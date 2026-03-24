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

            // Check if the polygon has orthogonal edges (all ~90° angles).
            // When extracting a subset of an L-shaped outline, the collected
            // vertices can form a trapezoid instead of a rectangle (e.g., one
            // corner from the extension at a different depth). Fall back to
            // the AABB of qualifying edge vertices for a clean rectangle.
            let allOrthogonal = true;
            for (let i = 0; i < compact.length; i++) {
              const prev = compact[(i - 1 + compact.length) % compact.length]!;
              const curr = compact[i]!;
              const next = compact[(i + 1) % compact.length]!;
              const ax = curr.x - prev.x, ay = curr.y - prev.y;
              const bx = next.x - curr.x, by = next.y - curr.y;
              const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
              if (la > 1e-6 && lb > 1e-6) {
                const dot = Math.abs((ax * bx + ay * by) / (la * lb));
                if (dot > 0.15) { allOrthogonal = false; break; }
              }
            }

            let result = compact;
            if (!allOrthogonal) {
              const xs = compact.map((v) => v.x);
              const ys = compact.map((v) => v.y);
              const mnx = Math.min(...xs), mxx = Math.max(...xs);
              const mny = Math.min(...ys), mxy = Math.max(...ys);
              if (mxx - mnx > 1e-6 && mxy - mny > 1e-6) {
                result = [
                  { x: mnx, y: mny },
                  { x: mxx, y: mny },
                  { x: mxx, y: mxy },
                  { x: mnx, y: mxy },
                ];
              }
            }

            let polyArea2 = 0;
            for (let i = 0; i < result.length; i++) {
              const j = (i + 1) % result.length;
              polyArea2 += result[i]!.x * result[j]!.y - result[j]!.x * result[i]!.y;
            }
            const polyArea = Math.abs(polyArea2) * 0.5;
            if (!Number.isFinite(polyArea) || polyArea <= 1e-6) return verts;
            if (polyArea / fullArea > 0.92) return verts;

            hasRealSetback = true;
            return result;
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
