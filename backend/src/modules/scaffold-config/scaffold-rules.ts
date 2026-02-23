/**
 * ═══════════════════════════════════════════════════════════════
 * くさび式足場 (Kusabi Scaffold) — Material Library & Rules
 * ═══════════════════════════════════════════════════════════════
 *
 * Single scaffold type: Kusabi (くさび式足場)
 * All material specs, calculation rules, and dropdown options
 * are defined here — NOT hardcoded anywhere else.
 *
 * To change any business rule, edit THIS file only.
 */

// ─── Types ───────────────────────────────────────────────────

export interface SizeOption {
  value: number;    // mm
  label: string;    // display label
}

export interface DropdownOption<T = string> {
  value: T;
  label: string;
  labelJp: string;
}

// ─── Wall Side Selection ─────────────────────────────────────
// NOTE: Removed N/S/E/W assumptions. Walls are now identified by arbitrary edge names
// (e.g., 'edge-0', 'edge-1', 'segment-1', etc.) from polygon geometry.

export interface WallInput {
  side: string;  // Arbitrary identifier (e.g., 'edge-0', 'segment-1')
  labelJp: string;
  lengthMm: number;   // wall length in mm
  enabled: boolean;    // whether this wall is selected
  stairAccessCount: number; // number of stair access points for this wall
}

// ─── Scaffold Width Options (足場幅 / Frame Width) ──────────
// Distance between front and back row of posts

export const SCAFFOLD_WIDTH_OPTIONS: SizeOption[] = [
  { value: 600,  label: '600mm (標準)' },
  { value: 900,  label: '900mm (広幅)' },
  { value: 1200, label: '1200mm (超広幅)' },
];

// ─── Post Catalog (支柱 / TATEJI) ───────────────────────────
// All kusabi posts — MA series (φ48.6mm)

export interface PostSpec {
  value: string;    // unique ID
  code: string;     // catalog code
  label: string;
  labelJp: string;
  heightMm: number;
  weightKg?: number;
  pipeDiameter: number;
}

export const POST_CATALOG: PostSpec[] = [
  { value: 'MA-2',  code: 'MA-2',  labelJp: '支柱 MA-2 (225mm)',   label: '225mm',   heightMm: 225,  pipeDiameter: 48.6 },
  { value: 'MA-4',  code: 'MA-4',  labelJp: '支柱 MA-4 (450mm)',   label: '450mm',   heightMm: 450,  weightKg: 2.1, pipeDiameter: 48.6 },
  { value: 'MA-6',  code: 'MA-6',  labelJp: '支柱 MA-6 (600mm)',   label: '600mm',   heightMm: 600,  pipeDiameter: 48.6 },
  { value: 'MA-9',  code: 'MA-9',  labelJp: '支柱 MA-9 (900mm)',   label: '900mm',   heightMm: 900,  weightKg: 3.8, pipeDiameter: 48.6 },
  { value: 'MA-13', code: 'MA-13', labelJp: '支柱 MA-13 (1350mm)', label: '1350mm',  heightMm: 1350, pipeDiameter: 48.6 },
  { value: 'MA-18', code: 'MA-18', labelJp: '支柱 MA-18 (1800mm)', label: '1800mm',  heightMm: 1800, weightKg: 6.9, pipeDiameter: 48.6 },
  { value: 'MA-27', code: 'MA-27', labelJp: '支柱 MA-27 (2700mm)', label: '2700mm',  heightMm: 2700, weightKg: 10.0, pipeDiameter: 48.6 },
  { value: 'MA-36', code: 'MA-36', labelJp: '支柱 MA-36 (3600mm)', label: '3600mm',  heightMm: 3600, weightKg: 13.2, pipeDiameter: 48.6 },
];

// All available post heights (sorted ascending)
export const POST_HEIGHTS: number[] = [225, 450, 600, 900, 1350, 1800, 2700, 3600];

// ─── Main Tateji Preference (user selects) ───────────────────
// The main stacking post — determines how many posts per level

export const MAIN_TATEJI_OPTIONS: SizeOption[] = [
  { value: 1800, label: '1800mm (MA-18・標準)' },
  { value: 2700, label: '2700mm (MA-27)' },
  { value: 3600, label: '3600mm (MA-36)' },
];

// ─── Top Guard Tateji (user selects) ─────────────────────────
// The post above the top plank level for safety

export const TOP_GUARD_OPTIONS: SizeOption[] = [
  { value: 900,  label: '900mm (MA-9)' },
  { value: 1350, label: '1350mm (MA-13)' },
  { value: 1800, label: '1800mm (MA-18)' },
];

// ─── Span Sizes (available standard sizes) ───────────────────

export const SPAN_SIZES: number[] = [600, 900, 1200, 1500, 1800];

export const SPAN_OPTIONS: SizeOption[] = [
  { value: 600,  label: '600mm (0.6m)' },
  { value: 900,  label: '900mm (0.9m)' },
  { value: 1200, label: '1200mm (1.2m)' },
  { value: 1500, label: '1500mm (1.5m)' },
  { value: 1800, label: '1800mm (1.8m・標準)' },
];

// ─── Horizontal Bar / Nuno (布材) Catalog ─────────────────────
// Used as: yokoji base stabilizer, plank support, tesuri (inner handrail), stopper

export const NUNO_SIZES: number[] = [200, 300, 600, 900, 1200, 1500, 1800];

// ─── Plank / Anchi (踏板) Catalog ────────────────────────────

// Anchi widths used in this app:
// - Full anchi: 500mm (for all widths)
// - Half anchi (for 900 width): 240mm
export const ANCHI_WIDTHS: number[] = [240, 500];
export const ANCHI_LENGTHS: number[] = [600, 900, 1200, 1500, 1800]; // matches span sizes

export interface AnchiSpec {
  widthMm: number;
  lengthMm: number;
  label: string;
}

// Generate all anchi combinations
export const ANCHI_CATALOG: AnchiSpec[] = [];
for (const w of ANCHI_WIDTHS) {
  for (const l of ANCHI_LENGTHS) {
    ANCHI_CATALOG.push({ widthMm: w, lengthMm: l, label: `${w}×${l}mm` });
  }
}

// ─── Anchi Selection by Scaffold Width ───────────────────────
// Width selection → Anchi width logic:
// - 600mm width → 1 Anchi of 500mm
// - 900mm width → 1 Anchi (500mm) + 1 half Anchi (240mm)
// - 1200mm width → 2 Anchi (500mm)

export interface AnchiLayout {
  fullAnchiWidth: number;   // mm
  fullAnchiPerSpan: number;
  halfAnchiWidth?: number;  // mm (optional second anchi)
  halfAnchiPerSpan: number;
}

export const ANCHI_LAYOUT_BY_WIDTH: Record<number, AnchiLayout> = {
  600:  { fullAnchiWidth: 500, fullAnchiPerSpan: 1, halfAnchiPerSpan: 0 },
  900:  { fullAnchiWidth: 500, fullAnchiPerSpan: 1, halfAnchiWidth: 240, halfAnchiPerSpan: 1 },
  1200: { fullAnchiWidth: 500, fullAnchiPerSpan: 2, halfAnchiPerSpan: 0 },
};

// ─── Brace (ブレス) Catalog ──────────────────────────────────
// X-brace used on OUTER face only, 1 per span per level

export const BRACE_SIZES: number[] = [600, 900, 1200, 1500, 1800]; // matches span sizes

// ─── Habaki / Toe Board (巾木) ───────────────────────────────
// Used on front + back faces at plank level

export const HABAKI_SIZES: number[] = [600, 900, 1200, 1500, 1800]; // matches span sizes

// ─── Jack Base (ジャッキベース) ──────────────────────────────
// Adjustable 0~300mm, counted as units only (no size in quotation)

export const JACK_BASE = {
  minMm: 0,
  maxMm: 300,
  nameJp: 'ジャッキベース',
  unit: '本',
};

// ─── Stair Set (階段セット) ──────────────────────────────────
// 1 set = 1 kaidan + 2 tesuri + 1 guard
// Replaces 1 anchi per level per access point

export const STAIR_SET = {
  nameJp: '階段セット',
  unit: 'セット',
  componentsPerSet: {
    kaidan: 1,
    kaidanTesuri: 2,
    kaidanGuard: 1,
  },
};

// ─── Stair Access Options ────────────────────────────────────

export const STAIR_ACCESS_OPTIONS: SizeOption[] = [
  { value: 1, label: '1箇所' },
  { value: 2, label: '2箇所' },
  { value: 3, label: '3箇所' },
  { value: 4, label: '4箇所' },
];

// ─── Level Height (fixed at 1800mm) ─────────────────────────

export const LEVEL_HEIGHT_MM = 1800;

// ─── Calculation Constants ───────────────────────────────────

export const CALC_RULES = {
  /** Level height is always 1800mm */
  levelHeightMm: 1800,

  /** Top plank must be within 0~200mm of building top */
  topPlankToleranceMm: 200,

  /** Jack base adjustment range */
  jackBaseMinMm: 0,
  jackBaseMaxMm: 300,

  /** 
   * Per span per level component rules:
   * - Brace: 1 per span (OUTER face only)
   * - Tesuri (nuno bar): 2 per span (INNER face, at 2 heights)
   * - Habaki: 2 per span (front + back)
   * - Anchi: 1 per span (sits on width yokoji)
   */
  bracePerSpanPerLevel: 1,        // outer face only
  tesuriPerSpanPerLevel: 2,       // inner face, 2 heights
  habakiPerSpanPerLevel: 2,       // front + back

  /**
   * Stopper at wall ends (端部布材):
   * - 2 per end per level (at 2 heights, like tesuri)
   * - 2 ends per wall = 4 per level
   * - Size = scaffold width
   */
  stoppersPerEndPerLevel: 2,

  /**
   * Yokoji base stabilizer (根がらみ):
   * - Span direction: N spans × 2 (front + back) — BASE LEVEL ONLY
   * - Width direction: (N+1) post positions — BASE LEVEL ONLY
   */

  /**
   * Yokoji plank support (幅方向布材):
   * - Width direction: (N+1) per level — at EVERY level
   * - Shared between adjacent spans (sharing principle)
   */

  /**
   * Posts (double row):
   * - Post positions = N+1 (sharing principle)
   * - × 2 rows (front + back)
   * - × L levels for main tateji
   * - + top guard at every position
   */

  /**
   * Jack bases:
   * - Post positions × 2 rows
   * - Count only, no size
   */
};

// ─── Span Fitting Algorithm ──────────────────────────────────
/**
 * Given a wall length, find the optimal combination of standard spans
 * to fit exactly. Uses largest-first greedy approach.
 * Returns array of span sizes.
 */
export function fitSpansToWallLength(wallLengthMm: number): number[] {
  const available = [...SPAN_SIZES].sort((a, b) => b - a); // descending
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

// ─── Level Calculation ───────────────────────────────────────
/**
 * Given building height and preferences, calculate:
 * - Number of full levels (each 1800mm)
 * - Jack base adjustment
 * - Whether a partial post is needed
 * - Top guard post size
 */
export interface LevelCalcResult {
  fullLevels: number;
  jackBaseAdjustmentMm: number;
  topPlankHeightMm: number;
  topGuardHeightMm: number;
  totalScaffoldHeightMm: number;
  mainPostsPerLine: number;       // how many main tateji per vertical line
  mainPostHeightMm: number;       // preferred main tateji height
  topGuardPostHeightMm: number;   // top guard post height
  partialPostHeightMm?: number;   // partial post if needed
}

export function calculateLevels(
  buildingHeightMm: number,
  preferredMainTateji: number,   // 1800, 2700, or 3600
  topGuardHeight: number,        // 900, 1350, or 1800
): LevelCalcResult {
  // Working level height is always 1800mm
  const levelH = LEVEL_HEIGHT_MM;

  // How many full 1800mm levels?
  let fullLevels = Math.floor(buildingHeightMm / levelH);
  let topPlank = fullLevels * levelH;
  let gap = buildingHeightMm - topPlank;

  // If gap > tolerance, we need more height
  if (gap > CALC_RULES.topPlankToleranceMm && gap > 0) {
    // Try using jack base adjustment (0~300mm)
    if (gap <= CALC_RULES.jackBaseMaxMm + CALC_RULES.topPlankToleranceMm) {
      // Jack base can cover the gap
    } else {
      // Need one more level
      fullLevels += 1;
      topPlank = fullLevels * levelH;
      gap = buildingHeightMm - topPlank;
    }
  }

  // Jack base adjustment to fine-tune
  let jackBase = 0;
  if (gap > CALC_RULES.topPlankToleranceMm) {
    // Top plank is too far below building top, raise with jack base
    jackBase = Math.min(gap - CALC_RULES.topPlankToleranceMm, CALC_RULES.jackBaseMaxMm);
  } else if (gap < 0) {
    // Top plank overshoots, but that's ok (within building or slightly above)
    jackBase = 0;
  }

  const actualTopPlank = topPlank + jackBase;

  // Calculate main posts per vertical line based on preferred tateji
  // Each level = 1800mm, but posts can be taller (2700=1.5 levels, 3600=2 levels)
  const totalPostHeightNeeded = fullLevels * levelH;
  let mainPostsPerLine: number;

  if (preferredMainTateji === 3600) {
    mainPostsPerLine = Math.floor(totalPostHeightNeeded / 3600);
    const remaining = totalPostHeightNeeded - mainPostsPerLine * 3600;
    if (remaining > 0) {
      mainPostsPerLine += 1; // Use partial or additional posts
    }
  } else if (preferredMainTateji === 2700) {
    mainPostsPerLine = Math.floor(totalPostHeightNeeded / 2700);
    const remaining = totalPostHeightNeeded - mainPostsPerLine * 2700;
    if (remaining > 0) {
      mainPostsPerLine += 1;
    }
  } else {
    // 1800mm — 1 post per level
    mainPostsPerLine = fullLevels;
  }

  return {
    fullLevels,
    jackBaseAdjustmentMm: jackBase,
    topPlankHeightMm: actualTopPlank,
    topGuardHeightMm: topGuardHeight,
    totalScaffoldHeightMm: actualTopPlank + topGuardHeight,
    mainPostsPerLine,
    mainPostHeightMm: preferredMainTateji,
    topGuardPostHeightMm: topGuardHeight,
  };
}

// ─── Find Nearest Nuno/Material Size ─────────────────────────
export function findNearestSize(targetMm: number, available: number[]): number {
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

// ─── Quotation Column Names ──────────────────────────────────
// NOTE: Removed N/S/E/W columns. Quotation now shows per-segment columns dynamically.

export const QUOTATION_COLUMNS = {
  no: 'No',
  materialName: '部材名',
  spec: '規格',
  total: '合計',
};

// ─── Export all rules as a single object for API endpoint ────

export const ALL_RULES = {
  scaffoldWidths: SCAFFOLD_WIDTH_OPTIONS,
  postCatalog: POST_CATALOG,
  postHeights: POST_HEIGHTS,
  mainTatejiOptions: MAIN_TATEJI_OPTIONS,
  topGuardOptions: TOP_GUARD_OPTIONS,
  spanSizes: SPAN_SIZES,
  spanOptions: SPAN_OPTIONS,
  nunoSizes: NUNO_SIZES,
  anchiWidths: ANCHI_WIDTHS,
  anchiLengths: ANCHI_LENGTHS,
  anchiLayoutByWidth: ANCHI_LAYOUT_BY_WIDTH,
  braceSizes: BRACE_SIZES,
  habakiSizes: HABAKI_SIZES,
  jackBase: JACK_BASE,
  stairSet: STAIR_SET,
  stairAccessOptions: STAIR_ACCESS_OPTIONS,
  levelHeightMm: LEVEL_HEIGHT_MM,
  calcRules: CALC_RULES,
};
