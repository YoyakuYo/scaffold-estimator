import { Injectable, Logger } from '@nestjs/common';
import * as Tesseract from 'tesseract.js';
import * as sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { BuildingOutlineDetectorService } from './building-outline-detector.service';

// ════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════

export type DrawingType = 'floor_plan' | 'section' | 'elevation' | 'unknown';
export type DimensionUnit = 'mm' | 'cm' | 'm' | 'ft_in' | 'unknown';

export interface RawDimension {
  /** Original text matched */
  rawText: string;
  /** Numeric value in its original unit */
  value: number;
  /** Secondary value (e.g. inches in feet-inches) */
  secondaryValue?: number;
  /** Detected unit */
  unit: DimensionUnit;
  /** Converted value in mm */
  valueMm: number;
  /** Whether this looks like an overall/outermost dimension */
  isOverall: boolean;
  /** Approximate position context (if any) */
  context: 'horizontal' | 'vertical' | 'unknown';
}

export interface ExtractionWarning {
  /** Warning severity */
  level: 'info' | 'warning' | 'error';
  /** Warning code for programmatic handling */
  code: 'LOW_RESOLUTION' | 'VERY_LOW_RESOLUTION' | 'LOW_OCR_CONFIDENCE' | 'NO_DIMENSIONS_FOUND' | 'FEW_DIMENSIONS_FOUND';
  /** Human-readable message (English) */
  message: string;
  /** Human-readable message (Japanese) */
  messageJa: string;
}

export interface ExtractedDimensions {
  /** Detected drawing type */
  drawingType: DrawingType;
  /** All raw dimension strings found via OCR */
  rawDimensionTexts: string[];
  /** Parsed dimension values in mm */
  parsedDimensionsMm: number[];
  /** Best-guess wall assignments */
  walls: {
    north: { lengthMm: number; heightMm: number } | null;
    south: { lengthMm: number; heightMm: number } | null;
    east: { lengthMm: number; heightMm: number } | null;
    west: { lengthMm: number; heightMm: number } | null;
  };
  /** Detected building height (if found from section views) */
  buildingHeightMm: number | null;
  /** Estimated floor count (detected from OCR text) */
  estimatedFloorCount: number;
  /** Estimated building height in mm (from floor count × typical floor height) */
  estimatedBuildingHeightMm: number | null;
  /** Detected unit system */
  detectedUnit: DimensionUnit;
  /** Confidence score 0-1 */
  confidence: number;
  /** Raw OCR text for debugging */
  ocrText: string;
  /** All parsed raw dimensions with details */
  allDimensions: RawDimension[];
  /** Number of views detected in the image */
  viewCount: number;
  /** Image resolution info */
  imageResolution: { width: number; height: number } | null;
  /** Warnings about extraction quality */
  warnings: ExtractionWarning[];
  /** Detected building outline polygon (fractional coords 0-1) */
  buildingOutline: { xFrac: number; yFrac: number }[] | null;
}

// ════════════════════════════════════════════════════════════════
// Service
// ════════════════════════════════════════════════════════════════

@Injectable()
export class ImageDimensionExtractorService {
  private readonly logger = new Logger(ImageDimensionExtractorService.name);

  /** Temporary filename hint for floor count / dimension extraction */
  private filenameHint: string = '';

  constructor(
    private readonly outlineDetector: BuildingOutlineDetectorService,
  ) {}

  /**
   * Main extraction pipeline:
   *   1. Preprocess image (enhance contrast, sharpen)
   *   2. Run OCR (Tesseract)
   *   3. Detect drawing type (plan / section / elevation)
   *   4. Parse all dimension formats
   *   5. Infer unit system
   *   6. Identify overall vs interior dimensions
   *   7. Sum grid dimensions if needed
   *   8. Assign to walls (or height for sections)
   */
  async extractDimensions(filePath: string, filenameHint?: string): Promise<ExtractedDimensions> {
    this.filenameHint = filenameHint || '';
    this.logger.log(`Starting enhanced dimension extraction for: ${filePath}`);

    const result: ExtractedDimensions = {
      drawingType: 'unknown',
      rawDimensionTexts: [],
      parsedDimensionsMm: [],
      walls: { north: null, south: null, east: null, west: null },
      buildingHeightMm: null,
      estimatedFloorCount: 1,
      estimatedBuildingHeightMm: null,
      detectedUnit: 'unknown',
      confidence: 0,
      ocrText: '',
      allDimensions: [],
      viewCount: 1,
      imageResolution: null,
      warnings: [],
      buildingOutline: null,
    };

    try {
      // ── Step 0: Check image resolution ─────────────────────
      const resolutionWarnings = await this.checkImageResolution(filePath, result);
      result.warnings.push(...resolutionWarnings);

      // ── Step 1: Preprocess image ──────────────────────────
      const preprocessedPath = await this.preprocessImage(filePath);

      // ── Step 2: Run OCR ───────────────────────────────────
      const ocrResult = await this.runOcr(preprocessedPath);
      result.ocrText = ocrResult.text;
      result.confidence = ocrResult.confidence;

      this.logger.log(
        `OCR done. Confidence: ${(result.confidence * 100).toFixed(0)}%, ` +
        `Text length: ${ocrResult.text.length} chars`,
      );

      // ── Step 3: Detect drawing type ───────────────────────
      // Include filename hint for better type detection
      const combinedText = this.filenameHint ? `${this.filenameHint}\n${ocrResult.text}` : ocrResult.text;
      result.drawingType = this.detectDrawingType(combinedText);
      this.logger.log(`Drawing type detected: ${result.drawingType}`);

      // ── Step 4: Detect multi-view ─────────────────────────
      result.viewCount = this.detectViewCount(combinedText);
      this.logger.log(`Views detected: ${result.viewCount}`);

      // ── Step 5: Parse all dimension formats ───────────────
      const rawDims = this.parseAllDimensions(ocrResult.text);
      result.allDimensions = rawDims;
      this.logger.log(`Parsed ${rawDims.length} raw dimensions`);
      if (rawDims.length > 0) {
        this.logger.log(`Dimension samples: ${rawDims.slice(0, 8).map(d => `${d.rawText}→${d.valueMm}mm(${d.unit})`).join(', ')}`);
      }

      // ── Step 6: Infer unit system ─────────────────────────
      result.detectedUnit = this.inferUnitSystem(rawDims, ocrResult.text);
      this.logger.log(`Inferred unit system: ${result.detectedUnit}`);

      // ── Step 7: Re-convert dimensions with correct unit ───
      const correctedDims = this.applyUnitCorrection(rawDims, result.detectedUnit);
      result.allDimensions = correctedDims;

      // Fill summary arrays
      for (const d of correctedDims) {
        result.rawDimensionTexts.push(d.rawText);
        result.parsedDimensionsMm.push(d.valueMm);
      }

      // ── Step 8: Identify overall dimensions ───────────────
      const overallDims = this.identifyOverallDimensions(correctedDims);
      this.logger.log(`Overall dimensions identified: ${overallDims.length}`);

      // ── Step 9: Try grid summation ────────────────────────
      const gridResult = this.tryGridSummation(correctedDims);
      if (gridResult) {
        this.logger.log(
          `Grid summation: horizontal=${gridResult.horizontalTotalMm}mm, ` +
          `vertical=${gridResult.verticalTotalMm}mm`,
        );
      }

      // ── Step 10: Assign to walls / height ─────────────────
      this.assignDimensions(result, overallDims, gridResult);

      // ── Step 11: Estimate floor count & height (for floor plans) ─
      this.estimateFloorCountAndHeight(result);

      // ── Cleanup preprocessed temp file ────────────────────
      if (preprocessedPath !== filePath) {
        try { fs.unlinkSync(preprocessedPath); } catch {}
      }

      this.logger.log(
        `Extraction complete: type=${result.drawingType}, ` +
        `unit=${result.detectedUnit}, ` +
        `dims=${result.parsedDimensionsMm.length}, ` +
        `height=${result.buildingHeightMm}mm, ` +
        `estFloors=${result.estimatedFloorCount}, ` +
        `estHeight=${result.estimatedBuildingHeightMm}mm`,
      );

      // ── Step 12: Detect building outline ────────────────────
      try {
        result.buildingOutline = await this.outlineDetector.detectOutline(filePath);
        this.logger.log(
          `Building outline: ${result.buildingOutline ? `${result.buildingOutline.length} vertices` : 'not detected'}`,
        );
      } catch (outlineErr) {
        this.logger.warn(`Outline detection failed: ${(outlineErr as Error).message}`);
      }

      // ── Step 13: Add quality warnings ──────────────────────
      this.addQualityWarnings(result);

    } catch (error) {
      this.logger.error(`Extraction failed: ${error.message}`, error.stack);
    }

    return result;
  }

  /**
   * Extract dimensions from pre-extracted text (e.g. from PDF text layer).
   * Runs the full parsing pipeline (steps 3-13) without image preprocessing or OCR.
   * This enables PDF uploads to get the same quality dimension extraction as images.
   */
  async extractDimensionsFromText(text: string, filenameHint?: string): Promise<ExtractedDimensions> {
    this.filenameHint = filenameHint || '';
    this.logger.log(`Starting dimension extraction from pre-extracted text (${text.length} chars)`);

    const result: ExtractedDimensions = {
      drawingType: 'unknown',
      rawDimensionTexts: [],
      parsedDimensionsMm: [],
      walls: { north: null, south: null, east: null, west: null },
      buildingHeightMm: null,
      estimatedFloorCount: 1,
      estimatedBuildingHeightMm: null,
      detectedUnit: 'unknown',
      confidence: 0.8, // Text extraction from PDF is generally reliable
      ocrText: text,
      allDimensions: [],
      viewCount: 1,
      imageResolution: null,
      warnings: [],
      buildingOutline: null,
    };

    try {
      // ── Step 2b: Also consider filename for drawing type + context ──
      const combinedText = this.filenameHint ? `${this.filenameHint}\n${text}` : text;

      // ── Step 3: Detect drawing type ───────────────────
      result.drawingType = this.detectDrawingType(combinedText);
      this.logger.log(`Drawing type detected: ${result.drawingType}`);

      // ── Step 4: Detect multi-view ─────────────────────
      result.viewCount = this.detectViewCount(combinedText);
      this.logger.log(`Views detected: ${result.viewCount}`);

      // ── Step 5: Parse all dimension formats ───────────
      const rawDims = this.parseAllDimensions(text);
      result.allDimensions = rawDims;
      this.logger.log(`Parsed ${rawDims.length} raw dimensions`);
      if (rawDims.length > 0) {
        this.logger.log(`Dimension samples: ${rawDims.slice(0, 8).map(d => `${d.rawText}→${d.valueMm}mm(${d.unit})`).join(', ')}`);
      }

      // ── Step 6: Infer unit system ─────────────────────
      result.detectedUnit = this.inferUnitSystem(rawDims, text);
      this.logger.log(`Inferred unit system: ${result.detectedUnit}`);

      // ── Step 7: Re-convert dimensions with correct unit ─
      const correctedDims = this.applyUnitCorrection(rawDims, result.detectedUnit);
      result.allDimensions = correctedDims;

      // Fill summary arrays
      for (const d of correctedDims) {
        result.rawDimensionTexts.push(d.rawText);
        result.parsedDimensionsMm.push(d.valueMm);
      }

      // ── Step 8: Identify overall dimensions ───────────
      const overallDims = this.identifyOverallDimensions(correctedDims);
      this.logger.log(`Overall dimensions identified: ${overallDims.length}`);

      // ── Step 9: Try grid summation ────────────────────
      const gridResult = this.tryGridSummation(correctedDims);
      if (gridResult) {
        this.logger.log(
          `Grid summation: horizontal=${gridResult.horizontalTotalMm}mm, ` +
          `vertical=${gridResult.verticalTotalMm}mm`,
        );
      }

      // ── Step 10: Assign to walls / height ─────────────
      this.assignDimensions(result, overallDims, gridResult);

      // ── Step 11: Estimate floor count & height ────────
      this.estimateFloorCountAndHeight(result);

      // ── Step 13: Add quality warnings ─────────────────
      this.addQualityWarnings(result);

      this.logger.log(
        `Text extraction complete: type=${result.drawingType}, ` +
        `unit=${result.detectedUnit}, ` +
        `dims=${result.parsedDimensionsMm.length}, ` +
        `height=${result.buildingHeightMm}mm, ` +
        `estFloors=${result.estimatedFloorCount}, ` +
        `estHeight=${result.estimatedBuildingHeightMm}mm`,
      );
    } catch (error) {
      this.logger.error(`Text dimension extraction failed: ${error.message}`, error.stack);
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 1: IMAGE PREPROCESSING
  // ══════════════════════════════════════════════════════════════

  private async preprocessImage(filePath: string): Promise<string> {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const outPath = filePath.replace(ext, `_ocr_prep.png`);

      // Check source resolution for adaptive processing
      const metadata = await (sharp as any)(filePath).metadata();
      const srcWidth = metadata.width || 0;
      const srcHeight = metadata.height || 0;
      const maxSrcDim = Math.max(srcWidth, srcHeight);

      // Moderate upscale: 2000px is optimal for Tesseract OCR.
      // Going beyond 2000px only enlarges noise and is very slow.
      // For images already >= 2000px, no resize needed.
      const targetSize = maxSrcDim < 1000 ? 2000 : maxSrcDim < 2000 ? 2500 : 3000;
      const sharpenSigma = maxSrcDim < 800 ? 1.5 : 1.0;
      const needsResize = maxSrcDim < targetSize;

      this.logger.log(`Preprocessing: ${srcWidth}×${srcHeight}px → target ${targetSize}px (resize=${needsResize}), sharpen σ=${sharpenSigma}`);

      let pipeline = (sharp as any)(filePath)
        // Normalize to grayscale
        .grayscale()
        // Increase contrast
        .normalize()
        // Sharpen for text clarity
        .sharpen({ sigma: sharpenSigma });

      // Only resize if the image actually needs upscaling
      if (needsResize) {
        pipeline = pipeline.resize({
          width: targetSize,
          height: targetSize,
          fit: 'inside',
          withoutEnlargement: false,
          kernel: 'lanczos2',
        });
      }

      // Output as high-quality PNG (better for OCR than JPEG)
      await pipeline.png({ quality: 100 }).toFile(outPath);

      this.logger.log(`Image preprocessed: ${outPath}`);
      return outPath;
    } catch (error) {
      this.logger.warn(`Image preprocessing failed, using original: ${error.message}`);
      return filePath;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 2: OCR
  // ══════════════════════════════════════════════════════════════

  private async runOcr(filePath: string): Promise<{ text: string; confidence: number }> {
    const ocrResult = await Tesseract.recognize(filePath, 'eng', {
      logger: (m: any) => {
        if (m.status === 'recognizing text' && m.progress % 0.25 < 0.01) {
          this.logger.debug(`OCR: ${(m.progress * 100).toFixed(0)}%`);
        }
      },
    });

    return {
      text: ocrResult.data.text,
      confidence: ocrResult.data.confidence / 100,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 3: DRAWING TYPE DETECTION
  // ══════════════════════════════════════════════════════════════

  private detectDrawingType(text: string): DrawingType {
    const lower = text.toLowerCase();

    // Section indicators
    const sectionKeywords = [
      'section', 'セクション', '断面', '断面図', 'cross section',
      'dpc', 'lintel', 'foundation',
      'concrete cavity', 'floor level', 'ceiling',
      'rafter', 'truss', 'ridge', 'eave',
      'concrete fill', 'cavity fill', 'damp proof',
      'footing', 'slab', 'beam',
    ];

    // Elevation indicators (expanded with more patterns)
    const elevationKeywords = [
      'elevation', '立面', '立面図', 'front elevation', 'side elevation',
      'rear elevation', 'north elevation', 'south elevation',
      'east elevation', 'west elevation',
      'elevation design', 'elevation view',
      'front view', 'side view', 'rear view',
    ];

    // Floor plan indicators (reduced weight for generic words)
    const planKeywords = [
      'floor plan', 'ground floor plan',
      '平面図', '間取り', '配置図',
      'kitchen', 'bedroom', 'bathroom', 'living', 'dining',
      'toilet', 'bath', 'hall', 'lobby', 'foyer',
      'car park', 'garage', 'porch', 'deck', 'lanai', 'covered porch',
      'lease space', 'sitout', 'drawing room',
      'master bedroom', 'bed', 'store', 'office', 'pantry',
      'ground floor', 'first floor', 'second floor',
      'great room', 'wic', 'walk-in', 'closet',
    ];

    // Check for section-specific patterns (height dimensions on sides)
    const hasVerticalDimLabels = /\b(FL|RL|FFL|SSL|DPC)\b/i.test(text);
    const hasRoofDetail = /\b(roof|ridge|eave|rafter|truss|lintels?)\b/i.test(lower);

    let sectionScore = 0;
    let planScore = 0;
    let elevationScore = 0;

    for (const kw of sectionKeywords) {
      if (lower.includes(kw)) sectionScore += 2;
    }
    for (const kw of elevationKeywords) {
      if (lower.includes(kw)) elevationScore += 2;
    }
    for (const kw of planKeywords) {
      if (lower.includes(kw)) planScore += 2;
    }

    if (hasVerticalDimLabels) sectionScore += 3;
    if (hasRoofDetail) sectionScore += 2;

    // "SECTION" as a title is a strong indicator
    if (/\bSECTION\b/.test(text)) sectionScore += 5;
    // Only give strong plan score for explicit "PLAN" title, not generic "plan" in text
    if (/\bFLOOR\s+PLAN\b/i.test(text)) planScore += 5;
    if (/\bPLAN\b/.test(text) && !/elevation/i.test(text)) planScore += 3;
    // Strong elevation indicators
    if (/\bELEVATION\b/i.test(text)) elevationScore += 8;
    if (/elevation\s+design/i.test(text)) elevationScore += 10;
    // "N floors" or "N story" patterns strongly suggest elevation/section context
    if (/\b\d+\s*(floors?|stor(?:ey|y|ies))\b/i.test(text)) elevationScore += 3;

    this.logger.debug(
      `Type scores — plan: ${planScore}, section: ${sectionScore}, elevation: ${elevationScore}`,
    );

    if (sectionScore > planScore && sectionScore > elevationScore) return 'section';
    if (elevationScore > planScore && elevationScore > sectionScore) return 'elevation';
    if (elevationScore > 0 && elevationScore >= planScore) return 'elevation';
    if (planScore > 0) return 'floor_plan';

    return 'floor_plan'; // default assumption
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 4: MULTI-VIEW DETECTION
  // ══════════════════════════════════════════════════════════════

  private detectViewCount(text: string): number {
    const lower = text.toLowerCase();
    let count = 0;

    // Look for distinct labeled views: "Floor Plan", "Section A-A", "Elevation 1", etc.
    // Only count explicit view LABELS, not every occurrence of the word "plan" or "elevation"
    const viewLabels = lower.match(/\b(floor\s+plan|ground\s+floor\s+plan|first\s+floor\s+plan|section\s+[a-z]-[a-z]|elevation\s+\d|front\s+elevation|side\s+elevation|rear\s+elevation|north\s+elevation|south\s+elevation|east\s+elevation|west\s+elevation)\b/gi);
    if (viewLabels) {
      // Deduplicate
      const unique = new Set(viewLabels.map(l => l.toLowerCase().trim()));
      count = unique.size;
    }

    // Look for "ground floor", "first floor", etc. as separate views
    const floorMatches = lower.match(/\b(ground|first|second|third|basement)\s+(floor|level)\b/gi);
    if (floorMatches) {
      const uniqueFloors = new Set(floorMatches.map(f => f.toLowerCase().trim()));
      count = Math.max(count, uniqueFloors.size);
    }

    // Cap at a reasonable maximum (most drawings have 1-6 views)
    return Math.max(1, Math.min(count, 8));
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 5: PARSE ALL DIMENSION FORMATS
  // ══════════════════════════════════════════════════════════════

  private parseAllDimensions(text: string): RawDimension[] {
    const dims: RawDimension[] = [];
    const seen = new Set<string>(); // deduplicate

    // Log first 500 chars of raw OCR text for debugging
    this.logger.debug(`Raw OCR text (first 500 chars): ${text.substring(0, 500).replace(/\n/g, '\\n')}`);
    this.logger.debug(`Raw OCR text (last 500 chars): ${text.substring(Math.max(0, text.length - 500)).replace(/\n/g, '\\n')}`);

    // ── Format 1: Feet-inches  53'-9", 22'-1", 15'-5½" ─────
    // Very flexible regex to handle OCR artifacts:
    //   - Various apostrophe/prime chars: ' ' ′ ` ʼ
    //   - Various dash chars: - – — ~ (or no dash)
    //   - Various quote/double-prime chars: " " ″ '' ``
    //   - Fractional inches: ½ ¼ ¾ or OCR misreadings
    //   - OCR may misread ' as | l 1 or " as ll
    //   - Spaces may appear between digits and symbols
    const feetInchRegex = /(\d{1,4})\s*[''′`ʼ\|]\s*[-–—~]?\s*(\d{1,2})\s*(?:[""″''`]{0,2})\s*([½¼¾⅛⅜⅝⅞])?/g;
    let match: RegExpExecArray | null;
    while ((match = feetInchRegex.exec(text)) !== null) {
      const feet = parseInt(match[1], 10);
      const inches = parseInt(match[2], 10);
      if (feet < 1 || feet > 1000 || inches > 11) continue;
      
      // Handle fractional inches
      let fracInches = 0;
      if (match[3]) {
        const fracMap: Record<string, number> = {
          '½': 0.5, '¼': 0.25, '¾': 0.75,
          '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
        };
        fracInches = fracMap[match[3]] || 0;
      }
      
      const mm = Math.round(feet * 304.8 + (inches + fracInches) * 25.4);
      const key = `ft_${feet}_${inches}_${fracInches}`;
      if (seen.has(key)) continue;
      seen.add(key);

      dims.push({
        rawText: `${feet}'-${inches}${fracInches ? match[3] : ''}"`,
        value: feet,
        secondaryValue: inches + fracInches,
        unit: 'ft_in',
        valueMm: mm,
        isOverall: false,
        context: 'unknown',
      });
    }

    // ── Format 1b: Feet-inches with dash separator  53-9, 22-1 ──
    // Some OCR outputs strip the apostrophe/quote entirely
    // Match patterns like "53-9" or "22-1" that look like feet-inches
    // Only match if we already found some ft_in or if the text has imperial hints
    const hasImperialHints = /[''′`]/.test(text) || dims.some(d => d.unit === 'ft_in');
    if (hasImperialHints) {
      const dashFtInRegex = /(?<![.\d])(\d{1,3})\s*[-–—]\s*(\d{1,2})(?:\s*([½¼¾⅛⅜⅝⅞]))?(?![.\d])/g;
      while ((match = dashFtInRegex.exec(text)) !== null) {
        const feet = parseInt(match[1], 10);
        const inches = parseInt(match[2], 10);
        if (feet < 1 || feet > 200 || inches > 11) continue;
        // Avoid matching things like "23 X 14" room dimensions
        const beforeChar = match.index > 0 ? text[match.index - 1] : '';
        const afterChar = match.index + match[0].length < text.length ? text[match.index + match[0].length] : '';
        if (/[xX×]/.test(beforeChar) || /[xX×]/.test(afterChar)) continue;
        
        let fracInches = 0;
        if (match[3]) {
          const fracMap: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
          fracInches = fracMap[match[3]] || 0;
        }

        const mm = Math.round(feet * 304.8 + (inches + fracInches) * 25.4);
        const key = `ft_${feet}_${inches}_${fracInches}`;
        if (seen.has(key)) continue;
        seen.add(key);

        dims.push({
          rawText: `${feet}'-${inches}${fracInches ? match[3] : ''}"`,
          value: feet,
          secondaryValue: inches + fracInches,
          unit: 'ft_in',
          valueMm: mm,
          isOverall: false,
          context: 'unknown',
        });
      }
    }

    // ── Format 1c: Room dimensions like "23 X 14.5'" or "12 X 12" (ft) ──
    // Common in US floor plans — room labels with "X" or "x"
    const roomDimRegex = /(\d{1,3}(?:\.\d)?)\s*[xX×]\s*(\d{1,3}(?:\.\d)?)\s*[''′]?/g;
    while ((match = roomDimRegex.exec(text)) !== null) {
      const dim1 = parseFloat(match[1]);
      const dim2 = parseFloat(match[2]);
      // Only consider if both values are reasonable room sizes in feet (4-60 ft)
      if (dim1 < 4 || dim1 > 60 || dim2 < 4 || dim2 > 60) continue;
      // These are room dimensions — useful as imperial context hint, but not
      // overall building dimensions, so we skip adding them
    }

    // ── Format 1d: Decimal numbers that look like feet.inches ──────
    // OCR often garbles 53'-9" → 53.9, 22'-1" → 22.1, 15'-5" → 15.5
    // Detect patterns like XX.Y where Y is 0-11 and X is a reasonable footage
    // Only apply if text already has imperial hints (room dims with X, apostrophes, etc.)
    const imperialHints = /[xX×]\s*\d{1,2}[.\s]?\d?[''′]?|[''′`]|\b(bedroom|kitchen|bath|porch|office|lanai|room)\b/i.test(text);
    if (imperialHints || dims.some(d => d.unit === 'ft_in')) {
      this.logger.log(`Imperial hints detected — trying decimal-as-feet.inches recovery`);
      const decFtRegex = /(?<![.\d])(\d{1,3})\.(\d{1,2})(?!\d)(?!\s*(?:mm|cm|m\b|%|px))/g;
      while ((match = decFtRegex.exec(text)) !== null) {
        const feet = parseInt(match[1], 10);
        const inches = parseInt(match[2], 10);
        // Only match if inches part is 0-11 (valid inches) and feet is reasonable (4-200)
        if (feet < 4 || feet > 200 || inches > 11) continue;
        
        // Skip if this appears near room labels or room dimension patterns
        const beforeText = text.substring(Math.max(0, match.index - 50), match.index);
        const afterText = text.substring(match.index + match[0].length, Math.min(text.length, match.index + match[0].length + 50));
        const context = (beforeText + ' ' + afterText).toLowerCase();
        
        // Skip if near room labels
        const roomKeywords = ['kitchen', 'bedroom', 'bath', 'lanai', 'porch', 'office', 'dining', 'great room', 'master'];
        if (roomKeywords.some(kw => context.includes(kw))) {
          this.logger.debug(`Skipping decimal near room label: ${match[0]}`);
          continue;
        }
        
        // Skip if this looks like a percentage or scale factor
        if (/^\s*[%xX×]/.test(afterText)) continue;
        
        // Skip if appears in "X Y" pattern (room dimensions like "54 X 12.5")
        if (/[xX×]\s*\d/.test(beforeText) || /[xX×]\s*\d/.test(afterText)) {
          this.logger.debug(`Skipping decimal in room dimension pattern: ${match[0]}`);
          continue;
        }
        
        // Skip very small values that are probably not building dimensions
        const mm = Math.round(feet * 304.8 + inches * 25.4);
        // For outer scaffolding, only accept dimensions >= 3000mm (10ft)
        if (mm < 3000) {
          this.logger.debug(`Skipping small dimension: ${match[0]} = ${mm}mm`);
          continue;
        }
        
        const key = `ft_${feet}_${inches}_0`;
        if (seen.has(key)) continue;
        seen.add(key);

        this.logger.debug(`Recovered feet-inches from decimal: ${match[0]} → ${feet}'-${inches}" = ${mm}mm`);
        dims.push({
          rawText: `${feet}'-${inches}"`,
          value: feet,
          secondaryValue: inches,
          unit: 'ft_in',
          valueMm: mm,
          isOverall: false,
          context: 'unknown',
        });
      }
    }

    // ── Format 2: Explicit mm  15000mm, 8000 mm ────────────
    const mmRegex = /(\d{3,6})\s*mm\b/gi;
    while ((match = mmRegex.exec(text)) !== null) {
      const val = parseInt(match[1], 10);
      if (val < 50 || val > 500000) continue;
      const key = `mm_${val}`;
      if (seen.has(key)) continue;
      seen.add(key);

      dims.push({
        rawText: `${val}mm`,
        value: val,
        unit: 'mm',
        valueMm: val,
        isOverall: false,
        context: 'unknown',
      });
    }

    // ── Format 3: Explicit cm  250cm, 150 cm ───────────────
    const cmRegex = /(\d{2,5})\s*cm\b/gi;
    while ((match = cmRegex.exec(text)) !== null) {
      const val = parseInt(match[1], 10);
      const mm = val * 10;
      if (mm < 100 || mm > 500000) continue;
      const key = `cm_${val}`;
      if (seen.has(key)) continue;
      seen.add(key);

      dims.push({
        rawText: `${val}cm`,
        value: val,
        unit: 'cm',
        valueMm: mm,
        isOverall: false,
        context: 'unknown',
      });
    }

    // ── Format 4: Explicit meters  65.5m, 37.2m ────────────
    const mRegex = /(\d{1,3}(?:[.,]\d{1,2})?)\s*m\b(?!m|²|2)/gi;
    while ((match = mRegex.exec(text)) !== null) {
      const val = parseFloat(match[1].replace(',', '.'));
      const mm = Math.round(val * 1000);
      if (mm < 500 || mm > 500000) continue;
      const key = `m_${val}`;
      if (seen.has(key)) continue;
      seen.add(key);

      dims.push({
        rawText: `${val}m`,
        value: val,
        unit: 'm',
        valueMm: mm,
        isOverall: false,
        context: 'unknown',
      });
    }

    // ── Format 5: Decimal numbers (likely meters)  5.80, 14.40 ─
    //    Matches numbers like 5.80, 14.40, 6.00 that are common
    //    in metric drawings without a unit suffix
    //    BUT exclude floor level annotations like "FL: 10.20" or "10.20m" when near "FL"
    const decimalRegex = /(?<![.\d])(\d{1,3})[.,](\d{2})(?!\d)(?!\s*m[m²])/g;
    while ((match = decimalRegex.exec(text)) !== null) {
      const whole = parseInt(match[1], 10);
      const frac = parseInt(match[2], 10);
      const val = whole + frac / 100;
      
      // Filter: likely a dimension if 0.50–200.00 range
      if (val < 0.5 || val > 200) continue;
      // Skip if looks like a year or page number
      if (whole >= 19 && whole <= 20 && frac >= 0 && frac <= 99) continue; // e.g. 19.95, 20.26
      
      // Check if this is a floor level annotation (FL: 10.20, FL 10.00, etc.)
      const beforeMatch = text.substring(Math.max(0, match.index - 20), match.index);
      const afterMatch = text.substring(match.index + match[0].length, Math.min(text.length, match.index + match[0].length + 20));
      const context = (beforeMatch + ' ' + afterMatch).toLowerCase();
      
      // Skip if it's clearly a floor level (FL, FFL, RL, etc.)
      if (/\b(fl|ffl|rl|ssl|dpc|level|lvl)\s*[:\s]*\d{1,3}[.,]\d{2}/i.test(context) ||
          /\d{1,3}[.,]\d{2}\s*(m\b|メートル)/.test(context)) {
        // Only skip if it's in a floor level context, not if it's a dimension
        if (context.includes('fl') || context.includes('level') || context.includes('ffl')) {
          continue;
        }
      }
      
      const key = `dec_${whole}_${frac}`;
      if (seen.has(key)) continue;
      seen.add(key);

      dims.push({
        rawText: `${whole}.${match[2]}`,
        value: val,
        unit: 'unknown', // will be inferred later
        valueMm: 0, // will be set after unit inference
        isOverall: false,
        context: 'unknown',
      });
    }

    // ── Format 6: Plain integers (3-5 digits)  9900, 4150, 1072 ─
    //    Only match numbers not already caught by explicit unit patterns
    const plainIntRegex = /(?<![.\d,])(\d{3,6})(?![.\d,]|\s*(?:mm|cm|m\b|M2|m2|kg|N))/g;
    while ((match = plainIntRegex.exec(text)) !== null) {
      const val = parseInt(match[1], 10);
      // Skip small numbers (<50), timestamps, years, etc.
      if (val < 50 || val > 500000) continue;
      if (val >= 1900 && val <= 2100) continue; // years
      if (val >= 100000 && val <= 999999) continue; // 6-digit likely not dimension

      const key = `int_${val}`;
      if (seen.has(key)) continue;
      seen.add(key);

      dims.push({
        rawText: `${val}`,
        value: val,
        unit: 'unknown', // will be inferred
        valueMm: 0, // will be set after unit inference
        isOverall: false,
        context: 'unknown',
      });
    }

    return dims;
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 6: UNIT INFERENCE
  // ══════════════════════════════════════════════════════════════

  /**
   * Smart unit inference based on the collection of dimensions found.
   *
   * Heuristics:
   *   - If we have explicit mm/cm/m/ft_in dimensions → use that
   *   - If all plain integers are 3-4 digits (100-9999):
   *       • If most are >2000 → likely mm (e.g., 4150, 9900)
   *       • If most are 100-1500 → likely cm (e.g., 1072, 944)
   *   - If we have decimal numbers like 5.80, 14.40 → likely meters
   *   - Look for area mentions "M2" or "m²" → metric system
   *   - Look for text like "mm" or "DP 50mm" → mm system
   */
  private inferUnitSystem(dims: RawDimension[], text: string): DimensionUnit {
    // Count explicit units
    const unitCounts: Record<DimensionUnit, number> = {
      mm: 0, cm: 0, m: 0, ft_in: 0, unknown: 0,
    };
    for (const d of dims) {
      unitCounts[d.unit]++;
    }

    // If we have feet-inches, that dominates
    if (unitCounts.ft_in >= 2) return 'ft_in';

    // If explicit mm/cm/m found, use majority
    if (unitCounts.mm >= 2) return 'mm';
    if (unitCounts.cm >= 2) return 'cm';
    if (unitCounts.m >= 2) return 'm';

    // Look for unit hints in text
    const lower = text.toLowerCase();
    if (/\b\d+\s*mm\b/i.test(text)) return 'mm'; // e.g., "DP 50mm"
    if (/\b\d+\s*cm\b/i.test(text)) return 'cm';

    // Check for decimal dimensions (5.80, 14.40) → likely meters
    const decimalDims = dims.filter(d => d.unit === 'unknown' && d.rawText.includes('.'));
    const integerDims = dims.filter(d => d.unit === 'unknown' && !d.rawText.includes('.'));

    if (decimalDims.length >= 3 && decimalDims.length > integerDims.length) {
      // Many decimal numbers → likely meters
      return 'm';
    }

    // For plain integers, analyze value ranges
    if (integerDims.length >= 2) {
      const values = integerDims.map(d => d.value);
      const maxVal = Math.max(...values);
      const medianVal = values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

      // If largest value is > 5000, likely mm (e.g., 9900mm, 15000mm)
      if (maxVal > 5000) return 'mm';

      // If values are mostly in 100-2000 range, could be cm
      // Key heuristic: if most values are 3-4 digits and max < 3000
      if (maxVal < 3000 && medianVal < 1500) {
        // Check if interpreting as cm gives reasonable building sizes
        const maxAsCm = maxVal * 10; // convert to mm
        if (maxAsCm >= 3000 && maxAsCm <= 50000) {
          return 'cm';
        }
      }

      // If values are mostly in 1000-50000 range → mm
      if (maxVal >= 1000 && maxVal <= 50000) return 'mm';
    }

    // Check for M2 / m² area label → metric
    if (/\bm[²2]\b/i.test(text) || /\bM2\b/.test(text)) {
      // Metric system, but which unit?
      if (integerDims.length > 0) {
        const maxVal = Math.max(...integerDims.map(d => d.value));
        if (maxVal > 3000) return 'mm';
        return 'cm';
      }
      return 'mm';
    }

    // Default
    return 'mm';
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 7: APPLY UNIT CORRECTION
  // ══════════════════════════════════════════════════════════════

  private applyUnitCorrection(dims: RawDimension[], inferredUnit: DimensionUnit): RawDimension[] {
    return dims.map(d => {
      if (d.unit !== 'unknown') return d; // already has explicit unit

      const corrected = { ...d };

      if (d.rawText.includes('.')) {
        // Decimal number
        switch (inferredUnit) {
          case 'm':
            corrected.unit = 'm';
            corrected.valueMm = Math.round(d.value * 1000);
            break;
          case 'cm':
            corrected.unit = 'cm';
            corrected.valueMm = Math.round(d.value * 10);
            break;
          case 'mm':
            corrected.unit = 'mm';
            corrected.valueMm = Math.round(d.value);
            break;
          default:
            // Default: assume meters for decimals
            corrected.unit = 'm';
            corrected.valueMm = Math.round(d.value * 1000);
        }
      } else {
        // Integer number
        switch (inferredUnit) {
          case 'mm':
            corrected.unit = 'mm';
            corrected.valueMm = d.value;
            break;
          case 'cm':
            corrected.unit = 'cm';
            corrected.valueMm = d.value * 10;
            break;
          case 'm':
            // Integer + meters: assume mm actually (plain integers are usually mm)
            corrected.unit = 'mm';
            corrected.valueMm = d.value;
            break;
          case 'ft_in':
            // Plain integer in a ft/in drawing → assume inches
            corrected.unit = 'mm';
            corrected.valueMm = Math.round(d.value * 25.4);
            break;
          default:
            corrected.unit = 'mm';
            corrected.valueMm = d.value;
        }
      }

      return corrected;
    }).filter(d => d.valueMm >= 100 && d.valueMm <= 500000); // reasonable range only
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 8: IDENTIFY OVERALL DIMENSIONS
  // ══════════════════════════════════════════════════════════════

  /**
   * Identify which dimensions are likely the overall building dimensions
   * vs interior room dimensions.
   *
   * Strategy:
   *   - Sort by size descending
   *   - The 2 largest dimensions that are unique are likely overall (width × depth)
   *   - If a dimension equals the sum of smaller sequential dimensions, it's overall
   *   - For section views, the tallest dimension is the building height
   *   - For multi-segment walls, look for dimensions that sum to a larger total
   */
  private identifyOverallDimensions(dims: RawDimension[]): RawDimension[] {
    if (dims.length === 0) return [];

    // Get unique values sorted desc
    const uniqueMm = [...new Set(dims.map(d => d.valueMm))].sort((a, b) => b - a);

    // Mark the largest 2 distinct values as "overall" candidates
    const overallCandidates: RawDimension[] = [];

    for (const d of dims) {
      if (uniqueMm.indexOf(d.valueMm) < 2) {
        d.isOverall = true;
        overallCandidates.push(d);
      }
    }

    // Check: does any large dimension equal a sum of smaller sequential ones?
    // This handles both simple cases (2 segments) and complex cases (3+ segments)
    for (const large of uniqueMm.slice(0, 5)) { // Check top 5 largest
      const smaller = uniqueMm.filter(v => v < large && v > large * 0.05);
      
      // Try pairs
      for (let i = 0; i < smaller.length; i++) {
        for (let j = i + 1; j < smaller.length; j++) {
          const sum = smaller[i] + smaller[j];
          if (Math.abs(sum - large) < large * 0.03) {
            // This large dim is a sum → it's definitely an overall dimension
            const matching = dims.find(d => d.valueMm === large);
            if (matching) matching.isOverall = true;
          }
        }
      }
      
      // Try triple sums (for L-shaped or 3-segment walls)
      for (let i = 0; i < smaller.length; i++) {
        for (let j = i + 1; j < smaller.length; j++) {
          for (let k = j + 1; k < smaller.length; k++) {
            const sum = smaller[i] + smaller[j] + smaller[k];
            if (Math.abs(sum - large) < large * 0.03) {
              const matching = dims.find(d => d.valueMm === large);
              if (matching) matching.isOverall = true;
            }
          }
        }
      }
      
      // Try quadruple sums (for complex multi-segment walls)
      for (let i = 0; i < smaller.length; i++) {
        for (let j = i + 1; j < smaller.length; j++) {
          for (let k = j + 1; k < smaller.length; k++) {
            for (let l = k + 1; l < smaller.length; l++) {
              const sum = smaller[i] + smaller[j] + smaller[k] + smaller[l];
              if (Math.abs(sum - large) < large * 0.03) {
                const matching = dims.find(d => d.valueMm === large);
                if (matching) matching.isOverall = true;
              }
            }
          }
        }
      }
    }

    return dims.filter(d => d.isOverall);
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 9: GRID DIMENSION SUMMATION
  // ══════════════════════════════════════════════════════════════

  /**
   * In many architectural drawings, overall dimensions are shown as
   * grid-line spacing that must be summed:
   *   e.g., 5.80 + 5.40 + 6.40 + 5.10 = 22.70m
   *
   * Strategy:
   *   - Group dimensions by likely direction (horizontal / vertical)
   *   - If multiple dimensions of similar magnitude appear, try summing them
   *   - Compare sum against any detected overall dimension
   *   - Handle multi-segment walls by summing all segments in each direction
   */
  private tryGridSummation(
    dims: RawDimension[],
  ): { horizontalTotalMm: number; verticalTotalMm: number } | null {
    if (dims.length < 3) return null;

    // Get all non-overall dimensions sorted by size
    const interiorDims = dims
      .filter(d => !d.isOverall && d.valueMm > 500)
      .map(d => d.valueMm)
      .sort((a, b) => b - a);

    if (interiorDims.length < 3) return null;

    // Find the largest dimension (potential overall)
    const overallDims = dims
      .filter(d => d.isOverall)
      .map(d => d.valueMm)
      .sort((a, b) => b - a);

    // Try to find subsets of interior dims that sum to an overall dim
    // For multi-segment walls, we want to sum ALL segments, not just top N
    const allInteriorDims = interiorDims.filter(d => d >= 1000 && d <= 200000);

    // Find two groups: one for horizontal, one for vertical
    // Heuristic: look for similar-magnitude dimensions
    const groups = this.clusterDimensions(allInteriorDims.slice(0, 20)); // Check more dimensions

    if (groups.length >= 2) {
      // Sum all segments in each group (for multi-segment walls)
      const g1Sum = this.sumWallSegments(groups[0]);
      const g2Sum = this.sumWallSegments(groups[1]);
      
      // Return larger as horizontal, smaller as vertical
      return {
        horizontalTotalMm: Math.max(g1Sum, g2Sum),
        verticalTotalMm: Math.min(g1Sum, g2Sum),
      };
    } else if (groups.length === 1) {
      // Only one group - might be all horizontal or all vertical
      // Try to split it into two groups
      const sorted = [...groups[0]].sort((a, b) => b - a);
      const mid = Math.floor(sorted.length / 2);
      const g1 = sorted.slice(0, mid);
      const g2 = sorted.slice(mid);
      
      if (g1.length > 0 && g2.length > 0) {
        const g1Sum = this.sumWallSegments(g1);
        const g2Sum = this.sumWallSegments(g2);
        return {
          horizontalTotalMm: Math.max(g1Sum, g2Sum),
          verticalTotalMm: Math.min(g1Sum, g2Sum),
        };
      }
    }

    // If we found overall dims, use those instead
    if (overallDims.length >= 2) {
      return {
        horizontalTotalMm: overallDims[0],
        verticalTotalMm: overallDims[1],
      };
    }

    // Fallback: sum all reasonable interior dimensions as potential totals
    const totalSum = this.sumWallSegments(allInteriorDims);
    if (totalSum > 0 && allInteriorDims.length >= 2) {
      // Split into two groups by value
      const sorted = [...allInteriorDims].sort((a, b) => b - a);
      const mid = Math.floor(sorted.length / 2);
      return {
        horizontalTotalMm: this.sumWallSegments(sorted.slice(0, mid)),
        verticalTotalMm: this.sumWallSegments(sorted.slice(mid)),
      };
    }

    return null;
  }

  /**
   * Simple clustering: group dimensions that are within 30% of each other's
   * average into one cluster, remaining into another.
   */
  private clusterDimensions(values: number[]): number[][] {
    if (values.length < 2) return [values];

    // K-means-ish with k=2
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];

    const group1 = values.filter(v => v >= mid);
    const group2 = values.filter(v => v < mid);

    if (group1.length === 0 || group2.length === 0) return [values];
    return [group1, group2];
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER: CLASSIFY DIMENSIONS BY CONTEXT
  // ══════════════════════════════════════════════════════════════

  /**
   * Classify dimensions as horizontal or vertical based on context clues.
   * This helps identify wall segments and building height.
   */
  private classifyDimensionsByContext(
    dims: RawDimension[],
    ocrText: string,
  ): { horizontal: RawDimension[]; vertical: RawDimension[] } {
    const horizontal: RawDimension[] = [];
    const vertical: RawDimension[] = [];

    const text = ocrText.toLowerCase();

    for (const dim of dims) {
      // Check if dimension has context hint
      if (dim.context === 'horizontal') {
        horizontal.push(dim);
      } else if (dim.context === 'vertical') {
        vertical.push(dim);
      } else {
        // Try to infer from value ranges
        // Very large dimensions (>15000mm) are often overall building dimensions
        // Medium dimensions (3000-12000mm) could be either
        // Small dimensions (<3000mm) are often interior/room dimensions

        // Heuristic: if dimension is in a reasonable range for wall length or height
        if (dim.valueMm >= 1000 && dim.valueMm <= 200000) {
          // Default: assume horizontal for floor plans, vertical for sections
          // This will be refined by the calling code
          horizontal.push(dim);
        }
      }
    }

    return { horizontal, vertical };
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER: EXTRACT EXPLICIT HEIGHT
  // ══════════════════════════════════════════════════════════════

  /**
   * Extract explicit building height from text patterns like:
   * - "Height: 10.2m"
   * - "H=10200mm"
   * - "高さ: 10.2m"
   * - "建物高: 10200"
   */
  private extractExplicitHeight(text: string, detectedUnit: DimensionUnit): number | null {
    const lower = text.toLowerCase();

    // Pattern 1: "Height:" or "H:" followed by number
    const heightPattern1 = /(?:height|h|高さ|建物高)[:\s=]+(\d{1,4}(?:[.,]\d{1,2})?)\s*(mm|cm|m|メートル)?/gi;
    let match: RegExpExecArray | null;
    while ((match = heightPattern1.exec(text)) !== null) {
      const value = parseFloat(match[1].replace(',', '.'));
      const unit = match[2]?.toLowerCase() || detectedUnit;
      
      let heightMm = 0;
      if (unit === 'mm' || (!unit && detectedUnit === 'mm')) {
        heightMm = Math.round(value);
      } else if (unit === 'cm' || (!unit && detectedUnit === 'cm')) {
        heightMm = Math.round(value * 10);
      } else if (unit === 'm' || unit === 'メートル' || (!unit && detectedUnit === 'm')) {
        heightMm = Math.round(value * 1000);
      } else if (unit === 'ft_in' || detectedUnit === 'ft_in') {
        heightMm = Math.round(value * 304.8); // Assume feet
      }

      if (heightMm >= 2000 && heightMm <= 50000) {
        return heightMm;
      }
    }

    // Pattern 2: Large vertical dimensions that are likely building height
    // Look for dimensions in section/elevation context
    if (lower.includes('section') || lower.includes('elevation') || lower.includes('断面')) {
      // Extract largest reasonable dimension (likely height)
      const dimPattern = /(\d{4,6})\s*(mm|cm|m)?/g;
      const candidates: number[] = [];
      
      while ((match = dimPattern.exec(text)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2]?.toLowerCase() || detectedUnit;
        
        let heightMm = 0;
        if (unit === 'mm' || (!unit && detectedUnit === 'mm')) {
          heightMm = value;
        } else if (unit === 'cm' || (!unit && detectedUnit === 'cm')) {
          heightMm = value * 10;
        } else if (unit === 'm' || (!unit && detectedUnit === 'm')) {
          heightMm = value * 1000;
        }

        if (heightMm >= 3000 && heightMm <= 50000) {
          candidates.push(heightMm);
        }
      }

      if (candidates.length > 0) {
        // Return the largest candidate (likely overall height)
        return Math.max(...candidates);
      }
    }

    return null;
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER: SUM WALL SEGMENTS
  // ══════════════════════════════════════════════════════════════

  /**
   * Intelligently sum wall segments to get total wall length.
   * Handles cases where:
   * - Multiple segments need to be summed (L-shaped walls)
   * - Some dimensions are interior (should be excluded)
   * - Some dimensions are overall (should be used directly)
   * 
   * Strategy:
   * 1. If we have an overall dimension that matches sum of segments, use it
   * 2. Otherwise, sum all segments that are likely part of the wall
   * 3. Filter out dimensions that are too small (likely interior) or too large (likely errors)
   */
  private sumWallSegments(segments: number[]): number {
    if (segments.length === 0) return 0;
    if (segments.length === 1) return segments[0];

    // Filter to reasonable wall segment sizes (1m to 200m)
    const validSegments = segments.filter(s => s >= 1000 && s <= 200000);
    
    if (validSegments.length === 0) return 0;
    if (validSegments.length === 1) return validSegments[0];

    // Sort descending
    validSegments.sort((a, b) => b - a);

    // Strategy 1: If largest dimension is very large, it might be the total
    // Check if it's close to sum of smaller segments
    const largest = validSegments[0];
    const smaller = validSegments.slice(1);
    const sumOfSmaller = smaller.reduce((a, b) => a + b, 0);

    // If largest is within 5% of sum of others, it's likely the total
    if (sumOfSmaller > 0 && Math.abs(largest - sumOfSmaller) / sumOfSmaller < 0.05) {
      return largest;
    }

    // Strategy 2: Sum all segments (for L-shaped or multi-segment walls)
    // But exclude very small segments (< 2m) that are likely interior dimensions
    const wallSegments = validSegments.filter(s => s >= 2000);
    if (wallSegments.length > 0) {
      const total = wallSegments.reduce((a, b) => a + b, 0);
      // If total is reasonable, use it
      if (total >= 3000 && total <= 200000) {
        return total;
      }
    }

    // Strategy 3: Use largest dimension as fallback
    return largest;
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 10: ASSIGN TO WALLS / HEIGHT
  // ══════════════════════════════════════════════════════════════

  private assignDimensions(
    result: ExtractedDimensions,
    overallDims: RawDimension[],
    gridResult: { horizontalTotalMm: number; verticalTotalMm: number } | null,
  ): void {
    // ── Extract explicit height from text patterns ──
    const explicitHeight = this.extractExplicitHeight(result.ocrText, result.detectedUnit);

    if (result.drawingType === 'section' || result.drawingType === 'elevation') {
      // ═══ SECTION / ELEVATION ═══
      this.assignElevationDimensions(result, explicitHeight);

    } else {
      // ═══ FLOOR PLAN ═══
      this.assignFloorPlanDimensions(result, overallDims, gridResult);
    }
  }

  /**
   * Assign dimensions for elevation/section drawings.
   * Strategy:
   *   - Horizontal dimensions → building width
   *   - Vertical dimensions (floor heights stacked) → building height
   *   - The largest horizontal dim is the building width
   *   - Building height from stacked floor heights OR explicit height annotation
   */
  private assignElevationDimensions(
    result: ExtractedDimensions,
    explicitHeight: number | null,
  ): void {
    let heightMm = explicitHeight || 0;
    const allDims = [...new Set(result.parsedDimensionsMm)]
      .filter(v => v >= 500)
      .sort((a, b) => b - a);

    // ── Determine building width ──
    // For elevation: the largest dimension that's likely horizontal (wall length)
    // Look for dimensions > 5000mm first, then fall back to largest dimension
    const largeDims = allDims.filter(v => v >= 5000 && v <= 200000);
    const mediumDims = allDims.filter(v => v >= 3000 && v < 5000);
    
    let horizontalMm = 0;
    if (largeDims.length >= 1) {
      horizontalMm = largeDims[0];
    } else if (mediumDims.length >= 1) {
      horizontalMm = mediumDims[0];
    } else if (allDims.length >= 1) {
      // Use the largest dimension available
      horizontalMm = allDims[0];
    }

    // ── Determine building height ──
    if (!heightMm) {
      // Strategy 1: Sum typical floor-height dimensions (2500-4000mm)
      // These represent individual floor heights in elevation drawings
      const floorHeightDims = allDims.filter(v => v >= 2500 && v <= 4000);
      if (floorHeightDims.length >= 2) {
        const stackedHeight = floorHeightDims.reduce((sum, v) => sum + v, 0);
        if (stackedHeight >= 5000 && stackedHeight <= 80000) {
          heightMm = stackedHeight;
          this.logger.log(`Elevation height from stacked floors: ${floorHeightDims.join('+')} = ${heightMm}mm`);
        }
      }

      // Strategy 2: Look for a single large vertical dimension
      if (!heightMm) {
        const heightCandidates = allDims.filter(v => v >= 3000 && v <= 50000 && v !== horizontalMm);
        if (heightCandidates.length > 0) {
          // Use the largest candidate that's different from the width
          heightMm = heightCandidates[0];
        }
      }

      // Strategy 3: Sum ALL dimensions in floor-height range (2000-4500mm) 
      // which might include slab-to-slab heights
      if (!heightMm) {
        const stackable = allDims.filter(v => v >= 2000 && v <= 4500);
        if (stackable.length >= 1) {
          const possibleHeight = stackable.reduce((sum, v) => sum + v, 0);
          if (possibleHeight >= 2500 && possibleHeight <= 80000) {
            heightMm = possibleHeight;
          }
        }
      }
    }

    result.buildingHeightMm = heightMm || null;

    // For elevation drawings, we typically see only one face of the building
    // Assign the horizontal dimension to all walls as a starting point
    // (the user can adjust East/West to be different from North/South)
    if (horizontalMm >= 1000) {
      result.walls.north = { lengthMm: horizontalMm, heightMm: heightMm || 0 };
      result.walls.south = { lengthMm: horizontalMm, heightMm: heightMm || 0 };
      // For elevation, we only see one dimension (front width), not the depth
      // Set E/W to 0 so they're left blank for manual entry
      result.walls.east  = null;
      result.walls.west  = null;
    }

    // If we found two distinct large dimensions, use them for N/S and E/W
    if (largeDims.length >= 2 && largeDims[0] !== largeDims[1]) {
      const dim1 = largeDims[0];
      const dim2 = largeDims[1];
      result.walls.north = { lengthMm: dim1, heightMm: heightMm || 0 };
      result.walls.south = { lengthMm: dim1, heightMm: heightMm || 0 };
      result.walls.east  = { lengthMm: dim2, heightMm: heightMm || 0 };
      result.walls.west  = { lengthMm: dim2, heightMm: heightMm || 0 };
    }

    this.logger.log(
      `Section/Elevation: width=${horizontalMm}mm, height=${heightMm}mm ` +
      `(explicit: ${explicitHeight || 'none'})`,
    );
  }

  /**
   * Assign dimensions for floor plan drawings.
   * Strategy: 
   *   - Filter out interior room dimensions (< 3000mm)
   *   - Pick the two largest distinct values for N/S and E/W
   *   - Fall back to grid summation if no large dimensions found
   *   - Lower threshold if building is smaller
   */
  private assignFloorPlanDimensions(
    result: ExtractedDimensions,
    overallDims: RawDimension[],
    gridResult: { horizontalTotalMm: number; verticalTotalMm: number } | null,
  ): void {
    // Floor plans provide width × depth (no height).
    const roomLabelKeywords = [
      'kitchen', 'bedroom', 'bathroom', 'bath', 'toilet', 'wc',
      'living', 'dining', 'great room', 'master', 'office', 'pantry',
      'lanai', 'porch', 'covered porch', 'deck', 'garage', 'car park',
      'hall', 'lobby', 'foyer', 'closet', 'wic', 'walk-in',
      'store', 'room', 'space', 'area',
    ];
    const ocrTextLower = result.ocrText.toLowerCase();

    const filteredDims = result.allDimensions.filter(d => {
      // Exclude very small dimensions (< 2000mm / 2m) — detail dimensions
      if (d.valueMm < 2000) {
        this.logger.debug(`Excluding small dimension (detail): ${d.rawText} (${d.valueMm}mm)`);
        return false;
      }

      // Exclude very large dimensions (> 100000mm / 100m) — likely errors
      if (d.valueMm > 100000) return false;

      // Exclude dimensions near room labels in OCR text
      const dimPattern = d.rawText.replace(/[^\d.-]/g, '');
      if (dimPattern) {
        const dimIndex = ocrTextLower.indexOf(dimPattern.toLowerCase());
        if (dimIndex >= 0) {
          const contextStart = Math.max(0, dimIndex - 100);
          const contextEnd = Math.min(ocrTextLower.length, dimIndex + dimPattern.length + 100);
          const context = ocrTextLower.substring(contextStart, contextEnd);
          
          for (const keyword of roomLabelKeywords) {
            if (context.includes(keyword)) {
              this.logger.debug(`Excluding dimension near room label "${keyword}": ${d.rawText} (${d.valueMm}mm)`);
              return false;
            }
          }
        }
      }

      // Exclude decimal annotations that look like floor levels (5.00-25.00)
      const hasExplicitUnit = /(?:mm|cm|m)\s*$/i.test(d.rawText);
      if (!hasExplicitUnit && /^\d{1,2}[.,]\d{2}$/.test(d.rawText)) {
        if (d.value >= 5 && d.value <= 25) {
          this.logger.debug(`Excluding likely floor-level annotation: ${d.rawText} (${d.valueMm}mm)`);
          return false;
        }
      }

      return true;
    });

    // ── Get unique valid dimension values ──
    // Start with 3000mm minimum (not 5000mm), since smaller buildings exist
    const allValidDims = [...new Set(filteredDims.map(d => d.valueMm))]
      .filter(v => v >= 3000 && v <= 100000)
      .sort((a, b) => b - a);
    
    // Prefer large dims (>= 5000mm) first, but use smaller if nothing else available
    const largeDims = allValidDims.filter(v => v >= 5000);
    const validDims = largeDims.length >= 2 ? largeDims : allValidDims;

    this.logger.log(
      `Floor plan: ${validDims.length} valid dims after filtering ` +
      `(${largeDims.length} >= 5m, from ${result.allDimensions.length} total). Values: [${validDims.join(', ')}]mm`,
    );

    // ── Pick the two best wall-length candidates ──
    let totalHorizontal = validDims.length >= 1 ? validDims[0] : 0;
    let totalVertical   = validDims.length >= 2 ? validDims[1] : 0;

    // ── Check if segment summing produces a better match ──
    const segments = allValidDims.filter(v => v >= 1000 && v <= 6000);
    if (segments.length >= 2) {
      for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
          const sum = segments[i] + segments[j];
          const matchDim = allValidDims.find(d => d > 5000 && Math.abs(d - sum) < d * 0.02);
          if (matchDim) {
            this.logger.debug(`Segment sum confirmed: ${segments[i]}+${segments[j]}≈${matchDim}mm`);
          }
        }
      }
    }

    // ── Use grid summation only if it improves on candidates ──
    if (gridResult) {
      const gH = gridResult.horizontalTotalMm;
      const gV = gridResult.verticalTotalMm;
      // Only use grid sums if they're in a reasonable range and not wildly larger
      if (gH >= 3000 && gH <= 100000) {
        if (totalHorizontal === 0 || (gH > totalHorizontal && gH <= totalHorizontal * 2.0)) {
          totalHorizontal = gH;
        }
      }
      if (gV >= 3000 && gV <= 100000) {
        if (totalVertical === 0 || (gV > totalVertical && gV <= totalVertical * 2.0)) {
          totalVertical = gV;
        }
      }
    }

    // ── Ensure N/S >= E/W ──
    if (totalVertical > totalHorizontal && totalHorizontal > 0) {
      [totalHorizontal, totalVertical] = [totalVertical, totalHorizontal];
    }

    // ── Assign to walls ──
    if (totalHorizontal > 0) {
      result.walls.north = { lengthMm: totalHorizontal, heightMm: 0 };
      result.walls.south = { lengthMm: totalHorizontal, heightMm: 0 };
    }
    if (totalVertical > 0) {
      result.walls.east = { lengthMm: totalVertical, heightMm: 0 };
      result.walls.west = { lengthMm: totalVertical, heightMm: 0 };
    }

    this.logger.log(
      `Floor plan result: N/S=${totalHorizontal}mm, E/W=${totalVertical}mm`,
    );
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 11: ESTIMATE FLOOR COUNT & BUILDING HEIGHT
  // ══════════════════════════════════════════════════════════════

  /**
   * For floor plans (which don't contain height info), try to estimate
   * the number of floors from OCR text and derive a building height.
   *
   * Detection patterns:
   *   - "GROUND FLOOR" / "1F" / "1階" → at least 1 floor
   *   - "FIRST FLOOR" / "2F" / "2階" → at least 2 floors
   *   - "SECOND FLOOR" / "3F" / "3階" → at least 3 floors
   *   - "BASEMENT" / "B1" / "地下" → adds 1 underground floor
   *   - Height labels like "FL: 10.20" → floor level reference
   *
   * Typical Japanese building floor heights:
   *   - Residential: ~3,000mm per floor
   *   - Commercial/Office: ~3,500mm per floor
   *   - Standard estimate: 3,000mm × floorCount
   */
  private estimateFloorCountAndHeight(result: ExtractedDimensions): void {
    // If we already have a building height from section/elevation, use it directly
    // This is the actual measured height, not an estimate
    if (result.buildingHeightMm && result.buildingHeightMm > 0) {
      result.estimatedFloorCount = Math.max(1, Math.round(result.buildingHeightMm / 3000));
      result.estimatedBuildingHeightMm = result.buildingHeightMm;
      this.logger.log(
        `Using actual building height: ${result.buildingHeightMm}mm (not estimated from floor count)`,
      );
      return;
    }

    const text = result.ocrText;
    const lower = text.toLowerCase();
    // Also check the filename hint if present (stored at end of ocrText after marker)
    const filenameHint = this.filenameHint || '';
    const filenameHintLower = filenameHint.toLowerCase();

    let maxFloor = 0;
    let hasBasement = false;

    // ── Japanese floor notation: 1階, 2階, 3階, etc. ──
    const jpFloorRegex = /(\d{1,2})\s*階/g;
    let match: RegExpExecArray | null;
    while ((match = jpFloorRegex.exec(text)) !== null) {
      const floor = parseInt(match[1], 10);
      if (floor >= 1 && floor <= 50) {
        maxFloor = Math.max(maxFloor, floor);
      }
    }

    // ── Japanese floor notation: B1階, B2階, 地下 ──
    if (/地下|B\d階/i.test(text)) {
      hasBasement = true;
    }

    // ── Compact notation: 1F, 2F, 3F, etc. ──
    const compactFloorRegex = /\b(\d{1,2})\s*F\b/g;
    while ((match = compactFloorRegex.exec(text)) !== null) {
      const floor = parseInt(match[1], 10);
      if (floor >= 1 && floor <= 50) {
        maxFloor = Math.max(maxFloor, floor);
      }
    }

    // ── "N Floors" / "N-Floor" / "N Story" / "N Storey" patterns ──
    // These are very common in English: "4 Floors Building", "3-story house", etc.
    const floorsPatternRegex = /\b(\d{1,2})\s*[-\s]?\s*(?:floors?|stor(?:ey|y|ies))\b/gi;
    while ((match = floorsPatternRegex.exec(text)) !== null) {
      const floor = parseInt(match[1], 10);
      if (floor >= 1 && floor <= 50) {
        maxFloor = Math.max(maxFloor, floor);
        this.logger.log(`Detected "${match[0]}" → ${floor} floors from text`);
      }
    }

    // ── Also check filename hint for floor count ──
    if (filenameHint) {
      const fileFloorMatch = filenameHintLower.match(/\b(\d{1,2})\s*[-\s]?\s*(?:floors?|stor(?:ey|y|ies)|階)\b/i);
      if (fileFloorMatch) {
        const floor = parseInt(fileFloorMatch[1], 10);
        if (floor >= 1 && floor <= 50) {
          maxFloor = Math.max(maxFloor, floor);
          this.logger.log(`Detected "${fileFloorMatch[0]}" → ${floor} floors from filename`);
        }
      }
    }

    // ── English floor names ──
    const floorNameMap: Record<string, number> = {
      'ground floor': 1,
      'first floor': 2,
      'second floor': 3,
      'third floor': 4,
      'fourth floor': 5,
      'fifth floor': 6,
      'mezzanine': 2,
      'penthouse': 3,
    };

    for (const [name, floor] of Object.entries(floorNameMap)) {
      if (lower.includes(name)) {
        maxFloor = Math.max(maxFloor, floor);
      }
    }

    // ── English: "basement", "B1", "B2" ──
    if (/\b(basement|underground|cellar)\b/i.test(lower) || /\bB[12]\b/.test(text)) {
      hasBasement = true;
    }

    // ── "Level X" or "LV X" patterns ──
    const levelRegex = /\b(?:level|lv|lvl)\s*(\d{1,2})\b/gi;
    while ((match = levelRegex.exec(text)) !== null) {
      const lvl = parseInt(match[1], 10);
      if (lvl >= 1 && lvl <= 50) {
        maxFloor = Math.max(maxFloor, lvl);
      }
    }

    // ── FL height labels (e.g., "FL: 10.20m", "FL 10.15m") → try to infer floors ──
    const flLabelRegex = /FL[:\s]*(\d{1,3})[.,](\d{1,2})\s*m?\b/gi;
    const flHeights: number[] = [];
    while ((match = flLabelRegex.exec(text)) !== null) {
      const h = parseFloat(`${match[1]}.${match[2]}`);
      if (h > 0 && h < 200) {
        flHeights.push(h);
      }
    }
    if (flHeights.length > 0) {
      const maxFl = Math.max(...flHeights);
      const minFl = Math.min(...flHeights);
      if (maxFl > 2 && maxFl < 200) {
        const heightRange = maxFl - minFl;
        if (heightRange > 2) {
          const estimatedFloors = Math.max(1, Math.round(heightRange / 3.0));
          maxFloor = Math.max(maxFloor, estimatedFloors + 1);
        }
      }
    }

    // ── For elevation drawings: try to estimate floors from stacked vertical dimensions ──
    if (result.drawingType === 'elevation' || result.drawingType === 'section') {
      // Look for repeating dimensions in the 2500-4000mm range (typical floor heights)
      const floorHeightDims = result.allDimensions
        .filter(d => d.valueMm >= 2500 && d.valueMm <= 4000)
        .map(d => d.valueMm);
      if (floorHeightDims.length >= 2) {
        // Count how many floor-height dimensions we see
        const floorCount = floorHeightDims.length;
        maxFloor = Math.max(maxFloor, floorCount);
        this.logger.log(`Elevation: detected ${floorCount} floor-height dimensions (${floorHeightDims.join(', ')}mm)`);
      }
    }

    // ── Heuristic from image structure / drawing count ──
    if (result.viewCount >= 2 && maxFloor < 2) {
      maxFloor = Math.max(maxFloor, Math.min(result.viewCount, 4));
    }

    // Default: if nothing detected, assume at least 1 floor
    if (maxFloor === 0) {
      maxFloor = 1;
    }

    const totalAboveGround = maxFloor;

    result.estimatedFloorCount = totalAboveGround;

    // Estimate height: 3,000mm per floor (standard Japanese residential/commercial)
    // Ground floor often slightly taller (3,300mm), upper floors ~3,000mm
    let estimatedHeight: number;
    if (totalAboveGround === 1) {
      estimatedHeight = 3000; // Single story: 3m
    } else if (totalAboveGround === 2) {
      estimatedHeight = 6300; // 2-story: 3.3m + 3.0m
    } else {
      estimatedHeight = 3300 + (totalAboveGround - 1) * 3000; // first + remaining
    }

    // For scaffold, add ~900mm above the top floor for parapet/eave
    estimatedHeight += 900;

    result.estimatedBuildingHeightMm = estimatedHeight;

    this.logger.log(
      `Floor estimation: detected ${totalAboveGround} floors` +
      `${hasBasement ? ' + basement' : ''}, ` +
      `estimated height: ${estimatedHeight}mm`,
    );
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 0: IMAGE RESOLUTION CHECK
  // ══════════════════════════════════════════════════════════════

  private async checkImageResolution(
    filePath: string,
    result: ExtractedDimensions,
  ): Promise<ExtractionWarning[]> {
    const warnings: ExtractionWarning[] = [];

    try {
      const metadata = await (sharp as any)(filePath).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      const maxDim = Math.max(width, height);

      result.imageResolution = { width, height };

      this.logger.log(`Image resolution: ${width}×${height}px (max=${maxDim}px)`);

      if (maxDim < 800) {
        warnings.push({
          level: 'error',
          code: 'VERY_LOW_RESOLUTION',
          message: `Image resolution is very low (${width}×${height}px). Minimum 2000px recommended for architectural drawings. OCR results will be unreliable.`,
          messageJa: `画像の解像度が非常に低いです（${width}×${height}px）。建築図面には最低2000px以上を推奨します。OCR結果は信頼できません。`,
        });
        this.logger.warn(`Image resolution VERY LOW: ${width}×${height}px — OCR will be unreliable`);
      } else if (maxDim < 1500) {
        warnings.push({
          level: 'warning',
          code: 'LOW_RESOLUTION',
          message: `Image resolution is low (${width}×${height}px). Recommended: 2000px+ on the longest side for best OCR accuracy.`,
          messageJa: `画像の解像度が低いです（${width}×${height}px）。OCR精度向上のため、長辺2000px以上を推奨します。`,
        });
        this.logger.warn(`Image resolution LOW: ${width}×${height}px — OCR accuracy may be reduced`);
      }
    } catch (error) {
      this.logger.warn(`Could not read image metadata: ${error.message}`);
    }

    return warnings;
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 12: QUALITY WARNINGS
  // ══════════════════════════════════════════════════════════════

  private addQualityWarnings(result: ExtractedDimensions): void {
    // Low OCR confidence warning
    if (result.confidence < 0.40) {
      result.warnings.push({
        level: result.confidence < 0.25 ? 'error' : 'warning',
        code: 'LOW_OCR_CONFIDENCE',
        message: `OCR confidence is very low (${(result.confidence * 100).toFixed(0)}%). The image may be blurry, too small, or not a readable architectural drawing. Consider uploading a higher-resolution scan.`,
        messageJa: `OCR信頼度が非常に低いです（${(result.confidence * 100).toFixed(0)}%）。画像がぼやけている、小さすぎる、または読み取り可能な建築図面でない可能性があります。高解像度のスキャンをアップロードしてください。`,
      });
    }

    // No meaningful dimensions found
    if (result.parsedDimensionsMm.length === 0) {
      result.warnings.push({
        level: 'error',
        code: 'NO_DIMENSIONS_FOUND',
        message: 'No dimensions could be extracted from this image. Please enter wall dimensions manually, or upload a clearer drawing with visible dimension annotations.',
        messageJa: 'この画像から寸法を検出できませんでした。壁の寸法を手動で入力するか、寸法注記が見える鮮明な図面をアップロードしてください。',
      });
    } else if (result.parsedDimensionsMm.length <= 2) {
      // Check if the detected dimensions are reasonable (not just noise)
      const hasReasonableWallDim = result.parsedDimensionsMm.some(d => d >= 1000 && d <= 200000);
      if (!hasReasonableWallDim) {
        result.warnings.push({
          level: 'warning',
          code: 'FEW_DIMENSIONS_FOUND',
          message: `Only ${result.parsedDimensionsMm.length} dimension(s) detected, and none appear to be valid wall measurements. The detected values may be OCR noise. Please verify or enter dimensions manually.`,
          messageJa: `寸法が${result.parsedDimensionsMm.length}つしか検出されず、有効な壁の寸法がありません。検出値はOCRノイズの可能性があります。手動で確認・入力してください。`,
        });
      } else {
        result.warnings.push({
          level: 'info',
          code: 'FEW_DIMENSIONS_FOUND',
          message: `Only ${result.parsedDimensionsMm.length} dimension(s) detected. For best results, upload a drawing with clear dimension annotations on all sides.`,
          messageJa: `寸法が${result.parsedDimensionsMm.length}つしか検出されませんでした。より良い結果のため、全方向に明確な寸法注記がある図面をアップロードしてください。`,
        });
      }
    }
  }
}
