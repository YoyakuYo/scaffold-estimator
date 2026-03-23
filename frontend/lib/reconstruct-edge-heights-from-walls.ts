/**
 * Reconstruct per-outline-edge maximum building top (mm) from saved calculation walls.
 * Used to re-run stepped massing synthesis for legacy configs without recreating them.
 */

export interface WallLikeForHeight {
  wallLengthMm: number;
  wallHeightMm?: number;
  baseHeightMm?: number;
  tierIndex?: number;
  levelCalc?: { topPlankHeightMm?: number };
}

function outlineXY(v: { xFrac?: number; yFrac?: number; x?: number; y?: number }): { x: number; y: number } {
  return {
    x: typeof v.xFrac === 'number' ? v.xFrac : (typeof v.x === 'number' ? v.x : 0),
    y: typeof v.yFrac === 'number' ? v.yFrac : (typeof v.y === 'number' ? v.y : 0),
  };
}

function wallTopMm(w: WallLikeForHeight): number {
  const base = w.baseHeightMm ?? 0;
  const h =
    typeof w.wallHeightMm === 'number' && Number.isFinite(w.wallHeightMm) && w.wallHeightMm > 0
      ? w.wallHeightMm
      : typeof w.levelCalc?.topPlankHeightMm === 'number' && Number.isFinite(w.levelCalc.topPlankHeightMm)
        ? w.levelCalc.topPlankHeightMm
        : 0;
  return base + h;
}

/**
 * @returns wallHeightsMm[i] = max scaffold/building top along outline edge i, or null if unreliable
 */
export function reconstructMaxTopMmPerOutlineEdge(
  storedVerts: Array<{ xFrac?: number; yFrac?: number; x?: number; y?: number }>,
  walls: WallLikeForHeight[],
): number[] | null {
  if (!storedVerts || storedVerts.length < 3 || !walls || walls.length === 0) return null;

  const verts = storedVerts.map(outlineXY);
  const n = verts.length;

  const rawLens: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % n]!;
    rawLens.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  const pRaw = rawLens.reduce((s, l) => s + l, 0);
  if (pRaw < 1e-9) return null;

  const minTier = Math.min(...walls.map((w) => w.baseHeightMm ?? 0));
  const byTierIdx0 = walls.filter((w) => (w.tierIndex ?? 0) === 0);
  const byMinBase = walls.filter((w) => (w.baseHeightMm ?? 0) === minTier);

  let scale: number;
  if (byTierIdx0.length === n) {
    const pMm = byTierIdx0.reduce((s, w) => s + Math.max(w.wallLengthMm, 600), 0);
    scale = pMm / pRaw;
  } else if (byMinBase.length === n) {
    const pMm = byMinBase.reduce((s, w) => s + Math.max(w.wallLengthMm, 600), 0);
    scale = pMm / pRaw;
  } else {
    const maxRaw = Math.max(...rawLens, 1e-9);
    const maxWall = Math.max(...walls.map((w) => Math.max(w.wallLengthMm, 600)), 1);
    scale = maxWall / maxRaw;
  }

  const edgeLenMm = rawLens.map((len) => len * scale);

  const maxTop = new Array<number>(n).fill(0);
  const sorted = [...walls].sort((a, b) => b.wallLengthMm - a.wallLengthMm);

  for (const w of sorted) {
    const len = Math.max(w.wallLengthMm, 600);
    const tol = Math.max(800, 0.08 * len);
    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < n; i++) {
      const err = Math.abs(len - edgeLenMm[i]!);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    }
    if (best < 0 || bestErr > tol) continue;
    const top = wallTopMm(w);
    if (top > maxTop[best]!) maxTop[best] = top;
  }

  if (maxTop.every((t) => t <= 0)) return null;
  const peak = Math.max(...maxTop);
  if (peak <= 0) return null;
  for (let i = 0; i < n; i++) {
    if (maxTop[i]! <= 0) maxTop[i] = peak;
  }

  return maxTop;
}
