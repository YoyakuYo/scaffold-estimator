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

import { SizeOption, AnchiLayout } from './scaffold-rules';

// ─── Frame Size Options (建枠サイズ) ──────────────────────────
// The frame size = level height (variable, unlike kusabi's fixed 1800mm)

export const WAKUGUMI_FRAME_SIZE_OPTIONS: SizeOption[] = [
  { value: 1700, label: '1700mm (標準)' },
  { value: 1800, label: '1800mm' },
  { value: 1900, label: '1900mm' },
];

// ─── Span Sizes (imperial-derived) ──────────────────────────
// Same progression as kusabi but imperial-origin values

export const WAKUGUMI_SPAN_SIZES: number[] = [610, 914, 1219, 1524, 1829];

export const WAKUGUMI_SPAN_OPTIONS: SizeOption[] = [
  { value: 610,  label: '610mm (2尺)' },
  { value: 914,  label: '914mm (3尺)' },
  { value: 1219, label: '1219mm (4尺)' },
  { value: 1524, label: '1524mm (5尺)' },
  { value: 1829, label: '1829mm (6尺・標準)' },
];

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

export const WAKUGUMI_BRACE_SIZES: number[] = [610, 914, 1219, 1524, 1829];

// ─── Shitasan (下桟) Sizes ──────────────────────────────────
// Bottom horizontal bar, matches span sizes

export const WAKUGUMI_SHITASAN_SIZES: number[] = [610, 914, 1219, 1524, 1829];

// ─── Habaki (巾木) Sizes ────────────────────────────────────

export const WAKUGUMI_HABAKI_SIZES: number[] = [610, 914, 1219, 1524, 1829];

// ─── Negarami (根がらみ) Sizes ──────────────────────────────

export const WAKUGUMI_NEGARAMI_SIZES: number[] = [610, 914, 1219, 1524, 1829];

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
   * Per span per level component rules:
   * - Brace: 2 per span (BOTH faces — front + back)
   * - Shitasan: 2 per span (bottom horizontal, both faces)
   * - Tesuri: 0 (NOT used in wakugumi)
   * - Habaki: 1 or 2 per span (user-selectable)
   */
  bracePerSpanPerLevel: 2,       // both faces
  shitasanPerSpanPerLevel: 2,    // bottom horizontal, both faces
  tesuriPerSpanPerLevel: 0,      // not used

  /**
   * End Stopper:
   * - Nuno type: 2 per end × 2 ends = 4 per level, size = scaffold width
   * - Frame type: 1 per end × 2 ends = 2 per level, count only
   */
  stoppersPerEndPerLevel_nuno: 2,   // nuno bars per end
  stoppersPerEndPerLevel_frame: 1,  // frame stopper per end

  /**
   * Negarami (根がらみ) — BASE LEVEL ONLY:
   * - Span direction: N × 2 (front + back)
   * - Width direction: (N+1) post positions
   */

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

// ─── Span Fitting Algorithm ─────────────────────────────────
/**
 * Given a wall length, find the optimal combination of standard spans
 * to fit. Uses largest-first greedy approach.
 */
export function fitSpansToWallLengthWakugumi(wallLengthMm: number): number[] {
  const available = [...WAKUGUMI_SPAN_SIZES].sort((a, b) => b - a); // descending
  const spans: number[] = [];
  let remaining = wallLengthMm;

  while (remaining > 0) {
    let fitted = false;
    for (const size of available) {
      if (size <= remaining) {
        spans.push(size);
        remaining -= size;
        fitted = true;
        break;
      }
    }
    if (!fitted) {
      // Remaining is smaller than smallest span, use smallest
      spans.push(available[available.length - 1]);
      remaining = 0;
    }
  }

  return spans;
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
  topGuardHeightMm: number;
  totalScaffoldHeightMm: number;
  frameSizeMm: number;         // = level height
}

export function calculateLevelsWakugumi(
  buildingHeightMm: number,
  frameSizeMm: number,        // 1700, 1800, or 1900
  topGuardHeight: number = 900,
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

  return {
    fullLevels,
    jackBaseAdjustmentMm: jackBase,
    topPlankHeightMm: actualTopPlank,
    topGuardHeightMm: topGuardHeight,
    totalScaffoldHeightMm: actualTopPlank + topGuardHeight,
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
  spanSizes: WAKUGUMI_SPAN_SIZES,
  spanOptions: WAKUGUMI_SPAN_OPTIONS,
  scaffoldWidths: WAKUGUMI_SCAFFOLD_WIDTH_OPTIONS,
  habakiCountOptions: WAKUGUMI_HABAKI_COUNT_OPTIONS,
  endStopperTypeOptions: WAKUGUMI_END_STOPPER_TYPE_OPTIONS,
  braceSizes: WAKUGUMI_BRACE_SIZES,
  shitasanSizes: WAKUGUMI_SHITASAN_SIZES,
  habakiSizes: WAKUGUMI_HABAKI_SIZES,
  negaramiSizes: WAKUGUMI_NEGARAMI_SIZES,
  stairSet: WAKUGUMI_STAIR_SET,
  stairAccessOptions: WAKUGUMI_STAIR_ACCESS_OPTIONS,
  jackBase: WAKUGUMI_JACK_BASE,
  calcRules: WAKUGUMI_CALC_RULES,
};
