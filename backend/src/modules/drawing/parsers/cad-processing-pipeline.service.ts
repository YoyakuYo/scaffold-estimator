import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CadConverterService } from './cad-converter.service';
import { DxfGeometryExtractorService, DxfExtractionResult } from './dxf-geometry-extractor.service';
import { GeometryCleanerService, GeometryCleaningResult } from './geometry-cleaner.service';
import { OuterBoundaryDetectorService, BoundaryDetectionResult } from './outer-boundary-detector.service';
import { WallSegmentExtractorService, CadExtractionResult, WallSegmentData } from './wall-segment-extractor.service';

/**
 * ═══════════════════════════════════════════════════════════
 * CAD Processing Pipeline — Professional Mode
 * ═══════════════════════════════════════════════════════════
 *
 * Complete pipeline:
 *   Upload → Validate → Convert → Parse DXF → Filter →
 *   Extract Geometry → Clean → Detect Boundary →
 *   Extract Walls → Extract Height → Return Structured Data
 *
 * All processing is deterministic — no estimation, no guessing.
 */

export interface CadProcessingResult {
  /** Whether processing was successful */
  success: boolean;
  /** Structured dimensional data */
  data: CadExtractionResult | null;
  /** Raw extraction info (for debugging) */
  extractionInfo: {
    rawSegmentCount: number;
    cleanedSegmentCount: number;
    graphNodes: number;
    graphEdges: number;
    loopsFound: number;
    outerBoundaryPoints: number;
    wallSegmentCount: number;
    unit: string;
    cleaningStats: {
      tooShort: number;
      duplicates: number;
      disconnected: number;
      merged: number;
    };
  } | null;
  /** Error message if processing failed */
  error: string | null;
}

@Injectable()
export class CadProcessingPipelineService {
  private readonly logger = new Logger(CadProcessingPipelineService.name);

  constructor(
    private readonly cadConverter: CadConverterService,
    private readonly dxfExtractor: DxfGeometryExtractorService,
    private readonly geometryCleaner: GeometryCleanerService,
    private readonly boundaryDetector: OuterBoundaryDetectorService,
    private readonly wallExtractor: WallSegmentExtractorService,
  ) {}

  /**
   * Process a CAD file through the complete pipeline.
   *
   * @param filePath Path to the uploaded file (DXF, DWG, or JWW)
   * @returns Structured dimensional data for scaffold calculation
   */
  async process(filePath: string): Promise<CadProcessingResult> {
    try {
      this.logger.log(`═══ CAD Processing Pipeline Start ═══`);
      this.logger.log(`Input: ${filePath}`);

      // ── Step 1: Convert to DXF if needed ──────────────────
      this.logger.log(`Step 1: Ensuring DXF format...`);
      const dxfPath = await this.cadConverter.ensureDxf(filePath);
      this.logger.log(`DXF path: ${dxfPath}`);

      // ── Step 2: Parse DXF entities ────────────────────────
      this.logger.log(`Step 2: Parsing DXF entities...`);
      const extraction: DxfExtractionResult = await this.dxfExtractor.extract(dxfPath);
      this.logger.log(
        `Parsed: ${extraction.segments.length} segments, ${extraction.dimensions.length} dimensions, ` +
        `unit=${extraction.unit}, hasZ=${extraction.hasZCoordinates}`,
      );

      if (extraction.segments.length === 0) {
        return {
          success: false,
          data: null,
          extractionInfo: null,
          error: 'No structural geometry found in CAD file. The file may contain only text/annotations.',
        };
      }

      // ── Step 3: Clean and normalize geometry ──────────────
      this.logger.log(`Step 3: Cleaning geometry...`);
      // Determine appropriate cleaning tolerances based on unit
      const { minLength, snapTol } = this.getCleaningTolerances(extraction);
      const cleaned: GeometryCleaningResult = this.geometryCleaner.clean(
        extraction.segments,
        minLength,
        snapTol,
      );
      this.logger.log(
        `Cleaned: ${cleaned.segments.length} segments ` +
        `(removed: ${cleaned.removedCount.tooShort} short, ` +
        `${cleaned.removedCount.duplicates} duplicates, ` +
        `${cleaned.removedCount.disconnected} disconnected, ` +
        `${cleaned.removedCount.merged} merged)`,
      );

      if (cleaned.segments.length < 3) {
        return {
          success: false,
          data: null,
          extractionInfo: null,
          error: `Insufficient geometry after cleaning (${cleaned.segments.length} segments remain). ` +
            `Need at least 3 segments to form a building outline.`,
        };
      }

      // ── Step 4: Detect outer boundary ─────────────────────
      this.logger.log(`Step 4: Detecting outer boundary...`);
      let boundaryResult: BoundaryDetectionResult;
      try {
        boundaryResult = this.boundaryDetector.detect(cleaned.segments, snapTol);
      } catch (err: any) {
        return {
          success: false,
          data: null,
          extractionInfo: {
            rawSegmentCount: extraction.segments.length,
            cleanedSegmentCount: cleaned.segments.length,
            graphNodes: 0,
            graphEdges: 0,
            loopsFound: 0,
            outerBoundaryPoints: 0,
            wallSegmentCount: 0,
            unit: extraction.unit,
            cleaningStats: cleaned.removedCount,
          },
          error: `Boundary detection failed: ${err.message}`,
        };
      }

      // ── Step 5: Extract wall segments + height ────────────
      this.logger.log(`Step 5: Extracting wall segments and height...`);
      const cadResult: CadExtractionResult = this.wallExtractor.extractWallSegments(
        boundaryResult.outerBoundary,
        extraction.dimensions,
        extraction.unit,
        extraction.hasZCoordinates,
        extraction.maxZ,
        extraction.minZ,
      );

      // ── Attach all cleaned geometry for frontend reference layer ──
      const toMm = extraction.unit === 'm' ? 1000 : extraction.unit === 'cm' ? 10 : 1;
      cadResult.allGeometry = cleaned.segments.map(seg => ({
        x1: seg.x1 * toMm,
        y1: seg.y1 * toMm,
        x2: seg.x2 * toMm,
        y2: seg.y2 * toMm,
      }));

      this.logger.log(`═══ CAD Processing Pipeline Complete ═══`);
      this.logger.log(
        `Result: ${cadResult.wallSegments.length} walls, ` +
        `perimeter=${cadResult.perimeterTotal}mm, ` +
        `height=${cadResult.buildingHeight ?? 'unknown'}mm, ` +
        `allGeometry=${cadResult.allGeometry.length} segments`,
      );

      return {
        success: true,
        data: cadResult,
        extractionInfo: {
          rawSegmentCount: extraction.segments.length,
          cleanedSegmentCount: cleaned.segments.length,
          graphNodes: boundaryResult.graph.nodes.length,
          graphEdges: boundaryResult.graph.edges.length,
          loopsFound: boundaryResult.innerLoops.length + 1,
          outerBoundaryPoints: boundaryResult.outerBoundary.points.length,
          wallSegmentCount: cadResult.wallSegments.length,
          unit: extraction.unit,
          cleaningStats: cleaned.removedCount,
        },
        error: null,
      };
    } catch (err: any) {
      this.logger.error(`CAD processing pipeline failed: ${err.message}`, err.stack);

      if (err instanceof BadRequestException) {
        throw err; // Re-throw user-facing errors
      }

      return {
        success: false,
        data: null,
        extractionInfo: null,
        error: `CAD processing failed: ${err.message}`,
      };
    }
  }

  /**
   * Determine appropriate cleaning tolerances based on unit and drawing scale.
   */
  private getCleaningTolerances(extraction: DxfExtractionResult): {
    minLength: number;
    snapTol: number;
  } {
    const { boundingBox, unit } = extraction;
    const drawingWidth = boundingBox.maxX - boundingBox.minX;
    const drawingHeight = boundingBox.maxY - boundingBox.minY;
    const maxDim = Math.max(drawingWidth, drawingHeight);

    // Adaptive tolerance: 0.1% of drawing extent, but minimum based on unit
    let snapTol: number;
    let minLength: number;

    switch (unit) {
      case 'mm':
        snapTol = Math.max(5, maxDim * 0.001); // At least 5mm
        minLength = Math.max(10, maxDim * 0.005); // At least 10mm
        break;
      case 'cm':
        snapTol = Math.max(0.5, maxDim * 0.001); // At least 0.5cm
        minLength = Math.max(1, maxDim * 0.005); // At least 1cm
        break;
      case 'm':
        snapTol = Math.max(0.005, maxDim * 0.001); // At least 5mm
        minLength = Math.max(0.01, maxDim * 0.005); // At least 1cm
        break;
      default:
        snapTol = Math.max(5, maxDim * 0.001);
        minLength = Math.max(10, maxDim * 0.005);
    }

    this.logger.log(
      `Cleaning tolerances: snap=${snapTol.toFixed(3)}, minLen=${minLength.toFixed(3)} ` +
      `(drawing extent: ${maxDim.toFixed(1)} ${unit})`,
    );

    return { minLength, snapTol };
  }
}
