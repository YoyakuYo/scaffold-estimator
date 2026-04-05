/**
 * Japanese BIM compliance (Shime-shiki / 締め式 足場).
 * Applied automatically in AI BIM Mode only.
 * MHLW safety standards; all dimensions in millimeters (mm).
 *
 * Also contains shape detection, validation, and XY axis notation utilities
 * used by the AI extraction pipeline and scaffold calculation.
 */

export const AI_BIM_RULES = {
  VERTICAL_STANDARD_SPACING_MM: 1800,
  LEDGER_SPACING_PRIMARY_MM: 1800,
  LEDGER_SPACING_SECONDARY_MM: 1200,
  HANDRAIL_HEIGHT_MIN_MM: 850,
  MIDDLE_RAIL_HEIGHT_MM: 450,
  LEVEL_HEIGHT_MM: 1800,
  CORNER_OVERRUN_MM: 300,
  /** Terminal span into the turn (kusabi) — nominal 足場幅 600 / 900 / 1200 mm. */
  CORNER_SPAN_MM: 600,
  /** First span along each wall after the turn (kusabi) — 6尺. */
  CORNER_START_SPAN_MM: 1829,
  MIN_WALL_LENGTH_MM: 600,
  JACK_BASE_MAX_MM: 300,
} as const;

export function getAiBimDefaults() {
  return {
    preferredMainTatejiMm: AI_BIM_RULES.VERTICAL_STANDARD_SPACING_MM,
    topGuardHeightMm: AI_BIM_RULES.VERTICAL_STANDARD_SPACING_MM,
    scaffoldWidthMm: 900 as 600 | 900 | 1200,
    levelHeightMm: AI_BIM_RULES.LEVEL_HEIGHT_MM,
    handrailHeightMm: AI_BIM_RULES.HANDRAIL_HEIGHT_MIN_MM,
    middleRailHeightMm: AI_BIM_RULES.MIDDLE_RAIL_HEIGHT_MM,
  };
}

// ─── Shape Classification ─────────────────────────────────

export type BuildingShape =
  | 'rectangle'    // 4 vertices, 0 reflex
  | 'l-shape'      // 6 vertices, 1 reflex
  | 'z-shape'      // 8 vertices, 2 reflex (two offset wings, like Z or S)
  | 'u-shape'      // 8 vertices, 2 reflex (courtyard opening on one side)
  | 't-shape'      // 8 vertices, 2 reflex (stem + bar, center protrusion)
  | 'cross'        // 12 vertices, 4 reflex
  | 'irregular';   // non-orthogonal or complex

export interface ShapeClassification {
  shape: BuildingShape;
  vertexCount: number;
  reflexCornerCount: number;
  reflexCornerIndices: number[];
  convexCornerCount: number;
  isOrthogonal: boolean;
  /** XY grid notation for the building */
  xyGrid: XYGridInfo | null;
  validationErrors: string[];
}

export interface XYGridInfo {
  /** X axis lines (shorter dimension, typically depth/奥行き) */
  xLines: { label: string; positionMm: number }[];
  /** Y axis lines (longer dimension, typically frontage/間口) */
  yLines: { label: string; positionMm: number }[];
  /** Per-wall axis assignment */
  wallAxes: { wallIndex: number; axis: 'X' | 'Y'; fromLine: string; toLine: string; lengthMm: number }[];
}

type Point2D = { x: number; y: number };

function vertexToPoint(v: any): Point2D {
  return {
    x: (v?.x ?? v?.xFrac ?? 0) as number,
    y: (v?.y ?? v?.yFrac ?? 0) as number,
  };
}

function crossProduct2D(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function edgeAngle(a: Point2D, b: Point2D): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function edgeLength(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function isAngleOrthogonal(angle: number): boolean {
  const snapped = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(angle - snapped) < 0.15;
}

/**
 * Classify a building footprint polygon.
 */
export function classifyBuildingShape(
  vertices: Array<any>,
  wallLengthsMm?: number[],
): ShapeClassification {
  const n = vertices.length;
  const pts = vertices.map(vertexToPoint);
  const errors: string[] = [];

  if (n < 3) {
    return {
      shape: 'irregular',
      vertexCount: n,
      reflexCornerCount: 0,
      reflexCornerIndices: [],
      convexCornerCount: 0,
      isOrthogonal: false,
      xyGrid: null,
      validationErrors: ['Too few vertices (minimum 3)'],
    };
  }

  // Determine winding direction (positive = CCW, negative = CW)
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  const isCCW = area2 > 0;

  // Find reflex corners
  const reflexIndices: number[] = [];
  let allOrthogonal = true;

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const cross = crossProduct2D(prev, curr, next);
    const isReflex = isCCW ? cross < 0 : cross > 0;
    if (isReflex) reflexIndices.push(i);

    const angle1 = edgeAngle(prev, curr);
    const angle2 = edgeAngle(curr, next);
    if (!isAngleOrthogonal(angle1) || !isAngleOrthogonal(angle2)) {
      allOrthogonal = false;
    }
  }

  // Validate wall lengths if provided
  if (wallLengthsMm && wallLengthsMm.length !== n) {
    errors.push(`wallLengthsMm count (${wallLengthsMm.length}) != vertex count (${n})`);
  }

  // Orthogonal closure check
  if (allOrthogonal && wallLengthsMm && wallLengthsMm.length === n) {
    let sumRight = 0, sumLeft = 0, sumDown = 0, sumUp = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = wallLengthsMm[i];
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) sumRight += len;
        else sumLeft += len;
      } else {
        if (dy > 0) sumDown += len;
        else sumUp += len;
      }
    }
    if (Math.abs(sumRight - sumLeft) > 500) {
      errors.push(`Horizontal imbalance: rightward=${sumRight}mm vs leftward=${sumLeft}mm (diff=${Math.abs(sumRight - sumLeft)}mm)`);
    }
    if (Math.abs(sumDown - sumUp) > 500) {
      errors.push(`Vertical imbalance: downward=${sumDown}mm vs upward=${sumUp}mm (diff=${Math.abs(sumDown - sumUp)}mm)`);
    }
  }

  // Classify shape
  let shape: BuildingShape;
  const reflexCount = reflexIndices.length;

  if (n === 4 && reflexCount === 0) {
    shape = 'rectangle';
    if (wallLengthsMm && wallLengthsMm.length === 4) {
      const tol = 500;
      if (Math.abs(wallLengthsMm[0] - wallLengthsMm[2]) > tol) {
        errors.push(`Opposite sides not equal: wall[0]=${wallLengthsMm[0]} vs wall[2]=${wallLengthsMm[2]}`);
      }
      if (Math.abs(wallLengthsMm[1] - wallLengthsMm[3]) > tol) {
        errors.push(`Opposite sides not equal: wall[1]=${wallLengthsMm[1]} vs wall[3]=${wallLengthsMm[3]}`);
      }
    }
  } else if (n === 6 && reflexCount === 1) {
    shape = 'l-shape';
  } else if (n === 8 && reflexCount === 2) {
    const shapeType8 = classify8VertexShape(pts, reflexIndices);
    shape = shapeType8;
  } else if (n === 12 && reflexCount === 4) {
    shape = 'cross';
  } else {
    shape = 'irregular';
  }

  // Build XY grid
  const xyGrid = allOrthogonal ? buildXYGrid(pts, wallLengthsMm ?? null, n) : null;

  return {
    shape,
    vertexCount: n,
    reflexCornerCount: reflexCount,
    reflexCornerIndices: reflexIndices,
    convexCornerCount: n - reflexCount,
    isOrthogonal: allOrthogonal,
    xyGrid,
    validationErrors: errors,
  };
}

/**
 * Classify 8-vertex shapes with 2 reflex corners into Z-shape, U-shape, or T-shape.
 *
 * Z-shape: Two offset wings — reflex corners are on OPPOSITE sides of the polygon.
 *   The two reflex corners create a staircase pattern (diagonal relationship).
 * U-shape: Courtyard — reflex corners are adjacent, creating an opening on one side.
 * T-shape: Center protrusion — reflex corners are adjacent, stem meets bar.
 */
function classify8VertexShape(pts: Point2D[], reflexIndices: number[]): 'z-shape' | 'u-shape' | 't-shape' {
  if (reflexIndices.length !== 2) return 'u-shape';
  const n = pts.length;
  const [r1, r2] = reflexIndices;
  const dist1 = Math.abs(r2 - r1);
  const dist2 = n - dist1;
  const minDist = Math.min(dist1, dist2);

  // Z-shape detection: reflex corners are far apart (on opposite sides)
  // In a Z with 8 vertices, reflex corners are typically 4 apart (diagonal).
  if (minDist === 4) {
    return 'z-shape';
  }

  // Also detect Z by checking if reflex corners are on opposite sides of bounding box
  if (minDist >= 3) {
    const cx = (Math.min(...pts.map(p => p.x)) + Math.max(...pts.map(p => p.x))) / 2;
    const cy = (Math.min(...pts.map(p => p.y)) + Math.max(...pts.map(p => p.y))) / 2;
    const p1 = pts[r1];
    const p2 = pts[r2];
    const side1x = p1.x < cx ? 'left' : 'right';
    const side1y = p1.y < cy ? 'top' : 'bottom';
    const side2x = p2.x < cx ? 'left' : 'right';
    const side2y = p2.y < cy ? 'top' : 'bottom';
    if (side1x !== side2x && side1y !== side2y) {
      return 'z-shape';
    }
  }

  // T-shape: reflex corners are close together (adjacent, stem meets bar)
  if (minDist <= 2) {
    return 't-shape';
  }

  // Default: U-shape
  return 'u-shape';
}

/**
 * Build Japanese XY grid notation from orthogonal polygon.
 * X = shorter axis (depth), Y = longer axis (frontage).
 */
function buildXYGrid(
  pts: Point2D[],
  wallLengthsMm: number[] | null,
  n: number,
): XYGridInfo {
  const xs = new Set<number>();
  const ys = new Set<number>();

  for (const p of pts) {
    xs.add(Math.round(p.x));
    ys.add(Math.round(p.y));
  }

  const sortedX = [...xs].sort((a, b) => a - b);
  const sortedY = [...ys].sort((a, b) => a - b);

  const spanX = sortedX.length > 1 ? sortedX[sortedX.length - 1] - sortedX[0] : 0;
  const spanY = sortedY.length > 1 ? sortedY[sortedY.length - 1] - sortedY[0] : 0;

  // X = shorter axis (vertical in plan), Y = longer axis (horizontal in plan)
  const xIsVertical = spanX <= spanY;

  const xLines = (xIsVertical ? sortedX : sortedY).map((pos, i) => ({
    label: `X${i + 1}`,
    positionMm: Math.round(pos),
  }));

  const yLines = (xIsVertical ? sortedY : sortedX).map((pos, i) => ({
    label: `Y${i + 1}`,
    positionMm: Math.round(pos),
  }));

  const wallAxes: XYGridInfo['wallAxes'] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const isHorizontal = dx > dy;
    const len = wallLengthsMm?.[i] ?? Math.round(Math.hypot(dx, dy));

    const axis: 'X' | 'Y' = (isHorizontal === xIsVertical) ? 'X' : 'Y';

    // Find closest grid lines
    const fromCoord = isHorizontal ? Math.round(Math.min(a.x, b.x)) : Math.round(Math.min(a.y, b.y));
    const toCoord = isHorizontal ? Math.round(Math.max(a.x, b.x)) : Math.round(Math.max(a.y, b.y));

    const lines = axis === 'X' ? xLines : yLines;
    const fromLine = lines.find(l => Math.abs(l.positionMm - fromCoord) < 100)?.label ?? `${axis}?`;
    const toLine = lines.find(l => Math.abs(l.positionMm - toCoord) < 100)?.label ?? `${axis}?`;

    wallAxes.push({
      wallIndex: i,
      axis,
      fromLine: fromLine === toLine ? fromLine : fromLine,
      toLine: toLine,
      lengthMm: len,
    });
  }

  return { xLines, yLines, wallAxes };
}

// ─── Validation Helpers ─────────────────────────────────

/**
 * Validate AI extraction result against shape rules.
 * Returns array of error/warning messages.
 */
export function validateExtraction(
  vertices: Array<any>,
  wallLengthsMm?: number[],
  buildingHeightMm?: number,
): string[] {
  const errors: string[] = [];
  const n = vertices.length;

  if (n < 3) {
    errors.push('ERROR: Less than 3 vertices');
    return errors;
  }

  if (wallLengthsMm) {
    if (wallLengthsMm.length !== n) {
      errors.push(`ERROR: wallLengthsMm count (${wallLengthsMm.length}) does not match vertex count (${n})`);
    }

    const perimeter = wallLengthsMm.reduce((s, v) => s + v, 0);
    if (perimeter < 4000) errors.push(`WARNING: Perimeter too small (${perimeter}mm < 4000mm)`);
    if (perimeter > 2000000) errors.push(`WARNING: Perimeter too large (${perimeter}mm > 2000m)`);

    for (let i = 0; i < wallLengthsMm.length; i++) {
      if (wallLengthsMm[i] < 600) {
        errors.push(`WARNING: Wall ${i} length (${wallLengthsMm[i]}mm) below minimum 600mm`);
      }
    }

    // Check for duplicate consecutive vertices
    const pts = vertices.map(vertexToPoint);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) < 0.001) {
        errors.push(`ERROR: Duplicate vertices at index ${i} and ${j}`);
      }
    }
  }

  if (buildingHeightMm !== undefined) {
    if (buildingHeightMm < 2000) errors.push(`WARNING: Building height (${buildingHeightMm}mm) unusually low`);
    if (buildingHeightMm > 200000) errors.push(`WARNING: Building height (${buildingHeightMm}mm) > 200m`);
  }

  // Shape-specific validation
  const classification = classifyBuildingShape(vertices, wallLengthsMm);
  errors.push(...classification.validationErrors);

  // Orthogonal vertex count check
  if (classification.isOrthogonal && n % 2 !== 0) {
    errors.push(`WARNING: Orthogonal building has odd vertex count (${n}) — likely an error`);
  }

  return errors;
}

/**
 * Count corners that need scaffold closure (yokoji+deck for L-shaped,
 * pattanko for non-90° corners). Returns breakdown for BOM.
 */
export function countCornerTypes(
  vertices: Array<any>,
): { lShapedCorners: number; pattankoCorners: number; straightEdges: number; total: number } {
  const n = vertices.length;
  if (n < 3) return { lShapedCorners: 0, pattankoCorners: 0, straightEdges: 0, total: 0 };

  const COS_L_SHAPED_MAX = 0.35;
  const COS_STRAIGHT_MIN = 0.98;
  let lShaped = 0;
  let pattanko = 0;
  let straight = 0;

  const pts = vertices.map(vertexToPoint);

  for (let j = 0; j < n; j++) {
    const prev = pts[(j - 1 + n) % n];
    const curr = pts[j];
    const next = pts[(j + 1) % n];

    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) continue;

    const cosAngle = (d1x * d2x + d1y * d2y) / (l1 * l2);
    const absCos = Math.abs(cosAngle);

    if (absCos >= COS_STRAIGHT_MIN) {
      straight++;
    } else if (absCos < COS_L_SHAPED_MAX) {
      lShaped++;
    } else {
      pattanko++;
    }
  }

  return { lShapedCorners: lShaped, pattankoCorners: pattanko, straightEdges: straight, total: n };
}

/**
 * Corner rules for scaffold span generation (足場コーナー詳細図).
 * Used to teach AI extraction about corner handling:
 *
 * 1. At every polygon corner where two walls meet:
 *    - Kusabi run = wallLength + 300 + terminal; middle = standard spans (wall + 300 − 1829).
 *    - Rectangle: shorter sides / longer sides are hints to prefer certain tail patterns when valid, not fixed grids.
 *    - wall+300 < 1829+terminal → legacy [t,…,t].
 *
 * 2. Wakugumi: [1829, …middle…, terminal]; same post-sharing idea at vertices.
 *
 * 3. Corner walkable area:
 *    - L-shaped (~90°) corners: yokoji pipes + L-shaped deck + habaki
 *    - Non-90° corners: pattanko filler planks
 *    - Both: vertical corner post at the shared polygon vertex
 *
 * 4. X-Y grid notation (for orthogonal buildings):
 *    - X = shorter axis (depth), Y = longer axis (frontage)
 *    - Walls are labeled X1, Y1, X2, Y2, etc. matching architectural grid lines
 */
export const CORNER_RULES = {
  overrunMm: AI_BIM_RULES.CORNER_OVERRUN_MM,
  kusabiCornerStartSpanMm: AI_BIM_RULES.CORNER_START_SPAN_MM,
  kusabiCornerSpanMm: AI_BIM_RULES.CORNER_SPAN_MM,
  wakugumiCornerStartSpanMm: 1829,
  wakugumiCornerSpanMm: 600,
  sharedPostAtVertex: true,
  lShapedThresholdDeg: 70,
  pattankoForNonRightAngle: true,
} as const;
