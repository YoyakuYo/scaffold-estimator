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

/**
 * Normalize footprint to mm. Uses UNIFORM scale for X and Z (same factor) to preserve
 * aspect ratio and avoid distortion. 90° corners in the source are preserved.
 */
function normalizeFootprintToMm(
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>,
  refLengthMm?: number,
): Array<{ x: number; z: number }> {
  const raw = vertices.map((v) => ({
    x: 'xFrac' in v ? v.xFrac : v.x,
    z: 'yFrac' in v ? v.yFrac : v.y,
  }));
  if (!isLikelyFractionCoords(raw)) {
    return raw.map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 }));
  }

  const xs = raw.map((p) => p.x);
  const zs = raw.map((p) => p.z);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadZ = Math.max(...zs) - Math.min(...zs);
  const spread = Math.max(spreadX, spreadZ, 0.001);
  const target = Math.max(6000, refLengthMm ?? 10000);
  const scale = target / spread;
  return raw.map((p) => ({ x: p.x * scale, z: p.z * scale }));
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

  let mm = normalizeFootprintToMm(vertices, refLengthMm);

  // Skip orthogonal correction when coordinates are already in precise mm
  // (e.g. from DXF parse or AI vision with scale). Snapping precise coordinates
  // distorts the actual building shape and is the main cause of "shape changes".
  const alreadyMm = !isLikelyFractionCoords(mm);
  const contourOpts: ContourExtractionOptions = { skipOrthoCorrection: alreadyMm };
  const pts2d = mm.map((p) => ({ x: p.x, y: p.z }));
  const contourPts = applyContourExtraction(pts2d, options?.wallLengthsMm, contourOpts);
  mm = contourPts.map((p) => ({ x: p.x, z: p.y }));

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
 */
export function graphToWallInputs(
  graph: BuildingGraphData,
  buildingHeightMm: number,
  stairAccessCountPerWall: number = 0,
  overrideLengthsMm?: number[],
): Array<{ side: string; wallLengthMm: number; wallHeightMm: number; stairAccessCount: number }> {
  const useOverride = Array.isArray(overrideLengthsMm) && overrideLengthsMm.length === graph.edges.length;
  return graph.edges.map((e, i) => ({
    side: e.id,
    wallLengthMm: Math.max(600, useOverride ? overrideLengthsMm[i]! : e.lengthMm),
    wallHeightMm: buildingHeightMm,
    stairAccessCount: stairAccessCountPerWall,
  }));
}
