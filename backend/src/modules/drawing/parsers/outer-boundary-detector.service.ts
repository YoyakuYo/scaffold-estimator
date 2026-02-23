import { Injectable, Logger } from '@nestjs/common';
import { CleanedSegment } from './geometry-cleaner.service';

/**
 * ═══════════════════════════════════════════════════════════
 * Outer Boundary Detector — Graph-Based
 * ═══════════════════════════════════════════════════════════
 *
 * From cleaned geometry segments:
 *   1) Build a geometric graph (nodes = endpoints, edges = segments)
 *   2) Detect all closed loops
 *   3) Compute area for each loop
 *   4) Select the loop with the largest area (= exterior wall boundary)
 *
 * Ignores internal rooms, holes, and partitions.
 */

export interface GraphNode {
  id: number;
  x: number;
  y: number;
  edges: number[]; // indices into edges array
}

export interface GraphEdge {
  id: number;
  node1: number;
  node2: number;
  length: number;
  angle: number; // angle from node1 to node2 in radians
}

export interface BoundaryLoop {
  /** Ordered node indices forming the loop */
  nodeIds: number[];
  /** Ordered points forming the loop */
  points: Array<{ x: number; y: number }>;
  /** Area of the enclosed region (positive = CCW) */
  area: number;
  /** Total perimeter length */
  perimeter: number;
}

export interface BoundaryDetectionResult {
  outerBoundary: BoundaryLoop;
  innerLoops: BoundaryLoop[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

@Injectable()
export class OuterBoundaryDetectorService {
  private readonly logger = new Logger(OuterBoundaryDetectorService.name);

  /**
   * Detect the outer boundary from cleaned segments.
   *
   * @param segments Cleaned line segments
   * @param snapTolerance Distance within which points are considered the same node
   */
  detect(
    segments: CleanedSegment[],
    snapTolerance: number = 5,
  ): BoundaryDetectionResult {
    // ── 1) Build geometric graph ─────────────────────────
    const { nodes, edges } = this.buildGraph(segments, snapTolerance);
    this.logger.log(`Graph: ${nodes.length} nodes, ${edges.length} edges`);

    if (nodes.length < 3 || edges.length < 3) {
      throw new Error('Insufficient geometry to detect boundary (need at least 3 nodes and 3 edges)');
    }

    // ── 2) Find all closed loops using minimum cycle basis ─
    const loops = this.findAllLoops(nodes, edges);
    this.logger.log(`Found ${loops.length} closed loops`);

    if (loops.length === 0) {
      // Fallback: try convex hull
      this.logger.warn('No closed loops found. Using convex hull as fallback.');
      const hull = this.convexHull(nodes);
      const area = this.calculatePolygonArea(hull.map(n => ({ x: n.x, y: n.y })));
      const perimeter = this.calculatePerimeter(hull.map(n => ({ x: n.x, y: n.y })));

      const outerBoundary: BoundaryLoop = {
        nodeIds: hull.map(n => n.id),
        points: hull.map(n => ({ x: n.x, y: n.y })),
        area: Math.abs(area),
        perimeter,
      };

      return { outerBoundary, innerLoops: [], graph: { nodes, edges } };
    }

    // ── 3) Select the loop with the largest area ─────────
    loops.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    const outerBoundary = loops[0];
    const innerLoops = loops.slice(1);

    this.logger.log(
      `Outer boundary: ${outerBoundary.points.length} points, ` +
      `area=${outerBoundary.area.toFixed(1)}, perimeter=${outerBoundary.perimeter.toFixed(1)}`,
    );

    return { outerBoundary, innerLoops, graph: { nodes, edges } };
  }

  // ── Graph construction ─────────────────────────────────

  private buildGraph(
    segments: CleanedSegment[],
    snapTolerance: number,
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Helper to find or create a node at a given position
    const findOrCreateNode = (x: number, y: number): number => {
      for (let i = 0; i < nodes.length; i++) {
        if (Math.hypot(nodes[i].x - x, nodes[i].y - y) <= snapTolerance) {
          return i;
        }
      }
      const id = nodes.length;
      nodes.push({ id, x, y, edges: [] });
      return id;
    };

    for (const seg of segments) {
      const n1 = findOrCreateNode(seg.x1, seg.y1);
      const n2 = findOrCreateNode(seg.x2, seg.y2);

      if (n1 === n2) continue; // Skip zero-length edges

      // Check for duplicate edge
      const hasDuplicate = edges.some(
        (e) =>
          (e.node1 === n1 && e.node2 === n2) ||
          (e.node1 === n2 && e.node2 === n1),
      );
      if (hasDuplicate) continue;

      const edgeId = edges.length;
      const angle = Math.atan2(nodes[n2].y - nodes[n1].y, nodes[n2].x - nodes[n1].x);

      edges.push({
        id: edgeId,
        node1: n1,
        node2: n2,
        length: seg.length,
        angle,
      });

      nodes[n1].edges.push(edgeId);
      nodes[n2].edges.push(edgeId);
    }

    return { nodes, edges };
  }

  // ── Loop detection using planar face traversal ─────────

  private findAllLoops(nodes: GraphNode[], edges: GraphEdge[]): BoundaryLoop[] {
    const loops: BoundaryLoop[] = [];
    const usedDirectedEdges = new Set<string>(); // "edgeId-from-to"

    // For each directed edge, traverse the minimum left-turn cycle
    for (const edge of edges) {
      for (const [startNode, endNode] of [[edge.node1, edge.node2], [edge.node2, edge.node1]]) {
        const dirKey = `${edge.id}-${startNode}-${endNode}`;
        if (usedDirectedEdges.has(dirKey)) continue;

        const loop = this.traceLoop(startNode, endNode, edge.id, nodes, edges, usedDirectedEdges);
        if (loop && loop.points.length >= 3) {
          loops.push(loop);
        }
      }
    }

    return loops;
  }

  private traceLoop(
    startNodeId: number,
    firstNextId: number,
    firstEdgeId: number,
    nodes: GraphNode[],
    edges: GraphEdge[],
    usedDirectedEdges: Set<string>,
  ): BoundaryLoop | null {
    const maxSteps = nodes.length + 10;
    const visited: number[] = [startNodeId];
    const visitedEdges: Array<{ edgeId: number; from: number; to: number }> = [];

    let prevNodeId = startNodeId;
    let currentNodeId = firstNextId;
    visitedEdges.push({ edgeId: firstEdgeId, from: startNodeId, to: firstNextId });

    for (let step = 0; step < maxSteps; step++) {
      visited.push(currentNodeId);

      if (currentNodeId === startNodeId && step > 0) {
        // Closed loop found!
        const points = visited.map(nid => ({ x: nodes[nid].x, y: nodes[nid].y }));
        const area = this.calculatePolygonArea(points);
        const perimeter = this.calculatePerimeter(points);

        // Only accept loops with positive area (filter out degenerate paths)
        if (Math.abs(area) > 0.1) {
          // Mark all directed edges as used
          for (const ve of visitedEdges) {
            usedDirectedEdges.add(`${ve.edgeId}-${ve.from}-${ve.to}`);
          }

          return {
            nodeIds: visited.slice(0, -1), // Remove duplicate start node
            points: points.slice(0, -1),
            area: Math.abs(area),
            perimeter,
          };
        }
        return null;
      }

      // Find the next edge using "turn right" (planar face traversal)
      const node = nodes[currentNodeId];
      const inAngle = Math.atan2(
        nodes[prevNodeId].y - node.y,
        nodes[prevNodeId].x - node.x,
      );

      // Sort outgoing edges by angle relative to incoming direction
      const candidates: Array<{ edgeId: number; nextNode: number; angle: number }> = [];

      for (const edgeId of node.edges) {
        const edge = edges[edgeId];
        const nextNode = edge.node1 === currentNodeId ? edge.node2 : edge.node1;
        if (nextNode === prevNodeId && node.edges.length > 1) continue; // Don't go back

        const outAngle = Math.atan2(
          nodes[nextNode].y - node.y,
          nodes[nextNode].x - node.x,
        );

        // Compute relative angle (right turn = smallest positive angle)
        let relAngle = outAngle - inAngle;
        if (relAngle <= 0) relAngle += 2 * Math.PI;
        if (relAngle >= 2 * Math.PI) relAngle -= 2 * Math.PI;

        candidates.push({ edgeId, nextNode, angle: relAngle });
      }

      if (candidates.length === 0) return null;

      // Pick the edge with smallest relative angle (rightmost turn)
      candidates.sort((a, b) => a.angle - b.angle);
      const next = candidates[0];

      const dirKey = `${next.edgeId}-${currentNodeId}-${next.nextNode}`;
      if (usedDirectedEdges.has(dirKey)) return null;

      visitedEdges.push({ edgeId: next.edgeId, from: currentNodeId, to: next.nextNode });
      prevNodeId = currentNodeId;
      currentNodeId = next.nextNode;
    }

    return null; // Max steps exceeded
  }

  // ── Convex hull fallback ───────────────────────────────

  private convexHull(nodes: GraphNode[]): GraphNode[] {
    if (nodes.length < 3) return nodes;

    // Graham scan
    const sorted = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
    const pivot = sorted[0];

    sorted.sort((a, b) => {
      if (a === pivot) return -1;
      if (b === pivot) return 1;
      const angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
      const angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
      return angleA - angleB;
    });

    const hull: GraphNode[] = [];
    for (const point of sorted) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2];
        const b = hull[hull.length - 1];
        const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        if (cross <= 0) {
          hull.pop();
        } else {
          break;
        }
      }
      hull.push(point);
    }

    return hull;
  }

  // ── Geometry helpers ───────────────────────────────────

  private calculatePolygonArea(points: Array<{ x: number; y: number }>): number {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return area / 2; // Signed area: positive = CCW
  }

  private calculatePerimeter(points: Array<{ x: number; y: number }>): number {
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      perimeter += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
    }
    return perimeter;
  }
}
