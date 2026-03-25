/**
 * Japanese BIM compliance (Shime-shiki / 締め式 足場).
 * Applied automatically in AI BIM Mode only.
 * MHLW safety standards; all dimensions in millimeters (mm).
 */

export const AI_BIM_RULES = {
  /** Vertical standards spacing (支柱間隔) */
  VERTICAL_STANDARD_SPACING_MM: 1800,
  /** Ledger spacing — primary (大桟間隔) */
  LEDGER_SPACING_PRIMARY_MM: 1800,
  /** Ledger spacing — secondary (中桟間隔) */
  LEDGER_SPACING_SECONDARY_MM: 1200,
  /** Handrail height minimum (手摺高さ) MHLW */
  HANDRAIL_HEIGHT_MIN_MM: 850,
  /** Middle rail 中桟 height above platform */
  MIDDLE_RAIL_HEIGHT_MM: 450,
  /** Level height (1 level) */
  LEVEL_HEIGHT_MM: 1800,
} as const;

export function getAiBimDefaults() {
  return {
    preferredMainTatejiMm: AI_BIM_RULES.VERTICAL_STANDARD_SPACING_MM,
    topGuardHeightMm: AI_BIM_RULES.HANDRAIL_HEIGHT_MIN_MM,
    scaffoldWidthMm: 900 as 600 | 900 | 1200,
    levelHeightMm: AI_BIM_RULES.LEVEL_HEIGHT_MM,
    handrailHeightMm: AI_BIM_RULES.HANDRAIL_HEIGHT_MIN_MM,
    middleRailHeightMm: AI_BIM_RULES.MIDDLE_RAIL_HEIGHT_MM,
  };
}

/**
 * Shape-specific extraction validation rules.
 * Used to verify AI-extracted polygons match expected shape geometry.
 */
export const SHAPE_RULES = {
  RECTANGLE: { vertices: 4, walls: 4, convexCorners: 4, reflexCorners: 0 },
  L_SHAPE:   { vertices: 6, walls: 6, convexCorners: 5, reflexCorners: 1 },
  U_SHAPE:   { vertices: 8, walls: 8, convexCorners: 6, reflexCorners: 2 },
  T_SHAPE:   { vertices: 8, walls: 8, convexCorners: 6, reflexCorners: 2 },
  H_SHAPE:   { vertices: 12, walls: 12, convexCorners: 8, reflexCorners: 4 },
  PLUS:      { vertices: 12, walls: 12, convexCorners: 8, reflexCorners: 4 },
} as const;

export const CORNER_RULES = {
  /** Posts extend 300mm past building corner */
  CORNER_OVERRUN_MM: 300,
  /** Kusabi corner span */
  KUSABI_CORNER_SPAN_MM: 600,
  /** Wakugumi corner span */
  WAKUGUMI_CORNER_SPAN_MM: 610,
  /** L-corner threshold: |cos(angle)| < this → L-shaped corner */
  COS_L_SHAPED_MAX: 0.35,
  /** Straight threshold: |cos(angle)| >= this → not a corner */
  COS_STRAIGHT_MIN: 0.98,
} as const;

/**
 * Validate orthogonal closure: for orthogonal polygons, the sum of
 * rightward edges must equal leftward, and downward must equal upward.
 */
export function validateOrthogonalClosure(wallLengthsMm: number[]): {
  valid: boolean;
  horizontalGap: number;
  verticalGap: number;
} {
  const n = wallLengthsMm.length;
  if (n < 4 || n % 2 !== 0) return { valid: false, horizontalGap: 0, verticalGap: 0 };

  const hWalls = wallLengthsMm.filter((_, i) => i % 2 === 0);
  const vWalls = wallLengthsMm.filter((_, i) => i % 2 !== 0);

  const findBestSplit = (arr: number[]): number => {
    const k = arr.length;
    let bestGap = Infinity;
    for (let mask = 0; mask < (1 << k); mask++) {
      let pos = 0, neg = 0;
      for (let j = 0; j < k; j++) {
        if (mask & (1 << j)) pos += arr[j]; else neg += arr[j];
      }
      bestGap = Math.min(bestGap, Math.abs(pos - neg));
    }
    return bestGap;
  };

  const hGap = findBestSplit(hWalls);
  const vGap = findBestSplit(vWalls);
  return { valid: hGap === 0 && vGap === 0, horizontalGap: hGap, verticalGap: vGap };
}

/**
 * Classify a polygon corner as L-shaped, reflex (PATTANKO), or straight.
 */
export function classifyCorner(
  prev: { x: number; y: number },
  curr: { x: number; y: number },
  next: { x: number; y: number },
): 'l-shaped' | 'pattanko' | 'straight' {
  const ax = curr.x - prev.x, ay = curr.y - prev.y;
  const bx = next.x - curr.x, by = next.y - curr.y;
  const lenA = Math.hypot(ax, ay);
  const lenB = Math.hypot(bx, by);
  if (lenA < 1e-9 || lenB < 1e-9) return 'straight';
  const cosAngle = Math.abs((ax * bx + ay * by) / (lenA * lenB));
  if (cosAngle >= CORNER_RULES.COS_STRAIGHT_MIN) return 'straight';
  if (cosAngle < CORNER_RULES.COS_L_SHAPED_MAX) return 'l-shaped';
  return 'pattanko';
}

/**
 * Count PATTANKO corners in a polygon (reflex corners that are not L-shaped).
 */
export function countPattankoCorners(
  vertices: Array<{ x: number; y: number }>,
): number {
  let count = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    if (classifyCorner(prev, curr, next) === 'pattanko') count++;
  }
  return count;
}
