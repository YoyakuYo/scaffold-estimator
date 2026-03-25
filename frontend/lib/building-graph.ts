/**
 * BuildingGraph — Node-and-Edge graph for advanced scaffold geometry.
 * Every building corner is a Vector3 Node; walls are Edges connecting Nodes.
 * Miter join logic ensures wall endpoints snap to shared nodes (zero gaps at intersections).
 * Contour-following: orthogonal correction, dimension-based scaling, closed-loop.
 * This layer feeds the existing rendering engine; it does not replace it.
 */

import { applyContourExtraction, type ContourExtractionOptions } from './contour-extraction';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface BuildingNode {
  id: string;
  position: Vector3Like; // in mm (x, 0, z) for footprint; y can be used for elevation
}

export interface BuildingEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  lengthMm: number;
  /** Wall index for mapping to calculation result */
  wallIndex?: number;
}

export interface FootprintVertex {
  xFrac: number;
  yFrac: number;
}

export interface BuildingGraphData {
  nodes: BuildingNode[];
  edges: BuildingEdge[];
  /** Optional polygon vertices (0–1 or mm) for compatibility with existing pipeline */
  polygonVertices?: FootprintVertex[];
}

function dist2dMm(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function isLikelyFractionCoords(points: Array<{ x: number; z: number }>): boolean {
  if (points.length < 3) return false;
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const spread = Math.max(maxX - minX, maxZ - minZ);
  const maxCoord = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minZ), Math.abs(maxZ));
  return maxCoord <= 1.1 && spread <= 1.1;
}

type FootprintCoordinateMode = 'fraction' | 'mm' | 'meters' | 'pixel';

/**
 * Decide whether the incoming outline already encodes a trustworthy footprint shape.
 * When the source is mm/meters (typical IFC / BIM output), rebuilding from dimension
 * text can distort the corner layout. For fraction/pixel outlines, reconstruction is
 * still useful because those coordinates are only a rough shape hint.
 */
function detectFootprintCoordinateMode(
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>,
  refLengthMm?: number,
  wallLengthsMm?: number[],
): FootprintCoordinateMode {
  const raw = vertices.map((v) => ({
    x: 'xFrac' in v ? v.xFrac : v.x,
    z: 'yFrac' in v ? v.yFrac : v.y,
  }));
  if (isLikelyFractionCoords(raw)) return 'fraction';

  const xs = raw.map((p) => p.x);
  const zs = raw.map((p) => p.z);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadZ = Math.max(...zs) - Math.min(...zs);
  const maxSpread = Math.max(spreadX, spreadZ);
  const maxCoord = Math.max(Math.max(...xs.map(Math.abs)), Math.max(...zs.map(Math.abs)));

  let vPerimeter = 0;
  for (let i = 0; i < raw.length; i++) {
    const j = (i + 1) % raw.length;
    vPerimeter += Math.hypot(raw[j].x - raw[i].x, raw[j].z - raw[i].z);
  }
  const wPerimeter = Array.isArray(wallLengthsMm) && wallLengthsMm.length > 0
    ? wallLengthsMm.reduce((a, b) => a + b, 0)
    : 0;
  const wallLengthsAreMm = wPerimeter >= 3000;

  if (maxSpread >= 3000) return 'mm';

  if (maxSpread > 1.1 && maxSpread < 200) {
    if (wallLengthsAreMm && vPerimeter > 0) {
      const ratio = wPerimeter / vPerimeter;
      if (ratio > 500 && ratio < 2000) return 'meters';
      if (ratio > 100) return 'meters';
    }
    if (!wallLengthsAreMm && refLengthMm && refLengthMm > 3000 && maxSpread < 100) {
      return 'meters';
    }
  }

  if (maxCoord > 1.1) return 'pixel';
  return 'pixel';
}

/**
 * Normalize footprint to mm. Uses UNIFORM scale for X and Z (same factor) to preserve
 * aspect ratio and avoid distortion. 90° corners in the source are preserved.
 *
 * Coordinate detection logic:
 *  - 0-1 fractions (maxCoord ≤ 1.1): scale to target mm using refLengthMm
 *  - Real mm (max spread ≥ 3000 OR any wallLengthsMm ≥ 3000): use as-is
 *  - Metres (spread 1.1–200, wallLengths confirm ratio ~1000): multiply by 1000
 *  - Pixel-scale (spread 1.1–3000 with no mm hint): scale to target mm
 */
function normalizeFootprintToMm(
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>,
  refLengthMm?: number,
  wallLengthsMm?: number[],
): Array<{ x: number; z: number }> {
  const raw = vertices.map((v) => ({
    x: 'xFrac' in v ? v.xFrac : v.x,
    z: 'yFrac' in v ? v.yFrac : v.y,
  }));

  const xs = raw.map((p) => p.x);
  const zs = raw.map((p) => p.z);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadZ = Math.max(...zs) - Math.min(...zs);
  const maxSpread = Math.max(spreadX, spreadZ);
  const maxCoord = Math.max(Math.max(...xs.map(Math.abs)), Math.max(...zs.map(Math.abs)));

  let vPerimeter = 0;
  for (let i = 0; i < raw.length; i++) {
    const j = (i + 1) % raw.length;
    vPerimeter += Math.hypot(raw[j].x - raw[i].x, raw[j].z - raw[i].z);
  }
  const wPerimeter = Array.isArray(wallLengthsMm) && wallLengthsMm.length > 0
    ? wallLengthsMm.reduce((a, b) => a + b, 0)
    : 0;
  const wallLengthsAreMm = wPerimeter >= 3000;

  if (isLikelyFractionCoords(raw)) {
    const spread = Math.max(maxSpread, 0.001);
    const target = Math.max(6000, refLengthMm ?? 10000);
    const scale = target / spread;
    return raw.map((p) => ({ x: p.x * scale, z: p.z * scale }));
  }

  if (maxSpread >= 3000) {
    // Likely real mm already — but verify against wallLengths if available.
    // If vertex perimeter is ~1000x wall perimeter, coords are in some other
    // large unit (shouldn't happen, but guard against it).
    if (wallLengthsAreMm && vPerimeter > 0) {
      const ratio = wPerimeter / vPerimeter;
      if (ratio > 0.2 && ratio < 5) {
        return raw.map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 }));
      }
    }
    return raw.map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 }));
  }

  // Metres detection: spread 1.1–200, check perimeter ratio against wallLengths.
  // Also detect when no wallLengths are present but coords are clearly in metres
  // (spread 2–200 with refLength suggesting the same scale).
  if (maxSpread > 1.1 && maxSpread < 200) {
    if (wallLengthsAreMm && vPerimeter > 0) {
      const ratio = wPerimeter / vPerimeter;
      if (ratio > 500 && ratio < 2000) {
        return raw.map((p) => ({ x: p.x * 1000, z: p.z * 1000 }));
      }
      // Use ratio directly as the scale factor for better precision
      if (ratio > 100) {
        return raw.map((p) => ({ x: p.x * ratio, z: p.z * ratio }));
      }
    }
    // No wall lengths but refLength suggests metres
    if (!wallLengthsAreMm && refLengthMm && refLengthMm > 3000 && maxSpread < 100) {
      return raw.map((p) => ({ x: p.x * 1000, z: p.z * 1000 }));
    }
  }

  // Pixel-scale coords: spread is 1.1–3000, scale to target mm
  if (maxCoord > 1.1) {
    const spread = Math.max(maxSpread, 1);
    const target = wallLengthsAreMm
      ? wPerimeter / (raw.length > 2 ? raw.length : 4)
      : Math.max(6000, refLengthMm ?? 10000);
    const scale = target / spread;
    return raw.map((p) => ({ x: p.x * scale, z: p.z * scale }));
  }

  return raw.map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 }));
}

/**
 * Collapse parallel-step artifacts that turn a 6-wall L-shape into 8+ walls.
 *
 * Uses ratio + area guard: grid artifacts have small ratios AND tiny area impact,
 * while real L-shape inner walls have significant area impact (>3% of polygon).
 * This prevents collapsing genuine geometry (6→4) while still removing artifacts (8→6).
 */
function collapseTinyOrthogonalJogs(
  pts: Array<{ x: number; z: number }>,
): Array<{ x: number; z: number }> {
  if (pts.length <= 4) return pts;
  const out = pts.map((p) => ({ x: p.x, z: p.z }));

  const polyArea = (verts: Array<{ x: number; z: number }>): number => {
    let a = 0;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      a += verts[i].x * verts[j].z - verts[j].x * verts[i].z;
    }
    return Math.abs(a / 2);
  };

  let changed = true;
  while (changed && out.length > 4) {
    changed = false;
    const n = out.length;
    const currentArea = polyArea(out);

    type Candidate = { i: number; nextI: number; nnI: number; ratio: number; vertical: boolean };
    const candidates: Candidate[] = [];

    for (let i = 0; i < n; i++) {
      const prevI = (i - 1 + n) % n;
      const nextI = (i + 1) % n;
      const nnI = (i + 2) % n;
      const a = out[prevI]!;
      const b = out[i]!;
      const c = out[nextI]!;
      const d = out[nnI]!;
      const d1x = b.x - a.x, d1z = b.z - a.z;
      const d2x = c.x - b.x, d2z = c.z - b.z;
      const d3x = d.x - c.x, d3z = d.z - c.z;
      const l1 = Math.hypot(d1x, d1z);
      const l2 = Math.hypot(d2x, d2z);
      const l3 = Math.hypot(d3x, d3z);
      if (l1 < 1e-9 || l2 < 1e-9 || l3 < 1e-9) continue;

      const parallel13 = Math.abs((d1x * d3x + d1z * d3z) / (l1 * l3));
      const perp12 = Math.abs((d1x * d2x + d1z * d2z) / (l1 * l2));
      if (parallel13 < 0.95 || perp12 > 0.25) continue;

      const ratio = l2 / Math.max(Math.min(l1, l3), 1);
      candidates.push({ i, nextI, nnI, ratio, vertical: Math.abs(d2z) > Math.abs(d2x) });
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.ratio - b.ratio);

    let collapsed = false;
    for (const best of candidates) {
      if (best.ratio >= 0.90) break;

      const sim = out.map((p) => ({ x: p.x, z: p.z }));
      if (best.vertical) sim[best.nnI]!.z = sim[best.i]!.z;
      else sim[best.nnI]!.x = sim[best.i]!.x;
      sim.splice(Math.max(best.i, best.nextI), 1);
      sim.splice(Math.min(best.i, best.nextI), 1);
      const areaChange = Math.abs(polyArea(sim) - currentArea) / Math.max(currentArea, 1);

      // Match backend two-stage guard so preview and persisted result stay aligned.
      const canUseRelaxedFirstPass = out.length > 6 && best.ratio < 0.75 && areaChange <= 0.20;
      if (areaChange > 0.08 && !canUseRelaxedFirstPass) continue;

      if (best.vertical) out[best.nnI]!.z = out[best.i]!.z;
      else out[best.nnI]!.x = out[best.i]!.x;
      out.splice(Math.max(best.i, best.nextI), 1);
      out.splice(Math.min(best.i, best.nextI), 1);
      collapsed = true;
      break;
    }
    changed = collapsed;
  }
  return out.length >= 3 ? out : pts;
}

export interface BuildGraphOptions {
  /** Wall lengths from plan dimensions (mm); used for scaling and closed-loop */
  wallLengthsMm?: number[];
}

/**
 * Build a BuildingGraph from a 2D footprint (closed polygon).
 * Vertices become nodes; each edge (i → i+1) becomes an edge with length.
 * Applies contour-following: orthogonal correction (90° snap), dimension-based scaling, closed-loop.
 * Units: assume vertices in mm on XZ plane (y=0), or 0–1 fraction (scaled by refLengthMm).
 */
export function buildGraphFromFootprint(
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>,
  refLengthMm?: number,
  options?: BuildGraphOptions,
): BuildingGraphData {
  const n = vertices.length;
  if (n < 3) return { nodes: [], edges: [] };

  const coordMode = detectFootprintCoordinateMode(vertices, refLengthMm, options?.wallLengthsMm);
  let mm = normalizeFootprintToMm(vertices, refLengthMm, options?.wallLengthsMm);

  const shouldPreserveMetricShape = coordMode === 'mm' || coordMode === 'meters';
  if (!shouldPreserveMetricShape) {
    const contourOpts: ContourExtractionOptions = { skipOrthoCorrection: false };
    const pts2d = mm.map((p) => ({ x: p.x, y: p.z }));
    const contourPts = applyContourExtraction(pts2d, options?.wallLengthsMm, contourOpts);
    mm = contourPts.map((p) => ({ x: p.x, z: p.y }));
  }
  mm = collapseTinyOrthogonalJogs(mm);

  // Snap / dedupe: merge vertices that are effectively identical (vision output often repeats endpoints).
  const tolMm = 1; // 1mm tolerance for node snapping
  const snapped: Array<{ x: number; z: number }> = [];
  for (const p of mm) {
    const last = snapped[snapped.length - 1];
    if (!last || dist2dMm(last, p) > tolMm) snapped.push(p);
  }
  // If last is same as first, remove last.
  if (snapped.length >= 3) {
    const first = snapped[0];
    const last = snapped[snapped.length - 1];
    if (dist2dMm(first, last) <= tolMm) snapped.pop();
  }

  // Map by rounded mm coordinate to ensure shared nodes at intersections.
  const nodeByKey = new Map<string, BuildingNode>();
  const order: BuildingNode[] = [];
  const getNode = (x: number, z: number) => {
    const rx = Math.round(x);
    const rz = Math.round(z);
    const key = `${rx},${rz}`;
    const existing = nodeByKey.get(key);
    if (existing) return existing;
    const node: BuildingNode = {
      id: `node-${nodeByKey.size}`,
      position: { x: rx, y: 0, z: rz },
    };
    nodeByKey.set(key, node);
    order.push(node);
    return node;
  };

  const loopNodes = snapped.map((p) => getNode(p.x, p.z));
  const nodes: BuildingNode[] = order;

  const edges: BuildingEdge[] = [];
  for (let i = 0; i < loopNodes.length; i++) {
    const next = (i + 1) % loopNodes.length;
    const a = loopNodes[i].position;
    const b = loopNodes[next].position;
    const lengthMm = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
    edges.push({
      id: `edge-${i}`,
      fromNodeId: loopNodes[i].id,
      toNodeId: loopNodes[next].id,
      lengthMm: Math.round(lengthMm),
      wallIndex: i,
    });
  }

  // For the existing 3D renderer: pass mm coords via the existing field names.
  const polygonVertices: FootprintVertex[] = loopNodes.map((node) => ({
    xFrac: node.position.x,
    yFrac: node.position.z,
  }));

  return { nodes, edges, polygonVertices };
}

/**
 * Miter join: ensure each edge uses exactly the shared node positions
 * (no duplicate vertices at corners). The graph is already miter-correct
 * when built from a closed polygon; this is for validation / snapping.
 */
export function ensureMiterJoin(graph: BuildingGraphData): BuildingGraphData {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges: BuildingEdge[] = graph.edges.map((e) => {
    const from = nodeMap.get(e.fromNodeId);
    const to = nodeMap.get(e.toNodeId);
    if (!from || !to) return e;
    const lengthMm = Math.sqrt(
      (to.position.x - from.position.x) ** 2 +
        (to.position.z - from.position.z) ** 2,
    );
    return { ...e, lengthMm: Math.round(lengthMm) };
  });
  return { ...graph, edges };
}

/**
 * Convert BuildingGraph to wall inputs for the existing estimator.
 * Each edge → one WallInput (side = edge id, wallLengthMm = edge length).
 * If overrideLengthsMm is provided and length matches edges, use those lengths (e.g. from plan dimensions).
 * If wallHeightsMm is provided (one per edge), each wall gets its own height (for stepped/tiered buildings).
 */
export function graphToWallInputs(
  graph: BuildingGraphData,
  buildingHeightMm: number,
  stairAccessCountPerWall: number = 0,
  overrideLengthsMm?: number[],
  wallHeightsMm?: number[],
): Array<{ side: string; wallLengthMm: number; wallHeightMm: number; stairAccessCount: number }> {
  const useOverride = Array.isArray(overrideLengthsMm) && overrideLengthsMm.length === graph.edges.length;
  const usePerWallHeight = Array.isArray(wallHeightsMm) && wallHeightsMm.length === graph.edges.length;
  return graph.edges.map((e, i) => ({
    side: e.id,
    wallLengthMm: Math.max(600, useOverride ? overrideLengthsMm[i]! : e.lengthMm),
    wallHeightMm: usePerWallHeight ? wallHeightsMm[i]! : buildingHeightMm,
    stairAccessCount: stairAccessCountPerWall,
  }));
}
