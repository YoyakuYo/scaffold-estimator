/**
 * ═══════════════════════════════════════════════════════════════
 * 枠組足場 (Wakugumi / Frame Scaffold) — Material Library & Rules
 * ═══════════════════════════════════════════════════════════════
 *
 * Scaffold type: Wakugumi (枠組足場)
 * All material specs, calculation rules, and dropdown options
 * are defined here — NOT hardcoded anywhere else.
 *
 * To change any business rule, edit THIS file only.
 */

import {
  SizeOption,
  AnchiLayout,
  expandMiddleSpansToTargetCount,
  exactSumWithStandardSpans,
  SPAN_OPTIONS,
  SPAN_SIZES,
} from './scaffold-rules';

// ─── Frame Size Options (建枠サイズ) ──────────────────────────
// The frame size = level height (variable, unlike kusabi's fixed 1800mm)

/** Level height for wakugumi — catalog FT-17 (1700mm) walk-through frames. */
export const WAKUGUMI_FRAME_HEIGHT_MM = 1700;

export const WAKUGUMI_FRAME_SIZE_OPTIONS: SizeOption[] = [
  { value: 1700, label: '1700mm (FT-17)' },
];

/** Walk-through frame product line (width between posts). Maps to layout width 600/900/1200. */
export type WakugumiFrameSeriesCode = 'FT617' | 'FT917' | 'FT1217';

export const WAKUGUMI_FRAME_SERIES_OPTIONS: Array<{
  value: WakugumiFrameSeriesCode;
  label: string;
  labelJp: string;
  /** Nominal catalog width (mm) — brace/shitasan nearest sizes */
  catalogWidthMm: number;
  /** Scaffold width for plank layout (600 / 900 / 1200) */
  scaffoldWidthMm: number;
}> = [
  { value: 'FT617', label: 'FT-617 (610mm wide)', labelJp: 'FT-617（幅610mm）', catalogWidthMm: 610, scaffoldWidthMm: 600 },
  { value: 'FT917', label: 'FT-917 (914mm wide)', labelJp: 'FT-917（幅914mm）', catalogWidthMm: 914, scaffoldWidthMm: 900 },
  { value: 'FT1217', label: 'FT-1217 (1219mm wide)', labelJp: 'FT-1217（幅1219mm）', catalogWidthMm: 1219, scaffoldWidthMm: 1200 },
];

export function scaffoldWidthFromWakugumiFrameSeries(code: WakugumiFrameSeriesCode): number {
  const row = WAKUGUMI_FRAME_SERIES_OPTIONS.find((o) => o.value === code);
  return row?.scaffoldWidthMm ?? 900;
}

export function wakugumiFrameSeriesFromScaffoldWidthMm(widthMm: number): WakugumiFrameSeriesCode {
  if (widthMm <= 600) return 'FT617';
  if (widthMm <= 900) return 'FT917';
  return 'FT1217';
}

// ─── Span Sizes ─────────────────────────────────────────────
// Single catalog shared with くさび式 (kusabi).

export const WAKUGUMI_SPAN_SIZES: number[] = SPAN_SIZES;
export const WAKUGUMI_SPAN_OPTIONS: SizeOption[] = SPAN_OPTIONS;

// ─── Scaffold Width Options (足場幅) ────────────────────────
// Same as kusabi: 600, 900, 1200mm

export const WAKUGUMI_SCAFFOLD_WIDTH_OPTIONS: SizeOption[] = [
  { value: 600,  label: '600mm (標準)' },
  { value: 900,  label: '900mm (広幅)' },
  { value: 1200, label: '1200mm (超広幅)' },
];

// ─── Habaki Count Options ───────────────────────────────────
// User selects 1 or 2 habaki per span

export const WAKUGUMI_HABAKI_COUNT_OPTIONS: SizeOption[] = [
  { value: 1, label: '1枚 (片面)' },
  { value: 2, label: '2枚 (両面)' },
];

// ─── End Stopper Type Options ───────────────────────────────

export const WAKUGUMI_END_STOPPER_TYPE_OPTIONS = [
  { value: 'nuno',  label: '布材タイプ (端部布材)' },
  { value: 'frame', label: '枠タイプ (妻側枠)' },
];

// ─── Plank / Anchi Layout by Width ──────────────────────────
// Same logic as kusabi

export const WAKUGUMI_ANCHI_LAYOUT_BY_WIDTH: Record<number, AnchiLayout> = {
  600:  { fullAnchiWidth: 500, fullAnchiPerSpan: 1, halfAnchiPerSpan: 0 },
  900:  { fullAnchiWidth: 500, fullAnchiPerSpan: 1, halfAnchiWidth: 240, halfAnchiPerSpan: 1 },
  1200: { fullAnchiWidth: 500, fullAnchiPerSpan: 2, halfAnchiPerSpan: 0 },
};

// ─── Brace Sizes ────────────────────────────────────────────
// Matches span sizes

export const WAKUGUMI_BRACE_SIZES: number[] = SPAN_SIZES;

// ─── Shitasan (下桟) Sizes ──────────────────────────────────
// Bottom horizontal bar, matches span sizes

export const WAKUGUMI_SHITASAN_SIZES: number[] = SPAN_SIZES;

// ─── Habaki (巾木) Sizes ────────────────────────────────────

export const WAKUGUMI_HABAKI_SIZES: number[] = SPAN_SIZES;

// ─── Negarami (根がらみ) Sizes ──────────────────────────────

/** @deprecated Negarami is not counted as separate material for wakugumi (ties are integral to frame system). */
export const WAKUGUMI_NEGARAMI_SIZES: number[] = SPAN_SIZES;

// ─── Stair Set ──────────────────────────────────────────────

export const WAKUGUMI_STAIR_SET = {
  nameJp: '階段セット',
  unit: 'セット',
};

// ─── Stair Access Options ───────────────────────────────────

export const WAKUGUMI_STAIR_ACCESS_OPTIONS: SizeOption[] = [
  { value: 1, label: '1箇所' },
  { value: 2, label: '2箇所' },
  { value: 3, label: '3箇所' },
  { value: 4, label: '4箇所' },
];

// ─── Jack Base ──────────────────────────────────────────────

export const WAKUGUMI_JACK_BASE = {
  minMm: 0,
  maxMm: 300,
  nameJp: 'ジャッキベース',
  unit: '本',
};

// ─── Calculation Constants ──────────────────────────────────

export const WAKUGUMI_CALC_RULES = {
  /** Top plank must be within 0~200mm of building top */
  topPlankToleranceMm: 200,

  /** Jack base adjustment range */
  jackBaseMinMm: 0,
  jackBaseMaxMm: 300,

  /**
   * Per span per level — inner row and outer row each get one **set**:
   * one set = 1 下桟 + 1 ブレス on that face (内列・外列それぞれ 1 セット/スパン/段).
   * Totals: 2 ブレス + 2 下桟 per span per level.
   * - Tesuri: 0 (NOT used in wakugumi)
   * - Habaki: 1 or 2 per span (user-selectable)
   * 相間ブラケット・装間ネットは枠組では使用しない（BOM に出さない）。
   */
  bracePerSpanPerLevel: 2,       // 1 per face × 2 faces
  shitasanPerSpanPerLevel: 2,   // 1 per face × 2 faces
  tesuriPerSpanPerLevel: 0,      // not used

  /**
   * End Stopper (multiply by `freeScaffoldEndCountForWall` × levels — not always 2 ends):
   * - Nuno: 2 bars per **free** dead end per level
   * - Frame: 1 per free dead end per level
   */
  stoppersPerEndPerLevel_nuno: 2,   // nuno bars per free end
  stoppersPerEndPerLevel_frame: 1,  // frame stopper per free end

  /**
   * Waku (建枠) — double row:
   * - Positions = N+1 (sharing principle)
   * - × 2 rows (front + back)
   * - × L levels
   */

  /**
   * Jack bases:
   * - Post positions × 2 rows
   * - Count only
   */
};

// ─── Corner alignment (足場コーナー詳細図) ─────────────────────
/** Last two posts extend this far past the building corner (mm). */
export const WAKUGUMI_CORNER_OVERRUN_MM = 300;
/**
 * Terminal span into the turn (mm) — 2尺. Total run = wall + 300mm so last posts sit past the corner.
 */
export const WAKUGUMI_CORNER_SPAN_MM = 600;
/** First span along each wall after the corner (mm) — 6尺. */
export const WAKUGUMI_CORNER_START_SPAN_MM = 1829;

// ─── Span Fitting Algorithm ─────────────────────────────────
/**
 * Given a wall length, find the optimal combination of standard spans
 * to fit.
 *
 * Corner alignment rule:
 * - Never leave a gap (total span length must be >= wall length).
 * - Prefer to keep the overrun small (≤ 300mm) to allow tight corner connections.
 * - If an overrun ≤ 300mm is impossible with standard spans, choose the smallest
 *   overrun achievable.
 * - North wall (wall index 0): last span may overrun up to 600mm to close corner with East.
 */
export function fitSpansToWallLengthWakugumi(
  wallLengthMm: number,
  options?: { northWall?: boolean },
): number[] {
  const maxOverrunMm = options?.northWall ? 600 : 300;
  return fitSpansToWallLengthWithOverrun(wallLengthMm, WAKUGUMI_SPAN_SIZES, maxOverrunMm);
}

/**
 * Span fitting for walls that meet at corners (closed polygon).
 * 1829 → middle → terminal (= nominal 足場幅 600/900/1200); run = wall + 300mm.
 * Short walls fall back to [t, …middle…, t].
 */
export function cornerTerminalSpanMmWakugumi(scaffoldWidthMm: number): number {
  const w = Number(scaffoldWidthMm);
  if (!Number.isFinite(w) || w <= 0) return WAKUGUMI_CORNER_SPAN_MM;
  if (w <= 600) return 600;
  if (w <= 900) return 900;
  return 1200;
}

export function fitSpansToWallLengthWithCornerWakugumi(
  wallLengthMm: number,
  scaffoldWidthMm: number = 600,
  options?: {
    /** Corner kind at the START of this wall (vertex i). Default: convex. */
    startCornerKind?: 'convex' | 'reflex';
    /** Corner kind at the END of this wall (vertex i+1). Default: convex. */
    endCornerKind?: 'convex' | 'reflex';
  },
): number[] {
  const terminal = cornerTerminalSpanMmWakugumi(scaffoldWidthMm);
  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) {
    return [WAKUGUMI_CORNER_START_SPAN_MM, terminal];
  }

  const startKind = options?.startCornerKind ?? 'convex';
  const endKind = options?.endCornerKind ?? 'convex';
  const startIsConvex = startKind !== 'reflex';
  const endIsConvex = endKind !== 'reflex';

  if (!startIsConvex || !endIsConvex) {
    const reflexInset =
      (startIsConvex ? 0 : WAKUGUMI_CORNER_OVERRUN_MM) + (endIsConvex ? 0 : WAKUGUMI_CORNER_OVERRUN_MM);
    const effectiveFacadeMm = Math.max(0, wallLengthMm - reflexInset);
    const prefix = startIsConvex ? [WAKUGUMI_CORNER_START_SPAN_MM] : [];
    const prefixSum = prefix.reduce((a, b) => a + b, 0);

    if (!endIsConvex) {
      const middleNeed = effectiveFacadeMm - prefixSum - terminal;
      if (middleNeed >= 0) {
        const middleExact = exactSumWithStandardSpans(middleNeed, WAKUGUMI_SPAN_SIZES);
        if (middleExact !== null) {
          return [...prefix, ...middleExact, terminal];
        }
      }
      const middleTarget = effectiveFacadeMm - prefixSum;
      if (middleTarget <= 0) return [...prefix];
      const middleSpans = fitSpansToWallLengthNoOverrun(middleTarget, WAKUGUMI_SPAN_SIZES);
      return [...prefix, ...middleSpans];
    }

    const suffix = [terminal];
    const runTarget = effectiveFacadeMm + WAKUGUMI_CORNER_OVERRUN_MM + terminal;
    const middleTarget = runTarget - prefixSum - terminal;
    if (middleTarget <= 0) return [...prefix, ...suffix];
    const middleSpans = fitSpansToWallLengthNoOverrun(middleTarget, WAKUGUMI_SPAN_SIZES);
    return [...prefix, ...middleSpans, ...suffix];
  }
  const totalRunMm = wallLengthMm + WAKUGUMI_CORNER_OVERRUN_MM;
  const middleMmNew = totalRunMm - WAKUGUMI_CORNER_START_SPAN_MM - terminal;

  if (middleMmNew < 0) {
    const middleLegacy = wallLengthMm + WAKUGUMI_CORNER_OVERRUN_MM - 2 * terminal;
    if (middleLegacy <= 0) {
      return [terminal, terminal];
    }
    const middleSpans = fitSpansToWallLengthWithOverrun(
      middleLegacy,
      WAKUGUMI_SPAN_SIZES,
      0,
    );
    return [terminal, ...middleSpans, terminal];
  }
  if (middleMmNew === 0) {
    return [WAKUGUMI_CORNER_START_SPAN_MM, terminal];
  }
  let middleSpans = fitSpansToWallLengthWithOverrun(
    middleMmNew,
    WAKUGUMI_SPAN_SIZES,
    0,
  );
  middleSpans = expandMiddleSpansToTargetCount(
    middleSpans,
    middleMmNew,
    WAKUGUMI_SPAN_SIZES,
    WAKUGUMI_CORNER_START_SPAN_MM,
  );
  return [WAKUGUMI_CORNER_START_SPAN_MM, ...middleSpans, terminal];
}

function fitSpansToWallLengthWithOverrun(
  wallLengthMm: number,
  spanSizesMm: number[],
  maxOverrunMm: number,
): number[] {
  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) return [];

  const sizes = [...spanSizesMm].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
  if (sizes.length === 0) return [];

  const max = sizes[0];
  const min = sizes[sizes.length - 1];

  const tailMaxCount = 10;
  const reserve = max * 4;
  const prefixCount = wallLengthMm > reserve ? Math.floor((wallLengthMm - reserve) / max) : 0;
  const prefixSum = prefixCount * max;
  const target = wallLengthMm - prefixSum;

  const tailMaxSum = target + Math.max(maxOverrunMm, max);
  const maxCountByMin = Math.ceil(tailMaxSum / min);
  const maxCount = Math.max(1, Math.min(tailMaxCount, maxCountByMin));

  type BestCandidate = { spans: number[]; sum: number; overrun: number; within: boolean };
  let best: BestCandidate | undefined;

  const betterThan = (a: BestCandidate, b: BestCandidate) => {
    if (a.within !== b.within) return a.within;
    if (a.overrun !== b.overrun) return a.overrun < b.overrun;
    if (a.spans.length !== b.spans.length) return a.spans.length < b.spans.length;
    for (let i = 0; i < Math.min(a.spans.length, b.spans.length); i++) {
      if (a.spans[i] !== b.spans[i]) return a.spans[i] > b.spans[i];
    }
    return false;
  };

  const dfs = (startIdx: number, chosen: number[], sum: number) => {
    if (sum >= target) {
      const overrun = sum - target;
      const within = overrun <= maxOverrunMm;
      const cand: BestCandidate = { spans: [...chosen], sum, overrun, within };
      if (!best || betterThan(cand, best)) best = cand;
      if (within && overrun === 0) return;
      return;
    }

    if (chosen.length >= maxCount) return;
    const remainingSlots = maxCount - chosen.length;
    if (sum + remainingSlots * max < target) return;

    for (let i = startIdx; i < sizes.length; i++) {
      const s = sizes[i];
      const nextSum = sum + s;
      if (best && best.within && nextSum - target > maxOverrunMm) continue;
      chosen.push(s);
      dfs(i, chosen, nextSum);
      chosen.pop();
    }
  };

  dfs(0, [], 0);

  const tail = best?.spans?.length ? best.spans : [min];
  const result = [...Array(prefixCount).fill(max), ...tail];
  const total = result.reduce((a, b) => a + b, 0);
  if (total < wallLengthMm) result.push(min);
  return result;
}

function fitSpansToWallLengthNoOverrun(
  wallLengthMm: number,
  spanSizesMm: number[],
): number[] {
  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) return [];
  const sizes = [...spanSizesMm].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a); // desc
  if (sizes.length === 0) return [];
  const max = sizes[0];
  const min = sizes[sizes.length - 1];

  const reserve = max * 6;
  const prefixCount = wallLengthMm > reserve ? Math.floor((wallLengthMm - reserve) / max) : 0;
  const prefix = Array(prefixCount).fill(max);
  const prefixSum = prefixCount * max;
  const remaining = wallLengthMm - prefixSum;
  if (remaining <= 0) return prefix;

  const maxCount = Math.min(10, Math.ceil(remaining / min) + 2);
  let best: number[] = [];
  let bestSum = 0;

  const dfs = (startIdx: number, acc: number[], sum: number) => {
    if (sum > remaining) return;
    if (sum > bestSum) {
      bestSum = sum;
      best = [...acc];
      if (bestSum === remaining) return;
    }
    if (acc.length >= maxCount) return;
    for (let i = startIdx; i < sizes.length; i++) {
      const s = sizes[i];
      if (sum + s > remaining) continue;
      acc.push(s);
      dfs(i, acc, sum + s);
      acc.pop();
      if (bestSum === remaining) return;
    }
  };
  dfs(0, [], 0);

  if (best.length === 0) return prefix;
  return [...prefix, ...best];
}

// ─── Level Calculation ──────────────────────────────────────
/**
 * Given building height and frame size, calculate levels.
 * Level height = frame size (variable, unlike kusabi's fixed 1800mm).
 */
export interface WakugumiLevelCalcResult {
  fullLevels: number;
  jackBaseAdjustmentMm: number;
  topPlankHeightMm: number;
  /** Extra vertical extent above top plank: one frame height (same as frameSizeMm). */
  topGuardHeightMm: number;
  totalScaffoldHeightMm: number;
  frameSizeMm: number;         // = level height
}

export function calculateLevelsWakugumi(
  buildingHeightMm: number,
  frameSizeMm: number,        // 1700, 1800, or 1900
): WakugumiLevelCalcResult {
  const levelH = frameSizeMm;

  let fullLevels = Math.floor(buildingHeightMm / levelH);
  let topPlank = fullLevels * levelH;
  let gap = buildingHeightMm - topPlank;

  if (gap > WAKUGUMI_CALC_RULES.topPlankToleranceMm && gap > 0) {
    if (gap <= WAKUGUMI_CALC_RULES.jackBaseMaxMm + WAKUGUMI_CALC_RULES.topPlankToleranceMm) {
      // Jack base can cover the gap
    } else {
      fullLevels += 1;
      topPlank = fullLevels * levelH;
      gap = buildingHeightMm - topPlank;
    }
  }

  let jackBase = 0;
  if (gap > WAKUGUMI_CALC_RULES.topPlankToleranceMm) {
    jackBase = Math.min(gap - WAKUGUMI_CALC_RULES.topPlankToleranceMm, WAKUGUMI_CALC_RULES.jackBaseMaxMm);
  } else if (gap < 0) {
    jackBase = 0;
  }

  const actualTopPlank = topPlank + jackBase;

  /** 最上は常にもう一段の建枠（ガード相当、枠高 = frameSizeMm） */
  const topExtensionMm = frameSizeMm;

  return {
    fullLevels,
    jackBaseAdjustmentMm: jackBase,
    topPlankHeightMm: actualTopPlank,
    topGuardHeightMm: topExtensionMm,
    totalScaffoldHeightMm: actualTopPlank + topExtensionMm,
    frameSizeMm,
  };
}

// ─── Find Nearest Size ──────────────────────────────────────
export function findNearestSizeWakugumi(targetMm: number, available: number[]): number {
  let nearest = available[0];
  let minDiff = Math.abs(available[0] - targetMm);
  for (const size of available) {
    const diff = Math.abs(size - targetMm);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = size;
    }
  }
  return nearest;
}

// ─── Export all wakugumi rules as a single object for API ────

export const ALL_WAKUGUMI_RULES = {
  frameSizeOptions: WAKUGUMI_FRAME_SIZE_OPTIONS,
  frameSeriesOptions: WAKUGUMI_FRAME_SERIES_OPTIONS,
  frameHeightMm: WAKUGUMI_FRAME_HEIGHT_MM,
  spanSizes: WAKUGUMI_SPAN_SIZES,
  spanOptions: WAKUGUMI_SPAN_OPTIONS,
  scaffoldWidths: WAKUGUMI_SCAFFOLD_WIDTH_OPTIONS,
  habakiCountOptions: WAKUGUMI_HABAKI_COUNT_OPTIONS,
  endStopperTypeOptions: WAKUGUMI_END_STOPPER_TYPE_OPTIONS,
  braceSizes: WAKUGUMI_BRACE_SIZES,
  shitasanSizes: WAKUGUMI_SHITASAN_SIZES,
  habakiSizes: WAKUGUMI_HABAKI_SIZES,
  stairSet: WAKUGUMI_STAIR_SET,
  stairAccessOptions: WAKUGUMI_STAIR_ACCESS_OPTIONS,
  jackBase: WAKUGUMI_JACK_BASE,
  calcRules: WAKUGUMI_CALC_RULES,
};
