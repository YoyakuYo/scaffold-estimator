/**
 * Rebuild massing tier vertices for old saved configs that used the bbox fallback
 * (or otherwise disagree with per-edge height synthesis).
 */

import type { BuildingMassingTier } from '@/lib/api/scaffold-configs';
import { reconstructMaxTopMmPerOutlineEdge, type WallLikeForHeight } from '@/lib/reconstruct-edge-heights-from-walls';
import { synthesizeMassingTiersFromWallHeights } from '@/lib/synthesize-massing-tiers-from-wall-heights';

function getXY(v: { xFrac?: number; yFrac?: number; x?: number; y?: number }): { x: number; y: number } {
  return {
    x: typeof v.xFrac === 'number' ? v.xFrac : (typeof v.x === 'number' ? v.x : 0),
    y: typeof v.yFrac === 'number' ? v.yFrac : (typeof v.y === 'number' ? v.y : 0),
  };
}

/** True if polygon is ~axis-aligned rectangle (4 verts, 90° corners). */
function isAxisAlignedRectangleMm(verts: Array<{ x: number; y: number }>, tolDeg = 6): boolean {
  if (verts.length !== 4) return false;
  const n = 4;
  const rad = (tolDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const p0 = verts[(i - 1 + n) % n]!;
    const p1 = verts[i]!;
    const p2 = verts[(i + 1) % n]!;
    const ax = p1.x - p0.x;
    const ay = p1.y - p0.y;
    const bx = p2.x - p1.x;
    const by = p2.y - p1.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) return false;
    const dot = (ax * bx + ay * by) / (la * lb);
    if (Math.abs(dot) > Math.sin(rad)) return false;
  }
  return true;
}

function polygonAreaXY(verts: Array<{ x: number; y: number }>): number {
  if (verts.length < 3) return 0;
  let a = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += verts[i]!.x * verts[j]!.y - verts[j]!.x * verts[i]!.y;
  }
  return Math.abs(a) * 0.5;
}

function highestTier(tiers: BuildingMassingTier[]): BuildingMassingTier | undefined {
  if (tiers.length === 0) return undefined;
  return [...tiers].sort((a, b) => b.topHeightMm - a.topHeightMm)[0];
}

/**
 * If this returns non-null, use it instead of stored `massingTiers` for 3D/plan alignment.
 */
export function correctLegacyMassingTiersIfNeeded(params: {
  storedVerts: Array<{ xFrac?: number; yFrac?: number; x?: number; y?: number }>;
  massingTiers: BuildingMassingTier[];
  walls: WallLikeForHeight[];
}): BuildingMassingTier[] | null {
  const { storedVerts, massingTiers, walls } = params;
  if (!storedVerts || storedVerts.length < 3 || !massingTiers || massingTiers.length < 2) return null;

  const maxTop = reconstructMaxTopMmPerOutlineEdge(storedVerts, walls);
  if (!maxTop) return null;

  const uniq = new Set(maxTop.map((h) => Math.round(h / 100) * 100));
  if (uniq.size < 2) return null;

  const synthetic = synthesizeMassingTiersFromWallHeights(storedVerts, maxTop);
  if (!synthetic || synthetic.length < 2) return null;

  const hiStored = highestTier(massingTiers);
  const hiSyn = highestTier(synthetic as BuildingMassingTier[]);
  if (!hiStored || !hiSyn) return null;

  const vStored = hiStored.vertices.map(getXY);
  const vSyn = hiSyn.vertices.map(getXY);

  const suspiciousBox =
    vStored.length === 4 && isAxisAlignedRectangleMm(vStored);

  const areaStored = polygonAreaXY(vStored);
  const areaSyn = polygonAreaXY(vSyn);
  const areaRatio =
    areaStored > 1e-6 && areaSyn > 1e-6 ? Math.max(areaStored, areaSyn) / Math.min(areaStored, areaSyn) : 1;

  const countMismatch = vStored.length !== vSyn.length;

  // A 4-vertex rectangle is valid for upper tiers of L-shaped buildings;
  // only treat it as suspicious when area also differs significantly.
  const needsCorrection =
    (suspiciousBox && areaRatio > 1.15) ||
    (!suspiciousBox && countMismatch && areaRatio > 1.07) ||
    areaRatio > 1.25;

  if (!needsCorrection) return null;

  return synthetic.map((t) => ({
    vertices: t.vertices.map((p) => {
      const q = getXY(p as any);
      return { x: q.x, y: q.y };
    }),
    topHeightMm: t.topHeightMm,
    baseHeightMm: t.baseHeightMm,
  })) as BuildingMassingTier[];
}
