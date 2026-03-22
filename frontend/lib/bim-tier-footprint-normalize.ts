/**
 * Map vision / BIM massing tier vertices into the same XZ metre space as the
 * ground footprint built by `buildFootprintPolygonXZ`, so upper tiers sit where
 * the drawing says — not recentred to the ground centroid (which caused fake
 * “wedding cake” stairs on façades that should stay flush).
 */

import type { FootprintVertexXZ } from '@/lib/scaffold-footprint-polygon';

export function normaliseMassingTierVerticesToGroundFootprint(
  tierVertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>,
  groundBuiltVerts: FootprintVertexXZ[],
  rawBaseVerts: Array<{ x: number; z: number }>,
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

  if (rawBaseVerts.length >= 3) {
    const rawBaseMinX = Math.min(...rawBaseVerts.map((v) => v.x));
    const rawBaseMaxX = Math.max(...rawBaseVerts.map((v) => v.x));
    const rawBaseMinZ = Math.min(...rawBaseVerts.map((v) => v.z));
    const rawBaseMaxZ = Math.max(...rawBaseVerts.map((v) => v.z));
    const rawSpanX = Math.max(rawBaseMaxX - rawBaseMinX, 1e-6);
    const rawSpanZ = Math.max(rawBaseMaxZ - rawBaseMinZ, 1e-6);

    const scaleX = builtSpanX / rawSpanX;
    const scaleZ = builtSpanZ / rawSpanZ;
    return rawTierVerts.map((v) => ({
      x: builtBaseMinX + (v.x - rawBaseMinX) * scaleX,
      z: builtBaseMinZ + (v.z - rawBaseMinZ) * scaleZ,
    }));
  }

  const maxCoord = Math.max(...rawTierVerts.map((v) => Math.max(Math.abs(v.x), Math.abs(v.z))));
  if (maxCoord > 1000) {
    return rawTierVerts.map((v) => ({ x: v.x / 1000, z: v.z / 1000 }));
  }
  return rawTierVerts;
}
