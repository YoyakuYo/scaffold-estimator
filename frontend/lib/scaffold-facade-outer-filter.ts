/**
 * For stepped / multi-tier footprints, tier decomposition creates a full perimeter
 * per slab. That includes:
 * 1) Parallel inset façades (same cardinal, different depth) → keep outermost per tier.
 * 2) Step / terrace "riser" edges perpendicular to the main 4 façades → skip in 3D
 *    (user wants gaibu only on the same directions as the ground footprint walls).
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

/** Unit tangents along ground footprint edges (one per distinct direction, ± merged). */
function groundFacadeUnitTangents(verts: Array<{ x: number; z: number }>): Array<{ tx: number; tz: number }> {
  const n = verts.length;
  const raw: Array<{ tx: number; tz: number }> = [];
  for (let i = 0; i < n; i++) {
    const v1 = verts[i]!;
    const v2 = verts[(i + 1) % n]!;
    const dx = v2.x - v1.x;
    const dz = v2.z - v1.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    raw.push({ tx: dx / len, tz: dz / len });
  }
  const cosDup = Math.cos((4 * Math.PI) / 180);
  const unique: Array<{ tx: number; tz: number }> = [];
  for (const t of raw) {
    const dup = unique.some((u) => Math.abs(u.tx * t.tx + u.tz * t.tz) >= cosDup);
    if (!dup) unique.push(t);
  }
  return unique;
}

function isParallelToGroundFacets(
  edgeTx: number,
  edgeTz: number,
  groundTans: Array<{ tx: number; tz: number }>,
): boolean {
  const cosMin = Math.cos((24 * Math.PI) / 180);
  return groundTans.some((g) => Math.abs(edgeTx * g.tx + edgeTz * g.tz) >= cosMin);
}

/**
 * @returns wall indices to skip when rendering (step risers not parallel to ground
 * façades, plus inner duplicate parallel façades per tier).
 */
export function computeInnerParallelWallSkipSet(params: {
  wallCount: number;
  tierGroups: Array<{ wallIndices: number[] }>;
  tierPolyData: FacadeTierPolyMeta[];
  groundCentroidX: number;
  groundCentroidZ: number;
  /** Ground-tier footprint; used to drop edges perpendicular to main 4 walls (step returns). */
  groundTierVerts?: Array<{ x: number; z: number }>;
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
    groundTierVerts,
  } = params;

  if (tierGroups.length <= 1 || wallCount <= 4) return skip;

  const groundTans =
    groundTierVerts && groundTierVerts.length >= 3
      ? groundFacadeUnitTangents(groundTierVerts)
      : [];

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

    const edgeTx = dx / edgeLen;
    const edgeTz = dz / edgeLen;
    // Drop step / terrace edges that run perpendicular to the main building façades.
    if (groundTans.length >= 1 && !isParallelToGroundFacets(edgeTx, edgeTz, groundTans)) {
      skip.add(wi);
      continue;
    }

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
