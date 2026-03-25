/**
 * Single source of truth for closed footprint polygons used by 3D and plan views.
 * Each wall i runs along the direction from polygon vertex i → (i+1)%n.
 *
 * Priority order for 3+ walls:
 *   1. Rectangle builder for 4 walls (exact wall lengths, always correct)
 *   2. Stored-vertex direction walk (correct orientation from BIM + exact wall lengths)
 *   3. Orthogonal builder guided by stored vertices (correct reflex corners + exact lengths)
 *   4. Blind orthogonal builder (tries all reflex combos, picks largest area)
 *   5. Regular n-gon last resort
 */

import type { WallCalculationResult } from '@/lib/api/scaffold-configs';

export type FootprintVertexXZ = { x: number; z: number };

function normaliseVertex(v: any): { x: number; z: number } {
  const hasMm = typeof v?.x === 'number' && typeof v?.y === 'number';
  if (hasMm) {
    return {
      x: Number.isFinite(v.x) ? v.x : 0,
      z: Number.isFinite(v.y) ? v.y : 0,
    };
  }
  const xf = v?.xFrac;
  const yf = v?.yFrac;
  return {
    x: Number.isFinite(xf) ? xf : 0,
    z: Number.isFinite(yf) ? yf : 0,
  };
}

function wallLenM(walls: Array<{ wallLengthMm?: number }>, i: number): number {
  const mm = (walls[i] as any)?.wallLengthMm;
  const safeMm = Number.isFinite(mm) ? Math.max(600, Number(mm)) : 6000;
  return safeMm / 1000;
}

/**
 * Reverse winding while keeping sv[0] as the first corner (same closed ring, opposite direction).
 */
function reverseClosedRingXZ(sv: FootprintVertexXZ[]): FootprintVertexXZ[] {
  const n = sv.length;
  if (n < 3) return [...sv];
  const out: FootprintVertexXZ[] = [sv[0]!];
  for (let i = n - 1; i >= 1; i--) out.push(sv[i]!);
  return out;
}

/**
 * Yield n cyclic rotations of the ring, plus the same for reversed winding.
 * Lets buildFromStoredDirections align walls[i] with the correct geometric edge when
 * polygonVertices from BIM start at a different corner than wall index 0 (plan 辺番号ずれ).
 */
function* storedPolygonRotations(sv: FootprintVertexXZ[]): Generator<FootprintVertexXZ[]> {
  const n = sv.length;
  const bases = [sv, reverseClosedRingXZ(sv)];
  for (const base of bases) {
    for (let k = 0; k < n; k++) {
      yield Array.from({ length: n }, (_, i) => base[(i + k) % n]!);
    }
  }
}

function hasPlausiblePolygonEdges(
  verts: FootprintVertexXZ[],
  walls: Array<{ wallLengthMm?: number }>,
): boolean {
  const n = walls.length;
  if (verts.length !== n || n < 3) return false;
  for (let i = 0; i < n; i++) {
    const p1 = verts[i];
    const p2 = verts[(i + 1) % n];
    if (!p1 || !p2) return false;
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    if (!Number.isFinite(len) || len < 0.1) return false;
  }
  return true;
}

function combinations(n: number, k: number): number[][] {
  if (k === 0) return [[]];
  if (k === 1) return Array.from({ length: n }, (_, i) => [i]);
  const result: number[][] = [];
  const pick = (start: number, current: number[]) => {
    if (current.length === k) { result.push([...current]); return; }
    for (let i = start; i < n; i++) {
      current.push(i);
      pick(i + 1, current);
      current.pop();
    }
  };
  pick(0, []);
  return result;
}

function polygonAbsArea(verts: FootprintVertexXZ[]): number {
  let area = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += verts[i].x * verts[j].z - verts[j].x * verts[i].z;
  }
  return Math.abs(area / 2);
}

/**
 * Build an orthogonal polygon from wall lengths using known reflex corner positions.
 */
function buildOrthoCandidate(
  lengths: number[],
  n: number,
  reflexSet: Set<number>,
  tolerance: number,
): FootprintVertexXZ[] | null {
  let best: FootprintVertexXZ[] | null = null;
  let bestArea = -1;

  for (const cwSign of [1, -1] as const) {
    const verts: FootprintVertexXZ[] = [{ x: 0, z: 0 }];
    let dir = 0;

    for (let i = 0; i < n - 1; i++) {
      const prev = verts[verts.length - 1];
      verts.push({
        x: prev.x + lengths[i] * Math.cos(dir),
        z: prev.z + lengths[i] * Math.sin(dir),
      });
      const nextVertex = (i + 1) % n;
      const turn = reflexSet.has(nextVertex) ? -Math.PI / 2 : Math.PI / 2;
      dir += cwSign * turn;
    }

    const last = verts[n - 1];
    const closeDx = verts[0].x - last.x;
    const closeDz = verts[0].z - last.z;
    const closeDist = Math.hypot(closeDx, closeDz);
    const lenError = Math.abs(closeDist - lengths[n - 1]);

    let dirOk = true;
    if (closeDist > 0.001) {
      const closeAngle = Math.atan2(closeDz, closeDx);
      const angleDiff = Math.abs(((closeAngle - dir) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (angleDiff > 0.15) dirOk = false;
    }

    if (!dirOk || lenError > tolerance) continue;

    const area = polygonAbsArea(verts);
    if (area > bestArea) {
      bestArea = area;
      best = [...verts];
    }
  }

  return best;
}

/**
 * Use stored polygon vertices to identify which corners are reflex (concave),
 * then build an orthogonal polygon with the original wall lengths.
 */
function tryOrthogonalFromStoredShape(
  walls: Array<{ wallLengthMm?: number }>,
  n: number,
  stored: FootprintVertexXZ[],
): FootprintVertexXZ[] | null {
  if (n < 6 || n > 16 || n % 2 !== 0 || stored.length < n) return null;
  const numReflex = (n - 4) / 2;
  if (numReflex <= 0) return null;

  const lengths = Array.from({ length: n }, (_, i) => wallLenM(walls, i));
  const sv = stored.slice(0, n);

  const crosses: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = sv[(i - 1 + n) % n];
    const curr = sv[i];
    const next = sv[(i + 1) % n];
    crosses.push(
      (curr.x - prev.x) * (next.z - curr.z) -
      (curr.z - prev.z) * (next.x - curr.x),
    );
  }

  const posCount = crosses.filter(c => c > 0).length;
  const negCount = crosses.filter(c => c < 0).length;

  let reflexSet: Set<number>;
  if (posCount === numReflex) {
    reflexSet = new Set<number>();
    crosses.forEach((c, i) => { if (c > 0) reflexSet.add(i); });
  } else if (negCount === numReflex) {
    reflexSet = new Set<number>();
    crosses.forEach((c, i) => { if (c < 0) reflexSet.add(i); });
  } else {
    return null;
  }

  const tolerance = Math.max(lengths[n - 1] * 0.15, 1);
  const result = buildOrthoCandidate(lengths, n, reflexSet, tolerance);
  if (result && polygonAbsArea(result) > 0.01) return result;
  return null;
}

/**
 * Try all reflex corner combinations and pick the one with the largest area.
 */
function tryOrthogonalFallback(
  walls: Array<{ wallLengthMm?: number }>,
  n: number,
): FootprintVertexXZ[] | null {
  if (n < 4 || n > 16 || n % 2 !== 0) return null;

  const numReflex = (n - 4) / 2;
  if (numReflex < 0) return null;
  if (numReflex === 0) return null;

  const lengths = Array.from({ length: n }, (_, i) => wallLenM(walls, i));
  const reflexCombos = combinations(n, numReflex);
  const tolerance = Math.max(lengths[n - 1] * 0.15, 1);

  let bestVerts: FootprintVertexXZ[] | null = null;
  let bestArea = -1;

  for (const reflexPositions of reflexCombos) {
    const reflexSet = new Set(reflexPositions);
    const candidate = buildOrthoCandidate(lengths, n, reflexSet, tolerance);
    if (!candidate) continue;

    const area = polygonAbsArea(candidate);
    if (area > bestArea) {
      bestArea = area;
      bestVerts = candidate;
    }
  }

  if (bestVerts && bestArea > 0.01) return bestVerts;
  return null;
}

/**
 * Walk stored vertex directions with exact wall lengths.
 * For orthogonal buildings, snaps each edge to the nearest 90° for clean results.
 * Returns null if the stored vertices are degenerate or the result is unusable.
 */
function buildFromStoredDirections(
  walls: Array<{ wallLengthMm?: number }>,
  n: number,
  stored: FootprintVertexXZ[],
): FootprintVertexXZ[] | null {
  if (stored.length < n || n < 3) return null;

  const sv = stored.slice(0, n);
  const lengths = Array.from({ length: n }, (_, i) => wallLenM(walls, i));

  const rawAngles: number[] = [];
  let allOrthogonal = true;
  for (let i = 0; i < n; i++) {
    const p1 = sv[i];
    const p2 = sv[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const edgeLen = Math.hypot(dx, dz);
    if (edgeLen < 1e-9) return null;
    const angle = Math.atan2(dz, dx);
    rawAngles.push(angle);

    const snapped = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
    const diff = Math.abs(angle - snapped);
    if (diff > 0.15) allOrthogonal = false;
  }

  const angles = allOrthogonal
    ? rawAngles.map(a => Math.round(a / (Math.PI / 2)) * (Math.PI / 2))
    : rawAngles;

  const verts: FootprintVertexXZ[] = [{ x: 0, z: 0 }];
  for (let i = 0; i < n - 1; i++) {
    const prev = verts[verts.length - 1];
    verts.push({
      x: prev.x + lengths[i] * Math.cos(angles[i]),
      z: prev.z + lengths[i] * Math.sin(angles[i]),
    });
  }

  if (verts.length !== n) return null;

  const last = verts[n - 1];
  const closeDist = Math.hypot(last.x - verts[0].x, last.z - verts[0].z);
  const closeAngle = Math.atan2(verts[0].z - last.z, verts[0].x - last.x);

  const expectedAngle = angles[n - 1];
  const angleDiff = Math.abs(
    ((closeAngle - expectedAngle) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI,
  );
  if (angleDiff > 0.4) return null;

  const lenError = Math.abs(closeDist - lengths[n - 1]);
  const closureTolerance = Math.max(lengths[n - 1] * 0.5, 5);
  if (lenError > closureTolerance) return null;

  if (polygonAbsArea(verts) < 0.01) return null;
  if (!hasPlausiblePolygonEdges(verts, walls)) return null;

  return verts;
}

/**
 * Build footprint polygon in meters (XZ horizontal plane; Y is up in Three.js).
 */
export function buildFootprintPolygonXZ(
  walls: WallCalculationResult[],
  storedVertices?: Array<{ xFrac?: number; yFrac?: number; x?: number; y?: number }>,
): FootprintVertexXZ[] {
  const n = walls.length;
  if (n < 1) return [];

  if (n === 1) {
    const lenM = wallLenM(walls, 0);
    return [{ x: 0, z: 0 }, { x: lenM, z: 0 }];
  }

  if (n === 2) {
    const len0 = wallLenM(walls, 0);
    const len1 = wallLenM(walls, 1);
    return [{ x: 0, z: 0 }, { x: len0, z: 0 }, { x: len0, z: len1 }];
  }

  // Normalise stored vertices once for all subsequent builders.
  // Accept exact match (length == n) or closed ring (length == n+1 with last ≈ first).
  let sv: FootprintVertexXZ[] | null = null;
  if (storedVertices) {
    const allNorm = storedVertices.map(normaliseVertex);
    if (allNorm.length === n) {
      sv = allNorm;
    } else if (allNorm.length === n + 1) {
      const first = allNorm[0];
      const last = allNorm[allNorm.length - 1];
      if (first && last && Math.hypot(first.x - last.x, first.z - last.z) <= 1e-3) {
        sv = allNorm.slice(0, n);
      }
    } else if (allNorm.length > n) {
      sv = allNorm.slice(0, n);
    }
    if (sv && !sv.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z))) {
      sv = null;
    }
  }

  // ── 4 walls: rectangle from wall lengths (only when no stored vertices) ──
  // Previously this was an unconditional early return that ignored stored vertices,
  // breaking L-shaped tier groups with exactly 4 walls. Now we first try direction-walk
  // from stored vertices so non-rectangular 4-wall shapes are preserved.
  if (n === 4 && !sv) {
    const w0 = wallLenM(walls, 0);
    const w1 = wallLenM(walls, 1);
    return [
      { x: 0, z: 0 },
      { x: w0, z: 0 },
      { x: w0, z: w1 },
      { x: 0, z: w1 },
    ];
  }

  // ── Priority 1: Walk stored vertex directions with exact wall lengths ──
  // Try every cyclic start (and reversed winding): BIM outline may list vertices from
  // a different corner than wall[0], which used to force ortho-blind and wrong 辺 order.
  if (sv) {
    let rotIdx = 0;
    for (const svTry of storedPolygonRotations(sv)) {
      const dirResult = buildFromStoredDirections(walls, n, svTry);
      if (dirResult) {
        if (typeof window !== 'undefined') {
          console.info('[Scaffold] footprint: direction-walk (stored+lengths)', n, 'walls, rot=', rotIdx);
        }
        return dirResult;
      }
      rotIdx++;
    }
  }

  // ── Priority 2: Orthogonal builder guided by stored reflex corners ──
  if (sv && n >= 6 && n <= 16 && n % 2 === 0) {
    let rotIdx = 0;
    for (const svTry of storedPolygonRotations(sv)) {
      const orthoGuided = tryOrthogonalFromStoredShape(walls, n, svTry);
      if (orthoGuided) {
        if (typeof window !== 'undefined') {
          console.info('[Scaffold] footprint: ortho-guided (stored+lengths)', n, 'walls, rot=', rotIdx);
        }
        return orthoGuided;
      }
      rotIdx++;
    }
  }

  // ── Priority 3: Blind orthogonal builder (tries all reflex combos) ──
  if (n >= 6 && n <= 16 && n % 2 === 0) {
    const orthoBlind = tryOrthogonalFallback(walls, n);
    if (orthoBlind) {
      if (typeof window !== 'undefined') {
        console.info('[Scaffold] footprint: ortho-blind (wall-lengths only)', n, 'walls');
      }
      return orthoBlind;
    }
  }

  // ── Orthogonal fallback for odd/out-of-range wall counts ──
  if (n < 6 || n > 16 || n % 2 !== 0) {
    const orthoResult = tryOrthogonalFallback(walls, n);
    if (orthoResult) return orthoResult;
  }

  // ── 4-wall rectangle fallback (stored vertices existed but all builders failed) ──
  if (n === 4) {
    const w0 = wallLenM(walls, 0);
    const w1 = wallLenM(walls, 1);
    return [
      { x: 0, z: 0 },
      { x: w0, z: 0 },
      { x: w0, z: w1 },
      { x: 0, z: w1 },
    ];
  }

  // ── Last resort: regular n-gon ──
  const extAngle = (2 * Math.PI) / n;
  const verts: FootprintVertexXZ[] = [{ x: 0, z: 0 }];
  let cx = 0,
    cz = 0;
  let angle = 0;
  for (let i = 0; i < n - 1; i++) {
    const lenM = wallLenM(walls, i);
    cx += lenM * Math.cos(angle);
    cz += lenM * Math.sin(angle);
    angle += extAngle;
    verts.push({ x: cx, z: cz });
  }
  const lastLenM = wallLenM(walls, n - 1);
  const dx = -cx;
  const dz = -cz;
  const dist = Math.hypot(dx, dz);
  if (dist >= 1e-6) {
    const scale = lastLenM / dist;
    verts[0] = { x: cx + dx * scale, z: cz + dz * scale };
  }
  return verts;
}
