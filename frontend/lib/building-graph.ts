/**
 * BuildingGraph — Node-and-Edge graph for advanced scaffold geometry.
 * Every building corner is a Vector3 Node; walls are Edges connecting Nodes.
 * Miter join logic ensures wall endpoints snap to shared nodes (zero gaps at intersections).
 * This layer feeds the existing rendering engine; it does not replace it.
 */

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

/**
 * Build a BuildingGraph from a 2D footprint (closed polygon).
 * Vertices become nodes; each edge (i → i+1) becomes an edge with length.
 * Units: assume vertices in mm on XZ plane (y=0), or 0–1 fraction (scaled by refLengthMm).
 */
export function buildGraphFromFootprint(
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>,
  refLengthMm?: number,
): BuildingGraphData {
  const n = vertices.length;
  if (n < 3) return { nodes: [], edges: [] };

  const isFraction = vertices.some(
    (v) => Math.abs((v as { xFrac?: number }).xFrac ?? (v as { x: number }).x) <= 1.1,
  );
  const scale = isFraction && refLengthMm ? refLengthMm / 1000 : 1;

  const nodes: BuildingNode[] = vertices.map((v, i) => {
    const x = ('xFrac' in v ? v.xFrac : v.x) * (isFraction ? scale : 1);
    const z = ('yFrac' in v ? v.yFrac : v.y) * (isFraction ? scale : 1);
    return {
      id: `node-${i}`,
      position: { x, y: 0, z },
    };
  });

  const edges: BuildingEdge[] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const a = nodes[i].position;
    const b = nodes[next].position;
    const lengthMm = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
    edges.push({
      id: `edge-${i}`,
      fromNodeId: nodes[i].id,
      toNodeId: nodes[next].id,
      lengthMm: Math.round(lengthMm),
      wallIndex: i,
    });
  }

  const polygonVertices: FootprintVertex[] = vertices.map((v) => ({
    xFrac: 'xFrac' in v ? v.xFrac : (v as { x: number }).x,
    yFrac: 'yFrac' in v ? v.yFrac : (v as { y: number }).y,
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
 */
export function graphToWallInputs(
  graph: BuildingGraphData,
  buildingHeightMm: number,
  stairAccessCountPerWall: number = 0,
): Array<{ side: string; wallLengthMm: number; wallHeightMm: number; stairAccessCount: number }> {
  return graph.edges.map((e) => ({
    side: e.id,
    wallLengthMm: Math.max(600, e.lengthMm),
    wallHeightMm: buildingHeightMm,
    stairAccessCount: stairAccessCountPerWall,
  }));
}
