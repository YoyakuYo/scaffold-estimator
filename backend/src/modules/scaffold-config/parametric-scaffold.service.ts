/**
 * Parametric Scaffold Service — TypeScript port of the parametric-scaffold-engine.
 *
 * Rules:
 * - True perimeter tracing: use every vertex from polygon (no bounding box).
 * - Per-segment scaffold width (600/900/1200).
 * - Pattanko gap: 200mm from wall to platform edge (always).
 * - Buragetto: if wall-to-obstacle distance < (width + 200mm) → Single-Pole + Bracket.
 * - Width transitions: mitered corner join when adjacent segments have different widths.
 */

export const PATTANKO_GAP_MM = 200;
export const CLEARANCE_THRESHOLD_EXTRA = 200; // if clearance < width + this → bracket
export const SCAFFOLD_WIDTH_OPTIONS = [600, 900, 1200] as const;

export type LayoutMode = 'double_post' | 'bracket';

export interface Point2D {
  x: number;
  y: number;
}

export interface Segment2D {
  start: Point2D;
  end: Point2D;
}

export interface BuildingEdge {
  index: number;
  label: string;
  segment: Segment2D;
  lengthMm: number;
}

export interface ObstacleInput {
  type: 'balcony' | 'ac' | 'pillar' | 'door';
  vertices?: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>;
  /** For pillars: center (mm or xFrac/yFrac) and radius in mm */
  center?: { x?: number; y?: number; xFrac?: number; yFrac?: number };
  radiusMm?: number;
  /** For doors: which wall edge, position along wall, opening width */
  wallIndex?: number;
  positionMm?: number;
  widthMm?: number;
}

export interface SideConfig {
  widthMm: number;
  layoutMode: LayoutMode;
  clearanceMm: number;
}

export interface TransitionConnection {
  cornerIndex: number;
  edgeBefore: number;
  edgeAfter: number;
  widthBeforeMm: number;
  widthAfterMm: number;
  innerPoint: Point2D;
  outerBefore?: Point2D;
  outerAfter?: Point2D;
}

function segmentLength(seg: Segment2D): number {
  const dx = seg.end.x - seg.start.x;
  const dy = seg.end.y - seg.start.y;
  return Math.hypot(dx, dy);
}

function pointToSegmentDistance(p: Point2D, seg: Segment2D): number {
  const dx = seg.end.x - seg.start.x;
  const dy = seg.end.y - seg.start.y;
  const L2 = dx * dx + dy * dy;
  if (L2 <= 0) return Math.hypot(p.x - seg.start.x, p.y - seg.start.y);
  let t = ((p.x - seg.start.x) * dx + (p.y - seg.start.y) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const projX = seg.start.x + t * dx;
  const projY = seg.start.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function segmentToSegmentDistance(a: Segment2D, b: Segment2D): number {
  const midB: Point2D = {
    x: (b.start.x + b.end.x) / 2,
    y: (b.start.y + b.end.y) / 2,
  };
  return pointToSegmentDistance(midB, a);
}

function circleToSegmentDistance(center: Point2D, radiusMm: number, seg: Segment2D): number {
  const d = pointToSegmentDistance(center, seg);
  return Math.max(0, d - radiusMm);
}

/** Build ObstacleSet from vision/DXF obstacles. Vertices in mm or 0–1 fraction (scaled by refMm). */
function buildObstacleSet(
  obstacles: ObstacleInput[],
  refMm?: number,
): { minDistanceToSegment: (seg: Segment2D) => number } {
  const segments: Segment2D[] = [];
  const circles: Array<{ center: Point2D; radius: number }> = [];

  const toMm = (v: { x?: number; y?: number; xFrac?: number; yFrac?: number }): Point2D => {
    const scale = refMm ?? 10000;
    if ('xFrac' in v && v.xFrac != null) {
      return { x: (v.xFrac ?? 0) * scale, y: (v.yFrac ?? 0) * scale };
    }
    return { x: v.x ?? 0, y: v.y ?? 0 };
  };

  for (const obs of obstacles) {
    if (obs.center != null && obs.radiusMm != null) {
      circles.push({ center: toMm(obs.center), radius: obs.radiusMm });
      continue;
    }
    const verts = (obs.vertices ?? []).map(toMm).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    for (let i = 0; i < verts.length - 1; i++) {
      segments.push({ start: verts[i], end: verts[i + 1] });
    }
    if (verts.length >= 3) {
      segments.push({ start: verts[verts.length - 1], end: verts[0] });
    }
  }

  return {
    minDistanceToSegment(seg: Segment2D): number {
      let best = Infinity;
      for (const s of segments) {
        const d = segmentToSegmentDistance(seg, s);
        if (d < best) best = d;
      }
      for (const { center, radius } of circles) {
        const d = circleToSegmentDistance(center, radius, seg);
        if (d < best) best = d;
      }
      return best === Infinity ? 999999 : best;
    },
  };
}

/** Buragetto check: if clearance < width + 200mm → bracket. */
export function checkBuragetto(
  widthMm: number,
  clearanceMm: number,
): LayoutMode {
  const required = widthMm + CLEARANCE_THRESHOLD_EXTRA;
  return clearanceMm < required ? 'bracket' : 'double_post';
}

/** Offset from wall: inner = 200mm (Pattanko), outer = 200 + width (double-post) or 200 (bracket). */
export function offsetForSide(widthMm: number, layoutMode: LayoutMode): { inner: number; outer: number } {
  const inner = PATTANKO_GAP_MM;
  if (layoutMode === 'bracket') return { inner, outer: inner };
  return { inner, outer: inner + widthMm };
}

/** Build edges from polygon vertices (mm or fraction). */
export function buildEdgesFromVertices(
  vertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>,
  refMm?: number,
): BuildingEdge[] {
  const scale = refMm ?? 10000;
  const toMm = (v: { x?: number; y?: number; xFrac?: number; yFrac?: number }): Point2D => {
    if ('xFrac' in v && v.xFrac != null) {
      return { x: (v.xFrac ?? 0) * scale, y: (v.yFrac ?? 0) * scale };
    }
    return { x: v.x ?? 0, y: v.y ?? 0 };
  };

  const pts = vertices.map(toMm).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return [];

  const labels = ['north', 'south', 'east', 'west'];
  const edges: BuildingEdge[] = [];
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const seg: Segment2D = { start: pts[i], end: pts[j] };
    const len = segmentLength(seg);
    edges.push({
      index: i,
      label: labels[i % 4] ?? `edge-${i}`,
      segment: seg,
      lengthMm: len,
    });
  }
  return edges;
}

/**
 * Site boundary / obstacle rule: if requested width hits obstacle (clearance < width + 200mm),
 * try downsize to 600mm first; if still insufficient, use bracket.
 */
function resolveWidthAndLayout(
  requestedMm: number,
  clearanceMm: number,
): { widthMm: number; layoutMode: LayoutMode } {
  const tryWidth = (w: number) => checkBuragetto(w, clearanceMm);
  if (clearanceMm >= requestedMm + CLEARANCE_THRESHOLD_EXTRA) {
    return { widthMm: requestedMm, layoutMode: 'double_post' };
  }
  if (clearanceMm >= 600 + CLEARANCE_THRESHOLD_EXTRA) {
    return { widthMm: 600, layoutMode: 'double_post' };
  }
  return { widthMm: requestedMm, layoutMode: 'bracket' };
}

/** Compute per-edge config: width, layout mode, clearance. */
export function computeSideConfigs(
  edges: BuildingEdge[],
  widthBySide: Record<number | string, number>,
  obstacles: ObstacleInput[],
  refMm?: number,
): SideConfig[] {
  const defaultWidth = 900;
  const obstacleSet = buildObstacleSet(obstacles, refMm);
  const configs: SideConfig[] = [];

  for (const edge of edges) {
    const requestedMm = widthBySide[edge.index] ?? widthBySide[edge.label.toLowerCase()] ?? defaultWidth;
    const clearance = obstacleSet.minDistanceToSegment(edge.segment);
    const { widthMm, layoutMode } = resolveWidthAndLayout(requestedMm, clearance);
    configs.push({ widthMm, layoutMode, clearanceMm: clearance });
  }
  return configs;
}

/** Compute transition connections at corners where width changes. */
export function computeTransitions(
  edges: BuildingEdge[],
  sideConfigs: SideConfig[],
): TransitionConnection[] {
  const transitions: TransitionConnection[] = [];
  const n = edges.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cfgI = sideConfigs[i];
    const cfgJ = sideConfigs[j];
    if (cfgI.widthMm === cfgJ.widthMm) continue;

    const segI = edges[i].segment;
    const segJ = edges[j].segment;
    const corner = segI.end;

    const { inner: innerI, outer: outerI } = offsetForSide(cfgI.widthMm, cfgI.layoutMode);
    const { inner: innerJ, outer: outerJ } = offsetForSide(cfgJ.widthMm, cfgJ.layoutMode);

    const dxI = segI.end.x - segI.start.x;
    const dyI = segI.end.y - segI.start.y;
    const Li = Math.hypot(dxI, dyI) || 1;
    const niI = { x: -dyI / Li, y: dxI / Li };

    const dxJ = segJ.end.x - segJ.start.x;
    const dyJ = segJ.end.y - segJ.start.y;
    const Lj = Math.hypot(dxJ, dyJ) || 1;
    const njJ = { x: -dyJ / Lj, y: dxJ / Lj };

    const ax = (niI.x + njJ.x) / 2;
    const ay = (niI.y + njJ.y) / 2;
    const la = Math.hypot(ax, ay) || 1;
    const axN = ax / la;
    const ayN = ay / la;
    const innerD = Math.max(innerI, innerJ);
    const innerPoint: Point2D = {
      x: corner.x + axN * innerD,
      y: corner.y + ayN * innerD,
    };

    let outerBefore: Point2D | undefined;
    let outerAfter: Point2D | undefined;
    if (cfgI.layoutMode === 'double_post') {
      outerBefore = {
        x: corner.x + niI.x * outerI,
        y: corner.y + niI.y * outerI,
      };
    }
    if (cfgJ.layoutMode === 'double_post') {
      outerAfter = {
        x: corner.x + njJ.x * outerJ,
        y: corner.y + njJ.y * outerJ,
      };
    }

    transitions.push({
      cornerIndex: j,
      edgeBefore: i,
      edgeAfter: j,
      widthBeforeMm: cfgI.widthMm,
      widthAfterMm: cfgJ.widthMm,
      innerPoint,
      outerBefore,
      outerAfter,
    });
  }
  return transitions;
}

/** Full parametric pipeline: vertices + obstacles → edges, configs, transitions. */
export interface ParametricResult {
  edges: BuildingEdge[];
  sideConfigs: SideConfig[];
  transitions: TransitionConnection[];
}

export function runParametricPipeline(
  vertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>,
  obstacles: ObstacleInput[],
  widthBySide: Record<number | string, number>,
  refMm?: number,
): ParametricResult {
  const edges = buildEdgesFromVertices(vertices, refMm);
  if (edges.length === 0) {
    return { edges: [], sideConfigs: [], transitions: [] };
  }
  const sideConfigs = computeSideConfigs(edges, widthBySide, obstacles, refMm);
  const transitions = computeTransitions(edges, sideConfigs);
  return { edges, sideConfigs, transitions };
}
