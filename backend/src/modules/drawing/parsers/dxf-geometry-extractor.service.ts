import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DxfParser = require('dxf-parser');

/**
 * ═══════════════════════════════════════════════════════════
 * DXF Geometry Extractor — Professional Mode
 * ═══════════════════════════════════════════════════════════
 *
 * Parses DXF entities and extracts ONLY structural geometry:
 *   - LINE
 *   - LWPOLYLINE
 *   - POLYLINE
 *   - ARC (→ segmented polyline)
 *   - SPLINE (→ approximated polyline)
 *
 * Ignores: TEXT, MTEXT, DIMENSION (except for height), HATCH,
 *          LEADER, ANNOTATION, SYMBOLS, NON-STRUCTURAL BLOCKS
 *
 * Output: Array of straight line segments with precise coordinates.
 */

export interface DxfSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  layer: string;
  /** Length of this segment */
  length: number;
}

export interface DxfDimensionEntity {
  /** Measured value (if present in DXF) */
  value: number | null;
  /** Text override */
  text: string;
  /** Start point of dimension line */
  start: { x: number; y: number };
  /** End point of dimension line */
  end: { x: number; y: number };
  layer: string;
  /** Whether this appears to be a height dimension (vertical) */
  isVertical: boolean;
}

export interface DxfExtractionResult {
  segments: DxfSegment[];
  dimensions: DxfDimensionEntity[];
  layers: string[];
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  unit: 'mm' | 'cm' | 'm';
  hasZCoordinates: boolean;
  maxZ: number;
  minZ: number;
}

@Injectable()
export class DxfGeometryExtractorService {
  private readonly logger = new Logger(DxfGeometryExtractorService.name);

  /** Number of segments to approximate arcs */
  private readonly ARC_SEGMENTS = 16;
  /** Number of segments to approximate splines */
  private readonly SPLINE_SEGMENTS = 20;

  async extract(dxfFilePath: string): Promise<DxfExtractionResult> {
    const fileContent = await fs.readFile(dxfFilePath, 'utf-8');
    const parser = new DxfParser();
    const dxf = parser.parse(fileContent);

    if (!dxf) {
      throw new Error('Failed to parse DXF file — file may be corrupted or empty');
    }

    const segments: DxfSegment[] = [];
    const dimensions: DxfDimensionEntity[] = [];
    const layerSet = new Set<string>();
    let hasZCoordinates = false;
    let maxZ = -Infinity;
    let minZ = Infinity;

    // Determine unit from DXF header
    const unit = this.detectUnit(dxf);

    // Process all entities
    const entities = dxf.entities || [];
    this.logger.log(`DXF contains ${entities.length} entities`);

    for (const entity of entities) {
      try {
        const layer = entity.layer || 'default';
        layerSet.add(layer);

        switch (entity.type) {
          case 'LINE':
            this.extractLine(entity, layer, segments);
            if (entity.start?.z !== undefined || entity.end?.z !== undefined) {
              hasZCoordinates = true;
              const zVals = [entity.start?.z || 0, entity.end?.z || 0];
              maxZ = Math.max(maxZ, ...zVals);
              minZ = Math.min(minZ, ...zVals);
            }
            break;

          case 'LWPOLYLINE':
          case 'POLYLINE':
            this.extractPolyline(entity, layer, segments);
            break;

          case 'ARC':
            this.extractArc(entity, layer, segments);
            break;

          case 'SPLINE':
            this.extractSpline(entity, layer, segments);
            break;

          case 'DIMENSION':
            this.extractDimension(entity, layer, dimensions);
            break;

          // Skip everything else (TEXT, MTEXT, HATCH, etc.)
          default:
            break;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to extract entity ${entity.type}: ${err.message}`);
      }
    }

    // Also process block references (INSERT entities) for structural geometry
    for (const entity of entities) {
      if (entity.type === 'INSERT' && entity.name && dxf.blocks?.[entity.name]) {
        const block = dxf.blocks[entity.name];
        if (block.entities) {
          for (const blockEntity of block.entities) {
            try {
              const layer = blockEntity.layer || entity.layer || 'default';
              switch (blockEntity.type) {
                case 'LINE':
                  this.extractLine(blockEntity, layer, segments, entity);
                  break;
                case 'LWPOLYLINE':
                case 'POLYLINE':
                  this.extractPolyline(blockEntity, layer, segments, entity);
                  break;
                case 'ARC':
                  this.extractArc(blockEntity, layer, segments, entity);
                  break;
                case 'SPLINE':
                  this.extractSpline(blockEntity, layer, segments, entity);
                  break;
              }
            } catch {
              // Skip failed block entities
            }
          }
        }
      }
    }

    // Calculate bounding box
    const boundingBox = this.calculateBoundingBox(segments);

    this.logger.log(
      `Extracted ${segments.length} segments, ${dimensions.length} dimensions, ` +
      `${layerSet.size} layers, unit=${unit}, hasZ=${hasZCoordinates}`,
    );

    return {
      segments,
      dimensions,
      layers: Array.from(layerSet),
      boundingBox,
      unit,
      hasZCoordinates,
      maxZ: isFinite(maxZ) ? maxZ : 0,
      minZ: isFinite(minZ) ? minZ : 0,
    };
  }

  // ── Entity extractors ──────────────────────────────────

  private extractLine(
    entity: any,
    layer: string,
    segments: DxfSegment[],
    blockRef?: any,
  ): void {
    let x1 = entity.start?.x ?? entity.vertices?.[0]?.x ?? 0;
    let y1 = entity.start?.y ?? entity.vertices?.[0]?.y ?? 0;
    let x2 = entity.end?.x ?? entity.vertices?.[1]?.x ?? 0;
    let y2 = entity.end?.y ?? entity.vertices?.[1]?.y ?? 0;

    if (blockRef) {
      [x1, y1] = this.transformBlockPoint(x1, y1, blockRef);
      [x2, y2] = this.transformBlockPoint(x2, y2, blockRef);
    }

    const length = Math.hypot(x2 - x1, y2 - y1);
    segments.push({ x1, y1, x2, y2, layer, length });
  }

  private extractPolyline(
    entity: any,
    layer: string,
    segments: DxfSegment[],
    blockRef?: any,
  ): void {
    const vertices = entity.vertices || entity.points || [];
    if (vertices.length < 2) return;

    const isClosed = entity.shape || entity.closed || false;

    for (let i = 0; i < vertices.length - 1; i++) {
      let x1 = vertices[i].x ?? vertices[i][0] ?? 0;
      let y1 = vertices[i].y ?? vertices[i][1] ?? 0;
      let x2 = vertices[i + 1].x ?? vertices[i + 1][0] ?? 0;
      let y2 = vertices[i + 1].y ?? vertices[i + 1][1] ?? 0;

      if (blockRef) {
        [x1, y1] = this.transformBlockPoint(x1, y1, blockRef);
        [x2, y2] = this.transformBlockPoint(x2, y2, blockRef);
      }

      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length > 0) {
        segments.push({ x1, y1, x2, y2, layer, length });
      }
    }

    // Close the polyline if flagged
    if (isClosed && vertices.length >= 3) {
      let x1 = vertices[vertices.length - 1].x ?? vertices[vertices.length - 1][0] ?? 0;
      let y1 = vertices[vertices.length - 1].y ?? vertices[vertices.length - 1][1] ?? 0;
      let x2 = vertices[0].x ?? vertices[0][0] ?? 0;
      let y2 = vertices[0].y ?? vertices[0][1] ?? 0;

      if (blockRef) {
        [x1, y1] = this.transformBlockPoint(x1, y1, blockRef);
        [x2, y2] = this.transformBlockPoint(x2, y2, blockRef);
      }

      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length > 0) {
        segments.push({ x1, y1, x2, y2, layer, length });
      }
    }
  }

  private extractArc(
    entity: any,
    layer: string,
    segments: DxfSegment[],
    blockRef?: any,
  ): void {
    const cx = entity.center?.x ?? 0;
    const cy = entity.center?.y ?? 0;
    const r = entity.radius ?? 0;
    let startAngle = (entity.startAngle ?? 0) * (Math.PI / 180);
    let endAngle = (entity.endAngle ?? 360) * (Math.PI / 180);

    if (r <= 0) return;

    // Ensure proper arc direction
    if (endAngle <= startAngle) {
      endAngle += 2 * Math.PI;
    }

    const totalAngle = endAngle - startAngle;
    const numSegs = Math.max(4, Math.ceil((totalAngle / (2 * Math.PI)) * this.ARC_SEGMENTS));

    for (let i = 0; i < numSegs; i++) {
      const a1 = startAngle + (totalAngle * i) / numSegs;
      const a2 = startAngle + (totalAngle * (i + 1)) / numSegs;

      let x1 = cx + r * Math.cos(a1);
      let y1 = cy + r * Math.sin(a1);
      let x2 = cx + r * Math.cos(a2);
      let y2 = cy + r * Math.sin(a2);

      if (blockRef) {
        [x1, y1] = this.transformBlockPoint(x1, y1, blockRef);
        [x2, y2] = this.transformBlockPoint(x2, y2, blockRef);
      }

      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length > 0) {
        segments.push({ x1, y1, x2, y2, layer, length });
      }
    }
  }

  private extractSpline(
    entity: any,
    layer: string,
    segments: DxfSegment[],
    blockRef?: any,
  ): void {
    // Approximate spline using control points
    const controlPoints = entity.controlPoints || entity.fitPoints || [];
    if (controlPoints.length < 2) return;

    // Simple: treat fit/control points as polyline vertices
    // For a more accurate approximation, we'd implement De Boor's algorithm
    const pts: Array<{ x: number; y: number }> = controlPoints.map((p: any) => ({
      x: p.x ?? p[0] ?? 0,
      y: p.y ?? p[1] ?? 0,
    }));

    for (let i = 0; i < pts.length - 1; i++) {
      let x1 = pts[i].x;
      let y1 = pts[i].y;
      let x2 = pts[i + 1].x;
      let y2 = pts[i + 1].y;

      if (blockRef) {
        [x1, y1] = this.transformBlockPoint(x1, y1, blockRef);
        [x2, y2] = this.transformBlockPoint(x2, y2, blockRef);
      }

      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length > 0) {
        segments.push({ x1, y1, x2, y2, layer, length });
      }
    }
  }

  private extractDimension(
    entity: any,
    layer: string,
    dimensions: DxfDimensionEntity[],
  ): void {
    const text = entity.text || entity.string || '';
    const start = {
      x: entity.defPointX ?? entity.start?.x ?? 0,
      y: entity.defPointY ?? entity.start?.y ?? 0,
    };
    const end = {
      x: entity.defPoint2X ?? entity.end?.x ?? 0,
      y: entity.defPoint2Y ?? entity.end?.y ?? 0,
    };

    // Parse dimension value from text
    let value: number | null = null;
    const numMatch = text.match(/[\d]+\.?[\d]*/);
    if (numMatch) {
      value = parseFloat(numMatch[0]);
    }

    // Determine if vertical
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const isVertical = dy > dx * 3; // Mostly vertical

    dimensions.push({ value, text, start, end, layer, isVertical });
  }

  // ── Block transform ────────────────────────────────────

  private transformBlockPoint(
    x: number,
    y: number,
    blockRef: any,
  ): [number, number] {
    const bx = blockRef.position?.x ?? blockRef.x ?? 0;
    const by = blockRef.position?.y ?? blockRef.y ?? 0;
    const scaleX = blockRef.xScale ?? blockRef.scaleX ?? 1;
    const scaleY = blockRef.yScale ?? blockRef.scaleY ?? 1;
    const rotation = (blockRef.rotation ?? 0) * (Math.PI / 180);

    // Apply scale
    let px = x * scaleX;
    let py = y * scaleY;

    // Apply rotation
    if (rotation !== 0) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      px = rx;
      py = ry;
    }

    // Apply translation
    return [px + bx, py + by];
  }

  // ── Helpers ────────────────────────────────────────────

  private detectUnit(dxf: any): 'mm' | 'cm' | 'm' {
    // $INSUNITS: 1=inches, 2=feet, 4=mm, 5=cm, 6=m
    const insunits = dxf?.header?.$INSUNITS;
    if (insunits === 4) return 'mm';
    if (insunits === 5) return 'cm';
    if (insunits === 6) return 'm';

    // $MEASUREMENT: 0=Imperial, 1=Metric
    const measurement = dxf?.header?.$MEASUREMENT;
    if (measurement === 0) return 'mm'; // Default to mm for imperial (will need conversion)

    // Default to mm for Japanese architectural drawings
    return 'mm';
  }

  private calculateBoundingBox(segments: DxfSegment[]): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    if (segments.length === 0) {
      return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const seg of segments) {
      minX = Math.min(minX, seg.x1, seg.x2);
      minY = Math.min(minY, seg.y1, seg.y2);
      maxX = Math.max(maxX, seg.x1, seg.x2);
      maxY = Math.max(maxY, seg.y1, seg.y2);
    }

    return { minX, minY, maxX, maxY };
  }
}
