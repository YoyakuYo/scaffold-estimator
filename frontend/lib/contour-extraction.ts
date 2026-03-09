/**
 * Contour-Following Extraction Engine
 *
 * - Concave hull: preserve interior vertices (L-shapes, indents)
 * - Orthogonal correction: 90° snap for perpendicular walls
 * - Closed-loop: explicit last→first connection
 * - Scaling sync: use wallLengthsMm from plan dimensions for single global scale
 */

export interface Point2D {
  x: number;
  y: number;
}

const ORTHO_SNAP_DEG = 8; // Snap if within ±8° of 90° or 0°/180°

/**
 * Apply orthogonal correction: for edges intended to be perpendicular,
 * snap vertex positions so adjacent edges form 90° angles.
 * Preserves L-shapes and interior vertices (concave hull).
 */
export function applyOrthogonalCorrection(
  pts: Point2D[],
  tolDeg: number = ORTHO_SNAP_DEG,
): Point2D[] {
  if (pts.length < 4) return pts;

  const n = pts.length;
  const result: Point2D[] = [...pts];

  for (let i = 0; i < n; i++) {
    const prev = result[(i - 1 + n) % n];
    const curr = result[i];
    const next = result[(i + 1) % n];

    const ax = curr.x - prev.x;
    const ay = curr.y - prev.y;
    const bx = next.x - curr.x;
    const by = next.y - curr.y;

    const lenA = Math.hypot(ax, ay);
    const lenB = Math.hypot(bx, by);
    if (lenA < 1e-6 || lenB < 1e-6) continue;

    const angleA = Math.atan2(ay, ax);
    const angleB = Math.atan2(by, bx);
    let turn = angleB - angleA;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;

    const turnDeg = (turn * 180) / Math.PI;
    const mod90 = Math.abs(((turnDeg % 90) + 90) % 90);
    const near90 = mod90 < tolDeg || mod90 > 90 - tolDeg;

    if (near90) {
      const snappedTurn = Math.round(turnDeg / 90) * 90;
      const snappedAngleB = angleA + (snappedTurn * Math.PI) / 180;
      const newNextX = curr.x + lenB * Math.cos(snappedAngleB);
      const newNextY = curr.y + lenB * Math.sin(snappedAngleB);
      const j = (i + 1) % n;
      result[j] = { x: newNextX, y: newNextY };
    }
  }

  return result;
}

/**
 * Rebuild polygon from directions + wall lengths.
 * Ensures closed-loop: last vertex connects to first.
 * Uses wallLengthsMm from plan dimensions for single global scale.
 */
export function rebuildFromDimensions(
  rawVertices: Point2D[],
  wallLengthsMm: number[],
): Point2D[] {
  const n = rawVertices.length;
  if (n < 3 || wallLengthsMm.length !== n) return rawVertices;

  const pts: Point2D[] = [];
  let x = 0;
  let y = 0;

  for (let i = 0; i < n; i++) {
    pts.push({ x, y });

    const next = (i + 1) % n;
    const rawDx = rawVertices[next].x - rawVertices[i].x;
    const rawDy = rawVertices[next].y - rawVertices[i].y;
    const rawLen = Math.hypot(rawDx, rawDy);
    const tgtLen = wallLengthsMm[i]; // mm

    if (rawLen < 1e-12) continue;
    const dx = (rawDx / rawLen) * tgtLen;
    const dy = (rawDy / rawLen) * tgtLen;
    x += dx;
    y += dy;
  }

  return pts;
}

/**
 * Scale polygon using a single global scale from dimension strings.
 * Uses wallLengthsMm total or max to set scale; ensures X and Y use same factor.
 */
export function scaleFromDimensions(
  pts: Point2D[],
  wallLengthsMm: number[],
): Point2D[] {
  if (pts.length < 3 || wallLengthsMm.length !== pts.length) return pts;

  const n = pts.length;
  const perimeterMm = wallLengthsMm.reduce((a, b) => a + b, 0);
  const rawPerimeter = pts.reduce((sum, p, i) => {
    const next = pts[(i + 1) % n];
    return sum + Math.hypot(next.x - p.x, next.y - p.y);
  }, 0);

  if (rawPerimeter < 1e-9) return pts;
  const scale = perimeterMm / rawPerimeter;

  return pts.map((p) => ({ x: p.x * scale, y: p.y * scale }));
}

/**
 * Ensure closed polygon: last vertex connects to first.
 * If last is not already the first (within tol), append first to close the loop.
 * Preserves all vertices; building-graph will dedupe the trailing first if present.
 */
export function ensureClosedLoop(pts: Point2D[], tolMm: number = 1): Point2D[] {
  if (pts.length < 3) return pts;

  const first = pts[0];
  const last = pts[pts.length - 1];
  const dist = Math.hypot(last.x - first.x, last.y - first.y);

  if (dist <= tolMm) return pts;

  return [...pts, { x: first.x, y: first.y }];
}

/**
 * Full contour extraction pipeline:
 * 1. Apply orthogonal correction (90° snap)
 * 2. Scale from wallLengthsMm if provided (single global scale)
 * 3. Rebuild from dimensions if lengths provided
 * 4. Ensure closed loop
 */
export function applyContourExtraction(
  vertices: Point2D[],
  wallLengthsMm?: number[],
): Point2D[] {
  if (vertices.length < 3) return vertices;

  let pts = [...vertices];

  pts = applyOrthogonalCorrection(pts);

  if (wallLengthsMm && wallLengthsMm.length === pts.length) {
    pts = rebuildFromDimensions(pts, wallLengthsMm);
  } else if (wallLengthsMm && wallLengthsMm.length > 0) {
    pts = scaleFromDimensions(pts, wallLengthsMm.slice(0, pts.length));
  }

  pts = ensureClosedLoop(pts);

  return pts;
}
