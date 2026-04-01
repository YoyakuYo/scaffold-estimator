import { Injectable, Logger } from '@nestjs/common';
import {
  fitSpansToWallLengthWakugumi,
  fitSpansToWallLengthWithCornerWakugumi,
  calculateLevelsWakugumi,
  WAKUGUMI_ANCHI_LAYOUT_BY_WIDTH,
  WAKUGUMI_CALC_RULES,
  WAKUGUMI_SHITASAN_SIZES,
  findNearestSizeWakugumi,
  WakugumiLevelCalcResult,
  type WakugumiFrameSeriesCode,
} from './scaffold-rules-wakugumi';
import { freeScaffoldEndCountForWall, reflexCornerInsetTotalMm } from './scaffold-rules';
import {
  WallCalculationInput,
  CalculatedComponent,
  WallCalculationResult,
  ScaffoldCalculationResult,
  WallSegment,
} from './scaffold-calculator.service';

/**
 * ═══════════════════════════════════════════════════════════════
 * 枠組足場 (Wakugumi / Frame Scaffold) Quantity Calculator Engine
 * ═══════════════════════════════════════════════════════════════
 *
 * Calculates per-wall and total quantities for all wakugumi components.
 *
 * Key differences from Kusabi:
 *   - Frame (建枠) instead of individual posts
 *   - Level height = 1700mm (FT-17 catalog)
 *   - Brace on BOTH faces (not just outer)
 *   - 下桟 (Shitasan) bottom horizontal instead of tesuri
 *   - No tesuri (手摺)
 *   - Habaki count user-selectable (1 or 2)
 *   - End stopper: nuno type or frame type
 */

export interface WakugumiCalculationInput {
  walls: WallCalculationInput[];
  structureType?: '改修工事' | 'S造' | 'RC造';
  scaffoldWidthMm: number;         // 600, 900, 1200 (from FT frame series)
  frameSizeMm: number;             // 1700 (FT-17)
  /** FT-617 / FT-917 / FT-1217 — walk-through frame width line */
  wakugumiFrameSeries?: WakugumiFrameSeriesCode;
  habakiCountPerSpan: number;      // 1 or 2
  endStopperType: 'nuno' | 'frame';
  /** @deprecated Ignored; one extra frame level is always applied. */
  topGuardHeightMm?: number;
  /** Corners that need pattanko (non-L-shaped). When omitted, PATTANKO is not added. */
  pattankoCornerCount?: number;
}

function getSideLabel(side: string): string {
  const map: Record<string, string> = {
    north: '北面',
    south: '南面',
    east: '東面',
    west: '西面',
  };
  if (map[side]) return map[side];
  if (side.startsWith('edge-')) {
    const num = parseInt(side.replace('edge-', ''), 10);
    return `辺${num + 1}`;
  }
  if (side.startsWith('segment-')) {
    const num = parseInt(side.replace('segment-', ''), 10);
    return `セグメント${num + 1}`;
  }
  return side;
}

@Injectable()
export class ScaffoldCalculatorWakugumiService {
  private readonly logger = new Logger(ScaffoldCalculatorWakugumiService.name);

  private readonly PATTERN_MULTIPLIERS: Record<'改修工事' | 'S造' | 'RC造', number> = {
    '改修工事': 1.25,
    'S造': 1.0,
    'RC造': 0.9,
  };

  calculate(input: WakugumiCalculationInput): ScaffoldCalculationResult {
    const structureType = input.structureType || '改修工事';
    const complexityMultiplier = this.PATTERN_MULTIPLIERS[structureType];
    this.logger.log(
      `Calculating wakugumi scaffold for ${input.walls.length} wall(s), ` +
      `frame: ${input.frameSizeMm}mm, pattern: ${structureType} (${complexityMultiplier}x)`
    );

    const wallResults: WallCalculationResult[] = [];

    for (let wallIndex = 0; wallIndex < input.walls.length; wallIndex++) {
      const wall = input.walls[wallIndex];
      const levelCalc = calculateLevelsWakugumi(wall.wallHeightMm, input.frameSizeMm);
      const result = this.calculateWall(wall, input, levelCalc, complexityMultiplier, wallIndex);
      wallResults.push(result);
    }

    const summary = this.aggregateComponents(wallResults);
    const maxLevels = Math.max(...wallResults.map(w => w.levelCalc.fullLevels), 0);

    // PATTANKO (パッタンコ): only at non-L-shaped corners (2 per corner per level). When pattankoCornerCount omitted, do not add.
    const pattankoCornerCount = input.pattankoCornerCount ?? 0;
    const pattankoQty = pattankoCornerCount * 2 * maxLevels;
    if (pattankoQty > 0) {
      summary.push({
        type: 'pattanko',
        category: '踏板',
        categoryEn: 'Plank',
        name: 'PATTANKO (corner filler)',
        nameJp: 'パッタンコ (PATTANKO)',
        sizeSpec: '角部用',
        unit: '枚',
        quantity: pattankoQty,
        sortOrder: 500,
        materialCode: 'PATTANKO',
      });
    }

    this.logger.log(`Wakugumi calculation complete: ${wallResults.length} walls, ${summary.length} material types`);

    return {
      scaffoldType: 'wakugumi',
      walls: wallResults,
      summary,
      scaffoldWidthMm: input.scaffoldWidthMm,
      preferredMainTatejiMm: input.frameSizeMm, // Use frame size for backward compat
      topGuardHeightMm: input.frameSizeMm,
      frameSizeMm: input.frameSizeMm,
      habakiCountPerSpan: input.habakiCountPerSpan,
      endStopperType: input.endStopperType,
      totalLevels: maxLevels,
      wakugumiFrameSeries: input.wakugumiFrameSeries,
    };
  }

  private calculateWall(
    wall: WallCalculationInput,
    input: WakugumiCalculationInput,
    levelCalc: WakugumiLevelCalcResult,
    complexityMultiplier: number,
    wallIndex: number = 0,
  ): WallCalculationResult {
    const widthMm = wall.scaffoldWidthMm ?? input.scaffoldWidthMm;
    const useCornerLogic = input.walls.length >= 2;
    const spans = useCornerLogic
      ? fitSpansToWallLengthWithCornerWakugumi(wall.wallLengthMm, widthMm, {
          startCornerKind: wall.startCornerKind,
          endCornerKind: wall.endCornerKind,
        })
      : fitSpansToWallLengthWakugumi(wall.wallLengthMm, { northWall: wallIndex === 0 });
    const cornerPostDeduction =
      useCornerLogic && input.walls.length >= 2
        ? (wallIndex > 0 ? 2 : 0) +
          (input.walls.length >= 3 && wallIndex === input.walls.length - 1 ? 2 : 0)
        : 0;
    const totalSpans = spans.length;
    const postPositions = totalSpans + 1;
    const L = levelCalc.fullLevels;
    /** 最上は常にもう一段建枠（L+1） */
    const Ltot = L + 1;

    // ─── Kaidan offset → span index mapping ──────────────
    const findKaidanSpanIndex = (offsetMm: number): number => {
      const positions: number[] = [0];
      let accum = 0;
      for (const span of spans) {
        accum += span;
        positions.push(accum);
      }
      let closestIdx = 0;
      let minDist = Math.abs(offsetMm - positions[0]);
      for (let i = 1; i < positions.length; i++) {
        const dist = Math.abs(offsetMm - positions[i]);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = i;
        }
      }
      if (closestIdx > 0 && offsetMm < positions[closestIdx]) {
        return Math.max(0, closestIdx - 1);
      }
      return Math.min(closestIdx, totalSpans - 2);
    };

    const kaidanCount = wall.kaidanCount ?? wall.stairAccessCount;
    const kaidanOffsets = wall.kaidanOffsets || [];
    const kaidanSpanIndices: number[] = [];

    if (kaidanOffsets.length > 0) {
      for (const offset of kaidanOffsets) {
        const spanIdx = findKaidanSpanIndex(offset);
        if (!kaidanSpanIndices.includes(spanIdx)) {
          kaidanSpanIndices.push(spanIdx);
        }
      }
      kaidanSpanIndices.sort((a, b) => a - b);
    } else if (kaidanCount > 0) {
      for (let i = 0; i < kaidanCount; i++) {
        const idx = Math.floor((i + 1) * totalSpans / (kaidanCount + 1));
        const clamped = Math.max(0, Math.min(totalSpans - 2, idx));
        if (!kaidanSpanIndices.includes(clamped)) {
          kaidanSpanIndices.push(clamped);
        }
      }
      kaidanSpanIndices.sort((a, b) => a - b);
    }

    const needsExtendedBay = widthMm <= 600 && kaidanSpanIndices.length > 0;
    const spanGroups = this.groupSpansBySize(spans);

    const components: CalculatedComponent[] = [];
    let sortOrder = 0;

    const CAT = {
      foundation:  { jp: '基礎部材',   en: 'Foundation' },
      frame:       { jp: '建枠',       en: 'Frame' },
      brace:       { jp: 'ブレス',     en: 'Brace' },
      shitasan:    { jp: '下桟',       en: 'Bottom Bar' },
      platform:    { jp: '踏板',       en: 'Plank' },
      habaki:      { jp: '巾木',       en: 'Toe Board' },
      stopper:     { jp: '端部',       en: 'End Stopper' },
      access:      { jp: '階段',       en: 'Stair' },
    };

    // ─── 1. ジャッキベース ────────────────────────────────
    sortOrder++;
    components.push({
      type: 'jack_base',
      category: CAT.foundation.jp,
      categoryEn: CAT.foundation.en,
      name: 'Jack Base',
      nameJp: 'ジャッキベース',
      sizeSpec: '調整式',
      unit: '本',
      quantity: Math.max(0, postPositions * 2 - cornerPostDeduction),
      sortOrder,
      materialCode: 'SHARED-JB-400',
    });

    // ─── 2. 建枠 (Waku / Frame) ─────────────────────────
    // (N+1) × 2 rows × Ltot — 上部入力時は **もう一段の建枠**（別品目 上部手摺枠 は出さない）
    sortOrder++;
    components.push({
      type: 'waku_frame',
      category: CAT.frame.jp,
      categoryEn: CAT.frame.en,
      name: `Frame ${input.frameSizeMm}mm`,
      nameJp: `建枠`,
      sizeSpec: `${input.frameSizeMm}`,
      unit: '枠',
      quantity: Math.max(0, postPositions * 2 * Ltot - cornerPostDeduction * Ltot),
      sortOrder,
      materialCode: `WAKU-FRAME-${input.frameSizeMm}`,
    });

    // ─── 3. ブレス (Brace) — BOTH faces ──────────────────
    // N × 2 (front + back) × L levels
    for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
      sortOrder++;
      components.push({
        type: 'brace',
        category: CAT.brace.jp,
        categoryEn: CAT.brace.en,
        name: `Brace ${spanSizeMm}mm`,
        nameJp: `ブレス`,
        sizeSpec: `${spanSizeMm}`,
        unit: '本',
        quantity: Number(count) * WAKUGUMI_CALC_RULES.bracePerSpanPerLevel * Ltot,
        sortOrder,
        materialCode: `WAKU-BRACE-${spanSizeMm}`,
      });
    }

    // ─── 5. 下桟 (Shitasan) — bottom horizontal, both faces ─
    // N × 2 × L levels
    for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
      sortOrder++;
      components.push({
        type: 'shitasan',
        category: CAT.shitasan.jp,
        categoryEn: CAT.shitasan.en,
        name: `Bottom Bar ${spanSizeMm}mm`,
        nameJp: `下桟`,
        sizeSpec: `${spanSizeMm}`,
        unit: '本',
        quantity: Number(count) * WAKUGUMI_CALC_RULES.shitasanPerSpanPerLevel * Ltot,
        sortOrder,
        materialCode: `WAKU-SHITASAN-${spanSizeMm}`,
      });
    }

    // ─── 6. 端部 (End Stopper) — free dead ends only (not 90° turns to next wall) ──
    const freeEnds = freeScaffoldEndCountForWall(wallIndex, input.walls.length);
    if (freeEnds > 0) {
      if (input.endStopperType === 'nuno') {
        const stopperSize = findNearestSizeWakugumi(widthMm, WAKUGUMI_SHITASAN_SIZES);
        sortOrder++;
        components.push({
          type: 'end_stopper_nuno',
          category: CAT.stopper.jp,
          categoryEn: CAT.stopper.en,
          name: `End Stopper (Nuno) ${stopperSize}mm`,
          nameJp: `端部布材`,
          sizeSpec: `${stopperSize}`,
          unit: '本',
          quantity: WAKUGUMI_CALC_RULES.stoppersPerEndPerLevel_nuno * freeEnds * Ltot,
          sortOrder,
          materialCode: `WAKU-STOPPER-${widthMm}`,
        });
      } else {
        sortOrder++;
        components.push({
          type: 'end_stopper_frame',
          category: CAT.stopper.jp,
          categoryEn: CAT.stopper.en,
          name: 'End Frame Stopper',
          nameJp: `妻側枠`,
          sizeSpec: '枠タイプ',
          unit: '枠',
          quantity: WAKUGUMI_CALC_RULES.stoppersPerEndPerLevel_frame * freeEnds * Ltot,
          sortOrder,
          materialCode: 'WAKU-END-FRAME',
        });
      }
    }

    // ─── 7. 踏板 / アンチ ────────────────────────────────
    const anchiLayout = WAKUGUMI_ANCHI_LAYOUT_BY_WIDTH[widthMm] || WAKUGUMI_ANCHI_LAYOUT_BY_WIDTH[600];
    const totalAnchiSlots = totalSpans * Ltot;

    // Stair replacement logic (same as kusabi)
    let stairReplacements = 0;
    if (!needsExtendedBay && kaidanSpanIndices.length > 0) {
      stairReplacements = kaidanSpanIndices.length * Ltot;
    }

    const spanEntries = Object.entries(spanGroups).sort(
      (a, b) => Number(b[0]) - Number(a[0]),
    );
    let remainingStairDeductions = stairReplacements;

    const anchiDeductions: Record<string, number> = {};
    for (const [spanSizeMm, count] of spanEntries) {
      const perSpanAnchi = anchiLayout.fullAnchiPerSpan * Number(count) * Ltot;
      const deduction = Math.min(remainingStairDeductions, perSpanAnchi);
      anchiDeductions[spanSizeMm] = deduction;
      remainingStairDeductions -= deduction;
    }

    for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
      sortOrder++;
      const perSpanAnchi = anchiLayout.fullAnchiPerSpan * Number(count) * Ltot;
      const stairDeduction = anchiDeductions[spanSizeMm] || 0;
      components.push({
        type: 'anchi',
        category: CAT.platform.jp,
        categoryEn: CAT.platform.en,
        name: `Plank ${anchiLayout.fullAnchiWidth}×${spanSizeMm}mm`,
        nameJp: `踏板`,
        sizeSpec: `${anchiLayout.fullAnchiWidth}×${spanSizeMm}`,
        unit: '枚',
        quantity: Math.max(0, perSpanAnchi - stairDeduction),
        sortOrder,
        materialCode: `WAKU-ANCHI-${anchiLayout.fullAnchiWidth}x${spanSizeMm}`,
      });
    }

    // Half anchi (900mm width)
    if (anchiLayout.halfAnchiWidth && anchiLayout.halfAnchiPerSpan > 0) {
      for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
        sortOrder++;
        components.push({
          type: 'anchi_half',
          category: CAT.platform.jp,
          categoryEn: CAT.platform.en,
          name: `Half Plank ${anchiLayout.halfAnchiWidth}×${spanSizeMm}mm`,
          nameJp: `踏板 (半幅)`,
          sizeSpec: `${anchiLayout.halfAnchiWidth}×${spanSizeMm}`,
          unit: '枚',
          quantity: anchiLayout.halfAnchiPerSpan * Number(count) * Ltot,
          sortOrder,
          materialCode: `WAKU-ANCHI-${anchiLayout.halfAnchiWidth}x${spanSizeMm}`,
        });
      }
    }

    // ─── 8. 巾木 (Habaki) ────────────────────────────────
    // N × (1 or 2) × L levels
    for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
      sortOrder++;
      components.push({
        type: 'habaki',
        category: CAT.habaki.jp,
        categoryEn: CAT.habaki.en,
        name: `Toe Board ${spanSizeMm}mm`,
        nameJp: `巾木`,
        sizeSpec: `${spanSizeMm}`,
        unit: '枚',
        quantity: Number(count) * Ltot * input.habakiCountPerSpan,
        sortOrder,
        materialCode: `WAKU-HABAKI-${spanSizeMm}`,
      });
    }

    // ─── 9. 階段セット ──────────────────────────────────
    const finalKaidanCount = kaidanCount || wall.stairAccessCount;
    if (finalKaidanCount > 0) {
      sortOrder++;
      components.push({
        type: 'stair_set',
        category: CAT.access.jp,
        categoryEn: CAT.access.en,
        name: 'Stair Set',
        nameJp: '階段セット',
        sizeSpec: '1セット',
        unit: 'セット',
        quantity: finalKaidanCount * L,
        sortOrder,
        materialCode: 'WAKU-STAIR-SET',
      });
    }

    // ─── 10. 梁枠 (Hariwaku / Beam Frame) — door openings ──────
    const resolvedDoors: WallCalculationResult['doorOpenings'] = [];
    if (wall.doorOpenings && wall.doorOpenings.length > 0) {
      const cumulativePos: number[] = [0];
      let accum = 0;
      for (const s of spans) { accum += s; cumulativePos.push(accum); }

      for (const door of wall.doorOpenings) {
        const doorStart = door.positionMm - door.widthMm / 2;
        const doorEnd = door.positionMm + door.widthMm / 2;
        let startIdx = 0;
        let endIdx = 0;
        for (let si = 0; si < spans.length; si++) {
          if (cumulativePos[si] <= doorStart) startIdx = si;
          if (cumulativePos[si + 1] >= doorEnd) { endIdx = si; break; }
          endIdx = si;
        }
        const spanCount = Math.max(2, endIdx - startIdx + 1);
        let hariwakuMm = 0;
        for (let si = startIdx; si < startIdx + spanCount && si < spans.length; si++) {
          hariwakuMm += spans[si];
        }

        resolvedDoors.push({
          positionMm: door.positionMm,
          widthMm: door.widthMm,
          startSpanIndex: startIdx,
          spanCount,
          hariwakuSizeMm: hariwakuMm,
        });

        sortOrder++;
        components.push({
          type: 'hariwaku',
          category: '梁枠',
          categoryEn: 'Beam Frame',
          name: `Beam Frame (Hariwaku) ${spanCount} span`,
          nameJp: `梁枠 ${spanCount}スパン`,
          sizeSpec: `${hariwakuMm}mm (${spanCount}スパン)`,
          unit: '基',
          quantity: 1,
          sortOrder,
          materialCode: `HARIWAKU-${spanCount}SPAN`,
        });
      }
    }

    // Apply complexity multiplier
    if (complexityMultiplier !== 1.0) {
      for (const comp of components) {
        comp.quantity = Math.ceil(comp.quantity * complexityMultiplier);
      }
    }

    // Build LevelCalcResult compatible with kusabi interface
    const levelCalcCompat = {
      fullLevels: levelCalc.fullLevels,
      jackBaseAdjustmentMm: levelCalc.jackBaseAdjustmentMm,
      topPlankHeightMm: levelCalc.topPlankHeightMm,
      topGuardHeightMm: levelCalc.topGuardHeightMm,
      totalScaffoldHeightMm: levelCalc.totalScaffoldHeightMm,
      mainPostsPerLine: L,  // For wakugumi, 1 frame per level
      mainPostHeightMm: input.frameSizeMm,
      topGuardPostHeightMm: input.frameSizeMm,
    };

    const reflexInsetMmW = reflexCornerInsetTotalMm(wall.startCornerKind, wall.endCornerKind);
    const scaffoldFacadeBasisMmW =
      reflexInsetMmW > 0 ? Math.max(0, wall.wallLengthMm - reflexInsetMmW) : undefined;

    return {
      side: wall.side,
      sideJp: getSideLabel(wall.side),
      wallLengthMm: wall.wallLengthMm,
      wallHeightMm: wall.wallHeightMm,
      spans,
      totalSpans,
      postPositions,
      levelCalc: levelCalcCompat,
      stairAccessCount: kaidanCount || wall.stairAccessCount,
      kaidanSpanIndices: kaidanSpanIndices.length > 0 ? kaidanSpanIndices : undefined,
      needsExtendedBay,
      segments: wall.segments,
      components,
      scaffoldWidthMm: widthMm,
      layoutMode: wall.layoutMode ?? 'double_post',
      doorOpenings: resolvedDoors.length > 0 ? resolvedDoors : undefined,
      baseHeightMm: wall.baseHeightMm,
      tierGroup: wall.tierGroup,
      tierIndex: wall.tierIndex,
      ...(scaffoldFacadeBasisMmW != null ? { scaffoldFacadeBasisMm: scaffoldFacadeBasisMmW } : {}),
    };
  }

  private groupSpansBySize(spans: number[]): Record<string, number> {
    const groups: Record<string, number> = {};
    for (const s of spans) {
      const key = String(s);
      groups[key] = (groups[key] || 0) + 1;
    }
    return groups;
  }

  private aggregateComponents(walls: WallCalculationResult[]): CalculatedComponent[] {
    const map = new Map<string, CalculatedComponent>();

    for (const wall of walls) {
      for (const comp of wall.components) {
        const key = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
        const existing = map.get(key);
        if (existing) {
          existing.quantity += comp.quantity;
        } else {
          map.set(key, { ...comp });
        }
      }
    }

    const categoryOrder: Record<string, number> = {
      '基礎部材': 1,
      '建枠': 2,
      'ブレス': 3,
      '下桟': 4,
      '端部': 5,
      '踏板': 6,
      '巾木': 7,
      '階段': 8,
    };

    return Array.from(map.values()).sort((a, b) => {
      const catA = categoryOrder[a.category] || 99;
      const catB = categoryOrder[b.category] || 99;
      if (catA !== catB) return catA - catB;

      if (a.category === b.category) {
        const extractSize = (spec: string): number => {
          const match = spec.match(/(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        };
        const sizeA = extractSize(a.sizeSpec);
        const sizeB = extractSize(b.sizeSpec);
        if (sizeA !== sizeB) return sizeA - sizeB;
      }

      return a.sortOrder - b.sortOrder;
    });
  }
}
