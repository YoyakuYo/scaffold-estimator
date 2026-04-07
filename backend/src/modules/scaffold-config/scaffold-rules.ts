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

// ─── Scaffold width catalog (足場幅) ─────────────────────────
// Front↔back between post rows — same imperial-origin class as span modules (610 / 914 / 1219).

export const SCAFFOLD_WIDTH_NARROW_MM = 610;
export const SCAFFOLD_WIDTH_MEDIUM_MM = 914;
export const SCAFFOLD_WIDTH_WIDE_MM = 1219;

/** Map legacy nominal widths (600/900/1200) and stray values to the catalog triple. */
export function normalizeScaffoldWidthMmToCatalog(widthMm: number): number {
  const w = Number(widthMm);
  if (!Number.isFinite(w) || w <= 0) return SCAFFOLD_WIDTH_NARROW_MM;
  if (w === 600 || w === SCAFFOLD_WIDTH_NARROW_MM) return SCAFFOLD_WIDTH_NARROW_MM;
  if (w === 900 || w === SCAFFOLD_WIDTH_MEDIUM_MM) return SCAFFOLD_WIDTH_MEDIUM_MM;
  if (w === 1200 || w === SCAFFOLD_WIDTH_WIDE_MM) return SCAFFOLD_WIDTH_WIDE_MM;
  if (w < 762) return SCAFFOLD_WIDTH_NARROW_MM;
  if (w < 1066) return SCAFFOLD_WIDTH_MEDIUM_MM;
  return SCAFFOLD_WIDTH_WIDE_MM;
}

// ─── Scaffold Width Options (足場幅 / Frame Width) ──────────
// Distance between front and back row of posts

export const SCAFFOLD_WIDTH_OPTIONS: SizeOption[] = [
  { value: 610,  label: '610mm (標準・2尺幅)' },
  { value: 914,  label: '914mm (広幅・3尺幅)' },
  { value: 1219, label: '1219mm (超広幅・4尺幅)' },
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

// ─── Top Guard Tateji (上部支柱) ─────────────────────────────
/** Always MA-18 (1800mm) above the top working level; no user selection. */
export const KUSABI_TOP_GUARD_HEIGHT_MM = 1800;

// ─── Span Sizes (available standard sizes) ───────────────────
// Same imperial-origin module set as 枠組 (wakugumi): 2尺〜6尺.

export const SPAN_SIZES: number[] = [610, 914, 1219, 1524, 1829];

/**
 * When packing the kusabi corner “middle” (between 1829 start and terminal bay), allow this much
 * length overrun so a **fewer-span** (longer-module) layout can beat an exact sum of short bays
 * (e.g. 1829+914 vs 914+914+914 for the same target).
 */
export const KUSABI_MIDDLE_PACK_MAX_OVERRUN_MM = 10;

/** Set lookup for span catalog (exact-sum merges, validation). */
export const SPAN_SIZE_SET: ReadonlySet<number> = new Set(SPAN_SIZES);

export const SPAN_OPTIONS: SizeOption[] = [
  { value: 610,  label: '610mm (2尺)' },
  { value: 914,  label: '914mm (3尺)' },
  { value: 1219, label: '1219mm (4尺)' },
  { value: 1524, label: '1524mm (5尺)' },
  { value: 1829, label: '1829mm (6尺・標準)' },
];

// ─── Horizontal Bar / Nuno (布材) Catalog ─────────────────────
// Used as: yokoji base stabilizer, plank support, tesuri (inner handrail), stopper

export const NUNO_SIZES: number[] = [200, 300, ...SPAN_SIZES];

// ─── Plank / Anchi (踏板) Catalog ────────────────────────────

// Anchi widths used in this app:
// - Full anchi: 500mm (for all widths)
// - Half anchi (for 900 width): 240mm
export const ANCHI_WIDTHS: number[] = [240, 500];
export const ANCHI_LENGTHS: number[] = [...SPAN_SIZES]; // matches span sizes

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
// - 610mm width → 1 Anchi of 500mm
// - 914mm width → 1 Anchi (500mm) + 1 half Anchi (240mm)
// - 1219mm width → 2 Anchi (500mm)

export interface AnchiLayout {
  fullAnchiWidth: number;   // mm
  fullAnchiPerSpan: number;
  halfAnchiWidth?: number;  // mm (optional second anchi)
  halfAnchiPerSpan: number;
}

export const ANCHI_LAYOUT_BY_WIDTH: Record<number, AnchiLayout> = {
  610:  { fullAnchiWidth: 500, fullAnchiPerSpan: 1, halfAnchiPerSpan: 0 },
  914:  { fullAnchiWidth: 500, fullAnchiPerSpan: 1, halfAnchiWidth: 240, halfAnchiPerSpan: 1 },
  1219: { fullAnchiWidth: 500, fullAnchiPerSpan: 2, halfAnchiPerSpan: 0 },
};

// ─── Brace (ブレス) Catalog ──────────────────────────────────
// X-brace used on OUTER face only, 1 per span per level

export const BRACE_SIZES: number[] = [...SPAN_SIZES]; // matches span sizes

// ─── Habaki / Toe Board (巾木) ───────────────────────────────
// Used on front + back faces at plank level

export const HABAKI_SIZES: number[] = [...SPAN_SIZES]; // matches span sizes

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

/**
 * メッシュシートの縦寸（長さ方向、被せる高さ）。幅はスパン長（BOM はスパン別行）。
 * 縦方向枚数/スパン = ceil(totalScaffoldHeightMm / この値) — 段ごと 1 枚ではない。
 */
export const MESH_SHEET_VERTICAL_LENGTH_MM = 3600;

export const CALC_RULES = {
  /** Level height is always 1800mm */
  levelHeightMm: 1800,

  /** Top plank must be within 0~200mm of building top */
  topPlankToleranceMm: 200,

  /** Jack base adjustment range */
  jackBaseMinMm: 0,
  jackBaseMaxMm: 300,

  /**
   * Per span per level (くさび式):
   * - Outer row: 1 ブレス/スパン/段
   * - Inner row: 手摺（布材）2 本高さ/スパン/段（外列はブレス）
   * - Habaki: 2 per span (front + back)
   * - Anchi: 1 per span (sits on width yokoji)
   */
  bracePerSpanPerLevel: 1,        // outer face only
  tesuriPerSpanPerLevel: 2,       // inner face, two rail heights
  habakiPerSpanPerLevel: 2,       // front + back

  /** @see MESH_SHEET_VERTICAL_LENGTH_MM — mesh quantity uses height ÷ this, not per-level. */
  meshSheetVerticalLengthMm: MESH_SHEET_VERTICAL_LENGTH_MM,

  /**
   * Stopper at **free** scaffold ends (端部手摺) — 2 bars per end per level (2 heights).
   * Multiply by `freeScaffoldEndCountForWall(wallIndex, wallCount)` (not 2 blindly): interior
   * polygon corners are excluded so counts match walkable 90° turns.
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

/** メッシュシート: 同一スパン幅の各スパンに掛ける縦方向の枚数（被せ高÷シート縦寸、切り上げ）。 */
export function meshSheetVerticalRowsForHeightMm(heightMm: number): number {
  if (heightMm <= 0) return 0;
  return Math.ceil(heightMm / MESH_SHEET_VERTICAL_LENGTH_MM);
}

/**
 * Scaffold **dead ends** that need 端部材 / 端部手摺 (workers cannot walk past).
 * Interior polygon corners where the run turns 90° to the next wall are **not** counted — only true open ends.
 *
 * - 1 wall: both ends of the run are free.
 * - 2 walls (L): wall 0 → one free end at its start; wall 1 → one free end at its end (list order = walk direction).
 * - 3 walls: assumed **U-shape** (gap between first and last) → free at wall 0 start and wall 2 end only.
 * - 4+ walls: **closed** perimeter (rectangle, n-gon) → continuous band, no free ends.
 */
export function freeScaffoldEndCountForWall(wallIndex: number, wallCount: number): number {
  if (wallCount <= 1) return 2;
  if (wallCount === 2) return 1;
  if (wallCount === 3) {
    if (wallIndex === 0 || wallIndex === 2) return 1;
    return 0;
  }
  return 0;
}

// ─── Corner alignment constants (足場コーナー詳細図) ─────────────
/** Last two posts extend this far past the building corner (mm). */
export const CORNER_OVERRUN_MM = 300;
/**
 * Default terminal bay into the turn — catalog module matching 足場幅 tier (610 / 914 / 1219 mm).
 */
export const CORNER_SPAN_MM = 610;
/**
 * First span along each wall after the corner (mm) — 6尺 bay; shares posts with the
 * previous wall’s terminal bay for continuous deck (足場コーナー詳細図).
 */
export const CORNER_START_SPAN_MM = 1829;

/** Total mm to subtract from nominal wall length for reflex (inner/re-entrant) corners on that edge. */
export function reflexCornerInsetTotalMm(
  startCornerKind?: 'convex' | 'reflex',
  endCornerKind?: 'convex' | 'reflex',
  overrunMm: number = CORNER_OVERRUN_MM,
): number {
  let t = 0;
  if (startCornerKind === 'reflex') t += overrunMm;
  if (endCornerKind === 'reflex') t += overrunMm;
  return t;
}

/**
 * Façade length used for span layout along one edge: building face length minus 300mm per reflex corner.
 * Example: 6000mm wall with reflex at one end → 5700mm basis (inner corner is “closed”, no +300 overrun there).
 */
export function scaffoldFacadeBasisMmFromCorners(
  wallLengthMm: number,
  startCornerKind?: 'convex' | 'reflex',
  endCornerKind?: 'convex' | 'reflex',
  overrunMm: number = CORNER_OVERRUN_MM,
): number {
  const inset = reflexCornerInsetTotalMm(startCornerKind, endCornerKind, overrunMm);
  return Math.max(0, wallLengthMm - inset);
}

/** Corner terminal bay = same catalog module as the scaffold width tier (610 / 914 / 1219). */
export function cornerTerminalSpanMmKusabi(scaffoldWidthMm: number): number {
  return normalizeScaffoldWidthMmToCatalog(scaffoldWidthMm);
}

/** Footprint vertex (fractional or mm — only turn direction matters for reflex detection). */
export type OutlineVertexInput = { x?: number; y?: number; xFrac?: number; yFrac?: number };

/**
 * Per-vertex reflex flags for a simple polygon (no self-intersection).
 * Vertex i is reflex (re-entrant / “inner” corner of the building) iff the exterior turn at i
 * is opposite to convex outer corners — used for −300mm inset and no forced terminal bay at that corner.
 * Wall i runs from vertex i → (i+1); it should use startKind = vertex i, endKind = vertex (i+1).
 *
 * Returns null if outline has fewer than 3 vertices.
 */
export function inferReflexVerticesFromOutline(outline: OutlineVertexInput[]): boolean[] | null {
  const n = outline.length;
  if (n < 3) return null;
  const pts = outline.map((v) => ({
    x: typeof v.xFrac === 'number' ? v.xFrac : v.x ?? 0,
    y: typeof v.yFrac === 'number' ? v.yFrac : v.y ?? 0,
  }));
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  const isCCW = area2 > 0;
  const isReflex: boolean[] = Array.from({ length: n }, () => false);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
    isReflex[i] = isCCW ? cross < 0 : cross > 0;
  }
  return isReflex;
}

/**
 * Split one middle span into two valid modules (if possible) — prefer splitting the largest span.
 */
function splitOneMiddleSpanInPlace(spans: number[], spanSizes: readonly number[]): boolean {
  const set = new Set(spanSizes);
  const positives = [...set].filter((n) => Number.isFinite(n) && n > 0);
  if (positives.length === 0) return false;
  const minSpan = Math.min(...positives);
  let bestI = -1;
  let bestA = 0;
  let bestB = 0;
  let bestSpan = -1;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s <= minSpan) continue;
    for (const a of spanSizes) {
      const b = s - a;
      if (b > 0 && set.has(b)) {
        if (s > bestSpan) {
          bestSpan = s;
          bestI = i;
          bestA = a;
          bestB = b;
        }
      }
    }
  }
  if (bestI < 0) return false;
  const hi = Math.max(bestA, bestB);
  const lo = Math.min(bestA, bestB);
  spans.splice(bestI, 1, hi, lo);
  return true;
}

/**
 * Prefer one extra middle bay vs minimal packing so the corner run matches 足場コーナー詳細図
 * (continuous deck: more bays along the run before the terminal width-module).
 */
export function expandMiddleSpansToTargetCount(
  middleSpans: number[],
  middleMm: number,
  spanSizes: readonly number[],
  cornerStartMm: number,
): number[] {
  const spans = [...middleSpans];
  const sum = spans.reduce((a, b) => a + b, 0);
  if (sum !== middleMm || middleMm <= 0) return spans;
  const target = Math.ceil(middleMm / cornerStartMm) + 1;
  let guard = 0;
  while (spans.length < target && guard++ < 40) {
    if (!splitOneMiddleSpanInPlace(spans, spanSizes)) break;
  }
  return spans;
}

// ─── Span Fitting Algorithm ──────────────────────────────────

/**
 * If possible, partition `target` into an exact sum of standard span modules (mm).
 * Prefers larger spans first when building the decomposition (walkable-bay packing).
 */
export function exactSumWithStandardSpans(
  target: number,
  spanSizesMm: readonly number[],
): number[] | null {
  if (!Number.isFinite(target) || target < 0) return null;
  if (target === 0) return [];
  const sizes = [...spanSizesMm].filter((n) => Number.isFinite(n) && n > 0);
  if (sizes.length === 0) return null;
  const sortedDesc = [...new Set(sizes)].sort((a, b) => b - a);
  const min = sortedDesc[sortedDesc.length - 1]!;
  if (target < min) return null;

  const dp: (number[] | null)[] = Array(target + 1).fill(null);
  dp[0] = [];
  for (let t = 1; t <= target; t++) {
    for (const s of sortedDesc) {
      if (s <= t && dp[t - s] !== null) {
        dp[t] = [...dp[t - s]!, s];
        break;
      }
    }
  }
  const raw = dp[target];
  if (!raw) return null;
  return raw.sort((a, b) => b - a);
}

/**
 * Merge adjacent spans when their sum is itself a catalog span (e.g. 610+914→1524, 610+1219→1829).
 * Preserves total length; reduces bay count for BOM / layout.
 */
export function compressAdjacentCatalogSumMerges(
  spans: readonly number[],
  spanSet: ReadonlySet<number> = SPAN_SIZE_SET,
): number[] {
  const out = [...spans];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length - 1; i++) {
      const sum = out[i]! + out[i + 1]!;
      if (spanSet.has(sum)) {
        out.splice(i, 2, sum);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * Given a wall length, find the optimal combination of standard spans
 * to fit.
 *
 * Corner alignment rule:
 * - Never leave a gap (total span length must be >= wall length).
 * - Prefer to keep the overrun small (≤ 300mm) to allow tight corner connections
 *   and installation of パッタンコ (corner connector).
 * - If an overrun ≤ 300mm is impossible with standard spans, choose the smallest
 *   overrun achievable.
 * Returns array of span sizes.
 * @param options.northWall - When true (North = wall index 0), allow last span to overrun up to 610mm to close corner with East.
 */
export function fitSpansToWallLength(
  wallLengthMm: number,
  options?: { northWall?: boolean },
): number[] {
  const maxOverrunMm = options?.northWall ? 610 : 300;
  return fitSpansToWallLengthWithOverrun(wallLengthMm, SPAN_SIZES, maxOverrunMm);
}

/** Hint for 4-wall rectangles: shorter sides vs longer — used only to **prefer** span patterns, not fixed layouts. */
export type KusabiRectangleCornerEdgeRole = 'short' | 'long';

/** Tie-break when fitting corner “middle” spans (standard sizes only; same total length). */
export interface KusabiCornerMiddleFitPreference {
  kind: 'long' | 'short';
  terminalMm: number;
  overrunMm: number;
}

/**
 * Sum of spans **between** the first corner-start bay and the terminal bay (mm).
 * Closed polygon standard run: wall + 300 + terminal = CORNER_START + this + terminal.
 */
export function kusabiCornerMiddleSumMm(wallLengthMm: number): number {
  return wallLengthMm + CORNER_OVERRUN_MM - CORNER_START_SPAN_MM;
}

function scoreKusabiCornerMiddleFit(
  fullMiddleSpans: number[],
  pref: KusabiCornerMiddleFitPreference,
): number {
  const start = CORNER_START_SPAN_MM;
  if (pref.kind === 'long') {
    const n1800 = fullMiddleSpans.filter((s) => s === start).length;
    const all1800 =
      fullMiddleSpans.length > 0 && fullMiddleSpans.every((s) => s === start);
    return (all1800 ? 1_000_000 : 0) + n1800 * 1_000 - fullMiddleSpans.length;
  }
  const pen = pref.terminalMm + pref.overrunMm;
  const tailOk =
    fullMiddleSpans.length >= 2 &&
    fullMiddleSpans[fullMiddleSpans.length - 2] === 1219 &&
    fullMiddleSpans[fullMiddleSpans.length - 1] === pen;
  return (tailOk ? 500_000 : 0) + fullMiddleSpans.filter((s) => s === start).length * 100 - fullMiddleSpans.length;
}

/**
 * For a 4-wall rectangle only: mark **shorter** façades `short` and **longer** `long` (same length → all `long`).
 * Does **not** require any specific span arithmetic to “fit”; hints are optional tie-breakers in the fitter.
 */
export function classifyKusabiRectangleEdgeRoles(
  wallLengthsMm: readonly number[],
  _scaffoldWidthMm: number = SCAFFOLD_WIDTH_NARROW_MM,
): (KusabiRectangleCornerEdgeRole | null)[] {
  const none = () => wallLengthsMm.map(() => null as null);
  if (wallLengthsMm.length !== 4) return none();
  for (const L of wallLengthsMm) {
    if (!Number.isFinite(L) || L <= 0) return none();
  }
  const counts = new Map<number, number>();
  for (const L of wallLengthsMm) counts.set(L, (counts.get(L) ?? 0) + 1);

  if (counts.size === 2) {
    const sorted = [...counts.entries()].sort((a, b) => a[0] - b[0]);
    if (sorted[0][1] !== 2 || sorted[1][1] !== 2) return none();
    const Lshort = sorted[0][0];
    return wallLengthsMm.map((L) => (L === Lshort ? 'short' : 'long'));
  }
  if (counts.size === 1) {
    const [, cnt] = [...counts.entries()][0]!;
    if (cnt !== 4) return none();
    return wallLengthsMm.map(() => 'long');
  }
  return none();
}

/**
 * Span fitting for walls that meet at corners (closed polygon).
 * - Run along the wall targets **wallLength + 300 + terminal**; first bay **1829**; last = terminal (610/914/1219).
 *   The middle is filled from **SPAN_SIZES** (small overrun allowed via **KUSABI_MIDDLE_PACK_MAX_OVERRUN_MM** so
 *   fewer longer bays beat an exact sum of shorter modules). Adjacent middle bays whose lengths
 *   sum to another catalog span are merged (e.g. 610+914→1524) **without** changing total length.
 *   *Nominal* pairs (914+914→1829, 610+610→1219) differ by ±1mm from a single catalog member and are **not**
 *   auto-merged here, so the geometric total stays consistent with the overrun fitter.
 * - **Reflex (inner) corner:** subtract **300mm** from nominal wall length **per** reflex vertex on that edge
 *   (effective façade = `scaffoldFacadeBasisMmFromCorners`). **Rule 1:** when possible, end the wall with the
 *   width-module terminal span so the next wall can reuse the same posts for a continuous
 *   walk bay (−300 line). **Rule 2:** if an exact standard span packing cannot end with that module, pack
 *   without it and count **pattanko** at that reflex joint (see calculator).
 * - **Convex 90° when wall+300 < 1829:** cannot place the leading **1829**; use **[terminal, …middle…, terminal]**
 *   so run length is still **wall+300+terminal** (not **wall+300** alone).
 */
export function fitSpansToWallLengthWithCorner(
  wallLengthMm: number,
  scaffoldWidthMm: number = SCAFFOLD_WIDTH_NARROW_MM,
  options?: {
    rectangleEdgeRole?: KusabiRectangleCornerEdgeRole | null;
    /** Corner kind at the START of this wall (vertex i). Default: convex. */
    startCornerKind?: 'convex' | 'reflex';
    /** Corner kind at the END of this wall (vertex i+1). Default: convex. */
    endCornerKind?: 'convex' | 'reflex';
  },
): number[] {
  const terminal = cornerTerminalSpanMmKusabi(scaffoldWidthMm);
  const start = CORNER_START_SPAN_MM;

  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) {
    return [start, terminal];
  }

  const startKind = options?.startCornerKind ?? 'convex';
  const endKind = options?.endCornerKind ?? 'convex';
  const startIsConvex = startKind !== 'reflex';
  const endIsConvex = endKind !== 'reflex';

  // Inner/reflex (re-entrant) corners: subtract overrunMm from nominal wall length per reflex vertex.
  if (!startIsConvex || !endIsConvex) {
    const reflexInset =
      (startIsConvex ? 0 : CORNER_OVERRUN_MM) + (endIsConvex ? 0 : CORNER_OVERRUN_MM);
    const effectiveFacadeMm = Math.max(0, wallLengthMm - reflexInset);
    const prefix = startIsConvex ? [start] : [];
    const prefixSum = prefix.reduce((a, b) => a + b, 0);

    if (!endIsConvex) {
      // Rule 1: last span = width-module (terminal); total run = effective façade (posts stop at −300 line).
      // Next wall (reflex start, prefix=[]) reuses those post lines — continuous bay.
      const middleNeed = effectiveFacadeMm - prefixSum - terminal;
      if (middleNeed >= 0) {
        const middleExact = exactSumWithStandardSpans(middleNeed, SPAN_SIZES);
        if (middleExact !== null) {
          return [...prefix, ...middleExact, terminal];
        }
      }
      // Rule 2: cannot end with width-module using exact standard spans → pack to inner line; pattanko at joint.
      const middleTarget = effectiveFacadeMm - prefixSum;
      if (middleTarget <= 0) return [...prefix];
      const middleSpans = fitSpansToWallLengthNoOverrun(middleTarget, SPAN_SIZES);
      return [...prefix, ...middleSpans];
    }

    // Reflex start only; convex end: overrun + terminal past outer corner
    const suffix = [terminal];
    const runTarget = effectiveFacadeMm + CORNER_OVERRUN_MM + terminal;
    const middleTarget = runTarget - prefixSum - terminal;
    if (middleTarget <= 0) return [...prefix, ...suffix];
    const middleSpans = fitSpansToWallLengthNoOverrun(middleTarget, SPAN_SIZES);
    return [...prefix, ...middleSpans, ...suffix];
  }

  const runTargetMm = wallLengthMm + CORNER_OVERRUN_MM + terminal;
  const middleSum = kusabiCornerMiddleSumMm(wallLengthMm);

  if (middleSum < 0) {
    const middleNeed = runTargetMm - 2 * terminal;
    if (middleNeed <= 0) return [terminal, terminal];
    const middleSpans = fitSpansToWallLengthWithOverrun(
      middleNeed,
      SPAN_SIZES,
      KUSABI_MIDDLE_PACK_MAX_OVERRUN_MM,
    );
    const mergedMiddle = compressAdjacentCatalogSumMerges(middleSpans);
    return [terminal, ...mergedMiddle, terminal];
  }

  if (middleSum === 0) {
    return [start, terminal];
  }

  const role = options?.rectangleEdgeRole;
  const middlePref: KusabiCornerMiddleFitPreference | undefined =
    role != null
      ? { kind: role, terminalMm: terminal, overrunMm: CORNER_OVERRUN_MM }
      : undefined;

  const middleSpans = fitSpansToWallLengthWithOverrun(
    middleSum,
    SPAN_SIZES,
    KUSABI_MIDDLE_PACK_MAX_OVERRUN_MM,
    middlePref,
  );
  const mergedMiddle = compressAdjacentCatalogSumMerges(middleSpans);
  return [start, ...mergedMiddle, terminal];
}

/**
 * Fit spans without exceeding the target length (sum <= wallLengthMm).
 * Used for reflex/inner corners where scaffold must not project past a closed notch corner.
 *
 * Greedy for the long prefix + bounded search for the tail.
 */
function fitSpansToWallLengthNoOverrun(
  wallLengthMm: number,
  spanSizesMm: number[],
): number[] {
  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) return [];
  const sizes = [...spanSizesMm].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a); // desc
  if (sizes.length === 0) return [];
  const max = sizes[0];
  const min = sizes[sizes.length - 1];

  // Large prefix of max spans to reduce search space
  const reserve = max * 6;
  const prefixCount = wallLengthMm > reserve ? Math.floor((wallLengthMm - reserve) / max) : 0;
  const prefix = Array(prefixCount).fill(max);
  const prefixSum = prefixCount * max;
  let remaining = wallLengthMm - prefixSum;
  if (remaining <= 0) return prefix;

  // Tail search: best sum <= remaining using up to 10 spans
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

  // If we couldn't place any span (remaining smaller than min), just return prefix.
  if (best.length === 0) return prefix;
  return [...prefix, ...best];
}

function fitSpansToWallLengthWithOverrun(
  wallLengthMm: number,
  spanSizesMm: number[],
  maxOverrunMm: number,
  cornerMiddlePref?: KusabiCornerMiddleFitPreference,
): number[] {
  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) return [];

  const sizes = [...spanSizesMm].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a); // desc
  if (sizes.length === 0) return [];

  const max = sizes[0];
  const min = sizes[sizes.length - 1];

  // Use a long prefix of max spans, and search only the tail — except when corner preferences need a
  // globally best middle decomposition (prefix would hide better 1800 / tail patterns).
  const skipPrefix = Boolean(cornerMiddlePref);
  const tailMaxCount = skipPrefix
    ? Math.min(80, Math.max(10, Math.ceil(wallLengthMm / min) + 8))
    : 10;
  const reserve = max * 4; // leave room for tail adjustments
  const prefixCount =
    skipPrefix || wallLengthMm <= reserve ? 0 : Math.floor((wallLengthMm - reserve) / max);
  const prefixSum = prefixCount * max;
  const target = wallLengthMm - prefixSum;

  const tailMaxSum = target + Math.max(maxOverrunMm, max);
  const maxCountByMin = Math.ceil(tailMaxSum / min);
  const maxCount = Math.max(1, Math.min(tailMaxCount, maxCountByMin));

  type BestCandidate = { spans: number[]; sum: number; overrun: number; within: boolean };
  let best: BestCandidate | undefined;

  const fullMiddle = (c: BestCandidate) => [...Array(prefixCount).fill(max), ...c.spans];

  const betterThan = (a: BestCandidate, b: BestCandidate) => {
    if (a.within !== b.within) return a.within; // within max overrun first
    if (a.within && b.within) {
      if (a.spans.length !== b.spans.length) return a.spans.length < b.spans.length;
      if (a.overrun !== b.overrun) return a.overrun < b.overrun;
    } else {
      if (a.overrun !== b.overrun) return a.overrun < b.overrun;
      if (a.spans.length !== b.spans.length) return a.spans.length < b.spans.length;
    }
    if (
      cornerMiddlePref &&
      a.within &&
      b.within &&
      a.overrun === b.overrun &&
      a.spans.length === b.spans.length
    ) {
      const sa = scoreKusabiCornerMiddleFit(fullMiddle(a), cornerMiddlePref);
      const sb = scoreKusabiCornerMiddleFit(fullMiddle(b), cornerMiddlePref);
      if (sa !== sb) return sa > sb;
    }
    // Tie-breaker: prefer larger spans earlier (more standard looking)
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
      // Prune: if we're already within max overrun and exact, can't improve.
      if (within && overrun === 0) return;
      // If within, adding more only increases overrun.
      return;
    }

    if (chosen.length >= maxCount) return;

    // Lower bound pruning: even if we fill remaining slots with max spans, can we reach target?
    const remainingSlots = maxCount - chosen.length;
    if (sum + remainingSlots * max < target) return;

    for (let i = startIdx; i < sizes.length; i++) {
      const s = sizes[i];
      const nextSum = sum + s;
      // Overrun pruning: if we already have a within-max solution, don't explore sums that exceed it.
      if (best && best.within && nextSum - target > maxOverrunMm) continue;
      chosen.push(s);
      dfs(i, chosen, nextSum); // allow repeats
      chosen.pop();
    }
  };

  dfs(0, [], 0);

  const tail = best?.spans?.length ? best.spans : [min];
  const result = [...Array(prefixCount).fill(max), ...tail];

  // Final safety: ensure no gap.
  const total = result.reduce((a, b) => a + b, 0);
  if (total < wallLengthMm) result.push(min);
  return result;
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
): LevelCalcResult {
  const topGuardHeight = KUSABI_TOP_GUARD_HEIGHT_MM;
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
  kusabiTopGuardHeightMm: KUSABI_TOP_GUARD_HEIGHT_MM,
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
