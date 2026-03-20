/**
 * Single source of truth for closed footprint polygons used by 3D and plan views.
 * Each wall i runs along the direction from stored vertex i → i+1, with length walls[i].wallLengthMm.
 * The last wall (i = n-1) closes from built vertex n-1 back to vertex 0 (chord length follows from geometry;
 * we do not overwrite vertex 0, which previously broke edge 0 / made edge n-1 shoot through the building).
 */

import type { WallCalculationResult } from '@/lib/api/scaffold-configs';

export type FootprintVertexXZ = { x: number; z: number };

function normaliseVertex(v: any): { x: number; z: number } {
  const hasMm = typeof v?.x === 'number' && typeof v?.y === 'number';
  if (hasMm) {
    // Note: AI returns {x, y} in image/screen coordinates (x right, y down).
    // We map y→z directly (both increase "southward").
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
 * Generate combinations C(n, k): choose k indices from 0..n-1.
 */
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

/**
 * Try to construct an orthogonal (all-90°-corners) polygon from wall lengths.
 * Buildings are almost always orthogonal:
 *   4 walls → rectangle (0 concave corners)
 *   6 walls → L-shape  (1 concave corner)
 *   8 walls → U-shape  (2 concave corners)
 *  10 walls → complex   (3 concave corners)
 *
 * For a closed orthogonal polygon with n vertices:
 *   convex corners = (n+4)/2, concave = (n-4)/2
 *   (sum of exterior angles = 360°, each turn ±90°)
 *
 * Tries all possible reflex vertex placements and picks the one
 * whose closing edge best matches the last wall length.
 */
function tryOrthogonalFallback(
  walls: Array<{ wallLengthMm?: number }>,
  n: number,
): FootprintVertexXZ[] | null {
  if (n < 4 || n > 16 || n % 2 !== 0) return null;

  const numReflex = (n - 4) / 2;
  if (numReflex < 0) return null;
  if (numReflex === 0) {
    // Rectangle: already handled by the 4-wall branch above
    return null;
  }

  const lengths = Array.from({ length: n }, (_, i) => wallLenM(walls, i));
  const reflexCombos = combinations(n, numReflex);

  let bestVerts: FootprintVertexXZ[] | null = null;
  let bestError = Infinity;

  for (const reflexPositions of reflexCombos) {
    const reflexSet = new Set(reflexPositions);

    // Try CW and CCW traversals
    for (const cwSign of [1, -1] as const) {
      const verts: FootprintVertexXZ[] = [{ x: 0, z: 0 }];
      let dir = 0; // start heading right

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

      // Check if closing edge matches last wall
      const last = verts[n - 1];
      const closeDx = verts[0].x - last.x;
      const closeDz = verts[0].z - last.z;
      const closeDist = Math.hypot(closeDx, closeDz);
      const lenError = Math.abs(closeDist - lengths[n - 1]);

      // Verify closing direction aligns with current heading
      let dirOk = true;
      if (closeDist > 0.001) {
        const closeAngle = Math.atan2(closeDz, closeDx);
        let angleDiff = Math.abs(((closeAngle - dir) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
        if (angleDiff > 0.15) dirOk = false;
      }

      const totalError = dirOk ? lenError : lenError + 1e9;
      if (totalError < bestError) {
        bestError = totalError;
        bestVerts = [...verts];
      }
    }
  }

  // Accept if closing error < 10% of last wall or < 0.5m absolute
  const tolerance = Math.max(lengths[n - 1] * 0.1, 0.5);
  if (bestVerts && bestError < tolerance) {
    return bestVerts;
  }
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

  // ── 1 wall: single edge (2 vertices) ──
  if (n === 1) {
    const lenM = wallLenM(walls, 0);
    return [{ x: 0, z: 0 }, { x: lenM, z: 0 }];
  }

  // ── 2 walls: L-shape (3 vertices) ──
  if (n === 2) {
    const len0 = wallLenM(walls, 0);
    const len1 = wallLenM(walls, 1);
    return [{ x: 0, z: 0 }, { x: len0, z: 0 }, { x: len0, z: len1 }];
  }

  // ── 4 walls: rectangle fallback when no / degenerate stored vertices ──
  if (n === 4) {
    const rect = (): FootprintVertexXZ[] => {
      const w0 = wallLenM(walls, 0);
      const w1 = wallLenM(walls, 1);
      return [
        { x: 0, z: 0 },
        { x: w0, z: 0 },
        { x: w0, z: w1 },
        { x: 0, z: w1 },
      ];
    };
    if (!storedVertices || storedVertices.length < 4) return rect();
    const raw4 = storedVertices.slice(0, 4).map(normaliseVertex);
    const xs4 = raw4.map((v) => v.x);
    const zs4 = raw4.map((v) => v.z);
    const spread4 = Math.max(
      Math.max(...xs4) - Math.min(...xs4),
      Math.max(...zs4) - Math.min(...zs4),
    );
    if (spread4 < 0.001 || !raw4.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z))) {
      return rect();
    }
  }

  // ── Stored outline: scale raw vertices to meters, then walk n-1 edges forward from verts[0] ──
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
        if (corrected.length === n) return corrected;
      }
    }
  }

  // ── Orthogonal fallback: try to build an L/U/T-shape with 90° turns ──
  const orthoResult = tryOrthogonalFallback(walls, n);
  if (orthoResult) return orthoResult;

  // ── Last resort: regular n-gon from lengths ──
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
