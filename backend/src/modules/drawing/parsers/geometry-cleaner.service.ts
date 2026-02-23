import { Injectable, Logger } from '@nestjs/common';
import { DxfSegment } from './dxf-geometry-extractor.service';

/**
 * ═══════════════════════════════════════════════════════════
 * Geometry Cleaner — Normalization & Deduplication
 * ═══════════════════════════════════════════════════════════
 *
 * After collecting all line segments:
 *   A) Remove segments below minimum length threshold (noise)
 *   B) Snap endpoints within tolerance (e.g., 5mm)
 *   C) Merge collinear adjacent segments
 *   D) Remove duplicate overlapping segments
 *   E) Remove disconnected fragments not attached to main structure
 *
 * All endpoints are unified into a consistent coordinate system.
 */

export interface CleanedSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
}

export interface GeometryCleaningResult {
  segments: CleanedSegment[];
  removedCount: {
    tooShort: number;
    duplicates: number;
    disconnected: number;
    merged: number;
  };
}

@Injectable()
export class GeometryCleanerService {
  private readonly logger = new Logger(GeometryCleanerService.name);

  /**
   * Clean and normalize raw DXF segments.
   *
   * @param rawSegments Raw segments from DXF extraction
   * @param minLengthMm Minimum segment length threshold (noise removal)
   * @param snapTolerance Endpoint snap tolerance in drawing units
   */
  clean(
    rawSegments: DxfSegment[],
    minLengthMm: number = 5,
    snapTolerance: number = 5,
  ): GeometryCleaningResult {
    const removedCount = { tooShort: 0, duplicates: 0, disconnected: 0, merged: 0 };

    this.logger.log(`Cleaning ${rawSegments.length} raw segments (minLen=${minLengthMm}, snap=${snapTolerance})`);

    // ── A) Remove segments below minimum length ──────────
    let segments: CleanedSegment[] = [];
    for (const seg of rawSegments) {
      if (seg.length < minLengthMm) {
        removedCount.tooShort++;
        continue;
      }
      segments.push({
        x1: seg.x1,
        y1: seg.y1,
        x2: seg.x2,
        y2: seg.y2,
        length: seg.length,
      });
    }
    this.logger.log(`After min-length filter: ${segments.length} (removed ${removedCount.tooShort})`);

    // ── B) Snap endpoints within tolerance ───────────────
    segments = this.snapEndpoints(segments, snapTolerance);
    this.logger.log(`After endpoint snapping: ${segments.length}`);

    // ── C) Merge collinear adjacent segments ─────────────
    const beforeMerge = segments.length;
    segments = this.mergeCollinear(segments, snapTolerance);
    removedCount.merged = beforeMerge - segments.length;
    this.logger.log(`After collinear merge: ${segments.length} (merged ${removedCount.merged})`);

    // ── D) Remove duplicate overlapping segments ─────────
    const beforeDedup = segments.length;
    segments = this.removeDuplicates(segments, snapTolerance);
    removedCount.duplicates = beforeDedup - segments.length;
    this.logger.log(`After dedup: ${segments.length} (removed ${removedCount.duplicates})`);

    // ── E) Remove disconnected fragments ─────────────────
    const beforeDisconnect = segments.length;
    segments = this.removeDisconnected(segments, snapTolerance);
    removedCount.disconnected = beforeDisconnect - segments.length;
    this.logger.log(`After disconnect removal: ${segments.length} (removed ${removedCount.disconnected})`);

    // Recalculate lengths
    for (const seg of segments) {
      seg.length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    }

    return { segments, removedCount };
  }

  // ── B) Snap endpoints ──────────────────────────────────

  private snapEndpoints(
    segments: CleanedSegment[],
    tolerance: number,
  ): CleanedSegment[] {
    // Collect all unique points
    const allPoints: Array<{ x: number; y: number }> = [];
    for (const seg of segments) {
      allPoints.push({ x: seg.x1, y: seg.y1 });
      allPoints.push({ x: seg.x2, y: seg.y2 });
    }

    // Build clusters of nearby points
    const clusters: Array<Array<{ x: number; y: number; indices: number[] }>> = [];
    const assigned = new Set<number>();

    for (let i = 0; i < allPoints.length; i++) {
      if (assigned.has(i)) continue;

      const cluster: Array<{ x: number; y: number; indices: number[] }> = [
        { x: allPoints[i].x, y: allPoints[i].y, indices: [i] },
      ];
      assigned.add(i);

      for (let j = i + 1; j < allPoints.length; j++) {
        if (assigned.has(j)) continue;
        const dist = Math.hypot(allPoints[j].x - allPoints[i].x, allPoints[j].y - allPoints[i].y);
        if (dist <= tolerance) {
          cluster.push({ x: allPoints[j].x, y: allPoints[j].y, indices: [j] });
          assigned.add(j);
        }
      }

      clusters.push(cluster);
    }

    // Calculate centroid for each cluster
    const snapMap = new Map<number, { x: number; y: number }>();
    for (const cluster of clusters) {
      const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
      const cy = cluster.reduce((s, p) => s + p.y, 0) / cluster.length;
      for (const pt of cluster) {
        for (const idx of pt.indices) {
          snapMap.set(idx, { x: cx, y: cy });
        }
      }
    }

    // Apply snapped coordinates
    return segments.map((seg, i) => {
      const p1 = snapMap.get(i * 2) || { x: seg.x1, y: seg.y1 };
      const p2 = snapMap.get(i * 2 + 1) || { x: seg.x2, y: seg.y2 };
      return {
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        length: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      };
    }).filter(seg => seg.length > 0.001); // Remove zero-length after snapping
  }

  // ── C) Merge collinear adjacent segments ───────────────

  private mergeCollinear(
    segments: CleanedSegment[],
    tolerance: number,
  ): CleanedSegment[] {
    const ANGLE_TOLERANCE = 1 * (Math.PI / 180); // 1 degree
    let changed = true;

    while (changed) {
      changed = false;
      const result: CleanedSegment[] = [];
      const used = new Set<number>();

      for (let i = 0; i < segments.length; i++) {
        if (used.has(i)) continue;

        let seg = { ...segments[i] };
        used.add(i);

        // Try to extend this segment by merging with adjacent collinear segments
        let extended = true;
        while (extended) {
          extended = false;
          for (let j = 0; j < segments.length; j++) {
            if (used.has(j)) continue;
            const other = segments[j];

            // Check if segments are collinear and adjacent
            const merged = this.tryMergeSegments(seg, other, tolerance, ANGLE_TOLERANCE);
            if (merged) {
              seg = merged;
              used.add(j);
              extended = true;
              changed = true;
            }
          }
        }

        result.push(seg);
      }

      segments = result;
    }

    return segments;
  }

  private tryMergeSegments(
    a: CleanedSegment,
    b: CleanedSegment,
    distTolerance: number,
    angleTolerance: number,
  ): CleanedSegment | null {
    // Check if endpoints are adjacent
    const connections = [
      { sharedA: 'end', sharedB: 'start', ax: a.x2, ay: a.y2, bx: b.x1, by: b.y1 },
      { sharedA: 'end', sharedB: 'end', ax: a.x2, ay: a.y2, bx: b.x2, by: b.y2 },
      { sharedA: 'start', sharedB: 'start', ax: a.x1, ay: a.y1, bx: b.x1, by: b.y1 },
      { sharedA: 'start', sharedB: 'end', ax: a.x1, ay: a.y1, bx: b.x2, by: b.y2 },
    ];

    for (const conn of connections) {
      const dist = Math.hypot(conn.ax - conn.bx, conn.ay - conn.by);
      if (dist > distTolerance) continue;

      // Check collinearity (angles must be similar)
      const angleA = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      let angleB = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);

      // Normalize angle difference
      let diff = Math.abs(angleA - angleB);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;

      // Allow exactly collinear (same direction or opposite direction)
      if (diff > angleTolerance && Math.abs(diff - Math.PI) > angleTolerance) {
        continue;
      }

      // Merge: find the two most distant endpoints
      const points = [
        { x: a.x1, y: a.y1 },
        { x: a.x2, y: a.y2 },
        { x: b.x1, y: b.y1 },
        { x: b.x2, y: b.y2 },
      ];

      let maxDist = 0;
      let p1 = points[0], p2 = points[1];
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const d = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
          if (d > maxDist) {
            maxDist = d;
            p1 = points[i];
            p2 = points[j];
          }
        }
      }

      return {
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        length: maxDist,
      };
    }

    return null;
  }

  // ── D) Remove duplicates ───────────────────────────────

  private removeDuplicates(
    segments: CleanedSegment[],
    tolerance: number,
  ): CleanedSegment[] {
    const result: CleanedSegment[] = [];

    for (let i = 0; i < segments.length; i++) {
      let isDuplicate = false;
      const a = segments[i];

      for (let j = 0; j < result.length; j++) {
        const b = result[j];

        // Check both orientations
        const d1 = Math.hypot(a.x1 - b.x1, a.y1 - b.y1) + Math.hypot(a.x2 - b.x2, a.y2 - b.y2);
        const d2 = Math.hypot(a.x1 - b.x2, a.y1 - b.y2) + Math.hypot(a.x2 - b.x1, a.y2 - b.y1);

        if (Math.min(d1, d2) < tolerance * 2) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        result.push(a);
      }
    }

    return result;
  }

  // ── E) Remove disconnected fragments ───────────────────

  private removeDisconnected(
    segments: CleanedSegment[],
    tolerance: number,
  ): CleanedSegment[] {
    if (segments.length <= 1) return segments;

    // Build adjacency: for each segment, find which other segments share an endpoint
    const adjList: number[][] = segments.map(() => []);

    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        if (this.areConnected(segments[i], segments[j], tolerance)) {
          adjList[i].push(j);
          adjList[j].push(i);
        }
      }
    }

    // Find connected components using BFS
    const visited = new Set<number>();
    const components: number[][] = [];

    for (let i = 0; i < segments.length; i++) {
      if (visited.has(i)) continue;

      const component: number[] = [];
      const queue = [i];
      visited.add(i);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);

        for (const neighbor of adjList[current]) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      components.push(component);
    }

    // Keep only the largest connected component
    if (components.length <= 1) return segments;

    components.sort((a, b) => b.length - a.length);
    const largestComponent = new Set(components[0]);

    this.logger.log(
      `Found ${components.length} connected components. ` +
      `Keeping largest with ${largestComponent.size} segments. ` +
      `Removing ${segments.length - largestComponent.size} disconnected segments.`,
    );

    return segments.filter((_, i) => largestComponent.has(i));
  }

  private areConnected(a: CleanedSegment, b: CleanedSegment, tolerance: number): boolean {
    return (
      Math.hypot(a.x1 - b.x1, a.y1 - b.y1) <= tolerance ||
      Math.hypot(a.x1 - b.x2, a.y1 - b.y2) <= tolerance ||
      Math.hypot(a.x2 - b.x1, a.y2 - b.y1) <= tolerance ||
      Math.hypot(a.x2 - b.x2, a.y2 - b.y2) <= tolerance
    );
  }
}
