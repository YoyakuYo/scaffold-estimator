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

type EditTool = 'move' | 'split' | 'removeVertex' | 'chordAB';

type Props = {
  outline: AiBimOutlinePoint[];
  baselineOutline?: AiBimOutlinePoint[] | null;
  showBaseline: boolean;
  onChange: (next: AiBimOutlinePoint[]) => void;
  onResetToBaseline?: () => void;
};

/**
 * CAD-style footprint editor: move corners, edge length, split wall (add corner), remove corner (merge walls), optional orthogonal snap.
 */
export function AiBimFootprintEditor({
  outline,
  baselineOutline,
  showBaseline,
  onChange,
  onResetToBaseline,
}: Props) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [editTool, setEditTool] = useState<EditTool>('move');
  const [snapOrtho, setSnapOrtho] = useState(false);
  /** true = length edit moves the end (B) of the edge; false = moves the start (A). */
  const [trimMovesEnd, setTrimMovesEnd] = useState(true);
  const [chordFirstIdx, setChordFirstIdx] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [edgeLengthInput, setEdgeLengthInput] = useState<string>('');
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setFlashMsg(msg);
    window.setTimeout(() => setFlashMsg(null), 3200);
  }, []);

  const { minX, minY, vbW, vbH, pad } = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of outline) {
      xs.push(p.xFrac);
      ys.push(p.yFrac);
    }
    if (showBaseline && baselineOutline?.length) {
      for (const p of baselineOutline) {
        xs.push(p.xFrac);
        ys.push(p.yFrac);
      }
    }
    const mnX = Math.min(...xs);
    const mnY = Math.min(...ys);
    const mxX = Math.max(...xs);
    const mxY = Math.max(...ys);
    const w = Math.max(mxX - mnX, 1e-6);
    const h = Math.max(mxY - mnY, 1e-6);
    const p = Math.max(w, h) * 0.08;
    return { minX: mnX, minY: mnY, vbW: w + 2 * p, vbH: h + 2 * p, pad: p };
  }, [outline, baselineOutline, showBaseline]);

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
      if (editTool === 'removeVertex') {
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
    [editTool, outline, n, onChange, flash, t, chordFirstIdx],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
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
    [dragIdx, editTool, outline, onChange, snapOrtho, toWorld, vbW, vbH],
  );

  const onPointerUp = useCallback(() => {
    setDragIdx(null);
  }, []);

  const onSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (dragIdx != null) return;
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;

      if (editTool === 'split') {
        const edge = pickEdgeAt(w.x, w.y, true);
        if (edge == null) return;
        const next = insertVertexOnEdge(outline, edge, w.x, w.y);
        if (next) onChange(next);
        else flash(t('scaffold', 'aiBimFootprintErrSplitShort'));
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
    [dragIdx, toWorld, editTool, pickEdgeAt, outline, onChange, edgeLenMm, flash, t],
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
        : editTool === 'chordAB'
          ? chordFirstIdx == null
            ? t('scaffold', 'aiBimFootprintHintChordPickA')
            : t('scaffold', 'aiBimFootprintHintChordPickB')
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
        {(['move', 'split', 'chordAB', 'removeVertex'] as const).map((tool) => (
          <button
            key={tool}
            type="button"
            onClick={() => {
              setEditTool(tool);
              setSelectedEdge(null);
              setDragIdx(null);
              setChordFirstIdx(null);
            }}
            className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
              editTool === tool
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {tool === 'move'
              ? t('scaffold', 'aiBimFootprintToolMove')
              : tool === 'split'
                ? t('scaffold', 'aiBimFootprintToolSplit')
                : tool === 'chordAB'
                  ? t('scaffold', 'aiBimFootprintToolChord')
                  : t('scaffold', 'aiBimFootprintToolRemove')}
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
            fillOpacity={0.75}
            stroke="#4f46e5"
            strokeWidth={strokeW}
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
        {outline.map((p, idx) => {
          const r = vh;
          const isEdgeVert =
            editTool === 'move' &&
            selectedEdge != null &&
            (idx === selectedEdge || idx === (selectedEdge + 1) % n);
          const isRemoveHot = editTool === 'removeVertex' && n > 3;
          const isChordPick = editTool === 'chordAB' && chordFirstIdx === idx;
          return (
            <g key={idx}>
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
    </div>
  );
}
