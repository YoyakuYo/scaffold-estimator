type XY = { x: number; y: number };

type MassingTier = {
  vertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>;
  topHeightMm: number;
  baseHeightMm?: number;
};

type WallLike = {
  wallLengthMm: number;
  wallHeightMm?: number;
  baseHeightMm?: number;
  tierIndex?: number;
  levelCalc?: { topPlankHeightMm?: number };
};

function getXY(v: { x?: number; y?: number; xFrac?: number; yFrac?: number }): XY {
  return {
    x: typeof v.xFrac === 'number' ? v.xFrac : (typeof v.x === 'number' ? v.x : 0),
    y: typeof v.yFrac === 'number' ? v.yFrac : (typeof v.y === 'number' ? v.y : 0),
  };
}

function polygonArea(verts: XY[]): number {
  if (verts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    a += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return Math.abs(a) * 0.5;
}

function wallTopMm(w: WallLike): number {
  const base = w.baseHeightMm ?? 0;
  const h =
    typeof w.wallHeightMm === 'number' && Number.isFinite(w.wallHeightMm) && w.wallHeightMm > 0
      ? w.wallHeightMm
      : typeof w.levelCalc?.topPlankHeightMm === 'number' && Number.isFinite(w.levelCalc.topPlankHeightMm)
        ? w.levelCalc.topPlankHeightMm
        : 0;
  return base + h;
}

function reconstructMaxTopMmPerOutlineEdge(outline: XY[], walls: WallLike[]): number[] | null {
  if (outline.length < 3 || walls.length === 0) return null;
  const n = outline.length;
  const rawLens: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    rawLens.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  const pRaw = rawLens.reduce((s, v) => s + v, 0);
  if (pRaw < 1e-9) return null;

  const byTier0 = walls.filter((w) => (w.tierIndex ?? 0) === 0);
  const byMinBase = walls.filter(
    (w) => (w.baseHeightMm ?? 0) === Math.min(...walls.map((x) => x.baseHeightMm ?? 0)),
  );
  let scale = 1;
  if (byTier0.length === n) {
    scale = byTier0.reduce((s, w) => s + Math.max(w.wallLengthMm, 600), 0) / pRaw;
  } else if (byMinBase.length === n) {
    scale = byMinBase.reduce((s, w) => s + Math.max(w.wallLengthMm, 600), 0) / pRaw;
  } else {
    scale = Math.max(...walls.map((w) => Math.max(w.wallLengthMm, 600)), 1) / Math.max(...rawLens, 1e-9);
  }
  const edgeLenMm = rawLens.map((v) => v * scale);
  const maxTop = new Array<number>(n).fill(0);
  const sorted = [...walls].sort((a, b) => b.wallLengthMm - a.wallLengthMm);
  for (const w of sorted) {
    const len = Math.max(w.wallLengthMm, 600);
    const tol = Math.max(800, 0.08 * len);
    let best = -1;
    let errBest = Infinity;
    for (let i = 0; i < n; i++) {
      const err = Math.abs(len - edgeLenMm[i]);
      if (err < errBest) {
        errBest = err;
        best = i;
      }
    }
    if (best < 0 || errBest > tol) continue;
    maxTop[best] = Math.max(maxTop[best], wallTopMm(w));
  }
  if (maxTop.every((h) => h <= 0)) return null;
  const peak = Math.max(...maxTop);
  for (let i = 0; i < n; i++) if (maxTop[i] <= 0) maxTop[i] = peak;
  return maxTop;
}

function synthesizeMassingTiers(outline: XY[], wallHeightsMm: number[]): MassingTier[] | null {
  const n = outline.length;
  if (n < 3 || wallHeightsMm.length !== n) return null;
  const uniqueH = [...new Set(wallHeightsMm.filter((h) => Number.isFinite(h) && h > 0))].sort((a, b) => a - b);
  if (uniqueH.length < 2) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const fullArea = Math.max((maxX - minX) * (maxY - minY), 1e-6);
  const tiers: MassingTier[] = [];
  let prevTop = 0;
  let hasSetback = false;

  for (const h of uniqueH) {
    const edgeIdx = wallHeightsMm.map((wh, i) => (wh >= h ? i : -1)).filter((i) => i >= 0);
    if (edgeIdx.length === 0) continue;
    const verts =
      edgeIdx.length === n
        ? outline
        : (() => {
            const vset = new Set<number>();
            for (const ei of edgeIdx) {
              vset.add(ei);
              vset.add((ei + 1) % n);
            }
            const ordered: XY[] = [];
            for (let i = 0; i < n; i++) if (vset.has(i)) ordered.push(outline[i]);
            if (ordered.length < 3) return outline;
            const compact: XY[] = [];
            for (const p of ordered) {
              const prev = compact[compact.length - 1];
              if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-6) compact.push(p);
            }
            if (compact.length < 3) return outline;
            const area = polygonArea(compact);
            if (!Number.isFinite(area) || area <= 1e-6) return outline;
            if (area / fullArea > 0.92) return outline;
            hasSetback = true;
            return compact;
          })();
    tiers.push({
      vertices: verts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      topHeightMm: h,
      baseHeightMm: prevTop,
    });
    prevTop = h;
  }
  if (!hasSetback || tiers.length < 2) return null;
  return tiers;
}

function isRect4(verts: XY[]): boolean {
  if (verts.length !== 4) return false;
  const tol = Math.sin((6 * Math.PI) / 180);
  for (let i = 0; i < 4; i++) {
    const p0 = verts[(i + 3) % 4], p1 = verts[i], p2 = verts[(i + 1) % 4];
    const ax = p1.x - p0.x, ay = p1.y - p0.y;
    const bx = p2.x - p1.x, by = p2.y - p1.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) return false;
    if (Math.abs((ax * bx + ay * by) / (la * lb)) > tol) return false;
  }
  return true;
}

export function correctLegacyMassingTiers(
  polygonVertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }> | undefined,
  massingTiers: MassingTier[] | undefined,
  walls: WallLike[] | undefined,
): MassingTier[] | null {
  if (!polygonVertices || polygonVertices.length < 3) return null;
  if (!massingTiers || massingTiers.length < 2) return null;
  if (!walls || walls.length === 0) return null;
  const outline = polygonVertices.map(getXY);
  const maxTop = reconstructMaxTopMmPerOutlineEdge(outline, walls);
  if (!maxTop) return null;
  if (new Set(maxTop.map((h) => Math.round(h / 100))).size < 2) return null;
  const syn = synthesizeMassingTiers(outline, maxTop);
  if (!syn || syn.length < 2) return null;

  const hiStored = [...massingTiers].sort((a, b) => b.topHeightMm - a.topHeightMm)[0];
  const hiSyn = [...syn].sort((a, b) => b.topHeightMm - a.topHeightMm)[0];
  const vStored = hiStored.vertices.map(getXY);
  const vSyn = hiSyn.vertices.map(getXY);
  const areaStored = polygonArea(vStored);
  const areaSyn = polygonArea(vSyn);
  const areaRatio =
    areaStored > 1e-6 && areaSyn > 1e-6 ? Math.max(areaStored, areaSyn) / Math.min(areaStored, areaSyn) : 1;
  const suspicious = isRect4(vStored) || vStored.length !== vSyn.length || areaRatio > 1.07 || vSyn.length > vStored.length;
  return suspicious ? syn : null;
}

