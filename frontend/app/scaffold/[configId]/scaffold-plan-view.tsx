'use client';

import { useState, useRef, useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import { WallCalculationResult } from '@/lib/api/scaffold-configs';
import { buildFootprintPolygonXZ } from '@/lib/scaffold-footprint-polygon';
import { ZoomIn, ZoomOut, Printer, FlipHorizontal, FlipVertical } from 'lucide-react';

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

const SCAFFOLD_STRIP_W = 14;
/** Map scaffold run (façade + overrun) past the building vertex on plan (足場コーナー詳細図). */
const PLAN_RUN_EXTEND_OVERFACADE = true;
const DIM_COLOR = '#6b7280';
const DIM_TEXT = '#374151';

interface Props {
  result: any;
}

interface Edge {
  x1: number; y1: number; x2: number; y2: number;
  wallIdx: number; angle: number;
}

interface Point2D {
  x: number;
  y: number;
}

/**
 * Compute signed area of a polygon — positive=CCW in math coords (CW in SVG).
 * Used to determine winding and flip normals when needed.
 */
function signedArea(pts: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
}

function intersectLines(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): Point2D | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const det = dax * dby - day * dbx;
  if (Math.abs(det) < 1e-6) return null;
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const t = (dx * dby - dy * dbx) / det;
  return { x: a1.x + t * dax, y: a1.y + t * day };
}

function edgeNormal(edge: Edge, normalSign: number): Point2D {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: 0 };
  return {
    x: normalSign * (-dy / len),
    y: normalSign * (dx / len),
  };
}

/** Closed SVG path for scaffold ring: outer boundary minus building hole (even-odd fill). */
function svgScaffoldRingPath(
  outer: Point2D[],
  inner: Point2D[],
  offX: number,
  offY: number,
): string {
  const loop = (pts: Point2D[]) => {
    if (pts.length < 2) return '';
    let d = `M ${pts[0]!.x + offX} ${pts[0]!.y + offY}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i]!.x + offX} ${pts[i]!.y + offY}`;
    }
    d += ' Z';
    return d;
  };
  if (outer.length < 3 || inner.length < 3) return '';
  return `${loop(outer)} ${loop([...inner].reverse())}`;
}

/** Same run stretch as post ticks / span labels (façade → full scaffold run). */
function planExtendFactor(
  wall: WallCalculationResult | undefined,
  isClosed: boolean,
  wallsCount: number,
): number {
  if (!wall) return 1;
  const spans = wall.spans ?? [];
  let accum = 0;
  for (const s of spans) accum += s;
  const totalLen = accum || (wall.wallLengthMm ?? 1);
  const facadeMm = wall.wallLengthMm ?? 0;
  if (
    PLAN_RUN_EXTEND_OVERFACADE &&
    isClosed &&
    wallsCount >= 2 &&
    facadeMm > 0 &&
    totalLen > facadeMm + 0.5
  ) {
    return totalLen / facadeMm;
  }
  return 1;
}

/**
 * Outer outline that follows extended scaffold runs past corners (miters C_i → far B_i → next miter).
 * Without this, the ring stops at building miters while spans draw past corners → visible corner gap.
 */
function buildOuterScaffoldRunOutline(
  vertices: Point2D[],
  edges: Edge[],
  outerVertices: Point2D[],
  walls: WallCalculationResult[],
  normalSign: number,
  strip: number,
  isClosed: boolean,
): Point2D[] {
  const n = vertices.length;
  if (!isClosed || n < 3 || outerVertices.length !== n) return [...outerVertices];

  const pts: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const C_i = outerVertices[i]!;
    const V0 = vertices[i]!;
    const V1 = vertices[(i + 1) % n]!;
    const edge = edges[i]!;
    const geomLen = Math.hypot(V1.x - V0.x, V1.y - V0.y);
    if (geomLen < 1e-6) continue;
    const T = { x: (V1.x - V0.x) / geomLen, y: (V1.y - V0.y) / geomLen };
    const en = edgeNormal(edge, normalSign);
    const ext = planExtendFactor(walls[edge.wallIdx], isClosed, walls.length);
    const L = geomLen * ext;
    const B_i = {
      x: V0.x + T.x * L + en.x * strip,
      y: V0.y + T.y * L + en.y * strip,
    };
    pts.push(C_i, B_i);
  }
  return pts.length >= 3 ? pts : [...outerVertices];
}

function buildOffsetPolyline(
  vertices: Point2D[],
  edges: Edge[],
  normalSign: number,
  offset: number,
  isClosed: boolean,
): Point2D[] {
  if (vertices.length === 0 || edges.length === 0) return [];

  const shiftedPoint = (p: Point2D, n: Point2D): Point2D => ({
    x: p.x + n.x * offset,
    y: p.y + n.y * offset,
  });

  const miterLimit = offset * 6;

  if (!isClosed) {
    const out: Point2D[] = [];
    const firstNormal = edgeNormal(edges[0], normalSign);
    out.push(shiftedPoint(vertices[0], firstNormal));

    for (let i = 1; i < vertices.length - 1; i++) {
      const prevEdge = edges[i - 1];
      const nextEdge = edges[i];
      const prevNormal = edgeNormal(prevEdge, normalSign);
      const nextNormal = edgeNormal(nextEdge, normalSign);
      const hit = intersectLines(
        shiftedPoint({ x: prevEdge.x1, y: prevEdge.y1 }, prevNormal),
        shiftedPoint({ x: prevEdge.x2, y: prevEdge.y2 }, prevNormal),
        shiftedPoint({ x: nextEdge.x1, y: nextEdge.y1 }, nextNormal),
        shiftedPoint({ x: nextEdge.x2, y: nextEdge.y2 }, nextNormal),
      );
      const fallback = shiftedPoint(vertices[i], {
        x: (prevNormal.x + nextNormal.x) / 2 || nextNormal.x || prevNormal.x,
        y: (prevNormal.y + nextNormal.y) / 2 || nextNormal.y || prevNormal.y,
      });
      if (!hit || Math.hypot(hit.x - vertices[i].x, hit.y - vertices[i].y) > miterLimit) out.push(fallback);
      else out.push(hit);
    }

    const lastNormal = edgeNormal(edges[edges.length - 1], normalSign);
    out.push(shiftedPoint(vertices[vertices.length - 1], lastNormal));
    return out;
  }

  return vertices.map((vertex, i) => {
    const prevEdge = edges[(i - 1 + edges.length) % edges.length];
    const nextEdge = edges[i % edges.length];
    const prevNormal = edgeNormal(prevEdge, normalSign);
    const nextNormal = edgeNormal(nextEdge, normalSign);
    const hit = intersectLines(
      shiftedPoint({ x: prevEdge.x1, y: prevEdge.y1 }, prevNormal),
      shiftedPoint({ x: prevEdge.x2, y: prevEdge.y2 }, prevNormal),
      shiftedPoint({ x: nextEdge.x1, y: nextEdge.y1 }, nextNormal),
      shiftedPoint({ x: nextEdge.x2, y: nextEdge.y2 }, nextNormal),
    );
    const fallback = shiftedPoint(vertex, {
      x: (prevNormal.x + nextNormal.x) / 2 || nextNormal.x || prevNormal.x,
      y: (prevNormal.y + nextNormal.y) / 2 || nextNormal.y || prevNormal.y,
    });
    if (!hit || Math.hypot(hit.x - vertex.x, hit.y - vertex.y) > miterLimit) return fallback;
    return hit;
  });
}

/**
 * Build polygon edges from walls.
 * Handles 1-2 walls (open segments), 3+ walls (closed polygon).
 * Uses stored polygon vertices when available, falls back to regular polygon.
 */
function buildPolygonFromWalls(
  walls: WallCalculationResult[],
  scaleFactor: number,
  storedVertices?: Array<Record<string, any>>,
): { vertices: { x: number; y: number }[]; edges: Edge[]; isClosed: boolean } {
  const n = walls.length;
  if (n === 0) return { vertices: [], edges: [], isClosed: false };

  const vertices: { x: number; y: number }[] = [];
  const edges: Edge[] = [];

  // ── Closed 3+ walls: same footprint math as 3D (fixes mis-closed BIM hex / 辺6) ──
  if (n >= 3) {
    const polyM = buildFootprintPolygonXZ(walls, storedVertices);
    if (polyM.length >= n) {
      const mmPts = polyM.map((v) => ({ x: v.x * 1000, y: v.z * 1000 }));
      const offX = Math.min(...mmPts.map((p) => p.x));
      const offY = Math.min(...mmPts.map((p) => p.y));
      for (let i = 0; i < n; i++) {
        vertices.push({
          x: (mmPts[i].x - offX) * scaleFactor,
          y: (mmPts[i].y - offY) * scaleFactor,
        });
      }
      for (let i = 0; i < n; i++) {
        const v1 = vertices[i]!;
        const v2 = vertices[(i + 1) % n]!;
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const angle = Math.atan2(dy, dx);
        edges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y, wallIdx: i, angle });
      }
      return { vertices, edges, isClosed: true };
    }
  }

  // ── 1-2 walls: draw as straight segments (open, not a polygon) ──
  if (n < 3) {
    let cx = 0, cy = 0;
    let angle = 0;
    for (let i = 0; i < n; i++) {
      const lenPx = (walls[i].wallLengthMm ?? 1800) * scaleFactor;
      vertices.push({ x: cx, y: cy });
      const nx = cx + lenPx * Math.cos(angle);
      const ny = cy + lenPx * Math.sin(angle);
      edges.push({ x1: cx, y1: cy, x2: nx, y2: ny, wallIdx: i, angle });
      cx = nx;
      cy = ny;
      if (n === 2 && i === 0) angle += Math.PI / 2;
    }
    vertices.push({ x: cx, y: cy });
    return { vertices, edges, isClosed: false };
  }

  // ── 3+ walls: regular polygon approximation ──
  const exteriorAngle = (2 * Math.PI) / n;
  let angle = 0;
  let cx = 0, cy = 0;

  for (let i = 0; i < n; i++) {
    const lenPx = (walls[i].wallLengthMm ?? 1800) * scaleFactor;
    vertices.push({ x: cx, y: cy });
    const nx = cx + lenPx * Math.cos(angle);
    const ny = cy + lenPx * Math.sin(angle);
    edges.push({ x1: cx, y1: cy, x2: nx, y2: ny, wallIdx: i, angle });
    cx = nx;
    cy = ny;
    angle += exteriorAngle;
  }

  return { vertices, edges, isClosed: true };
}

export default function ScaffoldPlanView({ result }: Props) {
  const { t, locale } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const allWalls: WallCalculationResult[] = result?.walls ?? [];
  const [scale, setScale] = useState(1);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const scaffoldWidthMm = result?.scaffoldWidthMm ?? 600;

  if (allWalls.length === 0) {
    return <div className="text-gray-500 p-8">{t('result', 'noWallData')}</div>;
  }

  // For tier-aware buildings (stepped/setback), use only ground-tier walls for
  // the plan polygon. Upper tiers stack vertically and share the same plan footprint.
  const hasTiers = allWalls.some((w) => ((w as any).tierIndex ?? 0) > 0);
  const walls = hasTiers
    ? allWalls.filter((w) => ((w as any).tierIndex ?? 0) === 0)
    : allWalls;

  // Use stored polygon vertices as shape hints. Also try ground massing tier vertices
  // when the full outline vertex count doesn't match the ground-tier wall count
  // (tier decomposition can reduce wall count per tier).
  const storedVertices: Array<Record<string, any>> | undefined = useMemo(() => {
    const pv = Array.isArray(result?.polygonVertices) ? result.polygonVertices : undefined;
    if (pv && pv.length === walls.length) return pv;
    // If stored outline doesn't match wall count, try ground massing tier vertices
    const mt = Array.isArray((result as any)?.massingTiers) ? (result as any).massingTiers : [];
    if (mt.length > 0) {
      const groundMassing = mt.find(
        (m: any) => ((m.baseHeightMm ?? 0) <= 2) && Array.isArray(m.vertices) && m.vertices.length === walls.length,
      );
      if (groundMassing) return groundMassing.vertices;
    }
    return pv;
  }, [result, walls.length]);

  const maxLen = Math.max(...walls.map(w => w.wallLengthMm ?? 1800));
  const baseSf = maxLen > 0 ? 350 / maxLen : 1;
  const sf = baseSf * scale;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { vertices: rawVertices, edges: rawEdges, isClosed } = useMemo(
    () => buildPolygonFromWalls(walls, sf, storedVertices),
    [walls, sf, storedVertices],
  );

  // Apply flip transforms if requested by user
  const { vertices, edges } = useMemo(() => {
    if (!flipH && !flipV) return { vertices: rawVertices, edges: rawEdges };
    const rawMaxX = rawVertices.length > 0 ? Math.max(...rawVertices.map(v => v.x)) : 0;
    const rawMaxY = rawVertices.length > 0 ? Math.max(...rawVertices.map(v => v.y)) : 0;
    const rawMinX = rawVertices.length > 0 ? Math.min(...rawVertices.map(v => v.x)) : 0;
    const rawMinY = rawVertices.length > 0 ? Math.min(...rawVertices.map(v => v.y)) : 0;
    const flipPt = (p: { x: number; y: number }) => ({
      x: flipH ? rawMaxX + rawMinX - p.x : p.x,
      y: flipV ? rawMaxY + rawMinY - p.y : p.y,
    });
    const flippedVerts = rawVertices.map(flipPt);
    const flippedEdges = rawEdges.map(e => {
      const s = flipPt({ x: e.x1, y: e.y1 });
      const en = flipPt({ x: e.x2, y: e.y2 });
      return { ...e, x1: s.x, y1: s.y, x2: en.x, y2: en.y, angle: Math.atan2(en.y - s.y, en.x - s.x) };
    });
    return { vertices: flippedVerts, edges: flippedEdges };
  }, [rawVertices, rawEdges, flipH, flipV]);

  // Determine normal flip: for closed polygons, ensure normals point outward.
  // signedArea > 0 means CW in SVG coords → normals from (-dy, dx) point outward.
  // signedArea < 0 → flip.
  const normalSign = useMemo(() => {
    if (!isClosed || vertices.length < 3) return 1;
    return signedArea(vertices) > 0 ? -1 : 1;
  }, [vertices, isClosed]);

  const outerVertices = useMemo(
    () => buildOffsetPolyline(vertices, edges, normalSign, SCAFFOLD_STRIP_W, isClosed),
    [vertices, edges, normalSign, isClosed],
  );

  const outerRunOutline = useMemo(
    () =>
      buildOuterScaffoldRunOutline(
        vertices,
        edges,
        outerVertices,
        walls,
        normalSign,
        SCAFFOLD_STRIP_W,
        isClosed,
      ),
    [vertices, edges, outerVertices, walls, normalSign, isClosed],
  );

  // Bounding box — handle empty/degenerate cases (include extended outer run past corners)
  const allPts = [
    ...vertices,
    ...edges.map(e => ({ x: e.x2, y: e.y2 })),
    ...outerRunOutline,
  ];
  const minX = allPts.length > 0 ? Math.min(...allPts.map(p => p.x)) : 0;
  const minY = allPts.length > 0 ? Math.min(...allPts.map(p => p.y)) : 0;
  const maxX = allPts.length > 0 ? Math.max(...allPts.map(p => p.x)) : 400;
  const maxY = allPts.length > 0 ? Math.max(...allPts.map(p => p.y)) : 300;

  const PAD = 120;
  const SCAFFOLD_PAD = 50;
  const svgW = Math.max(400, (maxX - minX) + PAD * 2 + SCAFFOLD_PAD * 2);
  const svgH = Math.max(300, (maxY - minY) + PAD * 2 + SCAFFOLD_PAD * 2);

  const offsetX = PAD + SCAFFOLD_PAD - minX;
  const offsetY = PAD + SCAFFOLD_PAD - minY;

  /** One filled ring (no per-wall overlap) so corners read straight, not separate wedges. */
  const useContinuousScaffoldRing =
    isClosed &&
    vertices.length >= 3 &&
    outerVertices.length === vertices.length &&
    outerRunOutline.length >= 3;

  // ─── Render scaffold strip along each edge ──────────────
  const renderEdge = (edge: Edge, idx: number) => {
    const col = WALL_ACCENT[idx % WALL_ACCENT.length];
    const wall = walls[edge.wallIdx];
    if (!wall) return null;

    const dx = edge.x2 - edge.x1;
    const dy = edge.y2 - edge.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;

    // Normal vector pointing OUTWARD from building
    const nx = normalSign * (-dy / len);
    const ny = normalSign * (dx / len);

    const stripOffset = SCAFFOLD_STRIP_W;

    const ex1 = edge.x1 + offsetX;
    const ey1 = edge.y1 + offsetY;
    const ex2 = edge.x2 + offsetX;
    const ey2 = edge.y2 + offsetY;
    const outerA = outerVertices[idx];
    const sx1 = (outerA?.x ?? (edge.x1 + nx * stripOffset)) + offsetX;
    const sy1 = (outerA?.y ?? (edge.y1 + ny * stripOffset)) + offsetY;
    const nextOuterIndex = isClosed ? ((idx + 1) % outerVertices.length) : (idx + 1);
    const sx2 = (outerVertices[nextOuterIndex]?.x ?? (edge.x2 + nx * stripOffset)) + offsetX;
    const sy2 = (outerVertices[nextOuterIndex]?.y ?? (edge.y2 + ny * stripOffset)) + offsetY;

    // Post positions along the edge
    const spans = wall.spans ?? [];
    const postPositions: number[] = [0];
    let accum = 0;
    for (const s of spans) { accum += s; postPositions.push(accum); }
    const totalLen = accum || (wall.wallLengthMm ?? 1);
    const facadeMm = wall.wallLengthMm ?? 0;
    const extendFactor = planExtendFactor(wall, isClosed, walls.length);

    // Edge midpoint for labels (stay on the side for all edges)
    const midX = (ex1 + ex2) / 2;
    const midY = (ey1 + ey2) / 2;
    const textAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    const readableAngle = (textAngle > 90 || textAngle < -90) ? textAngle + 180 : textAngle;
    const isVerticalEdge = Math.abs(Math.abs(textAngle) - 90) < 20;
    // Push vertical edge labels further out so they clear the span numbers
    const labelOffset = isVerticalEdge ? stripOffset + 38 : stripOffset + 22;
    const labelX = midX + nx * labelOffset;
    const labelY = midY + ny * labelOffset;
    // On vertical edges, separate kanji from measurement (like N/S) so they don't overlap
    const labelGap = isVerticalEdge ? 22 : 8;

    const sideKey = (wall.side?.toLowerCase?.() || wall.side) as 'north' | 'south' | 'east' | 'west';
    const sideLabel = sideKey && ['north', 'south', 'east', 'west'].includes(sideKey) ? t('sides', sideKey) : (wall.sideJp || wall.side);

    return (
      <g key={`edge-${idx}`}>
        {/* Building wall edge */}
        <line
          x1={ex1} y1={ey1} x2={ex2} y2={ey2}
          stroke="#475569" strokeWidth={2.5}
        />

        {/* Per-edge strip only when not using one continuous ring (open / degenerate). */}
        {!useContinuousScaffoldRing && (
          <>
            <polygon
              points={`${ex1},${ey1} ${ex2},${ey2} ${sx2},${sy2} ${sx1},${sy1}`}
              fill={col.fill}
              stroke={col.stroke}
              strokeWidth={1.5}
              opacity={0.7}
            />
            <line x1={sx1} y1={sy1} x2={sx2} y2={sy2}
              stroke={col.stroke} strokeWidth={1.2} strokeDasharray="4,2" />
          </>
        )}

        {/* Post ticks */}
        {postPositions.map((pos, pi) => {
          const t = totalLen > 0 ? pos / totalLen : 0;
          const px = ex1 + (ex2 - ex1) * extendFactor * t;
          const py = ey1 + (ey2 - ey1) * extendFactor * t;
          const px2 = px + nx * stripOffset;
          const py2 = py + ny * stripOffset;
          return (
            <line key={`post-${idx}-${pi}`}
              x1={px} y1={py} x2={px2} y2={py2}
              stroke={col.stroke} strokeWidth={1.2} opacity={0.7}
            />
          );
        })}

        {/* Span dimension labels */}
        {spans.length > 0 && spans.length <= 10 && spans.map((span, si) => {
          if (si >= postPositions.length - 1) return null;
          const t1 = totalLen > 0 ? postPositions[si] / totalLen : 0;
          const t2 = totalLen > 0 ? postPositions[si + 1] / totalLen : 0;
          const smx = ex1 + (ex2 - ex1) * extendFactor * ((t1 + t2) / 2);
          const smy = ey1 + (ey2 - ey1) * extendFactor * ((t1 + t2) / 2);
          const sLabelX = smx + nx * (stripOffset / 2);
          const sLabelY = smy + ny * (stripOffset / 2);
          const segPx = Math.hypot(
            (ex2 - ex1) * extendFactor * (t2 - t1),
            (ey2 - ey1) * extendFactor * (t2 - t1),
          );
          if (segPx < 20) return null;
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

        {/* Wall label — on the side; for East/West separate kanji from measurement so they don't overlap */}
        <text
          x={labelX}
          y={labelY - labelGap}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight="bold"
          fill={col.text}
          transform={`rotate(${readableAngle}, ${labelX}, ${labelY - labelGap})`}
        >
          {sideLabel}
        </text>
        <text
          x={labelX}
          y={labelY + labelGap}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fill={DIM_COLOR}
          transform={`rotate(${readableAngle}, ${labelX}, ${labelY + labelGap})`}
        >
          {(() => {
            const facadeMm = wall.wallLengthMm ?? 0;
            const nSp = wall.totalSpans ?? spans.length;
            const runMm = totalLen;
            const same =
              facadeMm > 0 && Math.abs(runMm - facadeMm) < 0.5;
            if (same) {
              return `${facadeMm.toLocaleString()}mm (${nSp}sp)`;
            }
            return `${facadeMm.toLocaleString()}mm façade · ${runMm.toLocaleString()}mm run (${nSp}sp)`;
          })()}
        </text>

        {/* Stair indicators */}
        {(wall.kaidanSpanIndices || []).map((spanIdx: number, si: number) => {
          if (spanIdx >= spans.length || spanIdx >= postPositions.length - 1) return null;
          const t1 = totalLen > 0 ? postPositions[spanIdx] / totalLen : 0;
          const t2 = totalLen > 0 ? postPositions[spanIdx + 1] / totalLen : 0;
          const stX = ex1 + (ex2 - ex1) * extendFactor * ((t1 + t2) / 2);
          const stY = ey1 + (ey2 - ey1) * extendFactor * ((t1 + t2) / 2);
          const stOffX = stX + nx * (stripOffset / 2);
          const stOffY = stY + ny * (stripOffset / 2);
          return (
            <g key={`stair-${idx}-${si}`}>
              <circle cx={stOffX} cy={stOffY} r={5} fill="#047857" opacity={0.8} />
              <text x={stOffX} y={stOffY + 2.5} textAnchor="middle" fontSize={6} fill="white" fontWeight="bold">S</text>
            </g>
          );
        })}

        {/* Vertex markers */}
        <circle cx={ex1} cy={ey1} r={3.5} fill={col.stroke} stroke="white" strokeWidth={1} />
        <text x={ex1 - nx * 12} y={ey1 - ny * 12}
          textAnchor="middle" dominantBaseline="central"
          fontSize={10} fontWeight="bold" fill="#374151"
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
    const printTitle = t('viewer', 'planPrintTitle');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html><head><title>${printTitle}</title>
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
          {t('viewer', 'planView')} — {walls.map(w => (w.side && ['north', 'south', 'east', 'west'].includes(String(w.side).toLowerCase()) ? t('sides', String(w.side).toLowerCase() as 'north' | 'south' | 'east' | 'west') : w.sideJp)).join(' · ')} ({walls.length} {t('viewer', 'walls')})
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setScale(s => Math.min(s * 1.25, 3))} className="p-1.5 rounded hover:bg-gray-200" title={t('viewer', 'zoomIn')}>
            <ZoomIn className="h-4 w-4 text-gray-600" />
          </button>
          <button onClick={() => setScale(s => Math.max(s / 1.25, 0.3))} className="p-1.5 rounded hover:bg-gray-200" title={t('viewer', 'zoomOut')}>
            <ZoomOut className="h-4 w-4 text-gray-600" />
          </button>
          <div className="w-px h-5 bg-gray-300" />
          <button
            onClick={() => setFlipH(f => !f)}
            className={`p-1.5 rounded transition-colors ${flipH ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200 text-gray-600'}`}
            title="左右反転 (Mirror horizontal)"
          >
            <FlipHorizontal className="h-4 w-4" />
          </button>
          <button
            onClick={() => setFlipV(f => !f)}
            className={`p-1.5 rounded transition-colors ${flipV ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200 text-gray-600'}`}
            title="上下反転 (Mirror vertical)"
          >
            <FlipVertical className="h-4 w-4" />
          </button>
          <div className="w-px h-5 bg-gray-300" />
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
            {t('viewer', 'planView')} — {walls.length} {t('viewer', 'walls')}
          </text>

          {/* Building outline fill (closed polygons only) */}
          {isClosed && vertices.length >= 3 && (
            <polygon
              points={vertices.map(v => `${v.x + offsetX},${v.y + offsetY}`).join(' ')}
              fill="#f1f5f9"
              stroke="#94a3b8"
              strokeWidth={2}
            />
          )}

          {/* Single scaffold band (closed loops): no stacked semi-transparent wall quads at corners. */}
          {useContinuousScaffoldRing && (
            <g>
              <path
                d={svgScaffoldRingPath(outerRunOutline, vertices, offsetX, offsetY)}
                fill="#e2e8f0"
                fillRule="evenodd"
                opacity={0.95}
              />
              <polygon
                points={outerRunOutline.map(v => `${v.x + offsetX},${v.y + offsetY}`).join(' ')}
                fill="none"
                stroke="#64748b"
                strokeWidth={1.25}
                strokeDasharray="4 2"
              />
            </g>
          )}

          {/* Building label */}
          {isClosed && vertices.length >= 3 && (() => {
            const cx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length + offsetX;
            const cy = vertices.reduce((s, v) => s + v.y, 0) / vertices.length + offsetY;
            return (
              <g>
                <text x={cx} y={cy - 6} textAnchor="middle" fontSize={12} fill="#64748b" fontWeight="600">
                  {t('viewer', 'building')}
                </text>
                <text x={cx} y={cy + 10} textAnchor="middle" fontSize={9} fill="#94a3b8">
                  {walls.length} edges · scaffold {scaffoldWidthMm}mm
                </text>
              </g>
            );
          })()}

          {/* Scaffold strips for each edge (corners: shared post at vertex only — no extra L-patch span) */}
          {edges.map((edge, idx) => renderEdge(edge, idx))}

          {/* Legend */}
          <g transform={`translate(${PAD - 20}, ${svgH - 18})`}>
            {walls.map((w, i) => {
              const col = WALL_ACCENT[i % WALL_ACCENT.length];
              return (
                <g key={w.side} transform={`translate(${i * 80}, 0)`}>
                  <rect x={0} y={-6} width={12} height={8} fill={col.fill} stroke={col.stroke} strokeWidth={1} rx={1} />
                  <text x={16} y={1} fontSize={8} fill={DIM_TEXT}>
                    {w.side && ['north', 'south', 'east', 'west'].includes(String(w.side).toLowerCase()) ? t('sides', String(w.side).toLowerCase() as 'north' | 'south' | 'east' | 'west') : w.sideJp}
                  </text>
                </g>
              );
            })}
            <g transform={`translate(${walls.length * 80}, 0)`}>
              <circle cx={4} cy={-2} r={4} fill="#047857" opacity={0.8} />
              <text x={12} y={1} fontSize={8} fill={DIM_TEXT}>
                {t('result', 'legendStair')}
              </text>
            </g>
          </g>

          {/* Compass */}
          <g transform={`translate(${svgW - 35}, 45)`}>
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
