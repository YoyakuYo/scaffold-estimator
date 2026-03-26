/**
 * Validation rules from docs/SHAPE_RULES_AND_AI_EXTRACTION.md §5 (Preventing AI Hallucination).
 * Single source for frontend + must stay aligned with that document.
 */

import { SHAPE_RULES, validateOrthogonalClosure } from '@/lib/ai-bim-rules';

const DOC_REF = 'SHAPE_RULES_AND_AI_EXTRACTION.md §5';

/** §5.3 */
const MIN_WALL_MM = 600;
const MAX_WALL_MM = 200_000;
const MIN_PERIMETER_MM = 4_000;
const MAX_PERIMETER_MM = 2_000_000;

/** §5.4 */
const MIN_HEIGHT_MM = 1_000;
const MAX_HEIGHT_MM = 300_000;

export type ShapeReportVertex = {
  x?: number;
  y?: number;
  xFrac?: number;
  yFrac?: number;
};

export type ShapeReportViolation = {
  code: string;
  /** Optional detail for logs / EN fallback */
  detail?: string;
};

export interface ShapeReportValidationResult {
  valid: boolean;
  errors: ShapeReportViolation[];
  warnings: ShapeReportViolation[];
}

function toXY(v: ShapeReportVertex): { x: number; y: number } {
  return {
    x: v.xFrac ?? v.x ?? 0,
    y: v.yFrac ?? v.y ?? 0,
  };
}

/** §5.3 — consecutive duplicate vertices */
function hasDuplicateConsecutiveVertices(pts: Array<{ x: number; y: number }>, eps = 1e-6): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) < eps) return true;
  }
  return false;
}

/** Edges axis-aligned only */
export function isOrthogonalFootprint(pts: Array<{ x: number; y: number }>, eps = 1e-6): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < eps) return false;
    if (Math.abs(dx) > eps && Math.abs(dy) > eps) return false;
  }
  return true;
}

/** Reflex (270° inner) vertex count; CCW-positive area → reflex when cross < 0 */
export function countReflexVertices(pts: Array<{ x: number; y: number }>): number {
  const n = pts.length;
  if (n < 3) return 0;
  let twiceArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twiceArea += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  const ccw = twiceArea > 0;
  let reflex = 0;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;
    const cross = e1x * e2y - e1y * e2x;
    const isRefs = ccw ? cross < 0 : cross > 0;
    if (isRefs) reflex++;
  }
  return reflex;
}

function expectedReflexForStandardShape(n: number): number | null {
  if (n === SHAPE_RULES.RECTANGLE.vertices) return SHAPE_RULES.RECTANGLE.reflexCorners;
  if (n === SHAPE_RULES.L_SHAPE.vertices) return SHAPE_RULES.L_SHAPE.reflexCorners;
  if (n === SHAPE_RULES.U_SHAPE.vertices) return SHAPE_RULES.U_SHAPE.reflexCorners;
  if (n === SHAPE_RULES.H_SHAPE.vertices) return SHAPE_RULES.H_SHAPE.reflexCorners;
  return null;
}

/**
 * Validate footprint + wall data against docs/SHAPE_RULES_AND_AI_EXTRACTION.md §5.
 */
export function validateShapeReportCompliance(params: {
  vertices: ShapeReportVertex[];
  wallLengthsMm: number[];
  wallHeightsMm?: number[] | null;
  /** Overall building height (§5.4) when not using per-edge wallHeightsMm only. */
  buildingHeightMm?: number | null;
}): ShapeReportValidationResult {
  const errors: ShapeReportViolation[] = [];
  const warnings: ShapeReportViolation[] = [];

  const verts = params.vertices ?? [];
  const n = verts.length;
  const lens = params.wallLengthsMm ?? [];
  const hasLens = lens.length > 0;

  if (n < 3) {
    errors.push({ code: 'shapeReport_fewVertices', detail: `${DOC_REF}` });
    return { valid: false, errors, warnings };
  }

  if (typeof params.buildingHeightMm === 'number' && Number.isFinite(params.buildingHeightMm)) {
    const bh = params.buildingHeightMm;
    if (bh < MIN_HEIGHT_MM || bh > MAX_HEIGHT_MM) {
      errors.push({
        code: 'shapeReport_buildingHeightBounds',
        detail: `${bh}mm (${DOC_REF} §5.4)`,
      });
    }
  }

  // §5.5 — wall count = vertex count (only when lengths are present)
  if (hasLens && lens.length !== n) {
    errors.push({
      code: 'shapeReport_wallVertexMismatch',
      detail: `vertices=${n} wallLengths=${lens.length} (${DOC_REF} §5.5)`,
    });
  }
  if (!hasLens) {
    warnings.push({
      code: 'shapeReport_wallLengthsMissing',
      detail: `${DOC_REF} §5.5`,
    });
  }

  const heights = params.wallHeightsMm;
  if (Array.isArray(heights) && heights.length > 0 && heights.length !== n) {
    errors.push({
      code: 'shapeReport_heightVertexMismatch',
      detail: `vertices=${n} wallHeights=${heights.length} (${DOC_REF} §5.5)`,
    });
  }

  const pts = verts.map(toXY);

  if (hasDuplicateConsecutiveVertices(pts)) {
    errors.push({ code: 'shapeReport_duplicateVertices', detail: DOC_REF + ' §5.3' });
  }

  let perimeter = 0;
  if (hasLens) {
    for (let i = 0; i < n; i++) {
      const L = lens[i];
      if (typeof L !== 'number' || !Number.isFinite(L)) {
        errors.push({ code: 'shapeReport_invalidWallLength', detail: `edge ${i}` });
        continue;
      }
      if (L < MIN_WALL_MM || L > MAX_WALL_MM) {
        errors.push({
          code: 'shapeReport_wallLengthBounds',
          detail: `edge ${i}: ${L}mm (${DOC_REF} §5.3)`,
        });
      }
      perimeter += L;
    }
  }

  if (hasLens && perimeter > 0 && (perimeter < MIN_PERIMETER_MM || perimeter > MAX_PERIMETER_MM)) {
    errors.push({
      code: 'shapeReport_perimeterBounds',
      detail: `${perimeter}mm (${DOC_REF} §5.3)`,
    });
  }

  if (Array.isArray(heights) && heights.length === n) {
    for (let i = 0; i < n; i++) {
      const h = heights[i];
      if (typeof h !== 'number' || !Number.isFinite(h)) {
        errors.push({ code: 'shapeReport_invalidWallHeight', detail: `edge ${i}` });
        continue;
      }
      if (h < MIN_HEIGHT_MM || h > MAX_HEIGHT_MM) {
        errors.push({
          code: 'shapeReport_wallHeightBounds',
          detail: `edge ${i}: ${h}mm (${DOC_REF} §5.4)`,
        });
      }
    }
  }

  const ortho = isOrthogonalFootprint(pts);
  if (ortho && hasLens && n >= 4 && n % 2 === 0 && lens.length === n) {
    const closure = validateOrthogonalClosure(lens);
    if (!closure.valid) {
      errors.push({
        code: 'shapeReport_orthogonalClosure',
        detail: `hGap=${closure.horizontalGap} vGap=${closure.verticalGap} (${DOC_REF} §5.2)`,
      });
    }
  } else if (!ortho && n >= 4) {
    warnings.push({
      code: 'shapeReport_nonOrthogonal',
      detail: DOC_REF + ' §5.2 applies only to orthogonal footprints',
    });
  }

  if (ortho) {
    const reflex = countReflexVertices(pts);
    const expected = expectedReflexForStandardShape(n);
    if (expected !== null && reflex !== expected) {
      errors.push({
        code: 'shapeReport_reflexCount',
        detail: `got ${reflex} reflex, expected ${expected} for n=${n} (${DOC_REF} §5.1)`,
      });
    }
    if (expected === null && n !== 4 && n !== 6 && n !== 8 && n !== 12) {
      warnings.push({
        code: 'shapeReport_nonStandardVertexCount',
        detail: `n=${n} (${DOC_REF} §5.1 table: 4,6,8,12)`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
