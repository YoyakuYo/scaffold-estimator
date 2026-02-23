/**
 * Segment Extraction — Extract line segments from parsed DXF data
 *
 * Collects:
 *   - LINE entities → 1 segment each
 *   - LWPOLYLINE entities → consecutive vertex pairs as segments
 *
 * Ignores: TEXT, MTEXT, DIMENSION, INSERT, ARC, CIRCLE, SPLINE,
 *          HATCH, BLOCK references, and all non-geometry entities.
 *
 * Pure function. No UI, no side-effects.
 */

import type { IDxf } from 'dxf-parser';
import type { RawSegment } from '@/geometry/polygonDetection';

/**
 * Additional metadata returned alongside raw segments.
 */
export interface ExtractionResult {
  /** All extracted line segments */
  segments: RawSegment[];
  /** Number of LINE entities found */
  lineCount: number;
  /** Number of LWPOLYLINE entities found */
  polylineCount: number;
  /** Total vertex count from polylines */
  vertexCount: number;
}

/**
 * Extract line segments from a parsed DXF.
 *
 * Only processes LINE and LWPOLYLINE entity types.
 * All other entity types are silently ignored.
 */
export function extractSegments(dxf: IDxf): ExtractionResult {
  const segments: RawSegment[] = [];
  let lineCount = 0;
  let polylineCount = 0;
  let vertexCount = 0;

  if (!dxf.entities) {
    return { segments, lineCount, polylineCount, vertexCount };
  }

  for (const entity of dxf.entities) {
    // ── LINE ───────────────────────────────────────────────
    if (entity.type === 'LINE') {
      const lineEntity = entity as any;
      const vertices = lineEntity.vertices;

      if (vertices && vertices.length >= 2) {
        segments.push({
          start: { x: vertices[0].x, y: vertices[0].y },
          end: { x: vertices[1].x, y: vertices[1].y },
        });
        lineCount++;
      }
      continue;
    }

    // ── LWPOLYLINE ─────────────────────────────────────────
    if (entity.type === 'LWPOLYLINE') {
      const polyEntity = entity as any;
      const vertices = polyEntity.vertices;

      if (vertices && vertices.length >= 2) {
        polylineCount++;
        vertexCount += vertices.length;

        // Convert consecutive vertex pairs into segments
        for (let i = 0; i < vertices.length - 1; i++) {
          segments.push({
            start: { x: vertices[i].x, y: vertices[i].y },
            end: { x: vertices[i + 1].x, y: vertices[i + 1].y },
          });
        }

        // If polyline is closed (shape flag), connect last → first
        if (polyEntity.shape && vertices.length >= 3) {
          const last = vertices[vertices.length - 1];
          const first = vertices[0];
          segments.push({
            start: { x: last.x, y: last.y },
            end: { x: first.x, y: first.y },
          });
        }
      }
      continue;
    }

    // ── POLYLINE (older DXF format) ────────────────────────
    if (entity.type === 'POLYLINE') {
      const polyEntity = entity as any;
      const vertices = polyEntity.vertices;

      if (vertices && vertices.length >= 2) {
        polylineCount++;
        vertexCount += vertices.length;

        for (let i = 0; i < vertices.length - 1; i++) {
          segments.push({
            start: { x: vertices[i].x, y: vertices[i].y },
            end: { x: vertices[i + 1].x, y: vertices[i + 1].y },
          });
        }

        // Check if closed
        if (polyEntity.shape && vertices.length >= 3) {
          const last = vertices[vertices.length - 1];
          const first = vertices[0];
          segments.push({
            start: { x: last.x, y: last.y },
            end: { x: first.x, y: first.y },
          });
        }
      }
      continue;
    }

    // All other entity types (TEXT, DIMENSION, ARC, CIRCLE, INSERT, etc.)
    // are intentionally ignored.
  }

  return { segments, lineCount, polylineCount, vertexCount };
}
