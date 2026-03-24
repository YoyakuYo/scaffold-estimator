/**
 * Single source of truth for closed footprint polygons used by 3D and plan views.
 * Each wall i runs along the direction from polygon vertex i → (i+1)%n.
 *
 * Priority order:
 *   1. Rectangle builder for 4 walls (exact wall lengths)
 *   2. Orthogonal builder for 6+ even walls (exact wall lengths, correct L/U/T shape)
 *   3. Stored-vertex fallbacks (for non-orthogonal or when ortho fails)
 *   4. Regular n-gon last resort
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
 * Returns the candidate with the largest area (among both CW/CCW), or null.
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
 * Try all reflex corner combinations and pick the one with the largest area
 * (rejects degenerate / self-intersecting shapes).
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

  // ── 4 walls: always use rectangle from wall lengths ──
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

  // ── Orthogonal L/U/T (6,8,10...) walls — ALWAYS first for even wall counts ──
  // The ortho builder uses exact wall lengths for each edge, so polygon edges
  // match wallLengthMm perfectly. This prevents scaffold horizontal overrun.
  if (n >= 6 && n <= 16 && n % 2 === 0) {
    let orthoResult: FootprintVertexXZ[] | null = null;

    if (storedVertices && storedVertices.length >= n) {
      const sv = storedVertices.slice(0, n).map(normaliseVertex);
      orthoResult = tryOrthogonalFromStoredShape(walls, n, sv);
    }

    if (!orthoResult) {
      orthoResult = tryOrthogonalFallback(walls, n);
    }

    if (orthoResult) return orthoResult;
  }

  // ── Stored outline fallback (non-orthogonal or when ortho failed) ──
  if (storedVertices && storedVertices.length >= n) {
    const raw = storedVertices.slice(0, n).map(normaliseVertex);
    const xs = raw.map((v) => v.x);
    const zs = raw.map((v) => v.z);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadZ = Math.max(...zs) - Math.min(...zs);
    const spread = Math.max(spreadX, spreadZ, 1e-6);
    const maxCoord = Math.max(Math.max(...xs), Math.max(...zs));

    if (spread >= 1e-6) {
      let verts: FootprintVertexXZ[];
      if (maxCoord <= 1.1 && spread <= 1.1) {
        const refM = Math.max(...walls.map((w) => Math.max(w.wallLengthMm ?? 0, 600))) / 1000;
        const scale = refM / spread;
        verts = raw.map((v) => ({ x: v.x * scale, z: v.z * scale }));
      } else if (spread > 1000 || maxCoord > 1000) {
        verts = raw.map((v) => ({ x: v.x / 1000, z: v.z / 1000 }));
      } else {
        verts = raw.map((v) => ({ x: v.x, z: v.z }));
      }

      const spreadM = Math.max(
        Math.max(...verts.map((v) => v.x)) - Math.min(...verts.map((v) => v.x)),
        Math.max(...verts.map((v) => v.z)) - Math.min(...verts.map((v) => v.z)),
      );
      if (spreadM > 0.01) {
        const corrected: FootprintVertexXZ[] = [{ ...verts[0] }];
        for (let i = 0; i < n - 1; i++) {
          const rawDx = verts[i + 1].x - verts[i].x;
          const rawDz = verts[i + 1].z - verts[i].z;
          const rawLen = Math.hypot(rawDx, rawDz);
          const tgtLen = wallLenM(walls, i);
          const prev = corrected[corrected.length - 1]!;
          if (rawLen < 0.001) {
            corrected.push({ x: prev.x, z: prev.z });
            continue;
          }
          const dx = (rawDx / rawLen) * tgtLen;
          const dz = (rawDz / rawLen) * tgtLen;
          corrected.push({ x: prev.x + dx, z: prev.z + dz });
        }
        if (corrected.length === n && hasPlausiblePolygonEdges(corrected, walls)) return corrected;
      }
    }
  }

  // ── Orthogonal fallback for odd/out-of-range wall counts ──
  if (n < 6 || n > 16 || n % 2 !== 0) {
    const orthoResult = tryOrthogonalFallback(walls, n);
    if (orthoResult) return orthoResult;
  }

  // ── Direction-preserving fallback ──
  if (storedVertices && storedVertices.length >= n) {
    const raw = storedVertices.slice(0, n).map(normaliseVertex);
    const dirVerts: FootprintVertexXZ[] = [{ x: 0, z: 0 }];
    let dcx = 0, dcz = 0;
    for (let i = 0; i < n - 1; i++) {
      const rawDx = raw[(i + 1) % n].x - raw[i].x;
      const rawDz = raw[(i + 1) % n].z - raw[i].z;
      const rawLen = Math.hypot(rawDx, rawDz);
      const lenM = wallLenM(walls, i);
      if (rawLen > 1e-6) {
        dcx += (rawDx / rawLen) * lenM;
        dcz += (rawDz / rawLen) * lenM;
      } else {
        const fallbackAngle = i * (2 * Math.PI) / n;
        dcx += lenM * Math.cos(fallbackAngle);
        dcz += lenM * Math.sin(fallbackAngle);
      }
      dirVerts.push({ x: dcx, z: dcz });
    }
    if (dirVerts.length === n && hasPlausiblePolygonEdges(dirVerts, walls)) return dirVerts;
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
