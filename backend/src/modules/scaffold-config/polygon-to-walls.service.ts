import { Injectable, Logger } from '@nestjs/common';
import { WallCalculationInput } from './scaffold-calculator.service';

/**
 * Converts a building outline polygon into scaffold wall segments.
 * 
 * This enables scaffold calculation for complex buildings with:
 * - Multiple corners (not just rectangles)
 * - Curved areas (approximated with straight segments)
 * - Complete perimeter coverage
 */

export interface OutlinePoint {
  xFrac: number;
  yFrac: number;
}

export interface PolygonEdge {
  /** Edge index (0-based) */
  index: number;
  /** Start point (fractional coords) */
  start: OutlinePoint;
  /** End point (fractional coords) */
  end: OutlinePoint;
  /** Edge length in fractional units (0-1) */
  lengthFrac: number;
  /** Direction classification (approximate) */
  direction: 'north' | 'south' | 'east' | 'west' | 'diagonal';
  /** Whether this edge appears to be curved (needs approximation) */
  isCurved: boolean;
}

export interface PolygonWallInput extends WallCalculationInput {
  /** Edge index in the polygon */
  edgeIndex: number;
  /** Start point of this edge */
  startPoint: OutlinePoint;
  /** End point of this edge */
  endPoint: OutlinePoint;
}

@Injectable()
export class PolygonToWallsService {
  private readonly logger = new Logger(PolygonToWallsService.name);

  /**
   * Convert a building outline polygon to scaffold wall segments.
   * 
   * @param outline Building outline polygon (fractional coords 0-1)
   * @param extractedDimensions Extracted dimensions from OCR (for scaling)
   * @param buildingHeightMm Building height in mm
   * @returns Array of wall inputs, one per polygon edge
   */
  convertPolygonToWalls(
    outline: OutlinePoint[],
    extractedDimensions: {
      walls: {
        north: { lengthMm: number } | null;
        south: { lengthMm: number } | null;
        east: { lengthMm: number } | null;
        west: { lengthMm: number } | null;
      };
    },
    buildingHeightMm: number,
  ): PolygonWallInput[] {
    if (outline.length < 3) {
      this.logger.warn('Polygon has fewer than 3 vertices, cannot convert to walls');
      return [];
    }

    // ── Step 1: Analyze polygon edges ──────────────────────────
    const edges = this.analyzeEdges(outline);

    // ── Step 2: Calculate real-world dimensions for each edge ──
    const edgesWithDimensions = this.calculateEdgeDimensions(
      edges,
      extractedDimensions,
    );

    // ── Step 3: Convert to wall inputs ────────────────────────
    const walls: PolygonWallInput[] = edgesWithDimensions.map((edge, idx) => {
      // For curved edges, we'll approximate with straight segments
      // For now, treat each edge as a single wall segment
      const wallLengthMm = edge.lengthMm;

      // Classify edge direction for naming
      const side = this.classifyEdgeSide(edge.direction, idx);

      return {
        side,
        wallLengthMm,
        wallHeightMm: buildingHeightMm,
        stairAccessCount: 0, // Can be configured later
        kaidanCount: 0,
        kaidanOffsets: [],
        edgeIndex: edge.index,
        startPoint: edge.start,
        endPoint: edge.end,
        // For curved edges, we could add segments here
        // For now, treat as single straight segment
        segments: edge.isCurved
          ? this.approximateCurvedEdge(edge, wallLengthMm)
          : undefined,
      };
    });

    this.logger.log(
      `Converted polygon with ${outline.length} vertices to ${walls.length} wall segments`,
    );

    return walls;
  }

  /**
   * Analyze polygon edges to extract geometry and detect curves.
   */
  private analyzeEdges(outline: OutlinePoint[]): PolygonEdge[] {
    const edges: PolygonEdge[] = [];

    for (let i = 0; i < outline.length; i++) {
      const start = outline[i];
      const end = outline[(i + 1) % outline.length];

      const dx = end.xFrac - start.xFrac;
      const dy = end.yFrac - start.yFrac;
      const lengthFrac = Math.sqrt(dx * dx + dy * dy);

      // Classify direction
      const angle = Math.atan2(dy, dx);
      const deg = (angle * 180) / Math.PI;
      let direction: PolygonEdge['direction'] = 'diagonal';

      // Classify as N/S/E/W if within ±15° of axis
      if (Math.abs(deg) < 15 || Math.abs(deg) > 165) {
        direction = 'east'; // horizontal
      } else if (Math.abs(deg - 90) < 15 || Math.abs(deg + 90) < 15) {
        direction = 'south'; // vertical (y-down in screen coords)
      } else if (Math.abs(deg - 45) < 15 || Math.abs(deg + 135) < 15) {
        direction = 'diagonal';
      }

      // Detect curves by checking angle change at vertices
      // If the angle between consecutive edges changes significantly, it might be curved
      const prevIdx = (i - 1 + outline.length) % outline.length;
      const nextIdx = (i + 2) % outline.length;
      const prev = outline[prevIdx];
      const next = outline[nextIdx];

      const angle1 = Math.atan2(start.yFrac - prev.yFrac, start.xFrac - prev.xFrac);
      const angle2 = Math.atan2(next.yFrac - end.yFrac, next.xFrac - end.xFrac);
      const angleDiff = Math.abs(angle2 - angle1);
      const isCurved = angleDiff > Math.PI / 6; // > 30° change suggests curve

      edges.push({
        index: i,
        start,
        end,
        lengthFrac,
        direction,
        isCurved,
      });
    }

    return edges;
  }

  /**
   * Calculate real-world dimensions (mm) for each edge based on extracted dimensions.
   */
  private calculateEdgeDimensions(
    edges: PolygonEdge[],
    extractedDimensions: {
      walls: {
        north: { lengthMm: number } | null;
        south: { lengthMm: number } | null;
        east: { lengthMm: number } | null;
        west: { lengthMm: number } | null;
      };
    },
  ): Array<PolygonEdge & { lengthMm: number }> {
    // Group edges by direction
    const dirGroups: Record<string, PolygonEdge[]> = {
      north: [],
      south: [],
      east: [],
      west: [],
      diagonal: [],
    };

    edges.forEach((e) => {
      if (e.direction === 'north' || e.direction === 'south' || e.direction === 'east' || e.direction === 'west') {
        dirGroups[e.direction].push(e);
      } else {
        dirGroups.diagonal.push(e);
      }
    });

    // Get extracted dimensions
    const extracted = extractedDimensions.walls;
    const totalNorth = extracted.north?.lengthMm || 0;
    const totalSouth = extracted.south?.lengthMm || 0;
    const totalEast = extracted.east?.lengthMm || 0;
    const totalWest = extracted.west?.lengthMm || 0;

    // Calculate total fractional lengths per direction
    const totalFracByDir: Record<string, number> = {
      north: dirGroups.north.reduce((s, e) => s + e.lengthFrac, 0),
      south: dirGroups.south.reduce((s, e) => s + e.lengthFrac, 0),
      east: dirGroups.east.reduce((s, e) => s + e.lengthFrac, 0),
      west: dirGroups.west.reduce((s, e) => s + e.lengthFrac, 0),
    };

    // Scale edges proportionally
    const edgesWithMm: Array<PolygonEdge & { lengthMm: number }> = edges.map((edge) => {
      let lengthMm = 0;

      if (edge.direction === 'north' && totalFracByDir.north > 0) {
        lengthMm = (edge.lengthFrac / totalFracByDir.north) * totalNorth;
      } else if (edge.direction === 'south' && totalFracByDir.south > 0) {
        lengthMm = (edge.lengthFrac / totalFracByDir.south) * totalSouth;
      } else if (edge.direction === 'east' && totalFracByDir.east > 0) {
        lengthMm = (edge.lengthFrac / totalFracByDir.east) * totalEast;
      } else if (edge.direction === 'west' && totalFracByDir.west > 0) {
        lengthMm = (edge.lengthFrac / totalFracByDir.west) * totalWest;
      } else {
        // Diagonal or no extracted dimension - estimate from average
        const avgExtracted = (totalNorth + totalSouth + totalEast + totalWest) / 4;
        if (avgExtracted > 0) {
          // Estimate diagonal as 1.4× the average (Pythagorean for 45°)
          lengthMm = edge.lengthFrac * avgExtracted * 1.4;
        } else {
          // Fallback: assume 1 fractional unit = 10m (10000mm)
          lengthMm = edge.lengthFrac * 10000;
        }
      }

      return {
        ...edge,
        lengthMm: Math.round(lengthMm),
      };
    });

    return edgesWithMm;
  }

  /**
   * Classify edge side for scaffold calculation (maps to N/S/E/W).
   */
  private classifyEdgeSide(
    direction: PolygonEdge['direction'],
    index: number,
  ): 'north' | 'south' | 'east' | 'west' {
    // For diagonal edges, assign to closest cardinal direction
    if (direction === 'north') return 'north';
    if (direction === 'south') return 'south';
    if (direction === 'east') return 'east';
    if (direction === 'west') return 'west';

    // For diagonal, alternate or use index-based assignment
    // This ensures all edges get assigned for calculation
    const mod = index % 4;
    if (mod === 0) return 'north';
    if (mod === 1) return 'east';
    if (mod === 2) return 'south';
    return 'west';
  }

  /**
   * Approximate a curved edge with straight segments.
   * For now, returns a single segment (can be enhanced later).
   */
  private approximateCurvedEdge(
    edge: PolygonEdge,
    totalLengthMm: number,
  ): Array<{ lengthMm: number; offsetMm: number }> {
    // Simple approximation: divide into 3-5 segments based on length
    const numSegments = Math.max(3, Math.min(5, Math.ceil(totalLengthMm / 3000)));
    const segmentLength = totalLengthMm / numSegments;

    const segments: Array<{ lengthMm: number; offsetMm: number }> = [];
    for (let i = 0; i < numSegments; i++) {
      segments.push({
        lengthMm: Math.round(segmentLength),
        offsetMm: 0, // For now, treat as straight (can add curve offset later)
      });
    }

    return segments;
  }
}
