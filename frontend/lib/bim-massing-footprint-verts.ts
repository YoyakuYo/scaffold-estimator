/**
 * Map massing tier vertices (AI/BIM outline coords) into the same meter XZ space
 * as `buildFootprintPolygonXZ` ground footprint — matches Building3DPreview scaling.
 */

export type FootprintXZ = { x: number; z: number };

export type MassingVertexInput = { x?: number; y?: number; xFrac?: number; yFrac?: number };

export function normaliseMassingVerticesToFootprintMeters(
  tierVertices: MassingVertexInput[],
  groundFootprintM: FootprintXZ[],
  rawOutlineVertices: FootprintXZ[],
): FootprintXZ[] {
  const rawTierVerts = tierVertices.map((v) => ({
    x: v.xFrac ?? v.x ?? 0,
    z: v.yFrac ?? v.y ?? 0,
  }));
  if (rawTierVerts.length < 3) return [];

  const builtBaseMinX = Math.min(...groundFootprintM.map((v) => v.x));
  const builtBaseMinZ = Math.min(...groundFootprintM.map((v) => v.z));
  const builtBaseSpan = Math.max(
    Math.max(...groundFootprintM.map((v) => v.x)) - builtBaseMinX,
    Math.max(...groundFootprintM.map((v) => v.z)) - builtBaseMinZ,
    1e-6,
  );

  if (rawOutlineVertices.length >= 3) {
    const rawBaseMinX = Math.min(...rawOutlineVertices.map((v) => v.x));
    const rawBaseMinZ = Math.min(...rawOutlineVertices.map((v) => v.z));
    const rawBaseSpan = Math.max(
      Math.max(...rawOutlineVertices.map((v) => v.x)) - rawBaseMinX,
      Math.max(...rawOutlineVertices.map((v) => v.z)) - rawBaseMinZ,
      1e-6,
    );
    const scale = builtBaseSpan / rawBaseSpan;
    return rawTierVerts.map((v) => ({
      x: builtBaseMinX + (v.x - rawBaseMinX) * scale,
      z: builtBaseMinZ + (v.z - rawBaseMinZ) * scale,
    }));
  }

  const maxCoord = Math.max(...rawTierVerts.map((v) => Math.max(Math.abs(v.x), Math.abs(v.z))));
  if (maxCoord > 1000) {
    return rawTierVerts.map((v) => ({ x: v.x / 1000, z: v.z / 1000 }));
  }
  return rawTierVerts.map((v) => ({ x: v.x, z: v.z }));
}
