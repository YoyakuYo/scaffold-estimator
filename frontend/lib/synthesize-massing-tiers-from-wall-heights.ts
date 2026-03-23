/**
 * Build massing tier footprints from a closed outline + per-edge building heights (mm).
 * Used by AI BIM stepped fallback and by 3D legacy correction for old saved configs.
 *
 * Matches the algorithm in scaffold/page.tsx `effectiveMassingTiers` (vertex-chain
 * extraction, not bounding-box rectangles).
 */

export interface MassingTierLike {
  vertices: Array<{ x: number; y: number }>;
  topHeightMm: number;
  baseHeightMm?: number;
}

function outlinePoint(v: { xFrac?: number; yFrac?: number; x?: number; y?: number }): { x: number; y: number } {
  return {
    x: typeof v.xFrac === 'number' ? v.xFrac : (typeof v.x === 'number' ? v.x : 0),
    y: typeof v.yFrac === 'number' ? v.yFrac : (typeof v.y === 'number' ? v.y : 0),
  };
}

/**
 * @param outlineVerts - closed polygon vertices (same order as wall edges 0→1→…→n-1→0)
 * @param wallHeightsMm - per-edge maximum building height (mm) at edge i
 */
export function synthesizeMassingTiersFromWallHeights(
  outlineVerts: Array<{ xFrac?: number; yFrac?: number; x?: number; y?: number }>,
  wallHeightsMm: number[],
): MassingTierLike[] | undefined {
  if (outlineVerts.length < 3 || wallHeightsMm.length !== outlineVerts.length) return undefined;

  const verts = outlineVerts.map(outlinePoint);
  const n = verts.length;

  let oMnx = Infinity,
    oMny = Infinity,
    oMxx = -Infinity,
    oMxy = -Infinity;
  for (const v of verts) {
    oMnx = Math.min(oMnx, v.x);
    oMny = Math.min(oMny, v.y);
    oMxx = Math.max(oMxx, v.x);
    oMxy = Math.max(oMxy, v.y);
  }
  const fullW = oMxx - oMnx;
  const fullH = oMxy - oMny;
  const fullArea = Math.max(fullW * fullH, 1e-6);

  const uniqueH = [...new Set(wallHeightsMm.filter((h) => Number.isFinite(h) && h > 0))].sort((a, b) => a - b);
  if (uniqueH.length < 2) return undefined;

  const tiers: MassingTierLike[] = [];
  let prevTop = 0;
  let hasRealSetback = false;

  for (const h of uniqueH) {
    const tierWallIndices = wallHeightsMm
      .map((wh, i) => (wh >= h ? i : -1))
      .filter((i) => i >= 0);
    if (tierWallIndices.length === 0) continue;

    const tierVerts =
      tierWallIndices.length === verts.length
        ? verts
        : (() => {
            const tierVertexSet = new Set<number>();
            for (const wi of tierWallIndices) {
              tierVertexSet.add(wi);
              tierVertexSet.add((wi + 1) % n);
            }
            const orderedVerts: Array<{ x: number; y: number }> = [];
            for (let vi = 0; vi < n; vi++) {
              if (tierVertexSet.has(vi)) orderedVerts.push(verts[vi]!);
            }
            if (orderedVerts.length < 3) return verts;

            const compact: Array<{ x: number; y: number }> = [];
            for (const p of orderedVerts) {
              const prev = compact[compact.length - 1];
              if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-6) {
                compact.push(p);
              }
            }
            if (compact.length < 3) return verts;

            let polyArea2 = 0;
            for (let i = 0; i < compact.length; i++) {
              const j = (i + 1) % compact.length;
              polyArea2 += compact[i]!.x * compact[j]!.y - compact[j]!.x * compact[i]!.y;
            }
            const polyArea = Math.abs(polyArea2) * 0.5;
            if (!Number.isFinite(polyArea) || polyArea <= 1e-6) return verts;
            if (polyArea / fullArea > 0.92) return verts;

            hasRealSetback = true;
            return compact;
          })();

    tiers.push({
      vertices: tierVerts.map((v) => ({ x: Math.round(v.x), y: Math.round(v.y) })),
      topHeightMm: h,
      baseHeightMm: prevTop,
    });
    prevTop = h;
  }

  if (!hasRealSetback) return undefined;
  return tiers.length >= 2 ? tiers : undefined;
}
