import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ScaffoldConfiguration } from './scaffold-config.entity';
import { CalculatedQuantity } from './calculated-quantity.entity';
import { ScaffoldMaterial } from './scaffold-material.entity';
import { ScaffoldCalculatorService, ScaffoldCalculationResult, WallCalculationInput } from './scaffold-calculator.service';
import { ScaffoldCalculatorWakugumiService } from './scaffold-calculator-wakugumi.service';
import { CreateScaffoldConfigDto } from './dto/create-config.dto';
import { PatchResultLabelsDto } from './dto/patch-result-labels.dto';
import { ALL_RULES, KUSABI_TOP_GUARD_HEIGHT_MM } from './scaffold-rules';
import {
  ALL_WAKUGUMI_RULES,
  WAKUGUMI_FRAME_HEIGHT_MM,
  scaffoldWidthFromWakugumiFrameSeries,
  wakugumiFrameSeriesFromScaffoldWidthMm,
} from './scaffold-rules-wakugumi';
import { PolygonToWallsService } from './polygon-to-walls.service';
import { runParametricPipeline } from './parametric-scaffold.service';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';
import { correctLegacyMassingTiers } from './massing-tier-normalizer';

/** Supabase PostgREST column names for optional site / contact fields on scaffold_configurations. */
const SCAFFOLD_SITE_SNAKE_KEYS = ['site_name', 'site_address', 'site_email', 'site_phone', 'site_fax'] as const;

function stripScaffoldSiteSnakeKeys(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  for (const k of SCAFFOLD_SITE_SNAKE_KEYS) delete next[k];
  return next;
}

function isPostgrestMissingScaffoldSiteColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const o = err as { code?: string; message?: string };
  if (o.code !== 'PGRST204') return false;
  const msg = String(o.message ?? '');
  return SCAFFOLD_SITE_SNAKE_KEYS.some((k) => msg.includes(k));
}

@Injectable()
export class ScaffoldConfigService {
  private readonly logger = new Logger(ScaffoldConfigService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private calculatorService: ScaffoldCalculatorService,
    private calculatorWakugumiService: ScaffoldCalculatorWakugumiService,
    private polygonToWallsService: PolygonToWallsService,
  ) {}

  /** Non-empty site/contact fields from DTO for JSON fallback when DB has no site_* columns. */
  private scaffoldSiteContactFromDto(dto: CreateScaffoldConfigDto): Record<string, string | null> | null {
    const siteName = (dto.siteName ?? '').trim() || null;
    const siteAddress = (dto.siteAddress ?? '').trim() || null;
    const siteEmail = (dto.siteEmail ?? '').trim() || null;
    const sitePhone = (dto.sitePhone ?? '').trim() || null;
    const siteFax = (dto.siteFax ?? '').trim() || null;
    if (!siteName && !siteAddress && !siteEmail && !sitePhone && !siteFax) return null;
    return { siteName, siteAddress, siteEmail, sitePhone, siteFax };
  }

  /** Fills top-level site fields from calculationResult.siteContact (legacy DB without columns). */
  private hydrateSiteContactFromCalculationResult(config: ScaffoldConfiguration): void {
    const cr = config.calculationResult as Record<string, unknown> | null | undefined;
    const sc = cr?.siteContact;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return;
    const o = sc as Record<string, unknown>;
    const take = (field: keyof ScaffoldConfiguration, key: string) => {
      const cur = config[field];
      if (cur != null && String(cur).trim() !== '') return;
      const v = o[key];
      if (typeof v === 'string' && v.trim() !== '')
        (config as unknown as Record<string, unknown>)[field as string] = v;
    };
    take('siteName', 'siteName');
    take('siteAddress', 'siteAddress');
    take('siteEmail', 'siteEmail');
    take('sitePhone', 'sitePhone');
    take('siteFax', 'siteFax');
  }

  /** Wakugumi: FT frame series fixes level height (1700mm) and layout width (600/900/1200). */
  private applyWakugumiFrameSeries(dto: CreateScaffoldConfigDto): CreateScaffoldConfigDto {
    const series =
      dto.wakugumiFrameSeries ?? wakugumiFrameSeriesFromScaffoldWidthMm(dto.scaffoldWidthMm);
    return {
      ...dto,
      wakugumiFrameSeries: series,
      scaffoldWidthMm: scaffoldWidthFromWakugumiFrameSeries(series),
      frameSizeMm: WAKUGUMI_FRAME_HEIGHT_MM,
    };
  }

  /**
   * Returns all dropdown options for the frontend (both kusabi + wakugumi).
   */
  getRules() {
    return {
      ...ALL_RULES,
      wakugumi: {
        frameSizeOptions: ALL_WAKUGUMI_RULES.frameSizeOptions,
        frameSeriesOptions: ALL_WAKUGUMI_RULES.frameSeriesOptions,
        frameHeightMm: ALL_WAKUGUMI_RULES.frameHeightMm,
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
    const dtoForCalc = scaffoldType === 'wakugumi' ? this.applyWakugumiFrameSeries(dto) : dto;
    this.logger.log(`Creating ${scaffoldType} scaffold config (mode: ${dto.mode})`);

    // ── Step 1: Build walls with optional per-wall width from parametric pipeline ──
    let wallsToCalculate: WallCalculationInput[] = dto.walls.map((w) => ({
      side: w.side,
      wallLengthMm: w.wallLengthMm,
      wallHeightMm: w.wallHeightMm,
      stairAccessCount: w.stairAccessCount,
      kaidanCount: w.kaidanCount,
      kaidanOffsets: w.kaidanOffsets,
      segments: w.segments,
      scaffoldWidthMm: w.scaffoldWidthMm,
      baseHeightMm: w.baseHeightMm,
      tierGroup: w.tierGroup,
      tierIndex: w.tierIndex,
    }));

    // ── Corner kind inference from buildingOutline (convex vs reflex) ──
    // Used to apply special inner-corner rules: reflex corners use -300 inset and no forced terminal bay.
    if (dto.buildingOutline && dto.buildingOutline.length >= 3 && wallsToCalculate.length === dto.buildingOutline.length) {
      const pts = dto.buildingOutline.map((v) => ({
        x: typeof (v as any).xFrac === 'number' ? (v as any).xFrac : (v as any).x ?? 0,
        y: typeof (v as any).yFrac === 'number' ? (v as any).yFrac : (v as any).y ?? 0,
      }));
      const n = pts.length;
      let area2 = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area2 += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      }
      const isCCW = area2 > 0;
      const isReflex: boolean[] = Array.from({ length: n }, () => false);
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const curr = pts[i];
        const next = pts[(i + 1) % n];
        const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
        const reflex = isCCW ? cross < 0 : cross > 0;
        isReflex[i] = reflex;
      }
      wallsToCalculate = wallsToCalculate.map((w, i) => ({
        ...w,
        startCornerKind: isReflex[i] ? 'reflex' : 'convex',
        endCornerKind: isReflex[(i + 1) % n] ? 'reflex' : 'convex',
      }));
    }

    // ── Step 2: Run parametric pipeline when we have buildingOutline + (obstacles or widthBySide) ──
    let parametricTransitions: ScaffoldCalculationResult['parametricTransitions'];
    const hasOutline = dto.buildingOutline && dto.buildingOutline.length >= 3;
    const hasObstacles = dto.obstacles && dto.obstacles.length > 0;
    const hasWidthBySide = dto.widthBySide && Object.keys(dto.widthBySide).length > 0;

    if (hasOutline && (hasObstacles || hasWidthBySide) && wallsToCalculate.length >= 3) {
      const widthBySide: Record<number | string, number> = { ...(dto.widthBySide ?? {}) };
      for (let i = 0; i < wallsToCalculate.length; i++) {
        const w = wallsToCalculate[i];
        const sideKey = w.side.toLowerCase();
        if (widthBySide[sideKey] == null && widthBySide[i] == null) {
          widthBySide[i] = dtoForCalc.scaffoldWidthMm;
          widthBySide[sideKey] = dtoForCalc.scaffoldWidthMm;
        }
      }
      const refMm = 10000;
      const spatialObs = (dto.obstacles ?? []).filter((o) => o.type !== 'door');
      const parametric = runParametricPipeline(
        dto.buildingOutline!,
        spatialObs.map((o) =>
          o.type === 'pillar' && 'center' in o && 'radiusMm' in o
            ? { type: 'pillar' as const, center: o.center, radiusMm: o.radiusMm }
            : { type: o.type as 'balcony' | 'ac', vertices: (o as any).vertices },
        ),
        widthBySide,
        refMm,
      );
      if (parametric.sideConfigs.length === wallsToCalculate.length) {
        wallsToCalculate = wallsToCalculate.map((w, i) => ({
          ...w,
          scaffoldWidthMm: parametric.sideConfigs[i].widthMm,
          layoutMode: parametric.sideConfigs[i].layoutMode,
        }));
        parametricTransitions = parametric.transitions.map((t) => ({
          cornerIndex: t.cornerIndex,
          edgeBefore: t.edgeBefore,
          edgeAfter: t.edgeAfter,
          widthBeforeMm: t.widthBeforeMm,
          widthAfterMm: t.widthAfterMm,
          innerPoint: t.innerPoint,
          outerBefore: t.outerBefore,
          outerAfter: t.outerAfter,
        }));
      }
    }

    // Inject door openings from obstacles into wall inputs
    if (dto.obstacles && dto.obstacles.length > 0) {
      const doorObs = dto.obstacles.filter((o): o is { type: 'door'; wallIndex?: number; positionMm?: number; widthMm?: number } => o.type === 'door');
      for (const door of doorObs) {
        const wi = door.wallIndex ?? 0;
        if (wi >= 0 && wi < wallsToCalculate.length) {
          const wall = wallsToCalculate[wi];
          if (!wall.doorOpenings) wall.doorOpenings = [];
          wall.doorOpenings.push({
            positionMm: door.positionMm ?? Math.round(wall.wallLengthMm / 2),
            widthMm: door.widthMm ?? 1800,
          });
        }
      }
    }

    const client = this.supabase.getClient();
    const configIns = mapPayloadToSnake({
      projectId: dto.projectId,
      drawingId: dto.drawingId || null,
      mode: dto.mode,
      scaffoldType,
      structureType: dto.structureType || '改修工事',
      siteName: (dto.siteName ?? '').trim() || null,
      siteAddress: (dto.siteAddress ?? '').trim() || null,
      siteEmail: (dto.siteEmail ?? '').trim() || null,
      sitePhone: (dto.sitePhone ?? '').trim() || null,
      siteFax: (dto.siteFax ?? '').trim() || null,
      buildingHeightMm: Math.max(...wallsToCalculate.map(w => w.wallHeightMm), 0),
      walls: wallsToCalculate.map(w => ({
        side: w.side,
        wallLengthMm: w.wallLengthMm,
        wallHeightMm: w.wallHeightMm,
        enabled: true,
        stairAccessCount: w.stairAccessCount,
        ...(w.segments && w.segments.length > 0 && { segments: w.segments }),
        ...(w.scaffoldWidthMm != null && { scaffoldWidthMm: w.scaffoldWidthMm }),
        ...(w.baseHeightMm != null && { baseHeightMm: w.baseHeightMm }),
        ...(w.tierGroup != null && { tierGroup: w.tierGroup }),
        ...(w.tierIndex != null && { tierIndex: w.tierIndex }),
      })),
      scaffoldWidthMm: dtoForCalc.scaffoldWidthMm,
      // wallStandoffMm omitted from insert until migration 113 is applied; see calculationResult for value
      preferredMainTatejiMm: dto.preferredMainTatejiMm || 1800,
      topGuardHeightMm:
        scaffoldType === 'wakugumi' ? dtoForCalc.frameSizeMm || 1700 : KUSABI_TOP_GUARD_HEIGHT_MM,
      frameSizeMm: dtoForCalc.frameSizeMm || 1700,
      ...(scaffoldType === 'wakugumi' && dtoForCalc.wakugumiFrameSeries
        ? { wakugumiFrameSeries: dtoForCalc.wakugumiFrameSeries }
        : {}),
      habakiCountPerSpan: dto.habakiCountPerSpan || 2,
      endStopperType: dto.endStopperType || 'nuno',
      rentalType: dto.rentalType || null,
      rentalStartDate: dto.rentalStartDate ? new Date(dto.rentalStartDate) : null,
      rentalEndDate: dto.rentalEndDate ? new Date(dto.rentalEndDate) : null,
      createdBy: userId,
      status: 'configured',
    });
    let usedSiteColumnFallback = false;
    let { data: savedConfigRow, error: configErr } = await client
      .from('scaffold_configurations')
      .insert(configIns)
      .select()
      .single();
    if (configErr && isPostgrestMissingScaffoldSiteColumnError(configErr)) {
      this.logger.warn(
        'scaffold_configurations: site_* columns missing; retrying insert without them. Run migration AddScaffoldSiteContactColumns or supabase-migrations/019_scaffold_site_contact.sql.',
      );
      usedSiteColumnFallback = true;
      ({ data: savedConfigRow, error: configErr } = await client
        .from('scaffold_configurations')
        .insert(stripScaffoldSiteSnakeKeys(configIns as Record<string, unknown>))
        .select()
        .single());
    }
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
        scaffoldWidthMm: dtoForCalc.scaffoldWidthMm,
        frameSizeMm: dtoForCalc.frameSizeMm || 1700,
        wakugumiFrameSeries: dtoForCalc.wakugumiFrameSeries,
        habakiCountPerSpan: dto.habakiCountPerSpan || 2,
        endStopperType: dto.endStopperType || 'nuno',
        pattankoCornerCount: dto.pattankoCornerCount,
      });
    } else {
      result = this.calculatorService.calculate({
        walls: wallsToCalculate,
        structureType: dto.structureType || '改修工事',
        scaffoldWidthMm: dtoForCalc.scaffoldWidthMm,
        preferredMainTatejiMm: dto.preferredMainTatejiMm || 1800,
        pattankoCornerCount: dto.pattankoCornerCount,
      });
    }

    const standoffMm = dto.wallStandoffMm ?? 300;
    const correctedMassingTiers = correctLegacyMassingTiers(
      dto.buildingOutline as any,
      dto.massingTiers as any,
      result.walls as any,
    );
    const siteContactFallback = usedSiteColumnFallback ? this.scaffoldSiteContactFromDto(dto) : null;
    const calculationResult = {
      ...result,
      wallStandoffMm: standoffMm,
      ...(dto.buildingOutline && dto.buildingOutline.length >= 3 && { polygonVertices: dto.buildingOutline }),
      ...((correctedMassingTiers ?? dto.massingTiers) &&
        (correctedMassingTiers ?? dto.massingTiers)!.length > 0 && {
          massingTiers: correctedMassingTiers ?? dto.massingTiers,
        }),
      ...(dto.obstacles && dto.obstacles.length > 0 && { obstacles: dto.obstacles }),
      ...(parametricTransitions && parametricTransitions.length > 0 && { parametricTransitions }),
      ...(dto.ifcFileUrl && { ifcFileUrl: dto.ifcFileUrl }),
      ...(dto.bimFacadeColors && { bimFacadeColors: dto.bimFacadeColors }),
      ...(dto.edgeHashiraLabeling && { edgeHashiraLabeling: dto.edgeHashiraLabeling }),
      ...(siteContactFallback ? { siteContact: siteContactFallback } : {}),
    };
    await client
      .from('scaffold_configurations')
      .update(mapPayloadToSnake({ calculationResult, status: 'calculated' }))
      .eq('id', savedConfig.id);
    savedConfig.calculationResult = calculationResult;
    savedConfig.wallStandoffMm = standoffMm;
    savedConfig.status = 'calculated';
    this.hydrateSiteContactFromCalculationResult(savedConfig);

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
    const dtoForCalc = scaffoldType === 'wakugumi' ? this.applyWakugumiFrameSeries(dto) : dto;
    this.logger.log(`Updating and recalculating ${scaffoldType} config ${configId}`);

    let wallsToCalculate: WallCalculationInput[] = dto.walls.map((w) => ({
      side: w.side,
      wallLengthMm: w.wallLengthMm,
      wallHeightMm: w.wallHeightMm,
      stairAccessCount: w.stairAccessCount,
      kaidanCount: w.kaidanCount,
      kaidanOffsets: w.kaidanOffsets,
      segments: w.segments,
      scaffoldWidthMm: w.scaffoldWidthMm,
      baseHeightMm: w.baseHeightMm,
      tierGroup: w.tierGroup,
      tierIndex: w.tierIndex,
    }));

    const hasOutline = dto.buildingOutline && dto.buildingOutline.length >= 3;
    const hasObstacles = dto.obstacles && dto.obstacles.length > 0;
    const hasWidthBySide = dto.widthBySide && Object.keys(dto.widthBySide).length > 0;
    let parametricTransitions: ScaffoldCalculationResult['parametricTransitions'];

    if (hasOutline && (hasObstacles || hasWidthBySide) && wallsToCalculate.length >= 3) {
      const widthBySide: Record<number | string, number> = { ...(dto.widthBySide ?? {}) };
      for (let i = 0; i < wallsToCalculate.length; i++) {
        const w = wallsToCalculate[i];
        const sideKey = w.side.toLowerCase();
        if (widthBySide[sideKey] == null && widthBySide[i] == null) {
          widthBySide[i] = dtoForCalc.scaffoldWidthMm;
          widthBySide[sideKey] = dtoForCalc.scaffoldWidthMm;
        }
      }
      const refMm = 10000;
      const spatialObs = (dto.obstacles ?? []).filter((o) => o.type !== 'door');
      const parametric = runParametricPipeline(
        dto.buildingOutline!,
        spatialObs.map((o) =>
          o.type === 'pillar' && 'center' in o && 'radiusMm' in o
            ? { type: 'pillar' as const, center: o.center, radiusMm: o.radiusMm }
            : { type: o.type as 'balcony' | 'ac', vertices: (o as any).vertices },
        ),
        widthBySide,
        refMm,
      );
      if (parametric.sideConfigs.length === wallsToCalculate.length) {
        wallsToCalculate = wallsToCalculate.map((w, i) => ({
          ...w,
          scaffoldWidthMm: parametric.sideConfigs[i].widthMm,
          layoutMode: parametric.sideConfigs[i].layoutMode,
        }));
        parametricTransitions = parametric.transitions.map((t) => ({
          cornerIndex: t.cornerIndex,
          edgeBefore: t.edgeBefore,
          edgeAfter: t.edgeAfter,
          widthBeforeMm: t.widthBeforeMm,
          widthAfterMm: t.widthAfterMm,
          innerPoint: t.innerPoint,
          outerBefore: t.outerBefore,
          outerAfter: t.outerAfter,
        }));
      }
    }

    // Inject door openings from obstacles into wall inputs (update path)
    if (dto.obstacles && dto.obstacles.length > 0) {
      const doorObs = dto.obstacles.filter((o): o is { type: 'door'; wallIndex?: number; positionMm?: number; widthMm?: number } => o.type === 'door');
      for (const door of doorObs) {
        const wi = door.wallIndex ?? 0;
        if (wi >= 0 && wi < wallsToCalculate.length) {
          const wall = wallsToCalculate[wi] as any;
          if (!wall.doorOpenings) wall.doorOpenings = [];
          wall.doorOpenings.push({
            positionMm: door.positionMm ?? Math.round(wall.wallLengthMm / 2),
            widthMm: door.widthMm ?? 1800,
          });
        }
      }
    }

    const client = this.supabase.getClient();
    await client.from('calculated_quantities').delete().eq('config_id', configId);

    const wallStandoffMm = dto.wallStandoffMm ?? config.wallStandoffMm ?? (config.calculationResult as any)?.wallStandoffMm ?? 300;
    const configUpdates = mapPayloadToSnake({
      mode: dto.mode,
      scaffoldType,
      structureType: dto.structureType || '改修工事',
      siteName: (dto.siteName ?? '').trim() || null,
      siteAddress: (dto.siteAddress ?? '').trim() || null,
      siteEmail: (dto.siteEmail ?? '').trim() || null,
      sitePhone: (dto.sitePhone ?? '').trim() || null,
      siteFax: (dto.siteFax ?? '').trim() || null,
      buildingHeightMm: Math.max(...wallsToCalculate.map((w) => w.wallHeightMm), 0),
      walls: wallsToCalculate.map((w) => ({
        side: w.side,
        wallLengthMm: w.wallLengthMm,
        wallHeightMm: w.wallHeightMm,
        enabled: true,
        stairAccessCount: w.stairAccessCount,
        ...(w.segments && w.segments.length > 0 && { segments: w.segments }),
        ...(w.scaffoldWidthMm != null && { scaffoldWidthMm: w.scaffoldWidthMm }),
        ...(w.baseHeightMm != null && { baseHeightMm: w.baseHeightMm }),
        ...(w.tierGroup != null && { tierGroup: w.tierGroup }),
        ...(w.tierIndex != null && { tierIndex: w.tierIndex }),
      })),
      scaffoldWidthMm: dtoForCalc.scaffoldWidthMm,
      // wallStandoffMm omitted from update until migration 113 is applied
      preferredMainTatejiMm: dto.preferredMainTatejiMm ?? 1800,
      topGuardHeightMm:
        scaffoldType === 'wakugumi' ? dtoForCalc.frameSizeMm ?? 1700 : KUSABI_TOP_GUARD_HEIGHT_MM,
      frameSizeMm: dtoForCalc.frameSizeMm ?? 1700,
      ...(scaffoldType === 'wakugumi' && dtoForCalc.wakugumiFrameSeries
        ? { wakugumiFrameSeries: dtoForCalc.wakugumiFrameSeries }
        : {}),
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
        scaffoldWidthMm: dtoForCalc.scaffoldWidthMm,
        frameSizeMm: dtoForCalc.frameSizeMm || 1700,
        wakugumiFrameSeries: dtoForCalc.wakugumiFrameSeries,
        habakiCountPerSpan: dto.habakiCountPerSpan || 2,
        endStopperType: dto.endStopperType || 'nuno',
        pattankoCornerCount: dto.pattankoCornerCount,
      });
    } else {
      result = this.calculatorService.calculate({
        walls: wallsToCalculate,
        structureType: dto.structureType || '改修工事',
        scaffoldWidthMm: dtoForCalc.scaffoldWidthMm,
        preferredMainTatejiMm: dto.preferredMainTatejiMm || 1800,
        pattankoCornerCount: dto.pattankoCornerCount,
      });
    }
    const correctedMassingTiersUpd = correctLegacyMassingTiers(
      dto.buildingOutline as any,
      dto.massingTiers as any,
      result.walls as any,
    );
    const prevEdgeLabels = (config.calculationResult as Record<string, unknown> | null)?.edgeHashiraLabeling;
    const dtoEdgeLabels = (dto as { edgeHashiraLabeling?: unknown }).edgeHashiraLabeling;
    const keepEdgeHashiraLabeling =
      prevEdgeLabels !== null &&
      prevEdgeLabels !== undefined &&
      typeof prevEdgeLabels === 'object' &&
      !Array.isArray(prevEdgeLabels);

    const massingForResult = correctedMassingTiersUpd ?? dto.massingTiers;
    const keepMassingTiers =
      Array.isArray(massingForResult) && massingForResult.length > 0;

    let calculationResult: Record<string, unknown> = {
      ...result,
      wallStandoffMm: wallStandoffMm,
      ...(dto.buildingOutline && dto.buildingOutline.length >= 3 ? { polygonVertices: dto.buildingOutline } : {}),
      ...(keepMassingTiers ? { massingTiers: massingForResult } : {}),
      ...(dto.obstacles && dto.obstacles.length > 0 ? { obstacles: dto.obstacles } : {}),
      ...(parametricTransitions && parametricTransitions.length > 0 ? { parametricTransitions } : {}),
      ...(dto.ifcFileUrl ? { ifcFileUrl: dto.ifcFileUrl } : {}),
      ...(dto.bimFacadeColors ? { bimFacadeColors: dto.bimFacadeColors } : {}),
      ...(dtoEdgeLabels != null && typeof dtoEdgeLabels === 'object' && !Array.isArray(dtoEdgeLabels)
        ? { edgeHashiraLabeling: dtoEdgeLabels }
        : keepEdgeHashiraLabeling
          ? { edgeHashiraLabeling: prevEdgeLabels }
          : {}),
    };
    const siteContactPatch = this.scaffoldSiteContactFromDto(dto);
    const updatesPayload = configUpdates as Record<string, unknown>;
    updatesPayload.calculation_result = calculationResult;
    let { error: updErr } = await client.from('scaffold_configurations').update(updatesPayload).eq('id', configId);
    if (updErr && isPostgrestMissingScaffoldSiteColumnError(updErr)) {
      this.logger.warn(
        'scaffold_configurations: site_* columns missing on update; retrying without them. Run migration AddScaffoldSiteContactColumns or supabase-migrations/019_scaffold_site_contact.sql.',
      );
      if (siteContactPatch) {
        calculationResult = { ...calculationResult, siteContact: siteContactPatch };
      }
      const stripped = stripScaffoldSiteSnakeKeys(updatesPayload);
      stripped.calculation_result = calculationResult;
      ({ error: updErr } = await client.from('scaffold_configurations').update(stripped).eq('id', configId));
    }
    if (updErr) {
      this.logger.error('Update config failed', updErr);
      throw new BadRequestException('Failed to save configuration.');
    }
    config.mode = dto.mode;
    config.scaffoldType = scaffoldType;
    config.structureType = dto.structureType || '改修工事';
    config.siteName = (dto.siteName ?? '').trim() || null;
    config.siteAddress = (dto.siteAddress ?? '').trim() || null;
    config.siteEmail = (dto.siteEmail ?? '').trim() || null;
    config.sitePhone = (dto.sitePhone ?? '').trim() || null;
    config.siteFax = (dto.siteFax ?? '').trim() || null;
    config.buildingHeightMm = Math.max(...wallsToCalculate.map((w) => w.wallHeightMm), 0);
    config.walls = wallsToCalculate.map((w) => ({
      side: w.side,
      wallLengthMm: w.wallLengthMm,
      wallHeightMm: w.wallHeightMm,
      enabled: true,
      stairAccessCount: w.stairAccessCount,
      ...(w.segments && w.segments.length > 0 && { segments: w.segments }),
      ...(w.scaffoldWidthMm != null && { scaffoldWidthMm: w.scaffoldWidthMm }),
      ...(w.baseHeightMm != null && { baseHeightMm: w.baseHeightMm }),
      ...(w.tierGroup != null && { tierGroup: w.tierGroup }),
      ...(w.tierIndex != null && { tierIndex: w.tierIndex }),
    }));
    config.scaffoldWidthMm = dtoForCalc.scaffoldWidthMm;
    if (scaffoldType === 'wakugumi' && dtoForCalc.wakugumiFrameSeries) {
      config.wakugumiFrameSeries = dtoForCalc.wakugumiFrameSeries;
    }
    config.wallStandoffMm = wallStandoffMm;
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
    this.applyLegacyMassingCorrection(config);
    this.hydrateSiteContactFromCalculationResult(config);
    return config;
  }

  /**
   * Shallow-merge edge X/Y 支柱番号 into calculation_result (no recalculation).
   */
  async patchEdgeHashiraLabeling(
    configId: string,
    dto: PatchResultLabelsDto,
    _userId: string,
  ): Promise<ScaffoldConfiguration> {
    const config = await this.getConfig(configId);
    const prev = (config.calculationResult ?? {}) as Record<string, unknown>;
    const nextCr = {
      ...prev,
      edgeHashiraLabeling: dto.edgeHashiraLabeling,
    };
    const { error } = await this.supabase
      .getClient()
      .from('scaffold_configurations')
      .update(mapPayloadToSnake({ calculationResult: nextCr }))
      .eq('id', configId);
    if (error) throw new BadRequestException('Failed to save plan labels.');
    config.calculationResult = nextCr as any;
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
    const cfg = mapRowToCamel<ScaffoldConfiguration>(rows[0] as Record<string, unknown>);
    if (!cfg) return null;
    this.applyLegacyMassingCorrection(cfg);
    return cfg;
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
    const list = mapRowsToCamel<ScaffoldConfiguration>(rows || []);
    for (const cfg of list) this.applyLegacyMassingCorrection(cfg);
    return list;
  }

  private applyLegacyMassingCorrection(config: ScaffoldConfiguration): void {
    const cr: any = config?.calculationResult;
    if (!cr || typeof cr !== 'object') return;
    const corrected = correctLegacyMassingTiers(
      cr.polygonVertices as any,
      cr.massingTiers as any,
      (cr.walls as any[]) ?? (config.walls as any[]),
    );
    if (corrected && corrected.length >= 2) {
      cr.massingTiers = corrected as any;
      config.calculationResult = cr;
    }
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
