/**
 * Polygon Detection — Find closed polygons from raw line segments
 *
 * Algorithm:
 * 1. Build adjacency map (rounded coord keys to avoid float errors)
 * 2. Walk the outer boundary using a "rightmost turn" heuristic
 *    which naturally follows the exterior perimeter of any shape.
 * 3. Score each candidate polygon:
 *    - Reject circles (equal edge lengths, many vertices)
 *    - Reject tiny shapes (annotation symbols)
 *    - Prefer orthogonal (rectilinear) shapes
 * 4. Return the highest-scoring polygon (best building candidate).
 *
 * Pure functions. No UI, no side-effects.
 */

import { Point2D, polygonArea } from './areaCalculation';

export interface RawSegment {
  start: Point2D;
  end: Point2D;
}

// ─── Coordinate key (tolerance-based rounding) ───────────────

function buildAdjacency(
  segments: RawSegment[],
  snap: number,
): { adj: Map<string, Array<{ to: string; angle: number }>>; keyToXY: (k: string) => Point2D } {
  const snapC = (v: number) => Math.round(v / snap) * snap;
  const key = (x: number, y: number) => `${snapC(x)},${snapC(y)}`;
  const keyToXY = (k: string): Point2D => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  };

  const adj = new Map<string, Array<{ to: string; angle: number }>>();
  const addEdge = (from: string, to: string, angle: number) => {
    if (from === to) return;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ to, angle });
  };

  for (const seg of segments) {
    const len = Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y);
    if (len < snap * 0.5) continue; // skip degenerate
    const k1 = key(seg.start.x, seg.start.y);
    const k2 = key(seg.end.x, seg.end.y);
    const a12 = Math.atan2(seg.end.y - seg.start.y, seg.end.x - seg.start.x);
    const a21 = Math.atan2(seg.start.y - seg.end.y, seg.start.x - seg.end.x);
    addEdge(k1, k2, a12);
    addEdge(k2, k1, a21);
  }

  return { adj, keyToXY };
}

/**
 * Walk the outer boundary from a start node using the "rightmost turn" rule.
 * At each junction, choose the neighbor making the most clockwise turn from
 * the incoming direction. This traces the exterior perimeter naturally.
 */
function walkOuterLoop(
  adj: Map<string, Array<{ to: string; angle: number }>>,
  startKey: string,
  startAngle: number,
): string[] | null {
  const path: string[] = [startKey];
  const visitedEdges = new Set<string>();
  visitedEdges.add(`${startKey}@${startAngle.toFixed(5)}`);
  let curKey = startKey;
  let incomingAngle = startAngle;
  const maxSteps = adj.size * 2 + 10;

  for (let step = 0; step < maxSteps; step++) {
    const neighbors = adj.get(curKey) ?? [];
    if (neighbors.length === 0) return null;

    const reverseAngle = incomingAngle + Math.PI;
    let bestDiff = Infinity;
    let best: { to: string; angle: number } | null = null;

    for (const nb of neighbors) {
      // Don't immediately backtrack (unless no other option)
      if (path.length > 1 && nb.to === path[path.length - 2] && neighbors.length > 1) continue;
      let diff = nb.angle - reverseAngle;
      while (diff <= 0) diff += 2 * Math.PI;
      while (diff > 2 * Math.PI) diff -= 2 * Math.PI;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = nb;
      }
    }

    if (!best) return null;
    if (best.to === startKey && path.length >= 3) return path;

    const edgeKey = `${best.to}@${best.angle.toFixed(5)}`;
    if (visitedEdges.has(edgeKey)) return null;
    visitedEdges.add(edgeKey);
    path.push(best.to);
    incomingAngle = best.angle;
    curKey = best.to;
  }
  return null;
}

/**
 * Score a candidate polygon as a building footprint.
 * Returns -Infinity to reject outright, higher = better.
 */
function scorePolygon(pts: Point2D[]): number {
  const n = pts.length;
  if (n < 3) return -Infinity;

  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (w < 1 || h < 1) return -Infinity;

  // Reject extreme aspect ratios (title blocks, dimension lines)
  const aspect = Math.max(w, h) / Math.min(w, h);
  if (aspect > 25) return -Infinity;

  // Edge length statistics
  const edgeLens = pts.map((p, i) => Math.hypot(pts[(i + 1) % n].x - p.x, pts[(i + 1) % n].y - p.y));
  const maxEdge = Math.max(...edgeLens);
  const minEdge = Math.min(...edgeLens);
  const perimeter = edgeLens.reduce((s, v) => s + v, 0);

  // Reject very small shapes (annotation symbols, door arcs, etc.)
  if (perimeter < 4000) return -Infinity; // < 4m perimeter — not a building

  // Reject circles / regular polygons: all edges nearly equal + many vertices
  const edgeVariance = maxEdge / (minEdge + 1e-9);
  if (edgeVariance < 1.3 && n >= 8) return -Infinity;

  // Count orthogonal corners (≈90°)
  let orthoCorners = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const abx = b.x - a.x; const aby = b.y - a.y;
    const bcx = c.x - b.x; const bcy = c.y - b.y;
    const cross = Math.abs(abx * bcy - aby * bcx);
    const dot = abx * bcx + aby * bcy;
    const angle = Math.abs(Math.atan2(cross, dot) * 180 / Math.PI);
    if (angle > 70 && angle < 110) orthoCorners++;
  }
  const orthoRatio = orthoCorners / n;

  const area = Math.abs(polygonArea(pts));

  let score = Math.log(area + 1);
  score += orthoRatio * 5;            // strongly prefer rectilinear shapes
  score -= Math.max(0, n - 30) * 0.5; // penalise very many vertices

  return score;
}

// ─── Main API ────────────────────────────────────────────────

export interface DetectedPolygon {
  points: Point2D[];
  area: number;
}

/**
 * Detect closed polygons from raw segments, scored as building candidates.
 * Returns them sorted by score descending (best building first).
 */
export function detectPolygons(segments: RawSegment[]): DetectedPolygon[] {
  if (segments.length < 3) return [];

  const allX = segments.flatMap(s => [s.start.x, s.end.x]);
  const allY = segments.flatMap(s => [s.start.y, s.end.y]);
  const extentX = Math.max(...allX) - Math.min(...allX);
  const extentY = Math.max(...allY) - Math.min(...allY);
  const snap = Math.max(1, Math.min(100, Math.max(extentX, extentY) * 0.005));

  const { adj, keyToXY } = buildAdjacency(segments, snap);

  const candidates: Array<{ points: Point2D[]; area: number; score: number }> = [];

  for (const [startKey, edges] of adj) {
    for (const startEdge of edges) {
      const loop = walkOuterLoop(adj, startKey, startEdge.angle);
      if (!loop || loop.length < 3) continue;
      const pts = loop.map(keyToXY);
      const area = Math.abs(polygonArea(pts));
      if (area < 1) continue;
      const score = scorePolygon(pts);
      if (score > -Infinity) {
        candidates.push({ points: pts, area, score });
      }
    }
  }

  // Sort by score desc, then area desc
  candidates.sort((a, b) => b.score - a.score || b.area - a.area);

  return candidates.map(c => ({ points: c.points, area: c.area }));
}

/**
 * Detect the best building outline polygon from raw segments.
 * Uses scoring to reject circles, title blocks, and annotation shapes.
 * Returns null if no valid polygon found.
 */
export function detectOuterPolygon(segments: RawSegment[]): DetectedPolygon | null {
  const polygons = detectPolygons(segments);
  return polygons.length > 0 ? polygons[0] : null;
}
