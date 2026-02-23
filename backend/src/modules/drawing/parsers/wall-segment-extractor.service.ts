import { Injectable, Logger } from '@nestjs/common';
import { BoundaryLoop } from './outer-boundary-detector.service';
import { DxfDimensionEntity } from './dxf-geometry-extractor.service';

/**
 * ═══════════════════════════════════════════════════════════
 * Wall Segment Extractor — From Outer Boundary
 * ═══════════════════════════════════════════════════════════
 *
 * Traverses the ordered outer boundary and extracts:
 *   - Each consecutive wall segment with start/end coordinates
 *   - Exact length (from CAD coordinates)
 *   - Direction angle
 *   - Building height from Z-coordinates or DIMENSION entities
 */

export interface WallSegmentData {
  id: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Exact length in drawing units (usually mm) */
  length: number;
  /** Direction angle in degrees (0=East, 90=North, 180=West, 270=South) */
  angle: number;
}

export interface CadExtractionResult {
  /** Total perimeter length in drawing units */
  perimeterTotal: number;
  /** Ordered wall segments forming the outer boundary */
  wallSegments: WallSegmentData[];
  /** Building height in drawing units, or null if not found */
  buildingHeight: number | null;
  /** Message about height extraction */
  heightNote: string;
  /** Drawing unit */
  unit: 'mm' | 'cm' | 'm';
  /** All cleaned DXF geometry (for rendering as background reference layer) */
  allGeometry?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

@Injectable()
export class WallSegmentExtractorService {
  private readonly logger = new Logger(WallSegmentExtractorService.name);

  /**
   * Extract wall segments from the outer boundary loop.
   */
  extractWallSegments(
    boundary: BoundaryLoop,
    dimensions: DxfDimensionEntity[],
    unit: 'mm' | 'cm' | 'm',
    hasZCoordinates: boolean,
    maxZ: number,
    minZ: number,
  ): CadExtractionResult {
    const points = boundary.points;
    const wallSegments: WallSegmentData[] = [];
    let perimeterTotal = 0;

    this.logger.log(`Extracting wall segments from boundary with ${points.length} points`);

    for (let i = 0; i < points.length; i++) {
      const start = points[i];
      const end = points[(i + 1) % points.length];

      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);

      // Angle in degrees: 0=East(+X), 90=North(+Y), 180=West(-X), 270=South(-Y)
      let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
      if (angleDeg < 0) angleDeg += 360;

      wallSegments.push({
        id: i + 1,
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        length,
        angle: Math.round(angleDeg * 100) / 100,
      });

      perimeterTotal += length;
    }

    // ── Extract building height ────────────────────────────
    const { height, note } = this.extractBuildingHeight(
      dimensions,
      unit,
      hasZCoordinates,
      maxZ,
      minZ,
    );

    // ── Convert units to mm if needed ──────────────────────
    const toMm = this.getUnitMultiplier(unit);
    const wallSegmentsMm = wallSegments.map(seg => ({
      ...seg,
      length: Math.round(seg.length * toMm),
      start: { x: seg.start.x * toMm, y: seg.start.y * toMm },
      end: { x: seg.end.x * toMm, y: seg.end.y * toMm },
    }));
    const perimeterTotalMm = Math.round(perimeterTotal * toMm);
    const buildingHeightMm = height !== null ? Math.round(height * toMm) : null;

    this.logger.log(
      `Extracted ${wallSegmentsMm.length} wall segments, ` +
      `perimeter=${perimeterTotalMm}mm, height=${buildingHeightMm ?? 'unknown'}mm`,
    );

    return {
      perimeterTotal: perimeterTotalMm,
      wallSegments: wallSegmentsMm,
      buildingHeight: buildingHeightMm,
      heightNote: note,
      unit: 'mm', // Always return in mm
    };
  }

  // ── Building height extraction ─────────────────────────

  private extractBuildingHeight(
    dimensions: DxfDimensionEntity[],
    unit: 'mm' | 'cm' | 'm',
    hasZCoordinates: boolean,
    maxZ: number,
    minZ: number,
  ): { height: number | null; note: string } {
    // Strategy A: Z-coordinate data in 3D DXF
    if (hasZCoordinates && maxZ > minZ) {
      const zHeight = maxZ - minZ;
      if (zHeight > 0) {
        this.logger.log(`Building height from Z-coordinates: ${zHeight} ${unit}`);
        return {
          height: zHeight,
          note: `Height extracted from 3D Z-coordinates: ${zHeight}${unit} (Z range: ${minZ} to ${maxZ})`,
        };
      }
    }

    // Strategy B/C/D: Look for vertical dimension entities labeled as height
    const heightKeywords = [
      'GL', '高さ', 'height', 'H=', 'FL', '階高', '建物高',
      '軒高', '最高高さ', '棟高', 'eave', 'ridge',
    ];

    // First, look for vertical dimensions that reference height
    const verticalDims = dimensions.filter(d => d.isVertical);
    for (const dim of verticalDims) {
      const text = (dim.text || '').toUpperCase();
      if (heightKeywords.some(kw => text.includes(kw.toUpperCase()))) {
        if (dim.value && dim.value > 0) {
          this.logger.log(`Building height from dimension entity: ${dim.value} ${unit} (text: ${dim.text})`);
          return {
            height: dim.value,
            note: `Height extracted from dimension entity: ${dim.value}${unit} (label: "${dim.text}")`,
          };
        }
      }
    }

    // Check any vertical dimension with a reasonable building-height value
    for (const dim of verticalDims) {
      if (dim.value && dim.value > 0) {
        const valueMm = dim.value * this.getUnitMultiplier(unit);
        // Reasonable building height: 2500mm - 100000mm (2.5m - 100m)
        if (valueMm >= 2500 && valueMm <= 100000) {
          this.logger.log(`Building height (best guess from vertical dim): ${dim.value} ${unit}`);
          return {
            height: dim.value,
            note: `Height possibly from vertical dimension: ${dim.value}${unit}. Please verify.`,
          };
        }
      }
    }

    // No height found
    this.logger.warn('Building height not found in CAD file');
    return {
      height: null,
      note: 'Height data not found in CAD file. Please enter building height manually.',
    };
  }

  private getUnitMultiplier(unit: 'mm' | 'cm' | 'm'): number {
    switch (unit) {
      case 'mm': return 1;
      case 'cm': return 10;
      case 'm': return 1000;
      default: return 1;
    }
  }
}
