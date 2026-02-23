import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScaffoldConfiguration } from './scaffold-config.entity';
import { CalculatedQuantity } from './calculated-quantity.entity';
import { ScaffoldMaterial } from './scaffold-material.entity';
import { ScaffoldCalculatorService, ScaffoldCalculationResult } from './scaffold-calculator.service';
import { ScaffoldCalculatorWakugumiService } from './scaffold-calculator-wakugumi.service';
import { CreateScaffoldConfigDto } from './dto/create-config.dto';
import { ALL_RULES } from './scaffold-rules';
import { ALL_WAKUGUMI_RULES } from './scaffold-rules-wakugumi';
import { PolygonToWallsService } from './polygon-to-walls.service';

@Injectable()
export class ScaffoldConfigService {
  private readonly logger = new Logger(ScaffoldConfigService.name);

  constructor(
    @InjectRepository(ScaffoldConfiguration)
    private configRepo: Repository<ScaffoldConfiguration>,
    @InjectRepository(CalculatedQuantity)
    private quantityRepo: Repository<CalculatedQuantity>,
    @InjectRepository(ScaffoldMaterial)
    private materialRepo: Repository<ScaffoldMaterial>,
    private calculatorService: ScaffoldCalculatorService,
    private calculatorWakugumiService: ScaffoldCalculatorWakugumiService,
    private polygonToWallsService: PolygonToWallsService,
  ) {}

  /**
   * Returns all dropdown options for the frontend (both kusabi + wakugumi).
   */
  getRules() {
    return {
      ...ALL_RULES,
      wakugumi: {
        frameSizeOptions: ALL_WAKUGUMI_RULES.frameSizeOptions,
        spanSizes: ALL_WAKUGUMI_RULES.spanSizes,
        spanOptions: ALL_WAKUGUMI_RULES.spanOptions,
        habakiCountOptions: ALL_WAKUGUMI_RULES.habakiCountOptions,
        endStopperTypeOptions: ALL_WAKUGUMI_RULES.endStopperTypeOptions,
      },
    };
  }

  /**
   * Create configuration AND run calculation in one step.
   */
  async createAndCalculate(
    dto: CreateScaffoldConfigDto,
    userId: string,
  ): Promise<{ config: ScaffoldConfiguration; result: ScaffoldCalculationResult; quantities: CalculatedQuantity[] }> {
    const scaffoldType = dto.scaffoldType || 'kusabi';
    this.logger.log(`Creating ${scaffoldType} scaffold config (mode: ${dto.mode})`);

    // ── Step 1: Convert polygon outline to walls if provided ──
    let wallsToCalculate = dto.walls.map(w => ({
      side: w.side,
      wallLengthMm: w.wallLengthMm,
      wallHeightMm: w.wallHeightMm,
      stairAccessCount: w.stairAccessCount,
      kaidanCount: w.kaidanCount,
      kaidanOffsets: w.kaidanOffsets,
      segments: w.segments,
    }));

    // NOTE: Removed polygon-to-walls conversion logic.
    // Walls are now passed directly from frontend as ordered segments from perimeter editor.

    // Save configuration
    const config = this.configRepo.create({
      projectId: dto.projectId,
      drawingId: dto.drawingId || null,
      mode: dto.mode,
      scaffoldType,
      structureType: dto.structureType || '改修工事', // Default to most complex
      buildingHeightMm: Math.max(...wallsToCalculate.map(w => w.wallHeightMm), 0),
      walls: wallsToCalculate.map(w => ({
        side: w.side,
        wallLengthMm: w.wallLengthMm,
        wallHeightMm: w.wallHeightMm,
        enabled: true,
        stairAccessCount: w.stairAccessCount,
        ...(w.segments && w.segments.length > 0 && { segments: w.segments }),
      })),
      scaffoldWidthMm: dto.scaffoldWidthMm,
      // Kusabi-specific
      preferredMainTatejiMm: dto.preferredMainTatejiMm || 1800,
      topGuardHeightMm: dto.topGuardHeightMm || 900,
      // Wakugumi-specific
      frameSizeMm: dto.frameSizeMm || 1700,
      habakiCountPerSpan: dto.habakiCountPerSpan || 2,
      endStopperType: dto.endStopperType || 'nuno',
      rentalType: dto.rentalType || null,
      rentalStartDate: dto.rentalStartDate ? new Date(dto.rentalStartDate) : null,
      rentalEndDate: dto.rentalEndDate ? new Date(dto.rentalEndDate) : null,
      createdBy: userId,
      status: 'configured',
    });

    const savedConfig = await this.configRepo.save(config) as ScaffoldConfiguration;

    // Run calculation — dispatch based on scaffold type
    let result: ScaffoldCalculationResult;

    if (scaffoldType === 'wakugumi') {
      result = this.calculatorWakugumiService.calculate({
        walls: wallsToCalculate,
        structureType: dto.structureType || '改修工事',
        scaffoldWidthMm: dto.scaffoldWidthMm,
        frameSizeMm: dto.frameSizeMm || 1700,
        habakiCountPerSpan: dto.habakiCountPerSpan || 2,
        endStopperType: dto.endStopperType || 'nuno',
        topGuardHeightMm: dto.topGuardHeightMm || 900,
      });
    } else {
      result = this.calculatorService.calculate({
        walls: wallsToCalculate,
        structureType: dto.structureType || '改修工事',
        scaffoldWidthMm: dto.scaffoldWidthMm,
        preferredMainTatejiMm: dto.preferredMainTatejiMm || 1800,
        topGuardHeightMm: dto.topGuardHeightMm || 900,
      });
    }

    // Store calculation result as JSON for quick retrieval
    // Include polygon vertices for accurate plan/3D rendering
    savedConfig.calculationResult = {
      ...result,
      ...(dto.buildingOutline && dto.buildingOutline.length >= 3 && {
        polygonVertices: dto.buildingOutline,
      }),
    };
    savedConfig.status = 'calculated';
    await this.configRepo.save(savedConfig);

    // Save individual quantity rows for editing
    // Auto-populate unit prices from scaffold_materials master
    const priceMap = await this.buildPriceMap(scaffoldType);

    const quantityEntities: CalculatedQuantity[] = [];

    // Save summary quantities (aggregated)
    for (const comp of result.summary) {
      let price = 0;
      
      // For Nuno Bars (布材), match by category + sizeSpec instead of materialCode
      if (comp.category === '布材' && comp.sizeSpec) {
        // Try to find any nuno bar type with matching size
        // Check tesuri, stopper, negarami, bearer codes for this size
        const size = comp.sizeSpec;
        const nunoCodes = [
          `KUSABI-TESURI-${size}`,
          `KUSABI-STOPPER-${size}`,
          `KUSABI-NEGR-${size}`,
          `KUSABI-BEARER-${size}`,
        ];
        
        // Use first available price (or average if multiple found)
        const prices = nunoCodes
          .map(code => priceMap.get(code))
          .filter((p): p is number => p !== undefined && p > 0);
        
        if (prices.length > 0) {
          // Use average price of all nuno bar types for this size
          price = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        }
      } else if (comp.materialCode) {
        // For other components, use materialCode
        price = priceMap.get(comp.materialCode) || 0;
      }
      
      quantityEntities.push(
        this.quantityRepo.create({
          configId: savedConfig.id,
          componentType: comp.type,
          componentName: comp.nameJp,
          sizeSpec: comp.sizeSpec,
          unit: comp.unit,
          calculatedQuantity: comp.quantity,
          adjustedQuantity: null,
          unitPrice: price,
          sortOrder: comp.sortOrder,
        }),
      );
    }

    if (priceMap.size > 0) {
      const pricedCount = quantityEntities.filter(q => q.unitPrice > 0).length;
      this.logger.log(`Auto-populated prices: ${pricedCount}/${quantityEntities.length} components from materials master`);
    }

    const savedQuantities = await this.quantityRepo.save(quantityEntities);

    return { config: savedConfig, result, quantities: savedQuantities };
  }

  async getConfig(id: string): Promise<ScaffoldConfiguration> {
    const config = await this.configRepo.findOne({
      where: { id },
    });
    if (!config) throw new NotFoundException('Scaffold configuration not found');
    return config;
  }

  async getConfigByDrawing(drawingId: string): Promise<ScaffoldConfiguration | null> {
    return await this.configRepo.findOne({
      where: { drawingId },
      order: { createdAt: 'DESC' },
    });
  }

  async getQuantities(configId: string): Promise<CalculatedQuantity[]> {
    return await this.quantityRepo.find({
      where: { configId },
      order: { sortOrder: 'ASC' },
    });
  }

  async updateQuantity(quantityId: string, adjustedQuantity: number, reason?: string): Promise<CalculatedQuantity> {
    const qty = await this.quantityRepo.findOne({ where: { id: quantityId } });
    if (!qty) throw new NotFoundException('Quantity record not found');

    qty.adjustedQuantity = adjustedQuantity;
    qty.adjustmentReason = reason || null;

    return await this.quantityRepo.save(qty);
  }

  async markReviewed(configId: string): Promise<ScaffoldConfiguration> {
    const config = await this.getConfig(configId);

    if (config.status !== 'calculated') {
      const quantities = await this.getQuantities(configId);
      if (quantities.length > 0) {
        config.status = 'calculated';
        await this.configRepo.save(config);
      } else {
        throw new BadRequestException(
          `Configuration must be calculated before review. Current status: '${config.status}'.`,
        );
      }
    }

    config.status = 'reviewed';
    return await this.configRepo.save(config);
  }

  async listConfigs(projectId?: string): Promise<ScaffoldConfiguration[]> {
    const query = this.configRepo.createQueryBuilder('config');
    if (projectId) {
      query.where('config.projectId = :projectId', { projectId });
    }
    query.orderBy('config.createdAt', 'DESC');
    return await query.getMany();
  }

  /**
   * Delete a scaffold configuration
   */
  async deleteConfig(configId: string): Promise<void> {
    const config = await this.configRepo.findOne({ where: { id: configId } });
    if (!config) {
      throw new Error('Configuration not found');
    }
    await this.configRepo.remove(config);
    this.logger.log(`Deleted scaffold config ${configId}`);
  }

  // ─── Materials Price Master ──────────────────────────────────

  /**
   * Build a Map of materialCode → rentalPriceMonthly from scaffold_materials.
   */
  private async buildPriceMap(scaffoldType: 'kusabi' | 'wakugumi' = 'kusabi'): Promise<Map<string, number>> {
    const materials = await this.materialRepo.find({
      where: { isActive: true, scaffoldType },
    });
    const map = new Map<string, number>();
    for (const m of materials) {
      if (m.code && Number(m.rentalPriceMonthly) > 0) {
        map.set(m.code, Number(m.rentalPriceMonthly));
      }
    }
    return map;
  }

  /**
   * List all active materials for the price master UI.
   */
  async listMaterials(scaffoldType?: 'kusabi' | 'wakugumi'): Promise<ScaffoldMaterial[]> {
    const where: any = {};
    if (scaffoldType) {
      where.scaffoldType = scaffoldType;
    }
    return await this.materialRepo.find({
      where,
      order: { sortOrder: 'ASC', category: 'ASC', code: 'ASC' },
    });
  }

  /**
   * Update a material's rental price (and optionally other fields).
   */
  async updateMaterialPrice(
    materialId: string,
    updates: { rentalPriceMonthly?: number; purchasePrice?: number; isActive?: boolean },
  ): Promise<ScaffoldMaterial> {
    const material = await this.materialRepo.findOne({ where: { id: materialId } });
    if (!material) throw new NotFoundException('Material not found');

    if (updates.rentalPriceMonthly !== undefined) {
      material.rentalPriceMonthly = updates.rentalPriceMonthly;
    }
    if (updates.purchasePrice !== undefined) {
      material.purchasePrice = updates.purchasePrice;
    }
    if (updates.isActive !== undefined) {
      material.isActive = updates.isActive;
    }

    return await this.materialRepo.save(material);
  }

  /**
   * Bulk update material prices.
   */
  async bulkUpdatePrices(
    updates: Array<{ id: string; rentalPriceMonthly: number }>,
  ): Promise<ScaffoldMaterial[]> {
    const results: ScaffoldMaterial[] = [];
    for (const update of updates) {
      const material = await this.materialRepo.findOne({ where: { id: update.id } });
      if (material) {
        material.rentalPriceMonthly = update.rentalPriceMonthly;
        results.push(await this.materialRepo.save(material));
      }
    }
    this.logger.log(`Bulk updated ${results.length} material prices`);
    return results;
  }

  /**
   * Seed initial materials if the table is empty.
   * Called on startup or via API.
   */
  async seedMaterials(): Promise<{ created: number; existing: number }> {
    const existingCount = await this.materialRepo.count({ where: { scaffoldType: 'kusabi' } });
    if (existingCount > 0) {
      return { created: 0, existing: existingCount };
    }

    const materials = this.getDefaultMaterials();
    const entities = materials.map(m => this.materialRepo.create(m));
    await this.materialRepo.save(entities);
    this.logger.log(`Seeded ${entities.length} kusabi scaffold materials`);
    return { created: entities.length, existing: 0 };
  }

  /**
   * Default kusabi scaffold materials with typical rental prices.
   */
  private getDefaultMaterials(): Partial<ScaffoldMaterial>[] {
    let sortOrder = 0;
    const materials: Partial<ScaffoldMaterial>[] = [];

    const add = (
      code: string,
      nameJp: string,
      nameEn: string,
      category: string,
      sizeSpec: string,
      unit: string,
      lengthMm: number | null,
      widthMm: number | null,
      weightKg: number | null,
      rentalPriceMonthly: number,
    ) => {
      sortOrder++;
      materials.push({
        code,
        nameJp,
        nameEn,
        category,
        scaffoldType: 'kusabi',
        sizeSpec,
        unit,
        standardLengthMm: lengthMm,
        standardWidthMm: widthMm,
        weightKg: weightKg,
        rentalPriceMonthly,
        purchasePrice: null,
        bundleQuantity: null,
        pipeDiameterMm: 48.6,
        isCombined: false,
        isActive: true,
        sortOrder,
      });
    };

    // ─── Foundation ──────────────────────────────
    add('KUSABI-JB', 'ジャッキベース', 'Jack Base', 'jack_base', '調整式', '本', null, null, 2.5, 20);

    // ─── Posts ────────────────────────────────────
    add('KUSABI-MA-18', '支柱 MA-18', 'Post MA-18', 'post', '1800mm', '本', 1800, null, 6.9, 40);
    add('KUSABI-MA-27', '支柱 MA-27', 'Post MA-27', 'post', '2700mm', '本', 2700, null, 10.0, 55);
    add('KUSABI-MA-36', '支柱 MA-36', 'Post MA-36', 'post', '3600mm', '本', 3600, null, 13.2, 70);

    // Top guard posts
    add('KUSABI-MA-9-TOP', '上部支柱 MA-9', 'Top Guard Post MA-9', 'post', '900mm', '本', 900, null, 3.8, 25);
    add('KUSABI-MA-13-TOP', '上部支柱 MA-13', 'Top Guard Post MA-13', 'post', '1350mm', '本', 1350, null, null, 30);
    add('KUSABI-MA-18-TOP', '上部支柱 MA-18', 'Top Guard Post MA-18', 'post', '1800mm', '本', 1800, null, 6.9, 40);

    // ─── Braces ──────────────────────────────────
    for (const size of [600, 900, 1200, 1500, 1800]) {
      add(`KUSABI-BRACE-${size}`, `ブレス`, `Brace ${size}mm`, 'brace', `L=${size}mm`, '本', size, null, null, size <= 900 ? 25 : 35);
    }

    // ─── Handrails ───────────────────────────────
    for (const size of [600, 900, 1200, 1500, 1800]) {
      add(`KUSABI-TESURI-${size}`, `手摺`, `Handrail ${size}mm`, 'handrail', `L=${size}mm`, '本', size, null, null, size <= 900 ? 20 : 30);
    }

    // ─── End Handrails (Stoppers) ────────────────
    for (const size of [600, 900, 1200]) {
      add(`KUSABI-STOPPER-${size}`, `端部手摺`, `End Handrail ${size}mm`, 'handrail', `L=${size}mm`, '本', size, null, null, 20);
    }

    // ─── Base Ties (Negarami) ────────────────────
    for (const size of [600, 900, 1200, 1500, 1800]) {
      add(`KUSABI-NEGR-${size}`, `根がらみ`, `Base Tie ${size}mm`, 'horizontal', `L=${size}mm`, '本', size, null, null, size <= 900 ? 15 : 22);
    }

    // ─── Plank Bearers (Width Yokoji) ────────────
    for (const size of [600, 900, 1200]) {
      add(`KUSABI-BEARER-${size}`, `踏板受け`, `Plank Bearer ${size}mm`, 'horizontal', `L=${size}mm`, '本', size, null, null, 18);
    }

    // ─── Full Planks (Anchi 500mm wide) ──────────
    for (const span of [600, 900, 1200, 1500, 1800]) {
      add(`KUSABI-ANCHI-500x${span}`, `踏板`, `Plank 500×${span}mm`, 'plank', `500×${span}mm`, '枚', span, 500, null, span <= 900 ? 45 : 65);
    }

    // ─── Half Planks (Anchi 240mm wide, for 900mm width) ─
    for (const span of [600, 900, 1200, 1500, 1800]) {
      add(`KUSABI-ANCHI-HALF-240x${span}`, `踏板 (半幅)`, `Half Plank 240×${span}mm`, 'plank', `240×${span}mm`, '枚', span, 240, null, span <= 900 ? 30 : 45);
    }

    // ─── Toe Boards (Habaki) ─────────────────────
    for (const size of [600, 900, 1200, 1500, 1800]) {
      add(`KUSABI-HABAKI-${size}`, `巾木`, `Toe Board ${size}mm`, 'toe_board', `L=${size}mm`, '枚', size, null, null, size <= 900 ? 15 : 22);
    }

    // ─── Stair Set ───────────────────────────────
    add('KUSABI-STAIR-SET', '階段セット', 'Stair Set', 'stairway', '1階段+2手摺+1ガード', 'セット', null, null, null, 300);

    return materials;
  }
}
