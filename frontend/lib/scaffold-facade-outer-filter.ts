/**
 * For stepped / multi-tier footprints, tier decomposition creates a full perimeter
 * per slab. Setback façades often produce several parallel edges with the same
 * outward direction (e.g. multiple "east" lines at different depths). For external
 * scaffold visualization we keep only the outermost edge per (tier × cardinal),
 * so the 3D view shows one strip per building face per tier — not a solid block of
 * parallel runs toward the interior.
 */

export type FacadeTierPolyMeta = {
  tierVerts: Array<{ x: number; z: number }>;
  isOpen: boolean;
  normalSign: number;
};

function cardinalKeyFromNormal(nx: number, nz: number): string {
  const ax = Math.abs(nx);
  const az = Math.abs(nz);
  if (ax >= az) {
    return nx >= 0 ? '+X' : '-X';
  }
  return nz >= 0 ? '+Z' : '-Z';
}

/**
 * @returns wall indices to skip when rendering (inner / duplicate parallel façades).
 */
export function computeInnerParallelWallSkipSet(params: {
  wallCount: number;
  tierGroups: Array<{ wallIndices: number[] }>;
  tierPolyData: FacadeTierPolyMeta[];
  groundCentroidX: number;
  groundCentroidZ: number;
  enabled: boolean;
}): Set<number> {
  const skip = new Set<number>();
  if (!params.enabled) return skip;

  const {
    wallCount,
    tierGroups,
    tierPolyData,
    groundCentroidX,
    groundCentroidZ,
  } = params;

  if (tierGroups.length <= 1 || wallCount <= 4) return skip;

  const hasTierOffset = tierGroups.length > 1;
  type Bucket = Array<{ wallIndex: number; outwardScore: number }>;
  const buckets = new Map<string, Bucket>();

  for (let wi = 0; wi < wallCount; wi++) {
    let tgi = 0;
    let localIdx = 0;
    let found = false;
    for (let g = 0; g < tierGroups.length; g++) {
      const ix = tierGroups[g].wallIndices.indexOf(wi);
      if (ix >= 0) {
        tgi = g;
        localIdx = ix;
        found = true;
        break;
      }
    }
    if (!found) continue;

    const tpd = tierPolyData[tgi];
    const tv = tpd?.tierVerts;
    if (!tpd || !tv || tv.length < 2) continue;

    const tierIsOpen = tpd.isOpen;
    const tierNormSign = tpd.normalSign;

    const tierCx = tv.reduce((s, v) => s + v.x, 0) / tv.length;
    const tierCz = tv.reduce((s, v) => s + v.z, 0) / tv.length;
    const tierOffX = hasTierOffset ? groundCentroidX - tierCx : 0;
    const tierOffZ = hasTierOffset ? groundCentroidZ - tierCz : 0;

    const v1 = { x: tv[localIdx].x + tierOffX, z: tv[localIdx].z + tierOffZ };
    const v2Idx = tierIsOpen ? localIdx + 1 : (localIdx + 1) % tv.length;
    const v2 = { x: tv[v2Idx].x + tierOffX, z: tv[v2Idx].z + tierOffZ };
    const dx = v2.x - v1.x;
    const dz = v2.z - v1.z;
    const edgeLen = Math.hypot(dx, dz);
    if (edgeLen < 1e-6) continue;

    let nx = tierNormSign * (-dz / edgeLen);
    let nz = tierNormSign * (dx / edgeLen);
    if (tierIsOpen) {
      const midX = (v1.x + v2.x) / 2;
      const midZ = (v1.z + v2.z) / 2;
      const toCenterX = groundCentroidX - midX;
      const toCenterZ = groundCentroidZ - midZ;
      if (nx * toCenterX + nz * toCenterZ > 0) {
        nx = -nx;
        nz = -nz;
      }
    }

    const midX = (v1.x + v2.x) / 2;
    const midZ = (v1.z + v2.z) / 2;
    const outwardScore = midX * nx + midZ * nz;

    const cardinalKey = cardinalKeyFromNormal(nx, nz);
    const key = `${tgi}|${cardinalKey}`;
    const arr = buckets.get(key) ?? [];
    arr.push({ wallIndex: wi, outwardScore });
    buckets.set(key, arr);
  }

  for (const [, arr] of buckets) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => b.outwardScore - a.outwardScore);
    for (let k = 1; k < arr.length; k++) {
      skip.add(arr[k].wallIndex);
    }
  }

  return skip;
}
