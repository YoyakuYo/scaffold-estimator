'use client';

import { useState, useRef, useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import { WallCalculationResult } from '@/lib/api/scaffold-configs';
import { ZoomIn, ZoomOut, Printer } from 'lucide-react';

// ─── Colors ─────────────────────────────────────────────────────
const WALL_ACCENT = [
  { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e40af' },
  { fill: '#fef3c7', stroke: '#f59e0b', text: '#92400e' },
  { fill: '#d1fae5', stroke: '#10b981', text: '#065f46' },
  { fill: '#fce7f3', stroke: '#ec4899', text: '#9d174d' },
  { fill: '#ede9fe', stroke: '#8b5cf6', text: '#5b21b6' },
  { fill: '#fee2e2', stroke: '#ef4444', text: '#991b1b' },
  { fill: '#cffafe', stroke: '#06b6d4', text: '#155e75' },
  { fill: '#ecfccb', stroke: '#84cc16', text: '#3f6212' },
  { fill: '#ffedd5', stroke: '#f97316', text: '#9a3412' },
  { fill: '#e0e7ff', stroke: '#6366f1', text: '#3730a3' },
];

const SCAFFOLD_STRIP_W = 12; // visual px width for scaffold strip
const DIM_COLOR = '#6b7280';
const DIM_TEXT = '#374151';

interface Props {
  result: any;
}

/**
 * Builds polygon from actual stored vertices (from perimeter tracer).
 * Vertices are in mm-space; we scale to SVG pixels.
 * Falls back to regular polygon approximation if no vertices stored.
 */
function buildPolygonFromWalls(
  walls: WallCalculationResult[],
  scaleFactor: number,
  storedVertices?: Array<{ xFrac: number; yFrac: number }>,
): { vertices: { x: number; y: number }[]; edges: { x1: number; y1: number; x2: number; y2: number; wallIdx: number; angle: number }[] } {
  const n = walls.length;
  if (n < 3) return { vertices: [], edges: [] };

  const vertices: { x: number; y: number }[] = [];
  const edges: { x1: number; y1: number; x2: number; y2: number; wallIdx: number; angle: number }[] = [];

  // ── Use actual polygon vertices if available ──
  if (storedVertices && storedVertices.length >= n) {
    // storedVertices are in mm-space (xFrac/yFrac are actually mm coords)
    // Find bounding box to determine proper scaling
    const xs = storedVertices.map(v => v.xFrac);
    const ys = storedVertices.map(v => v.yFrac);
    const bbW = Math.max(...xs) - Math.min(...xs);
    const bbH = Math.max(...ys) - Math.min(...ys);
    const maxDim = Math.max(bbW, bbH, 1);
    // Scale so the polygon fits in ~700px
    const sf = 700 / maxDim;

    for (let i = 0; i < n; i++) {
      const sv = storedVertices[i];
      vertices.push({ x: sv.xFrac * sf, y: sv.yFrac * sf });
    }

    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const angle = Math.atan2(dy, dx);
      edges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y, wallIdx: i, angle });
    }

    return { vertices, edges };
  }

  // ── Fallback: regular polygon approximation ──
  const exteriorAngle = (2 * Math.PI) / n;
  let angle = 0;
  let cx = 0, cy = 0;

  for (let i = 0; i < n; i++) {
    const lenPx = (walls[i].wallLengthMm * scaleFactor);
    vertices.push({ x: cx, y: cy });

    const nx = cx + lenPx * Math.cos(angle);
    const ny = cy + lenPx * Math.sin(angle);

    edges.push({ x1: cx, y1: cy, x2: nx, y2: ny, wallIdx: i, angle });

    cx = nx;
    cy = ny;
    angle += exteriorAngle;
  }

  return { vertices, edges };
}

export default function ScaffoldPlanView({ result }: Props) {
  const { t, locale } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const walls: WallCalculationResult[] = result?.walls ?? [];
  const [scale, setScale] = useState(1);

  const scaffoldWidthMm = result?.scaffoldWidthMm ?? 600;

  if (walls.length === 0) {
    return <div className="text-gray-500 p-8">{t('result', 'noWallData')}</div>;
  }

  // ─── Build polygon ──────────────────────────────────────
  const storedVertices: Array<{ xFrac: number; yFrac: number }> | undefined =
    result?.polygonVertices;

  const maxLen = Math.max(...walls.map(w => w.wallLengthMm));
  const baseSf = 350 / maxLen; // scale so longest wall = ~350px
  const sf = baseSf * scale;

  const { vertices, edges } = useMemo(
    () => buildPolygonFromWalls(walls, sf, storedVertices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [walls, sf, storedVertices],
  );

  // Calculate bounding box
  const allPts = [...vertices, ...edges.map(e => ({ x: e.x2, y: e.y2 }))];
  const minX = Math.min(...allPts.map(p => p.x));
  const minY = Math.min(...allPts.map(p => p.y));
  const maxX = Math.max(...allPts.map(p => p.x));
  const maxY = Math.max(...allPts.map(p => p.y));

  const PAD = 120;
  const SCAFFOLD_PAD = 40; // extra space for scaffold strip rendering
  const svgW = (maxX - minX) + PAD * 2 + SCAFFOLD_PAD * 2;
  const svgH = (maxY - minY) + PAD * 2 + SCAFFOLD_PAD * 2;

  // Translate so polygon is centered
  const offsetX = PAD + SCAFFOLD_PAD - minX;
  const offsetY = PAD + SCAFFOLD_PAD - minY;

  // ─── Render scaffold strip along each edge ──────────────
  const renderEdge = (edge: typeof edges[0], idx: number) => {
    const col = WALL_ACCENT[idx % WALL_ACCENT.length];
    const wall = walls[edge.wallIdx];
    const dx = edge.x2 - edge.x1;
    const dy = edge.y2 - edge.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;

    // Normal vector (outward from polygon center)
    const nx = -dy / len;
    const ny = dx / len;

    // Scaffold strip: offset outward
    const stripOffset = SCAFFOLD_STRIP_W;
    const sx1 = edge.x1 + offsetX + nx * stripOffset;
    const sy1 = edge.y1 + offsetY + ny * stripOffset;
    const sx2 = edge.x2 + offsetX + nx * stripOffset;
    const sy2 = edge.y2 + offsetY + ny * stripOffset;

    const ex1 = edge.x1 + offsetX;
    const ey1 = edge.y1 + offsetY;
    const ex2 = edge.x2 + offsetX;
    const ey2 = edge.y2 + offsetY;

    // Post positions along the edge
    const spans = wall.spans;
    const postPositions: number[] = [0];
    let accum = 0;
    for (const s of spans) { accum += s; postPositions.push(accum); }
    const totalLen = accum;

    // Edge midpoint for labels
    const midX = (ex1 + ex2) / 2;
    const midY = (ey1 + ey2) / 2;
    const labelOffset = stripOffset + 18;
    const labelX = midX + nx * labelOffset;
    const labelY = midY + ny * labelOffset;

    // Angle for text rotation
    const textAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    // Keep text readable (not upside down)
    const readableAngle = (textAngle > 90 || textAngle < -90) ? textAngle + 180 : textAngle;

    const sideLabel = locale === 'ja' ? (wall.sideJp || wall.side) : wall.side;

    return (
      <g key={`edge-${idx}`}>
        {/* Building wall edge */}
        <line
          x1={ex1} y1={ey1} x2={ex2} y2={ey2}
          stroke="#94a3b8" strokeWidth={2}
        />

        {/* Scaffold strip (filled parallelogram) */}
        <polygon
          points={`${ex1},${ey1} ${ex2},${ey2} ${sx2},${sy2} ${sx1},${sy1}`}
          fill={col.fill}
          stroke={col.stroke}
          strokeWidth={1.5}
          opacity={0.6}
        />

        {/* Post ticks */}
        {postPositions.map((pos, pi) => {
          const t = totalLen > 0 ? pos / totalLen : 0;
          const px = ex1 + (ex2 - ex1) * t;
          const py = ey1 + (ey2 - ey1) * t;
          const px2 = px + nx * stripOffset;
          const py2 = py + ny * stripOffset;
          return (
            <line key={`post-${idx}-${pi}`}
              x1={px} y1={py} x2={px2} y2={py2}
              stroke={col.stroke} strokeWidth={1.2} opacity={0.8}
            />
          );
        })}

        {/* Span dimension labels (small, along the edge) */}
        {spans.length <= 8 && spans.map((span, si) => {
          const t1 = totalLen > 0 ? postPositions[si] / totalLen : 0;
          const t2 = totalLen > 0 ? postPositions[si + 1] / totalLen : 0;
          const smx = ex1 + (ex2 - ex1) * ((t1 + t2) / 2);
          const smy = ey1 + (ey2 - ey1) * ((t1 + t2) / 2);
          const sLabelX = smx + nx * (stripOffset / 2);
          const sLabelY = smy + ny * (stripOffset / 2);
          const segPx = Math.hypot((ex2 - ex1) * (t2 - t1), (ey2 - ey1) * (t2 - t1));
          if (segPx < 20) return null; // too small to label
          return (
            <text key={`span-${idx}-${si}`}
              x={sLabelX} y={sLabelY}
              textAnchor="middle" dominantBaseline="central"
              fontSize={7} fill={DIM_COLOR}
              transform={`rotate(${readableAngle}, ${sLabelX}, ${sLabelY})`}
            >
              {span}
            </text>
          );
        })}

        {/* Wall label */}
        <text
          x={labelX} y={labelY - 8}
          textAnchor="middle" dominantBaseline="central"
          fontSize={11} fontWeight="bold" fill={col.text}
          transform={`rotate(${readableAngle}, ${labelX}, ${labelY - 8})`}
        >
          {sideLabel}
        </text>
        <text
          x={labelX} y={labelY + 6}
          textAnchor="middle" dominantBaseline="central"
          fontSize={9} fill={DIM_COLOR}
          transform={`rotate(${readableAngle}, ${labelX}, ${labelY + 6})`}
        >
          {wall.wallLengthMm.toLocaleString()}mm ({wall.totalSpans}sp)
        </text>

        {/* Stair indicators */}
        {(wall.kaidanSpanIndices || []).map((spanIdx, si) => {
          if (spanIdx >= spans.length) return null;
          const t1 = totalLen > 0 ? postPositions[spanIdx] / totalLen : 0;
          const t2 = totalLen > 0 ? postPositions[spanIdx + 1] / totalLen : 0;
          const stX = ex1 + (ex2 - ex1) * ((t1 + t2) / 2);
          const stY = ey1 + (ey2 - ey1) * ((t1 + t2) / 2);
          const stOffX = stX + nx * (stripOffset / 2);
          const stOffY = stY + ny * (stripOffset / 2);
          return (
            <g key={`stair-${idx}-${si}`}>
              <circle cx={stOffX} cy={stOffY} r={5} fill="#047857" opacity={0.8} />
              <text x={stOffX} y={stOffY + 2.5} textAnchor="middle" fontSize={6} fill="white" fontWeight="bold">S</text>
            </g>
          );
        })}

        {/* Vertex label */}
        <circle cx={ex1} cy={ey1} r={3} fill={col.stroke} />
        <text x={ex1 - nx * 10} y={ey1 - ny * 10}
          textAnchor="middle" dominantBaseline="central"
          fontSize={9} fontWeight="bold" fill="#374151"
        >
          {String.fromCharCode(65 + idx)}
        </text>
      </g>
    );
  };

  // ─── Print handler ─────────────────────────────────────
  const handlePrint = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html><head><title>Plan View — 平面図</title>
        <style>
          body { margin: 0; display: flex; justify-content: center; align-items: flex-start; }
          img { max-width: 100%; height: auto; }
          @media print { body { margin: 0; } }
        </style>
        </head><body>
        <img src="${url}" onload="setTimeout(()=>{window.print();},300);" />
        </body></html>
      `);
      win.document.close();
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-medium text-gray-600">
          平面図 / Plan View — {walls.map(w => w.sideJp).join('・')} ({walls.length} walls)
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setScale(s => Math.min(s * 1.25, 3))} className="p-1.5 rounded hover:bg-gray-200" title="Zoom In">
            <ZoomIn className="h-4 w-4 text-gray-600" />
          </button>
          <button onClick={() => setScale(s => Math.max(s / 1.25, 0.3))} className="p-1.5 rounded hover:bg-gray-200" title="Zoom Out">
            <ZoomOut className="h-4 w-4 text-gray-600" />
          </button>
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-200 transition-colors border border-gray-300">
            <Printer className="h-4 w-4" /> {t('result', 'print')}
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="overflow-auto" style={{ maxHeight: '700px' }}>
        <svg
          ref={svgRef}
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          xmlns="http://www.w3.org/2000/svg"
          className="block mx-auto"
          style={{ background: '#ffffff', minWidth: Math.min(svgW, 400) }}
        >
          {/* Title */}
          <text x={svgW / 2} y={22} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#111827">
            平面図 / Plan View — {walls.length} walls
          </text>

          {/* Building outline fill */}
          {vertices.length >= 3 && (
            <polygon
              points={vertices.map(v => `${v.x + offsetX},${v.y + offsetY}`).join(' ')}
              fill="#f8fafc"
              stroke="#cbd5e1"
              strokeWidth={2}
            />
          )}

          {/* Building label */}
          {vertices.length >= 3 && (() => {
            const cx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length + offsetX;
            const cy = vertices.reduce((s, v) => s + v.y, 0) / vertices.length + offsetY;
            return (
              <g>
                <text x={cx} y={cy - 4} textAnchor="middle" fontSize={11} fill="#94a3b8" fontWeight="500">
                  建物 / Building
                </text>
                <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9} fill="#cbd5e1">
                  {walls.length} edges · scaffold {scaffoldWidthMm}mm
                </text>
              </g>
            );
          })()}

          {/* Scaffold strips for each edge */}
          {edges.map((edge, idx) => renderEdge(edge, idx))}

          {/* Legend */}
          <g transform={`translate(${PAD - 20}, ${svgH - 18})`}>
            {walls.map((w, i) => {
              const col = WALL_ACCENT[i % WALL_ACCENT.length];
              return (
                <g key={w.side} transform={`translate(${i * 80}, 0)`}>
                  <rect x={0} y={-6} width={12} height={8} fill={col.fill} stroke={col.stroke} strokeWidth={1} rx={1} />
                  <text x={16} y={1} fontSize={8} fill={DIM_TEXT}>
                    {w.sideJp}
                  </text>
                </g>
              );
            })}
            {/* Stair legend */}
            <g transform={`translate(${walls.length * 80}, 0)`}>
              <circle cx={4} cy={-2} r={4} fill="#047857" opacity={0.8} />
              <text x={12} y={1} fontSize={8} fill={DIM_TEXT}>
                {locale === 'ja' ? '階段' : 'Stairs'}
              </text>
            </g>
          </g>

          {/* Compass */}
          <g transform={`translate(${svgW - 35}, 40)`}>
            <line x1={0} y1={-14} x2={0} y2={14} stroke="#9ca3af" strokeWidth={1} />
            <line x1={-14} y1={0} x2={14} y2={0} stroke="#9ca3af" strokeWidth={1} />
            <polygon points="0,-14 -4,-8 4,-8" fill="#374151" />
            <text x={0} y={-18} textAnchor="middle" fontSize={10} fill="#374151" fontWeight="bold">N</text>
          </g>
        </svg>
      </div>
    </div>
  );
}
