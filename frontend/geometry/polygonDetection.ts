/**
 * Polygon Detection — Find closed polygons from raw line segments
 *
 * Algorithm:
 * 1. Build adjacency map (rounded coord keys to avoid float errors)
 * 2. Walk connected segments until loop closes
 * 3. Collect all closed loops
 * 4. Select polygon with largest absolute area
 *
 * Pure functions. No UI, no side-effects.
 */

import { Point2D, polygonArea } from './areaCalculation';

export interface RawSegment {
  start: Point2D;
  end: Point2D;
}

// ─── Coordinate key (tolerance-based rounding) ───────────────

const PRECISION = 1; // round to 1 unit (typically 1mm)

function coordKey(x: number, y: number): string {
  const rx = Math.round(x / PRECISION) * PRECISION;
  const ry = Math.round(y / PRECISION) * PRECISION;
  return `${rx},${ry}`;
}

function keyToPoint(key: string): Point2D {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

// ─── Adjacency graph ─────────────────────────────────────────

interface AdjEntry {
  targetKey: string;
  used: boolean;
}

/**
 * Build an adjacency map from raw segments.
 * Each endpoint → list of connected endpoints.
 */
function buildAdjacency(segments: RawSegment[]): Map<string, AdjEntry[]> {
  const adj = new Map<string, AdjEntry[]>();

  const addEdge = (fromKey: string, toKey: string) => {
    if (!adj.has(fromKey)) adj.set(fromKey, []);
    adj.get(fromKey)!.push({ targetKey: toKey, used: false });
  };

  for (const seg of segments) {
    const startKey = coordKey(seg.start.x, seg.start.y);
    const endKey = coordKey(seg.end.x, seg.end.y);

    // Skip zero-length segments
    if (startKey === endKey) continue;

    addEdge(startKey, endKey);
    addEdge(endKey, startKey);
  }

  return adj;
}

// ─── Loop walking ────────────────────────────────────────────

/**
 * Attempt to walk a loop starting from the given node.
 * Uses DFS with edge-usage tracking.
 * Returns the loop vertices if found, or null.
 */
function walkLoop(adj: Map<string, AdjEntry[]>, startKey: string): string[] | null {
  const path: string[] = [startKey];
  const visited = new Set<string>([startKey]);

  let current = startKey;

  while (true) {
    const neighbors = adj.get(current);
    if (!neighbors) return null;

    let found = false;
    for (const entry of neighbors) {
      if (entry.used) continue;

      if (entry.targetKey === startKey && path.length >= 3) {
        // Loop closed! Mark all edges used.
        markPathUsed(adj, path);
        return path;
      }

      if (!visited.has(entry.targetKey)) {
        visited.add(entry.targetKey);
        path.push(entry.targetKey);
        current = entry.targetKey;
        found = true;
        break;
      }
    }

    if (!found) {
      // Dead end — backtrack
      path.pop();
      if (path.length === 0) return null;
      visited.delete(current);
      // Mark current edge as used so we don't retry it
      const prev = path[path.length - 1];
      const prevNeighbors = adj.get(prev);
      if (prevNeighbors) {
        for (const entry of prevNeighbors) {
          if (entry.targetKey === current && !entry.used) {
            entry.used = true;
            break;
          }
        }
      }
      current = prev;
    }
  }
}

/**
 * Mark all edges along a closed path as used.
 */
function markPathUsed(adj: Map<string, AdjEntry[]>, path: string[]): void {
  for (let i = 0; i < path.length; i++) {
    const from = path[i];
    const to = path[(i + 1) % path.length];

    const fromNeighbors = adj.get(from);
    if (fromNeighbors) {
      for (const entry of fromNeighbors) {
        if (entry.targetKey === to && !entry.used) {
          entry.used = true;
          break;
        }
      }
    }

    // Mark reverse direction too
    const toNeighbors = adj.get(to);
    if (toNeighbors) {
      for (const entry of toNeighbors) {
        if (entry.targetKey === from && !entry.used) {
          entry.used = true;
          break;
        }
      }
    }
  }
}

// ─── Main API ────────────────────────────────────────────────

export interface DetectedPolygon {
  points: Point2D[];
  area: number;
}

/**
 * Detect all closed polygons from raw segments.
 * Returns them sorted by area (largest first).
 */
export function detectPolygons(segments: RawSegment[]): DetectedPolygon[] {
  if (segments.length < 3) return [];

  const adj = buildAdjacency(segments);
  const polygons: DetectedPolygon[] = [];
  const triedStarts = new Set<string>();

  // Try to find loops starting from each node
  for (const [nodeKey] of adj) {
    if (triedStarts.has(nodeKey)) continue;
    triedStarts.add(nodeKey);

    const loop = walkLoop(adj, nodeKey);
    if (loop && loop.length >= 3) {
      const points = loop.map(keyToPoint);
      const area = polygonArea(points);

      if (area > 0) {
        polygons.push({ points, area });
      }
    }
  }

  // Sort by area descending (largest first)
  polygons.sort((a, b) => b.area - a.area);

  return polygons;
}

/**
 * Detect the outermost polygon (largest area) from raw segments.
 * Returns null if no closed polygon found.
 */
export function detectOuterPolygon(segments: RawSegment[]): DetectedPolygon | null {
  const polygons = detectPolygons(segments);
  return polygons.length > 0 ? polygons[0] : null;
}
