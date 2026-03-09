import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ScaffoldConfiguration } from './scaffold-config.entity';
import { CalculatedQuantity } from './calculated-quantity.entity';
import { ScaffoldMaterial } from './scaffold-material.entity';
import { ScaffoldCalculatorService, ScaffoldCalculationResult } from './scaffold-calculator.service';
import { ScaffoldCalculatorWakugumiService } from './scaffold-calculator-wakugumi.service';
import { CreateScaffoldConfigDto } from './dto/create-config.dto';
import { ALL_RULES } from './scaffold-rules';
import { ALL_WAKUGUMI_RULES } from './scaffold-rules-wakugumi';
import { PolygonToWallsService } from './polygon-to-walls.service';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

@Injectable()
export class ScaffoldConfigService {
  private readonly logger = new Logger(ScaffoldConfigService.name);

  constructor(
    private readonly supabase: SupabaseService,
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

    const client = this.supabase.getClient();
    const configIns = mapPayloadToSnake<Record<string, unknown>>({
      projectId: dto.projectId,
      drawingId: dto.drawingId || null,
      mode: dto.mode,
      scaffoldType,
      structureType: dto.structureType || '改修工事',
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
      preferredMainTatejiMm: dto.preferredMainTatejiMm || 1800,
      topGuardHeightMm: dto.topGuardHeightMm || 900,
      frameSizeMm: dto.frameSizeMm || 1700,
      habakiCountPerSpan: dto.habakiCountPerSpan || 2,
      endStopperType: dto.endStopperType || 'nuno',
      rentalType: dto.rentalType || null,
      rentalStartDate: dto.rentalStartDate ? new Date(dto.rentalStartDate) : null,
      rentalEndDate: dto.rentalEndDate ? new Date(dto.rentalEndDate) : null,
      createdBy: userId,
      status: 'configured',
    });
    const { data: savedConfigRow, error: configErr } = await client.from('scaffold_configurations').insert(configIns).select().single();
    if (configErr || !savedConfigRow) {
      this.logger.error('Insert config failed', configErr);
      throw new BadRequestException('Failed to save configuration.');
    }
    const savedConfig = mapRowToCamel<ScaffoldConfiguration>(savedConfigRow as Record<string, unknown>)!;

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

    const calculationResult = {
      ...result,
      ...(dto.buildingOutline && dto.buildingOutline.length >= 3 && { polygonVertices: dto.buildingOutline }),
    };
    await client
      .from('scaffold_configurations')
      .update(mapPayloadToSnake({ calculationResult, status: 'calculated' }))
      .eq('id', savedConfig.id);
    savedConfig.calculationResult = calculationResult;
    savedConfig.status = 'calculated';

    const priceMap = await this.buildPriceMap(scaffoldType);
    const quantityInserts: Record<string, unknown>[] = [];
    for (const comp of result.summary) {
      let price = 0;
      if (comp.category === '布材' && comp.sizeSpec) {
        const size = comp.sizeSpec;
        const nunoCodes = [
          `KUSABI-TESURI-${size}`,
          `KUSABI-STOPPER-${size}`,
          `KUSABI-NEGR-${size}`,
          `KUSABI-BEARER-${size}`,
        ];
        const prices = nunoCodes.map(code => priceMap.get(code)).filter((p): p is number => p !== undefined && p > 0);
        if (prices.length > 0) price = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      } else if (comp.materialCode) {
        price = priceMap.get(comp.materialCode) || 0;
      }
      quantityInserts.push(
        mapPayloadToSnake({
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
      const pricedCount = quantityInserts.filter(q => Number((q as any).unit_price) > 0).length;
      this.logger.log(`Auto-populated prices: ${pricedCount}/${quantityInserts.length} components from materials master`);
    }
    let savedQuantities: CalculatedQuantity[] = [];
    if (quantityInserts.length > 0) {
      const { data: qRows, error: qErr } = await client.from('calculated_quantities').insert(quantityInserts).select();
      if (!qErr && qRows) savedQuantities = mapRowsToCamel<CalculatedQuantity>(qRows as Record<string, unknown>[]);
    }
    return { config: savedConfig, result, quantities: savedQuantities };
  }

  /**
   * Update an existing configuration and recalculate (same result shape as createAndCalculate).
   */
  async updateAndRecalculate(
    configId: string,
    dto: CreateScaffoldConfigDto,
    userId: string,
  ): Promise<{ config: ScaffoldConfiguration; result: ScaffoldCalculationResult; quantities: CalculatedQuantity[] }> {
    const config = await this.getConfig(configId);
    const scaffoldType = dto.scaffoldType || config.scaffoldType || 'kusabi';
    this.logger.log(`Updating and recalculating ${scaffoldType} config ${configId}`);

    const wallsToCalculate = dto.walls.map((w) => ({
      side: w.side,
      wallLengthMm: w.wallLengthMm,
      wallHeightMm: w.wallHeightMm,
      stairAccessCount: w.stairAccessCount,
      kaidanCount: w.kaidanCount,
      kaidanOffsets: w.kaidanOffsets,
      segments: w.segments,
    }));

    const client = this.supabase.getClient();
    await client.from('calculated_quantities').delete().eq('config_id', configId);

    const configUpdates = mapPayloadToSnake({
      mode: dto.mode,
      scaffoldType,
      structureType: dto.structureType || '改修工事',
      buildingHeightMm: Math.max(...wallsToCalculate.map((w) => w.wallHeightMm), 0),
      walls: wallsToCalculate.map((w) => ({
        side: w.side,
        wallLengthMm: w.wallLengthMm,
        wallHeightMm: w.wallHeightMm,
        enabled: true,
        stairAccessCount: w.stairAccessCount,
        ...(w.segments && w.segments.length > 0 && { segments: w.segments }),
      })),
      scaffoldWidthMm: dto.scaffoldWidthMm,
      preferredMainTatejiMm: dto.preferredMainTatejiMm ?? 1800,
      topGuardHeightMm: dto.topGuardHeightMm ?? 900,
      frameSizeMm: dto.frameSizeMm ?? 1700,
      habakiCountPerSpan: dto.habakiCountPerSpan ?? 2,
      endStopperType: dto.endStopperType ?? 'nuno',
      rentalType: dto.rentalType ?? null,
      rentalStartDate: dto.rentalStartDate ? new Date(dto.rentalStartDate) : null,
      rentalEndDate: dto.rentalEndDate ? new Date(dto.rentalEndDate) : null,
      calculationResult: null as any,
      status: 'calculated',
    });
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
    const calculationResult = {
      ...result,
      ...(dto.buildingOutline && dto.buildingOutline.length >= 3 && { polygonVertices: dto.buildingOutline }),
    };
    configUpdates.calculation_result = calculationResult;
    await client.from('scaffold_configurations').update(configUpdates).eq('id', configId);
    config.mode = dto.mode;
    config.scaffoldType = scaffoldType;
    config.structureType = dto.structureType || '改修工事';
    config.buildingHeightMm = Math.max(...wallsToCalculate.map((w) => w.wallHeightMm), 0);
    config.walls = wallsToCalculate.map((w) => ({ side: w.side, wallLengthMm: w.wallLengthMm, wallHeightMm: w.wallHeightMm, enabled: true, stairAccessCount: w.stairAccessCount, ...(w.segments && w.segments.length > 0 && { segments: w.segments }) }));
    config.scaffoldWidthMm = dto.scaffoldWidthMm;
    config.calculationResult = calculationResult;
    config.status = 'calculated';

    const priceMap = await this.buildPriceMap(scaffoldType);
    const quantityInserts: Record<string, unknown>[] = [];
    for (const comp of result.summary) {
      let price = 0;
      if (comp.category === '布材' && comp.sizeSpec) {
        const size = comp.sizeSpec;
        const nunoCodes = [`KUSABI-TESURI-${size}`, `KUSABI-STOPPER-${size}`, `KUSABI-NEGR-${size}`, `KUSABI-BEARER-${size}`];
        const prices = nunoCodes.map((code) => priceMap.get(code)).filter((p): p is number => p !== undefined && p > 0);
        if (prices.length > 0) price = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      } else if (comp.materialCode) {
        price = priceMap.get(comp.materialCode) || 0;
      }
      quantityInserts.push(
        mapPayloadToSnake({
          configId,
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
    let savedQuantities: CalculatedQuantity[] = [];
    if (quantityInserts.length > 0) {
      const { data: qRows } = await client.from('calculated_quantities').insert(quantityInserts).select();
      if (qRows) savedQuantities = mapRowsToCamel<CalculatedQuantity>(qRows as Record<string, unknown>[]);
    }
    return { config, result, quantities: savedQuantities };
  }

  async getConfig(id: string): Promise<ScaffoldConfiguration> {
    const { data: row, error } = await this.supabase.getClient().from('scaffold_configurations').select('*').eq('id', id).maybeSingle();
    if (error || !row) throw new NotFoundException('Scaffold configuration not found');
    const config = mapRowToCamel<ScaffoldConfiguration>(row as Record<string, unknown>);
    if (!config) throw new NotFoundException('Scaffold configuration not found');
    return config;
  }

  async getConfigByDrawing(drawingId: string): Promise<ScaffoldConfiguration | null> {
    const { data: rows } = await this.supabase
      .getClient()
      .from('scaffold_configurations')
      .select('*')
      .eq('drawing_id', drawingId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (!rows || rows.length === 0) return null;
    return mapRowToCamel<ScaffoldConfiguration>(rows[0] as Record<string, unknown>);
  }

  async getQuantities(configId: string): Promise<CalculatedQuantity[]> {
    const { data: rows } = await this.supabase
      .getClient()
      .from('calculated_quantities')
      .select('*')
      .eq('config_id', configId)
      .order('sort_order', { ascending: true });
    return mapRowsToCamel<CalculatedQuantity>(rows || []);
  }

  async updateQuantity(quantityId: string, adjustedQuantity: number, reason?: string): Promise<CalculatedQuantity> {
    const { data: row } = await this.supabase.getClient().from('calculated_quantities').select('*').eq('id', quantityId).maybeSingle();
    if (!row) throw new NotFoundException('Quantity record not found');
    const updates = mapPayloadToSnake({ adjustedQuantity, adjustmentReason: reason || null });
    const { data: saved, error } = await this.supabase.getClient().from('calculated_quantities').update(updates).eq('id', quantityId).select().single();
    if (error || !saved) throw new BadRequestException('Update failed.');
    return mapRowToCamel<CalculatedQuantity>(saved as Record<string, unknown>)!;
  }

  async markReviewed(configId: string): Promise<ScaffoldConfiguration> {
    const config = await this.getConfig(configId);
    if (config.status !== 'calculated') {
      const quantities = await this.getQuantities(configId);
      if (quantities.length > 0) {
        await this.supabase.getClient().from('scaffold_configurations').update(mapPayloadToSnake({ status: 'calculated' })).eq('id', configId);
        config.status = 'calculated';
      } else {
        throw new BadRequestException(`Configuration must be calculated before review. Current status: '${config.status}'.`);
      }
    }
    await this.supabase.getClient().from('scaffold_configurations').update(mapPayloadToSnake({ status: 'reviewed' })).eq('id', configId);
    config.status = 'reviewed';
    return config;
  }

  async listConfigs(projectId?: string): Promise<ScaffoldConfiguration[]> {
    let q = this.supabase.getClient().from('scaffold_configurations').select('*').order('created_at', { ascending: false });
    if (projectId) q = q.eq('project_id', projectId);
    const { data: rows } = await q;
    return mapRowsToCamel<ScaffoldConfiguration>(rows || []);
  }

  async deleteConfig(configId: string): Promise<void> {
    const { data: row } = await this.supabase.getClient().from('scaffold_configurations').select('id').eq('id', configId).maybeSingle();
    if (!row) throw new Error('Configuration not found');
    await this.supabase.getClient().from('calculated_quantities').delete().eq('config_id', configId);
    await this.supabase.getClient().from('scaffold_configurations').delete().eq('id', configId);
    this.logger.log(`Deleted scaffold config ${configId}`);
  }

  // ─── Materials Price Master ──────────────────────────────────

  /**
   * Build a Map of materialCode → rentalPriceMonthly from scaffold_materials.
   */
  private async buildPriceMap(scaffoldType: 'kusabi' | 'wakugumi' = 'kusabi'): Promise<Map<string, number>> {
    const { data: rows } = await this.supabase
      .getClient()
      .from('scaffold_materials')
      .select('code, rental_price_monthly')
      .eq('is_active', true)
      .eq('scaffold_type', scaffoldType);
    const materials = mapRowsToCamel<{ code: string; rentalPriceMonthly: number }>(rows || []);
    const map = new Map<string, number>();
    for (const m of materials) {
      if (m.code && Number(m.rentalPriceMonthly) > 0) map.set(m.code, Number(m.rentalPriceMonthly));
    }
    return map;
  }

  async listMaterials(scaffoldType?: 'kusabi' | 'wakugumi'): Promise<ScaffoldMaterial[]> {
    let q = this.supabase
      .getClient()
      .from('scaffold_materials')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('category', { ascending: true })
      .order('code', { ascending: true });
    if (scaffoldType) q = q.eq('scaffold_type', scaffoldType);
    const { data: rows } = await q;
    return mapRowsToCamel<ScaffoldMaterial>(rows || []);
  }

  async updateMaterialPrice(
    materialId: string,
    updates: { rentalPriceMonthly?: number; purchasePrice?: number; isActive?: boolean },
  ): Promise<ScaffoldMaterial> {
    const { data: row } = await this.supabase.getClient().from('scaffold_materials').select('*').eq('id', materialId).maybeSingle();
    if (!row) throw new NotFoundException('Material not found');
    const payload: Record<string, unknown> = {};
    if (updates.rentalPriceMonthly !== undefined) payload.rentalPriceMonthly = updates.rentalPriceMonthly;
    if (updates.purchasePrice !== undefined) payload.purchasePrice = updates.purchasePrice;
    if (updates.isActive !== undefined) payload.isActive = updates.isActive;
    if (Object.keys(payload).length === 0) return mapRowToCamel<ScaffoldMaterial>(row as Record<string, unknown>)!;
    const { data: saved, error } = await this.supabase.getClient().from('scaffold_materials').update(mapPayloadToSnake(payload)).eq('id', materialId).select().single();
    if (error || !saved) throw new BadRequestException('Update failed.');
    return mapRowToCamel<ScaffoldMaterial>(saved as Record<string, unknown>)!;
  }

  async bulkUpdatePrices(updates: Array<{ id: string; rentalPriceMonthly: number }>): Promise<ScaffoldMaterial[]> {
    const results: ScaffoldMaterial[] = [];
    for (const update of updates) {
      const { data: saved } = await this.supabase
        .getClient()
        .from('scaffold_materials')
        .update(mapPayloadToSnake({ rentalPriceMonthly: update.rentalPriceMonthly }))
        .eq('id', update.id)
        .select()
        .single();
      if (saved) results.push(mapRowToCamel<ScaffoldMaterial>(saved as Record<string, unknown>)!);
    }
    this.logger.log(`Bulk updated ${results.length} material prices`);
    return results;
  }

  async seedMaterials(): Promise<{ created: number; existing: number }> {
    const { count } = await this.supabase.getClient().from('scaffold_materials').select('*', { count: 'exact', head: true }).eq('scaffold_type', 'kusabi');
    if (count && count > 0) return { created: 0, existing: count };
    const materials = this.getDefaultMaterials();
    const inserts = materials.map((m) => mapPayloadToSnake(m as Record<string, unknown>));
    const { data: inserted } = await this.supabase.getClient().from('scaffold_materials').insert(inserts).select();
    const created = inserted?.length ?? 0;
    this.logger.log(`Seeded ${created} kusabi scaffold materials`);
    return { created, existing: 0 };
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
