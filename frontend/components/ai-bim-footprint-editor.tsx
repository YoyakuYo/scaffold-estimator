'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';

export type AiBimOutlinePoint = { xFrac: number; yFrac: number };

const MIN_EDGE_MM = 600;

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-18) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  return Math.hypot(px - qx, py - qy);
}

function cloneOutline(pts: AiBimOutlinePoint[]): AiBimOutlinePoint[] {
  return pts.map((p) => ({ xFrac: p.xFrac, yFrac: p.yFrac }));
}

/** Insert a vertex on edge `edgeIndex` (vertex edgeIndex → edgeIndex+1), clamped so both new edges ≥ MIN_EDGE_MM. */
function insertVertexOnEdge(
  outline: AiBimOutlinePoint[],
  edgeIndex: number,
  wx: number,
  wy: number,
): AiBimOutlinePoint[] | null {
  const n = outline.length;
  if (n < 3 || edgeIndex < 0 || edgeIndex >= n) return null;
  const i = edgeIndex;
  const j = (i + 1) % n;
  const ax = outline[i].xFrac;
  const ay = outline[i].yFrac;
  const bx = outline[j].xFrac;
  const by = outline[j].yFrac;
  const abx = bx - ax;
  const aby = by - ay;
  const len = Math.hypot(abx, aby);
  if (len < MIN_EDGE_MM * 2 + 1) return null;
  let t = ((wx - ax) * abx + (wy - ay) * aby) / (len * len);
  const tMin = MIN_EDGE_MM / len;
  const tMax = 1 - MIN_EDGE_MM / len;
  if (tMax < tMin) return null;
  t = Math.max(tMin, Math.min(tMax, t));
  const nx = ax + t * abx;
  const ny = ay + t * aby;
  const next = cloneOutline(outline);
  const insertAt = j === 0 ? n : j;
  next.splice(insertAt, 0, { xFrac: nx, yFrac: ny });
  return next;
}

/** Remove vertex `vertexIndex`; merges two walls into one. Requires n > 3 and new diagonal edge ≥ MIN_EDGE_MM. */
function removeVertexAt(outline: AiBimOutlinePoint[], vertexIndex: number): AiBimOutlinePoint[] | null {
  const n = outline.length;
  if (n <= 3 || vertexIndex < 0 || vertexIndex >= n) return null;
  const prevIdx = (vertexIndex - 1 + n) % n;
  const nextIdx = (vertexIndex + 1) % n;
  const A = outline[prevIdx];
  const B = outline[nextIdx];
  const merged = Math.hypot(B.xFrac - A.xFrac, B.yFrac - A.yFrac);
  if (merged < MIN_EDGE_MM) return null;
  const copy = cloneOutline(outline);
  copy.splice(vertexIndex, 1);
  return copy;
}

function pickVertexAt(
  x: number,
  y: number,
  outline: AiBimOutlinePoint[],
  thresh: number,
): number | null {
  let best: { i: number; d: number } | null = null;
  for (let i = 0; i < outline.length; i++) {
    const d = Math.hypot(x - outline[i].xFrac, y - outline[i].yFrac);
    if (!best || d < best.d) best = { i, d };
  }
  if (best && best.d <= thresh) return best.i;
  return null;
}

function applyOrthoSnap(
  x: number,
  y: number,
  dragIdx: number,
  outline: AiBimOutlinePoint[],
  eps: number,
): { x: number; y: number } {
  const n = outline.length;
  const neighbors = [
    outline[(dragIdx - 1 + n) % n],
    outline[(dragIdx + 1) % n],
  ];
  let nx = x;
  let ny = y;
  for (const nb of neighbors) {
    if (Math.abs(x - nb.xFrac) < eps) nx = nb.xFrac;
    if (Math.abs(y - nb.yFrac) < eps) ny = nb.yFrac;
  }
  return { x: nx, y: ny };
}

function edgesAllMinLength(pts: AiBimOutlinePoint[], minMm: number): boolean {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(pts[j].xFrac - pts[i].xFrac, pts[j].yFrac - pts[i].yFrac);
    if (len + 1e-9 < minMm) return false;
  }
  return true;
}

/**
 * Pick corner A then B: remove vertices along the shorter perimeter detour and connect A–B with one straight segment (CAD-style chord).
 */
function chordReplaceDetour(outline: AiBimOutlinePoint[], idxA: number, idxB: number): AiBimOutlinePoint[] | null {
  const n = outline.length;
  if (n < 4 || idxA < 0 || idxB < 0 || idxA >= n || idxB >= n || idxA === idxB) return null;

  const jb = (idxB - idxA + n) % n;
  if (jb === 0 || jb === 1 || jb === n - 1) return null;
  const fwdInterior = jb - 1;
  const bwdInterior = n - jb - 1;
  if (fwdInterior < 1 && bwdInterior < 1) return null;

  const rot = idxA === 0 ? cloneOutline(outline) : [...outline.slice(idxA), ...outline.slice(0, idxA)];

  let useForward: boolean;
  if (fwdInterior >= 1 && bwdInterior >= 1) {
    useForward = jb <= n - jb;
  } else {
    useForward = fwdInterior >= 1;
  }

  let candidate: AiBimOutlinePoint[];
  if (useForward) {
    candidate = [rot[0], ...rot.slice(jb)];
  } else {
    candidate = rot.slice(0, jb + 1);
  }

  if (candidate.length < 3 || !edgesAllMinLength(candidate, MIN_EDGE_MM)) return null;
  return candidate;
}

function rectFromOppositeCorners(a: AiBimOutlinePoint, b: AiBimOutlinePoint): AiBimOutlinePoint[] | null {
  const x1 = Math.min(a.xFrac, b.xFrac);
  const x2 = Math.max(a.xFrac, b.xFrac);
  const y1 = Math.min(a.yFrac, b.yFrac);
  const y2 = Math.max(a.yFrac, b.yFrac);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < MIN_EDGE_MM || h < MIN_EDGE_MM) return null;
  return [
    { xFrac: x1, yFrac: y1 },
    { xFrac: x2, yFrac: y1 },
    { xFrac: x2, yFrac: y2 },
    { xFrac: x1, yFrac: y2 },
  ];
}

/** Regular N-gon approximating a circle; edge count scales so chords stay ≥ minChord. */
function circleOutline(cx: number, cy: number, r: number): AiBimOutlinePoint[] | null {
  if (r < MIN_EDGE_MM / (2 * Math.sin(Math.PI / 12))) return null;
  const circumference = 2 * Math.PI * r;
  let n = Math.round(circumference / (MIN_EDGE_MM * 0.92));
  n = Math.max(12, Math.min(96, n));
  const pts: AiBimOutlinePoint[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (2 * Math.PI * i) / n - Math.PI / 2;
    pts.push({ xFrac: cx + r * Math.cos(ang), yFrac: cy + r * Math.sin(ang) });
  }
  if (!edgesAllMinLength(pts, MIN_EDGE_MM)) return null;
  return pts;
}

function snapDrawOrtho(px: number, py: number, last: AiBimOutlinePoint | null, epsScale: number): AiBimOutlinePoint {
  if (!last) return { xFrac: px, yFrac: py };
  const dx = px - last.xFrac;
  const dy = py - last.yFrac;
  const eps = epsScale * 0.02;
  if (Math.abs(dx) < eps && Math.abs(dy) < eps) return { xFrac: last.xFrac, yFrac: last.yFrac };
  if (Math.abs(dx) >= Math.abs(dy)) return { xFrac: px, yFrac: last.yFrac };
  return { xFrac: last.xFrac, yFrac: py };
}

type EditTool =
  | 'move'
  | 'split'
  | 'removeVertex'
  | 'chordAB'
  | 'drawPolyline'
  | 'drawRect'
  | 'drawCircle'
  | 'deleteWall'
  | 'addWall';

type Props = {
  outline: AiBimOutlinePoint[];
  baselineOutline?: AiBimOutlinePoint[] | null;
  showBaseline: boolean;
  showDimensions?: boolean;
  showXYGrid?: boolean;
  onChange: (next: AiBimOutlinePoint[]) => void;
  onResetToBaseline?: () => void;
};

/**
 * CAD-style footprint editor: draw polyline / rect / circle to replace outline,
 * plus vertex edits (move, split, chord, remove, delete wall, add wall).
 * Shows dimension labels on every edge and XY grid notation.
 */
export function AiBimFootprintEditor({
  outline,
  baselineOutline,
  showBaseline,
  showDimensions = true,
  showXYGrid = true,
  onChange,
  onResetToBaseline,
}: Props) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [editTool, setEditTool] = useState<EditTool>('move');
  const [snapOrtho, setSnapOrtho] = useState(false);
  /** Orthogonal segment snap while drawing polyline / second corner of rectangle. */
  const [drawOrtho, setDrawOrtho] = useState(true);
  /** true = length edit moves the end (B) of the edge; false = moves the start (A). */
  const [trimMovesEnd, setTrimMovesEnd] = useState(true);
  const [chordFirstIdx, setChordFirstIdx] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [edgeLengthInput, setEdgeLengthInput] = useState<string>('');
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const [draftPolyline, setDraftPolyline] = useState<AiBimOutlinePoint[]>([]);
  const [draftHover, setDraftHover] = useState<{ x: number; y: number } | null>(null);
  const [rectCornerA, setRectCornerA] = useState<AiBimOutlinePoint | null>(null);
  const [circleCenter, setCircleCenter] = useState<AiBimOutlinePoint | null>(null);

  const flash = useCallback((msg: string) => {
    setFlashMsg(msg);
    window.setTimeout(() => setFlashMsg(null), 3200);
  }, []);

  const clearDrawingDraft = useCallback(() => {
    setDraftPolyline([]);
    setDraftHover(null);
    setRectCornerA(null);
    setCircleCenter(null);
  }, []);

  const { minX, minY, vbW, vbH, pad } = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    const pushPt = (p: { xFrac: number; yFrac: number }) => {
      xs.push(p.xFrac);
      ys.push(p.yFrac);
    };
    for (const p of outline) pushPt(p);
    if (showBaseline && baselineOutline?.length) {
      for (const p of baselineOutline) pushPt(p);
    }
    for (const p of draftPolyline) pushPt(p);
    if (draftHover) {
      xs.push(draftHover.x);
      ys.push(draftHover.y);
    }
    if (rectCornerA) pushPt(rectCornerA);
    if (circleCenter) pushPt(circleCenter);
    if (xs.length === 0) {
      return { minX: 0, minY: 0, vbW: 1e4, vbH: 1e4, pad: 800 };
    }
    const mnX = Math.min(...xs);
    const mnY = Math.min(...ys);
    const mxX = Math.max(...xs);
    const mxY = Math.max(...ys);
    const w = Math.max(mxX - mnX, 1e-6);
    const h = Math.max(mxY - mnY, 1e-6);
    const p = Math.max(w, h) * 0.08;
    return { minX: mnX, minY: mnY, vbW: w + 2 * p, vbH: h + 2 * p, pad: p };
  }, [outline, baselineOutline, showBaseline, draftPolyline, draftHover, rectCornerA, circleCenter]);

  const vertexHitR = Math.max(vbW, vbH) * 0.022;
  const edgePickThresh = Math.max(vbW, vbH) * 0.02;

  const toWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    },
    [],
  );

  const n = outline.length;
  const isDrawTool =
    editTool === 'drawPolyline' || editTool === 'drawRect' || editTool === 'drawCircle';

  const tryApplyPolyline = useCallback(() => {
    if (draftPolyline.length < 3) return;
    const closed = cloneOutline(draftPolyline);
    if (!edgesAllMinLength(closed, MIN_EDGE_MM)) {
      flash(t('scaffold', 'aiBimFootprintDrawInvalid'));
      return;
    }
    onChange(closed);
    clearDrawingDraft();
    setEditTool('move');
  }, [draftPolyline, onChange, flash, t, clearDrawingDraft]);

  const edgeLenMm = useCallback(
    (i: number) => {
      const j = (i + 1) % n;
      return Math.hypot(
        outline[j].xFrac - outline[i].xFrac,
        outline[j].yFrac - outline[i].yFrac,
      );
    },
    [outline, n],
  );

  const pickEdgeAt = useCallback(
    (x: number, y: number, skipNearVertices: boolean): number | null => {
      if (n < 3) return null;
      if (skipNearVertices && pickVertexAt(x, y, outline, vertexHitR * 1.1) != null) return null;
      let best: { i: number; d: number } | null = null;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const d = distToSegment(
          x,
          y,
          outline[i].xFrac,
          outline[i].yFrac,
          outline[j].xFrac,
          outline[j].yFrac,
        );
        if (!best || d < best.d) best = { i, d };
      }
      if (best && best.d <= edgePickThresh) return best.i;
      return null;
    },
    [outline, n, edgePickThresh, vertexHitR],
  );

  const applyEdgeLength = useCallback(() => {
    if (selectedEdge == null || n < 3) return;
    const raw = Number(edgeLengthInput);
    if (!Number.isFinite(raw) || raw < MIN_EDGE_MM) return;

    const i = selectedEdge;
    const j = (i + 1) % n;
    const A = outline[i];
    const B = outline[j];
    const dx = B.xFrac - A.xFrac;
    const dy = B.yFrac - A.yFrac;
    const cur = Math.hypot(dx, dy);
    if (cur < 1e-6) return;

    const ux = dx / cur;
    const uy = dy / cur;
    const next = cloneOutline(outline);
    if (trimMovesEnd) {
      next[j] = {
        xFrac: A.xFrac + ux * raw,
        yFrac: A.yFrac + uy * raw,
      };
    } else {
      next[i] = {
        xFrac: B.xFrac - ux * raw,
        yFrac: B.yFrac - uy * raw,
      };
    }
    onChange(next);
  }, [selectedEdge, edgeLengthInput, outline, n, onChange, trimMovesEnd]);

  const onPointerDownVertex = useCallback(
    (e: React.PointerEvent, idx: number) => {
      e.stopPropagation();
      if (isDrawTool) return;
      if (editTool === 'chordAB') {
        if (chordFirstIdx == null) {
          setChordFirstIdx(idx);
        } else if (chordFirstIdx === idx) {
          setChordFirstIdx(null);
        } else {
          const next = chordReplaceDetour(outline, chordFirstIdx, idx);
          setChordFirstIdx(null);
          if (next) onChange(next);
          else flash(t('scaffold', 'aiBimFootprintChordErr'));
        }
        return;
      }
      if (editTool === 'removeVertex' || editTool === 'deleteWall') {
        const next = removeVertexAt(outline, idx);
        if (next) onChange(next);
        else if (n <= 3) flash(t('scaffold', 'aiBimFootprintErrRemoveMinEdges'));
        else flash(t('scaffold', 'aiBimFootprintErrRemoveLong'));
        return;
      }
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDragIdx(idx);
      setSelectedEdge(null);
    },
    [editTool, outline, n, onChange, flash, t, chordFirstIdx, isDrawTool],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isDrawTool && dragIdx == null) {
        const w = toWorld(e.clientX, e.clientY);
        if (w) {
          let x = w.x;
          let y = w.y;
          if (editTool === 'drawRect' && rectCornerA && drawOrtho) {
            const sn = snapDrawOrtho(x, y, rectCornerA, Math.max(vbW, vbH));
            x = sn.xFrac;
            y = sn.yFrac;
          }
          setDraftHover({ x, y });
        }
        return;
      }
      if (dragIdx == null || editTool !== 'move') return;
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;
      let x = w.x;
      let y = w.y;
      if (snapOrtho) {
        const eps = Math.max(vbW, vbH) * 0.015;
        const sn = applyOrthoSnap(x, y, dragIdx, outline, eps);
        x = typeof sn.x === 'number' ? sn.x : x;
        y = typeof sn.y === 'number' ? sn.y : y;
      }
      const next = cloneOutline(outline);
      next[dragIdx] = { xFrac: x, yFrac: y };
      onChange(next);
    },
    [
      isDrawTool,
      dragIdx,
      editTool,
      rectCornerA,
      drawOrtho,
      outline,
      onChange,
      snapOrtho,
      toWorld,
      vbW,
      vbH,
    ],
  );

  const onPointerUp = useCallback(() => {
    setDragIdx(null);
  }, []);

  const onSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (dragIdx != null) return;
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;

      const closePolyTol = Math.max(vbW, vbH) * 0.028;

      if (editTool === 'drawPolyline') {
        let nx = w.x;
        let ny = w.y;
        if (drawOrtho && draftPolyline.length > 0) {
          const last = draftPolyline[draftPolyline.length - 1];
          const sn = snapDrawOrtho(nx, ny, last, Math.max(vbW, vbH));
          nx = sn.xFrac;
          ny = sn.yFrac;
        }
        if (draftPolyline.length >= 3) {
          const a = draftPolyline[0];
          if (Math.hypot(nx - a.xFrac, ny - a.yFrac) <= closePolyTol) {
            tryApplyPolyline();
            return;
          }
        }
        setDraftPolyline((prev) => [...prev, { xFrac: nx, yFrac: ny }]);
        return;
      }

      if (editTool === 'drawRect') {
        if (!rectCornerA) {
          setRectCornerA({ xFrac: w.x, yFrac: w.y });
        } else {
          let bx = w.x;
          let by = w.y;
          if (drawOrtho) {
            const sn = snapDrawOrtho(bx, by, rectCornerA, Math.max(vbW, vbH));
            bx = sn.xFrac;
            by = sn.yFrac;
          }
          const r = rectFromOppositeCorners(rectCornerA, { xFrac: bx, yFrac: by });
          setRectCornerA(null);
          setDraftHover(null);
          if (r) {
            onChange(r);
            setEditTool('move');
          } else flash(t('scaffold', 'aiBimFootprintDrawRectTooSmall'));
        }
        return;
      }

      if (editTool === 'drawCircle') {
        if (!circleCenter) {
          setCircleCenter({ xFrac: w.x, yFrac: w.y });
        } else {
          const r = Math.hypot(w.x - circleCenter.xFrac, w.y - circleCenter.yFrac);
          const poly = circleOutline(circleCenter.xFrac, circleCenter.yFrac, r);
          setCircleCenter(null);
          setDraftHover(null);
          if (poly) {
            onChange(poly);
            setEditTool('move');
          } else flash(t('scaffold', 'aiBimFootprintDrawCircleTooSmall'));
        }
        return;
      }

      if (editTool === 'split' || editTool === 'addWall') {
        const edge = pickEdgeAt(w.x, w.y, true);
        if (edge == null) return;
        const next = insertVertexOnEdge(outline, edge, w.x, w.y);
        if (next) onChange(next);
        else flash(t('scaffold', 'aiBimFootprintErrSplitShort'));
        return;
      }

      if (editTool === 'deleteWall') {
        const edge = pickEdgeAt(w.x, w.y, true);
        if (edge == null) return;
        if (n <= 3) {
          flash(t('scaffold', 'aiBimFootprintErrRemoveMinEdges'));
          return;
        }
        const next = removeVertexAt(outline, (edge + 1) % n);
        if (next) onChange(next);
        else flash(t('scaffold', 'aiBimFootprintErrRemoveLong'));
        return;
      }

      if (editTool === 'move') {
        const edge = pickEdgeAt(w.x, w.y, false);
        if (edge != null) {
          setSelectedEdge(edge);
          setEdgeLengthInput(String(Math.round(edgeLenMm(edge))));
        }
      }
    },
    [
      dragIdx,
      toWorld,
      editTool,
      pickEdgeAt,
      outline,
      onChange,
      edgeLenMm,
      flash,
      t,
      vbW,
      vbH,
      draftPolyline,
      drawOrtho,
      rectCornerA,
      circleCenter,
      tryApplyPolyline,
    ],
  );

  const clearChordPick = useCallback(() => setChordFirstIdx(null), []);

  const baselinePoly =
    showBaseline && baselineOutline && baselineOutline.length >= 3
      ? baselineOutline.map((p) => `${p.xFrac},${p.yFrac}`).join(' ')
      : '';

  const editedPoly = outline.map((p) => `${p.xFrac},${p.yFrac}`).join(' ');

  const viewBox = `${minX - pad} ${minY - pad} ${vbW} ${vbH}`;
  const strokeW = Math.max(vbW, vbH) * 0.004;
  const vh = Math.max(vbW, vbH) * 0.012;

  const toolHint =
    editTool === 'move'
      ? t('scaffold', 'aiBimFootprintHintMove')
      : editTool === 'split'
        ? t('scaffold', 'aiBimFootprintHintSplit')
        : editTool === 'deleteWall'
          ? 'クリックで壁を削除 / Click a wall edge to delete it'
          : editTool === 'addWall'
            ? 'クリックで壁を追加（エッジに頂点を挿入） / Click an edge to add a wall (insert vertex)'
            : editTool === 'chordAB'
              ? chordFirstIdx == null
                ? t('scaffold', 'aiBimFootprintHintChordPickA')
                : t('scaffold', 'aiBimFootprintHintChordPickB')
              : editTool === 'drawPolyline'
                ? t('scaffold', 'aiBimFootprintHintDrawPoly')
                : editTool === 'drawRect'
              ? rectCornerA == null
                ? t('scaffold', 'aiBimFootprintHintDrawRect1')
                : t('scaffold', 'aiBimFootprintHintDrawRect2')
              : editTool === 'drawCircle'
                ? circleCenter == null
                  ? t('scaffold', 'aiBimFootprintHintDrawCircle1')
                  : t('scaffold', 'aiBimFootprintHintDrawCircle2')
                : t('scaffold', 'aiBimFootprintHintRemove');

  return (
    <div className="rounded-lg border border-violet-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 border-b border-violet-100 bg-violet-50/60">
        <span className="text-xs font-semibold text-violet-800">
          {t('scaffold', 'aiBimFootprintEditTitle')}
        </span>
        {onResetToBaseline && (
          <button
            type="button"
            onClick={onResetToBaseline}
            className="text-xs font-medium text-violet-700 hover:text-violet-900 px-2 py-0.5 rounded border border-violet-200 bg-white"
          >
            {t('scaffold', 'aiBimFootprintReset')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50/90">
        {(['move', 'split', 'chordAB', 'removeVertex', 'deleteWall', 'addWall'] as const).map((tool) => (
          <button
            key={tool}
            type="button"
            onClick={() => {
              setEditTool(tool);
              setSelectedEdge(null);
              setDragIdx(null);
              setChordFirstIdx(null);
              clearDrawingDraft();
            }}
            className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
              editTool === tool
                ? tool === 'deleteWall' ? 'bg-red-600 text-white border-red-600' : 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {tool === 'move'
              ? t('scaffold', 'aiBimFootprintToolMove')
              : tool === 'split'
                ? t('scaffold', 'aiBimFootprintToolSplit')
                : tool === 'chordAB'
                  ? t('scaffold', 'aiBimFootprintToolChord')
                  : tool === 'removeVertex'
                    ? t('scaffold', 'aiBimFootprintToolRemove')
                    : tool === 'deleteWall'
                      ? '壁削除'
                      : '壁追加'}
          </button>
        ))}
        {editTool === 'chordAB' && chordFirstIdx != null && (
          <button
            type="button"
            onClick={clearChordPick}
            className="text-[10px] font-medium px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            {t('scaffold', 'aiBimFootprintChordCancel')}
          </button>
        )}
        <label className="flex items-center gap-1 ml-1 text-[10px] text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={snapOrtho}
            onChange={(e) => setSnapOrtho(e.target.checked)}
            disabled={editTool !== 'move'}
            className="rounded border-gray-300"
          />
          {t('scaffold', 'aiBimFootprintSnapOrtho')}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-amber-100/80 bg-amber-50/40">
        <span className="text-[10px] font-semibold text-amber-900/90 mr-1">{t('scaffold', 'aiBimFootprintDrawGroup')}</span>
        {(['drawPolyline', 'drawRect', 'drawCircle'] as const).map((tool) => (
          <button
            key={tool}
            type="button"
            onClick={() => {
              setEditTool(tool);
              setSelectedEdge(null);
              setDragIdx(null);
              setChordFirstIdx(null);
              clearDrawingDraft();
            }}
            className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
              editTool === tool
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-white text-gray-700 border-amber-200 hover:bg-amber-50/80'
            }`}
          >
            {tool === 'drawPolyline'
              ? t('scaffold', 'aiBimFootprintToolDrawPoly')
              : tool === 'drawRect'
                ? t('scaffold', 'aiBimFootprintToolDrawRect')
                : t('scaffold', 'aiBimFootprintToolDrawCircle')}
          </button>
        ))}
        <label className="flex items-center gap-1 ml-1 text-[10px] text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={drawOrtho}
            onChange={(e) => setDrawOrtho(e.target.checked)}
            disabled={!isDrawTool}
            className="rounded border-gray-300"
          />
          {t('scaffold', 'aiBimFootprintDrawOrtho')}
        </label>
      </div>

      <p className="text-[11px] text-gray-600 px-2 py-1 border-b border-gray-100">{toolHint}</p>
      {flashMsg && (
        <p className="text-[11px] text-amber-800 bg-amber-50 px-2 py-1 border-b border-amber-100">{flashMsg}</p>
      )}

      <svg
        ref={svgRef}
        role="img"
        viewBox={viewBox}
        className="w-full block touch-none select-none bg-white"
        style={{ minHeight: 220, maxHeight: 400 }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerDown={onSvgPointerDown}
      >
        {baselinePoly ? (
          <polygon
            points={baselinePoly}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={strokeW}
            strokeDasharray={`${Math.max(vbW, vbH) * 0.015} ${Math.max(vbW, vbH) * 0.01}`}
            opacity={0.85}
          />
        ) : null}
        {n >= 3 ? (
          <polygon
            points={editedPoly}
            fill="#e0e7ff"
            fillOpacity={isDrawTool ? 0.22 : 0.75}
            stroke="#4f46e5"
            strokeWidth={strokeW}
            strokeOpacity={isDrawTool ? 0.45 : 1}
          />
        ) : null}
        {n >= 3 &&
          editTool === 'split' &&
          Array.from({ length: n }, (_, ei) => {
            const a = outline[ei];
            const b = outline[(ei + 1) % n];
            const mx = (a.xFrac + b.xFrac) / 2;
            const my = (a.yFrac + b.yFrac) / 2;
            const br = Math.max(vbW, vbH) * 0.006;
            return (
              <rect
                key={`mid-${ei}`}
                x={mx - br}
                y={my - br}
                width={br * 2}
                height={br * 2}
                fill="#22c55e"
                fillOpacity={0.35}
                stroke="#16a34a"
                strokeWidth={strokeW * 0.5}
                transform={`rotate(45 ${mx} ${my})`}
                style={{ pointerEvents: 'none' }}
              />
            );
          })}
        {editTool === 'drawPolyline' && draftPolyline.length > 0 && (
          <g style={{ pointerEvents: 'none' }}>
            <polyline
              points={draftPolyline.map((p) => `${p.xFrac},${p.yFrac}`).join(' ')}
              fill="none"
              stroke="#ea580c"
              strokeWidth={strokeW * 1.2}
              strokeDasharray={`${Math.max(vbW, vbH) * 0.012} ${Math.max(vbW, vbH) * 0.008}`}
            />
            {draftHover && draftPolyline.length > 0 ? (
              <line
                x1={draftPolyline[draftPolyline.length - 1].xFrac}
                y1={draftPolyline[draftPolyline.length - 1].yFrac}
                x2={draftHover.x}
                y2={draftHover.y}
                stroke="#fdba74"
                strokeWidth={strokeW}
                strokeDasharray={`${Math.max(vbW, vbH) * 0.01} ${Math.max(vbW, vbH) * 0.008}`}
              />
            ) : null}
            {draftPolyline.map((p, i) => (
              <circle key={`d-${i}`} cx={p.xFrac} cy={p.yFrac} r={vh * 0.65} fill="#ea580c" stroke="#fff" strokeWidth={strokeW * 0.4} />
            ))}
            {draftPolyline.length >= 3 ? (
              <circle
                cx={draftPolyline[0].xFrac}
                cy={draftPolyline[0].yFrac}
                r={Math.max(vbW, vbH) * 0.028}
                fill="none"
                stroke="#22c55e"
                strokeWidth={strokeW}
              />
            ) : null}
            {draftHover && draftPolyline.length >= 3 ? (
              <line
                x1={draftPolyline[draftPolyline.length - 1].xFrac}
                y1={draftPolyline[draftPolyline.length - 1].yFrac}
                x2={draftPolyline[0].xFrac}
                y2={draftPolyline[0].yFrac}
                stroke="#86efac"
                strokeWidth={strokeW * 0.85}
                strokeDasharray={`${Math.max(vbW, vbH) * 0.01} ${Math.max(vbW, vbH) * 0.008}`}
                opacity={0.9}
              />
            ) : null}
          </g>
        )}
        {editTool === 'drawRect' &&
          rectCornerA &&
          draftHover &&
          (() => {
            const r = rectFromOppositeCorners(rectCornerA, { xFrac: draftHover.x, yFrac: draftHover.y });
            if (!r) return null;
            return (
              <polygon
                points={r.map((p) => `${p.xFrac},${p.yFrac}`).join(' ')}
                fill="#fed7aa"
                fillOpacity={0.35}
                stroke="#ea580c"
                strokeWidth={strokeW}
                strokeDasharray={`${Math.max(vbW, vbH) * 0.014} ${Math.max(vbW, vbH) * 0.01}`}
                style={{ pointerEvents: 'none' }}
              />
            );
          })()}
        {editTool === 'drawRect' && rectCornerA && !draftHover ? (
          <circle cx={rectCornerA.xFrac} cy={rectCornerA.yFrac} r={vh * 0.8} fill="#ea580c" stroke="#fff" strokeWidth={strokeW * 0.4} style={{ pointerEvents: 'none' }} />
        ) : null}
        {editTool === 'drawCircle' && circleCenter && draftHover ? (
          <g style={{ pointerEvents: 'none' }}>
            <circle
              cx={circleCenter.xFrac}
              cy={circleCenter.yFrac}
              r={Math.hypot(draftHover.x - circleCenter.xFrac, draftHover.y - circleCenter.yFrac)}
              fill="#fed7aa"
              fillOpacity={0.2}
              stroke="#ea580c"
              strokeWidth={strokeW}
              strokeDasharray={`${Math.max(vbW, vbH) * 0.014} ${Math.max(vbW, vbH) * 0.01}`}
            />
            <line
              x1={circleCenter.xFrac}
              y1={circleCenter.yFrac}
              x2={draftHover.x}
              y2={draftHover.y}
              stroke="#c2410c"
              strokeWidth={strokeW * 0.8}
            />
            <circle cx={circleCenter.xFrac} cy={circleCenter.yFrac} r={vh * 0.65} fill="#ea580c" stroke="#fff" strokeWidth={strokeW * 0.4} />
          </g>
        ) : null}
        {editTool === 'drawCircle' && circleCenter && !draftHover ? (
          <circle cx={circleCenter.xFrac} cy={circleCenter.yFrac} r={vh * 0.8} fill="#ea580c" stroke="#fff" strokeWidth={strokeW * 0.4} style={{ pointerEvents: 'none' }} />
        ) : null}
        {/* Dimension labels on each edge */}
        {showDimensions && n >= 3 && outline.map((p, idx) => {
          const j = (idx + 1) % n;
          const ax = p.xFrac, ay = p.yFrac;
          const bx = outline[j].xFrac, by = outline[j].yFrac;
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          const len = Math.round(Math.hypot(bx - ax, by - ay));
          const dx = bx - ax, dy = by - ay;
          const edgeLen = Math.hypot(dx, dy);
          if (edgeLen < 1) return null;
          const nx = -dy / edgeLen, ny = dx / edgeLen;
          const labelOffset = Math.max(vbW, vbH) * 0.035;
          const lx = mx + nx * labelOffset;
          const ly = my + ny * labelOffset;
          const fontSize = Math.max(vbW, vbH) * 0.022;
          const isHoriz = Math.abs(dx) >= Math.abs(dy);
          const axisLabel = isHoriz ? 'Y' : 'X';
          const isSelected = selectedEdge === idx;
          return (
            <g key={`dim-${idx}`} style={{ pointerEvents: 'none' }}>
              <line x1={ax} y1={ay} x2={bx} y2={by}
                stroke={isSelected ? '#f59e0b' : '#94a3b8'}
                strokeWidth={strokeW * 0.3}
                strokeDasharray={`${Math.max(vbW, vbH) * 0.006} ${Math.max(vbW, vbH) * 0.004}`}
              />
              <text
                x={lx} y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={isSelected ? '#d97706' : '#475569'}
                fontSize={fontSize}
                fontWeight={isSelected ? 'bold' : 'normal'}
                fontFamily="monospace"
              >
                {len.toLocaleString()}mm
              </text>
              {showXYGrid && (
                <text
                  x={lx} y={ly + fontSize * 1.3}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#7c3aed"
                  fontSize={fontSize * 0.75}
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {axisLabel}{idx + 1}
                </text>
              )}
            </g>
          );
        })}
        {/* Vertex index labels */}
        {n >= 3 && outline.map((p, idx) => {
          const fontSize = Math.max(vbW, vbH) * 0.018;
          return (
            <text
              key={`vlbl-${idx}`}
              x={p.xFrac} y={p.yFrac - vh * 1.8}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#4f46e5"
              fontSize={fontSize}
              fontWeight="bold"
              fontFamily="monospace"
              style={{ pointerEvents: 'none' }}
            >
              V{idx}
            </text>
          );
        })}
        {outline.map((p, idx) => {
          const r = vh;
          const isEdgeVert =
            editTool === 'move' &&
            selectedEdge != null &&
            (idx === selectedEdge || idx === (selectedEdge + 1) % n);
          const isRemoveHot = editTool === 'removeVertex' && n > 3;
          const isDeleteWall = editTool === 'deleteWall' && n > 3;
          const isChordPick = editTool === 'chordAB' && chordFirstIdx === idx;
          return (
            <g key={idx} style={{ pointerEvents: isDrawTool ? 'none' : 'auto' }}>
              {isChordPick ? (
                <circle
                  cx={p.xFrac}
                  cy={p.yFrac}
                  r={r * 1.75}
                  fill="none"
                  stroke="#c026d3"
                  strokeWidth={Math.max(vbW, vbH) * 0.003}
                  style={{ pointerEvents: 'none' }}
                />
              ) : null}
              <circle
                cx={p.xFrac}
                cy={p.yFrac}
                r={isRemoveHot ? r * 1.15 : r}
                fill={
                  isChordPick
                    ? '#e879f9'
                    : isEdgeVert
                      ? '#f59e0b'
                      : isRemoveHot
                        ? '#fecaca'
                        : '#6366f1'
                }
                stroke={isRemoveHot ? '#dc2626' : '#fff'}
                strokeWidth={Math.max(vbW, vbH) * 0.002}
                style={{
                  cursor:
                    editTool === 'chordAB'
                      ? 'crosshair'
                      : editTool === 'removeVertex'
                        ? n > 3
                          ? 'pointer'
                          : 'not-allowed'
                        : editTool === 'move'
                          ? 'grab'
                          : 'default',
                }}
                onPointerDown={(e) => onPointerDownVertex(e, idx)}
              />
            </g>
          );
        })}
      </svg>

      {editTool === 'move' && selectedEdge != null && n >= 3 ? (
        <div className="flex flex-col gap-2 px-2 py-2 border-t border-gray-100 bg-gray-50/80">
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-700">
            <span className="font-medium text-gray-600">{t('scaffold', 'aiBimFootprintTrimWhich')}</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="aiBimFootprintTrimVertex"
                checked={trimMovesEnd}
                onChange={() => setTrimMovesEnd(true)}
                className="rounded-full border-gray-300"
              />
              {t('scaffold', 'aiBimFootprintAtB')}
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="aiBimFootprintTrimVertex"
                checked={!trimMovesEnd}
                onChange={() => setTrimMovesEnd(false)}
                className="rounded-full border-gray-300"
              />
              {t('scaffold', 'aiBimFootprintAtA')}
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] font-medium text-gray-600 mb-0.5">
                {t('scaffold', 'aiBimFootprintEdgeLength').replace('{n}', String(selectedEdge + 1))}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={MIN_EDGE_MM}
                  step={100}
                  value={edgeLengthInput}
                  onChange={(e) => setEdgeLengthInput(e.target.value)}
                  className="w-28 rounded border border-gray-300 px-2 py-1 text-xs"
                />
                <span className="text-xs text-gray-500">mm</span>
              </div>
            </div>
            <button
              type="button"
              onClick={applyEdgeLength}
              className="text-xs font-medium px-3 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-700"
            >
              {t('scaffold', 'aiBimFootprintApplyEdge')}
            </button>
            <span className="text-[10px] text-gray-500">{t('scaffold', 'aiBimFootprintEdgeNoteTrim')}</span>
          </div>
        </div>
      ) : null}

      {editTool === 'drawPolyline' ? (
        <div className="flex flex-wrap items-center gap-2 px-2 py-2 border-t border-amber-100 bg-amber-50/50">
          <button
            type="button"
            disabled={draftPolyline.length === 0}
            onClick={() => setDraftPolyline((p) => p.slice(0, -1))}
            className="text-xs font-medium px-2 py-1 rounded border border-amber-300 bg-white text-amber-900 disabled:opacity-40"
          >
            {t('scaffold', 'aiBimFootprintDrawUndo')}
          </button>
          <button
            type="button"
            disabled={draftPolyline.length < 3}
            onClick={() => tryApplyPolyline()}
            className="text-xs font-medium px-2 py-1 rounded bg-amber-600 text-white disabled:opacity-40"
          >
            {t('scaffold', 'aiBimFootprintDrawApply')}
          </button>
          <button
            type="button"
            disabled={draftPolyline.length === 0}
            onClick={() => setDraftPolyline([])}
            className="text-xs font-medium px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-40"
          >
            {t('scaffold', 'aiBimFootprintDrawClear')}
          </button>
          <span className="text-[10px] text-gray-600">{t('scaffold', 'aiBimFootprintDrawCloseHint')}</span>
        </div>
      ) : null}
    </div>
  );
}
