'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';

export type AiBimOutlinePoint = { xFrac: number; yFrac: number };

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

type Props = {
  outline: AiBimOutlinePoint[];
  baselineOutline?: AiBimOutlinePoint[] | null;
  showBaseline: boolean;
  onChange: (next: AiBimOutlinePoint[]) => void;
  onResetToBaseline?: () => void;
};

/**
 * Interactive 2D footprint editor for AI BIM preview: drag vertices, select edge and set length (trim/extend).
 * Coordinates use the same mm space as buildingOutline (xFrac/yFrac field names are legacy).
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
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [edgeLengthInput, setEdgeLengthInput] = useState<string>('');

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
    (x: number, y: number): number | null => {
      if (n < 3) return null;
      const thresh = Math.max(vbW, vbH) * 0.02;
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
      if (best && best.d <= thresh) return best.i;
      return null;
    },
    [outline, n, vbW, vbH],
  );

  const applyEdgeLength = useCallback(() => {
    if (selectedEdge == null || n < 3) return;
    const raw = Number(edgeLengthInput);
    if (!Number.isFinite(raw) || raw < 600) return;

    const i = selectedEdge;
    const j = (i + 1) % n;
    const A = outline[i];
    const B = outline[j];
    const dx = B.xFrac - A.xFrac;
    const dy = B.yFrac - A.yFrac;
    const cur = Math.hypot(dx, dy);
    if (cur < 1e-6) return;

    const newLen = raw;
    const scale = newLen / cur;
    const next = cloneOutline(outline);
    next[j] = {
      xFrac: A.xFrac + dx * scale,
      yFrac: A.yFrac + dy * scale,
    };
    onChange(next);
  }, [selectedEdge, edgeLengthInput, outline, n, onChange]);

  const onPointerDownVertex = useCallback(
    (e: React.PointerEvent, idx: number) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDragIdx(idx);
      setSelectedEdge(null);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragIdx == null) return;
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;
      const next = cloneOutline(outline);
      next[dragIdx] = { xFrac: w.x, yFrac: w.y };
      onChange(next);
    },
    [dragIdx, outline, onChange, toWorld],
  );

  const onPointerUp = useCallback(() => {
    setDragIdx(null);
  }, []);

  const onSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (dragIdx != null) return;
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;
      const edge = pickEdgeAt(w.x, w.y);
      if (edge != null) {
        setSelectedEdge(edge);
        setEdgeLengthInput(String(Math.round(edgeLenMm(edge))));
      }
    },
    [dragIdx, toWorld, pickEdgeAt, edgeLenMm],
  );

  const baselinePoly =
    showBaseline && baselineOutline && baselineOutline.length >= 3
      ? baselineOutline.map((p) => `${p.xFrac},${p.yFrac}`).join(' ')
      : '';

  const editedPoly = outline.map((p) => `${p.xFrac},${p.yFrac}`).join(' ');

  const viewBox = `${minX - pad} ${minY - pad} ${vbW} ${vbH}`;

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
      <p className="text-[11px] text-gray-600 px-2 py-1 border-b border-gray-100">
        {t('scaffold', 'aiBimFootprintEditHint')}
      </p>
      <svg
        ref={svgRef}
        role="img"
        viewBox={viewBox}
        className="w-full block touch-none select-none bg-white"
        style={{ minHeight: 200, maxHeight: 360 }}
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
            strokeWidth={Math.max(vbW, vbH) * 0.004}
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
            strokeWidth={Math.max(vbW, vbH) * 0.004}
          />
        ) : null}
        {outline.map((p, idx) => {
          const r = Math.max(vbW, vbH) * 0.012;
          const isSel =
            selectedEdge != null &&
            (idx === selectedEdge || idx === (selectedEdge + 1) % n);
          return (
            <circle
              key={idx}
              cx={p.xFrac}
              cy={p.yFrac}
              r={r}
              fill={isSel ? '#f59e0b' : '#6366f1'}
              stroke="#fff"
              strokeWidth={Math.max(vbW, vbH) * 0.002}
              onPointerDown={(e) => onPointerDownVertex(e, idx)}
            />
          );
        })}
      </svg>
      {selectedEdge != null && n >= 3 ? (
        <div className="flex flex-wrap items-end gap-2 px-2 py-2 border-t border-gray-100 bg-gray-50/80">
          <div>
            <label className="block text-[10px] font-medium text-gray-600 mb-0.5">
              {t('scaffold', 'aiBimFootprintEdgeLength').replace(
                '{n}',
                String(selectedEdge + 1),
              )}
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={600}
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
          <span className="text-[10px] text-gray-500">
            {t('scaffold', 'aiBimFootprintEdgeNote')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
