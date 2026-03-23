/**
 * Map vision / BIM massing tier vertices into the same XZ metre space as the
 * ground footprint built by `buildFootprintPolygonXZ`, so upper tiers sit where
 * the drawing says — not recentred to the ground centroid (which caused fake
 * “wedding cake” stairs on façades that should stay flush).
 */

import type { FootprintVertexXZ } from '@/lib/scaffold-footprint-polygon';

/** Ray-cast point-in-polygon on XZ plane (z = “plan north”). */
function pointInPolygonXZ(pt: FootprintVertexXZ, poly: FootprintVertexXZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const zi = poly[i]!.z;
    const zj = poly[j]!.z;
    if ((zi > pt.z) !== (zj > pt.z) &&
      pt.x < ((poly[j]!.x - poly[i]!.x) * (pt.z - zi)) / (zj - zi + 1e-15) + poly[i]!.x) {
      inside = !inside;
    }
  }
  return inside;
}

function closestPointOnSegmentXZ(
  p: FootprintVertexXZ,
  a: FootprintVertexXZ,
  b: FootprintVertexXZ,
): FootprintVertexXZ {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-12) return { x: a.x, z: a.z };
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, z: a.z + t * dz };
}

/**
 * If a point lies outside the ground footprint, snap it to the nearest point on the polygon boundary.
 * Unlike an axis-aligned bounding box, this respects L-shaped / concave bases so upper-tier
 * horizontal bands do not “overrun” into void corners of the bbox.
 */
function clampPointToFootprintPolygon(pt: FootprintVertexXZ, ground: FootprintVertexXZ[]): FootprintVertexXZ {
  if (ground.length < 3) return pt;
  if (pointInPolygonXZ(pt, ground)) return pt;
  let best = closestPointOnSegmentXZ(pt, ground[0]!, ground[1]!);
  let bestD = Math.hypot(pt.x - best.x, pt.z - best.z);
  for (let i = 0; i < ground.length; i++) {
    const a = ground[i]!;
    const b = ground[(i + 1) % ground.length]!;
    const q = closestPointOnSegmentXZ(pt, a, b);
    const d = Math.hypot(pt.x - q.x, pt.z - q.z);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** Clamp every vertex to lie inside (or on) the ground footprint polygon. */
export function clampFootprintVerticesToGroundPolygon(
  vertices: FootprintVertexXZ[],
  groundPoly: FootprintVertexXZ[],
): FootprintVertexXZ[] {
  if (groundPoly.length < 3) return vertices;
  return vertices.map((v) => clampPointToFootprintPolygon(v, groundPoly));
}

export function normaliseMassingTierVerticesToGroundFootprint(
  tierVertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>,
  groundBuiltVerts: FootprintVertexXZ[],
  rawBaseVerts: Array<{ x: number; z: number }>,
  clampToGroundBounds = true,
): FootprintVertexXZ[] {
  const rawTierVerts = tierVertices.map((v) => ({
    x: v.xFrac ?? v.x ?? 0,
    z: v.yFrac ?? v.y ?? 0,
  }));
  if (rawTierVerts.length < 3) return [];

  const builtBaseMinX = Math.min(...groundBuiltVerts.map((v) => v.x));
  const builtBaseMaxX = Math.max(...groundBuiltVerts.map((v) => v.x));
  const builtBaseMinZ = Math.min(...groundBuiltVerts.map((v) => v.z));
  const builtBaseMaxZ = Math.max(...groundBuiltVerts.map((v) => v.z));
  const builtSpanX = Math.max(builtBaseMaxX - builtBaseMinX, 1e-6);
  const builtSpanZ = Math.max(builtBaseMaxZ - builtBaseMinZ, 1e-6);

  let mapped: FootprintVertexXZ[];

  if (rawBaseVerts.length >= 3) {
    const rawBaseMinX = Math.min(...rawBaseVerts.map((v) => v.x));
    const rawBaseMaxX = Math.max(...rawBaseVerts.map((v) => v.x));
    const rawBaseMinZ = Math.min(...rawBaseVerts.map((v) => v.z));
    const rawBaseMaxZ = Math.max(...rawBaseVerts.map((v) => v.z));
    const rawSpanX = Math.max(rawBaseMaxX - rawBaseMinX, 1e-6);
    const rawSpanZ = Math.max(rawBaseMaxZ - rawBaseMinZ, 1e-6);

    const scaleX = builtSpanX / rawSpanX;
    const scaleZ = builtSpanZ / rawSpanZ;
    mapped = rawTierVerts.map((v) => ({
      x: builtBaseMinX + (v.x - rawBaseMinX) * scaleX,
      z: builtBaseMinZ + (v.z - rawBaseMinZ) * scaleZ,
    }));
  } else {
    const maxCoord = Math.max(...rawTierVerts.map((v) => Math.max(Math.abs(v.x), Math.abs(v.z))));
    mapped = maxCoord > 1000
      ? rawTierVerts.map((v) => ({ x: v.x / 1000, z: v.z / 1000 }))
      : rawTierVerts.map((v) => ({ x: v.x, z: v.z }));
  }

  // Clamp upper-tier vertices to the ground footprint polygon (not its axis-aligned bbox —
  // bbox corners stick out past L-shaped bases and caused horizontal bands to overrun).
  if (clampToGroundBounds) {
    mapped = clampFootprintVerticesToGroundPolygon(mapped, groundBuiltVerts);
  }

  return mapped;
}
