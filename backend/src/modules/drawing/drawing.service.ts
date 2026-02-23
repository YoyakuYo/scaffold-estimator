import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as path from 'path';
import * as fs from 'fs';
import { Drawing, DrawingFileFormat } from './drawing.entity';
import { ImageDimensionExtractorService, ExtractedDimensions, ExtractionWarning } from './parsers/image-dimension-extractor.service';
import { CadProcessingPipelineService } from './parsers/cad-processing-pipeline.service';
import { DrawingParsingService } from './parsers/drawing-parsing.service';

@Injectable()
export class DrawingService {
  private readonly logger = new Logger(DrawingService.name);

  constructor(
    @InjectRepository(Drawing)
    private drawingRepository: Repository<Drawing>,
    @InjectQueue('drawing-processing')
    @Optional()
    private drawingQueue: Queue | null,
    private imageDimensionExtractor: ImageDimensionExtractorService,
    private cadPipeline: CadProcessingPipelineService,
    private drawingParsingService: DrawingParsingService,
  ) {}

  async processDrawing(
    file: Express.Multer.File,
    projectId: string,
    uploadedBy: string,
  ) {
    try {
      const format = this.getFormat(file.originalname);
      this.logger.log(`Processing drawing: ${file.originalname}, format: ${format}`);
      
      const drawing = this.drawingRepository.create({
        projectId,
        filename: file.originalname,
        fileFormat: format,
        filePath: file.path,
        fileSizeBytes: file.size,
        uploadedBy,
        uploadStatus: 'pending',
      });

      this.logger.log(`Saving drawing to database...`);
      const savedDrawing = await this.drawingRepository.save(drawing);
      this.logger.log(`Drawing saved with ID: ${savedDrawing.id}`);

      // ── CAD files: Process through the professional CAD pipeline ──
      const isCad = ['dxf', 'dwg', 'jww'].includes(format);
      if (isCad) {
        return await this.processCadFile(savedDrawing, file.path);
      }

      // ── Images: run OCR dimension extraction ──
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tif', 'tiff'].includes(format);
      if (isImage) {
        return await this.processImageFile(savedDrawing, file.path);
      }

      // ── PDF: Process synchronously ──
      if (format === 'pdf') {
        return await this.processPdfFile(savedDrawing, file.path);
      }

      // ── Fallback: unknown format ──
      this.logger.warn(`Unknown format "${format}", marking as completed without processing.`);
      await this.drawingRepository.update(savedDrawing.id, { uploadStatus: 'completed' });
      return {
        id: savedDrawing.id,
        message: 'Drawing uploaded.',
        status: 'completed',
      };
    } catch (error) {
      this.logger.error(`Error processing drawing: ${error.message}`, error.stack);
      
      if (error.message?.includes('invalid input value for enum') || 
          error.message?.includes('drawing_file_format')) {
        this.logger.error('Database enum does not support this file format. Run migration.');
        throw new Error('Unsupported file format. Database migration required.');
      }
      
      throw error;
    }
  }

  // ── CAD file processing (DXF / DWG / JWW) ────────────────

  private async processCadFile(savedDrawing: Drawing, filePath: string) {
    this.logger.log(`Running CAD processing pipeline on ${savedDrawing.id}...`);

    await this.drawingRepository.update(savedDrawing.id, {
      uploadStatus: 'processing',
    });

    try {
      const result = await this.cadPipeline.process(filePath);

      if (result.success && result.data) {
        await this.drawingRepository.update(savedDrawing.id, {
          uploadStatus: 'completed',
          metadata: {
            cadProcessing: result.extractionInfo,
            wallSegments: result.data.wallSegments,
            perimeterTotal: result.data.perimeterTotal,
            buildingHeight: result.data.buildingHeight,
            heightNote: result.data.heightNote,
          } as any,
        });

        return {
          id: savedDrawing.id,
          message: `CAD file processed: ${result.data.wallSegments.length} wall segments detected, ` +
            `perimeter=${result.data.perimeterTotal}mm. ${result.data.heightNote}`,
          status: 'completed',
          cadData: result.data,
          extractionInfo: result.extractionInfo,
        };
      } else {
        await this.drawingRepository.update(savedDrawing.id, {
          uploadStatus: 'failed',
          metadata: {
            error: result.error,
            extractionInfo: result.extractionInfo,
          } as any,
        });

        return {
          id: savedDrawing.id,
          message: result.error || 'CAD processing failed.',
          status: 'failed',
          cadData: null,
          extractionInfo: result.extractionInfo,
        };
      }
    } catch (err: any) {
      this.logger.error(`CAD pipeline error: ${err.message}`, err.stack);
      await this.drawingRepository.update(savedDrawing.id, {
        uploadStatus: 'failed',
      });

      return {
        id: savedDrawing.id,
        message: `CAD processing failed: ${err.message}`,
        status: 'failed',
        cadData: null,
      };
    }
  }

  // ── Image file processing (OCR) ──────────────────────────

  private async processImageFile(savedDrawing: Drawing, filePath: string) {
    this.logger.log(`Running OCR dimension extraction on image ${savedDrawing.id}...`);

    let extractedDimensions: ExtractedDimensions | null = null;
    try {
      extractedDimensions = await this.imageDimensionExtractor.extractDimensions(filePath, savedDrawing.filename);
      
      await this.drawingRepository.update(savedDrawing.id, {
        uploadStatus: 'completed',
        metadata: {
          drawingType: extractedDimensions.drawingType,
          detectedUnit: extractedDimensions.detectedUnit,
          extractedDimensions: extractedDimensions.walls,
          buildingHeightMm: extractedDimensions.buildingHeightMm,
          estimatedFloorCount: extractedDimensions.estimatedFloorCount,
          estimatedBuildingHeightMm: extractedDimensions.estimatedBuildingHeightMm,
          rawDimensionTexts: extractedDimensions.rawDimensionTexts,
          parsedDimensionsMm: extractedDimensions.parsedDimensionsMm,
          ocrConfidence: extractedDimensions.confidence,
          viewCount: extractedDimensions.viewCount,
          imageResolution: extractedDimensions.imageResolution,
          warnings: extractedDimensions.warnings,
          buildingOutline: extractedDimensions.buildingOutline,
        } as any,
      });
      
      this.logger.log(
        `Image ${savedDrawing.id} processed: ` +
        `type=${extractedDimensions.drawingType}, ` +
        `unit=${extractedDimensions.detectedUnit}, ` +
        `${extractedDimensions.parsedDimensionsMm.length} dims, ` +
        `height=${extractedDimensions.buildingHeightMm}mm`,
      );
    } catch (err) {
      this.logger.warn(`OCR extraction failed for ${savedDrawing.id}, continuing without dimensions: ${err.message}`);
      await this.drawingRepository.update(savedDrawing.id, {
        uploadStatus: 'completed',
      });
    }
    
    return {
      id: savedDrawing.id,
      message: extractedDimensions?.parsedDimensionsMm?.length
        ? `Image uploaded. ${extractedDimensions.parsedDimensionsMm.length} dimensions extracted (${extractedDimensions.drawingType}, ${extractedDimensions.detectedUnit}).`
        : 'Image uploaded successfully.',
      status: 'completed',
      extractedDimensions: extractedDimensions ? {
        drawingType: extractedDimensions.drawingType,
        detectedUnit: extractedDimensions.detectedUnit,
        walls: extractedDimensions.walls,
        buildingHeightMm: extractedDimensions.buildingHeightMm,
        estimatedFloorCount: extractedDimensions.estimatedFloorCount,
        estimatedBuildingHeightMm: extractedDimensions.estimatedBuildingHeightMm,
        rawDimensionTexts: extractedDimensions.rawDimensionTexts,
        parsedDimensionsMm: extractedDimensions.parsedDimensionsMm,
        confidence: extractedDimensions.confidence,
        viewCount: extractedDimensions.viewCount,
        imageResolution: extractedDimensions.imageResolution,
        warnings: extractedDimensions.warnings,
        buildingOutline: extractedDimensions.buildingOutline ?? null,
      } : null,
    };
  }

  // ── PDF file processing (synchronous) ───────────────────

  private async processPdfFile(savedDrawing: Drawing, filePath: string) {
    this.logger.log(`Processing PDF synchronously for ${savedDrawing.id}...`);

    await this.drawingRepository.update(savedDrawing.id, {
      uploadStatus: 'processing',
    });

    let extractedDimensions: ExtractedDimensions | null = null;

    try {
      // Step 1: Extract text from PDF using pdf-parse
      const normalizedGeometry = await this.drawingParsingService.parse(filePath, 'pdf');
      const pdfText = normalizedGeometry.text || '';

      this.logger.log(`PDF text extracted: ${pdfText.length} chars`);

      // Step 2: Run the full dimension parsing pipeline on the extracted text
      // Pass filename as a hint for floor count, drawing type, etc.
      if (pdfText.length > 10) {
        extractedDimensions = await this.imageDimensionExtractor.extractDimensionsFromText(pdfText, savedDrawing.filename);

        this.logger.log(
          `PDF dimension extraction (text): type=${extractedDimensions.drawingType}, ` +
          `unit=${extractedDimensions.detectedUnit}, ` +
          `dims=${extractedDimensions.parsedDimensionsMm.length}, ` +
          `N=${extractedDimensions.walls.north?.lengthMm || 0}mm, ` +
          `S=${extractedDimensions.walls.south?.lengthMm || 0}mm, ` +
          `E=${extractedDimensions.walls.east?.lengthMm || 0}mm, ` +
          `W=${extractedDimensions.walls.west?.lengthMm || 0}mm`,
        );
      } else {
        this.logger.warn(`PDF text too short (${pdfText.length} chars) — likely a scanned/image-only PDF`);
      }

      // Step 2b: If text extraction gave poor results, try rendering PDF to image and running OCR
      const hasWalls = extractedDimensions?.walls?.north?.lengthMm || extractedDimensions?.walls?.east?.lengthMm;
      const hasFewDims = (extractedDimensions?.parsedDimensionsMm?.length || 0) < 3;
      const needsImageOcr = !extractedDimensions || !hasWalls || hasFewDims;

      if (needsImageOcr) {
        this.logger.log(`Text extraction insufficient (walls=${!!hasWalls}, dims=${extractedDimensions?.parsedDimensionsMm?.length || 0}). Trying PDF-to-image OCR fallback...`);
        const ocrResult = await this.tryPdfToImageOcr(filePath, savedDrawing.filename);
        if (ocrResult) {
          // Use OCR result if it's better than text extraction
          const ocrHasWalls = ocrResult.walls?.north?.lengthMm || ocrResult.walls?.east?.lengthMm;
          const ocrDimCount = ocrResult.parsedDimensionsMm?.length || 0;
          const textDimCount = extractedDimensions?.parsedDimensionsMm?.length || 0;

          if (ocrHasWalls || ocrDimCount > textDimCount) {
            this.logger.log(`OCR fallback produced better results (${ocrDimCount} dims vs ${textDimCount}). Using OCR result.`);
            extractedDimensions = ocrResult;
          } else {
            this.logger.log(`OCR fallback did not improve results. Keeping text extraction.`);
          }
        }
      }

      // Step 3: Store results in database
      await this.drawingRepository.update(savedDrawing.id, {
        normalizedGeometry: normalizedGeometry as any,
        uploadStatus: 'completed',
        metadata: {
          scale: normalizedGeometry.scale,
          unit: normalizedGeometry.unit,
          bbox: normalizedGeometry.boundingBox,
          layers: normalizedGeometry.layers?.map((l: any) => l.name) || [],
          ...(extractedDimensions ? {
            drawingType: extractedDimensions.drawingType,
            detectedUnit: extractedDimensions.detectedUnit,
            extractedDimensions: extractedDimensions.walls,
            buildingHeightMm: extractedDimensions.buildingHeightMm,
            estimatedFloorCount: extractedDimensions.estimatedFloorCount,
            estimatedBuildingHeightMm: extractedDimensions.estimatedBuildingHeightMm,
            rawDimensionTexts: extractedDimensions.rawDimensionTexts,
            parsedDimensionsMm: extractedDimensions.parsedDimensionsMm,
            ocrConfidence: extractedDimensions.confidence,
            warnings: extractedDimensions.warnings,
          } : {}),
        } as any,
      });

      this.logger.log(`PDF ${savedDrawing.id} processed successfully`);

      return {
        id: savedDrawing.id,
        message: extractedDimensions?.parsedDimensionsMm?.length
          ? `PDF processed. ${extractedDimensions.parsedDimensionsMm.length} dimensions extracted (${extractedDimensions.drawingType}, ${extractedDimensions.detectedUnit}).`
          : 'PDF uploaded. No text dimensions found (may be scanned image).',
        status: 'completed',
        extractedDimensions: extractedDimensions ? {
          drawingType: extractedDimensions.drawingType,
          detectedUnit: extractedDimensions.detectedUnit,
          walls: extractedDimensions.walls,
          buildingHeightMm: extractedDimensions.buildingHeightMm,
          estimatedFloorCount: extractedDimensions.estimatedFloorCount,
          estimatedBuildingHeightMm: extractedDimensions.estimatedBuildingHeightMm,
          rawDimensionTexts: extractedDimensions.rawDimensionTexts,
          parsedDimensionsMm: extractedDimensions.parsedDimensionsMm,
          confidence: extractedDimensions.confidence,
          viewCount: extractedDimensions.viewCount,
          imageResolution: extractedDimensions.imageResolution,
          warnings: extractedDimensions.warnings,
          buildingOutline: extractedDimensions.buildingOutline ?? null,
        } : null,
      };
    } catch (err: any) {
      this.logger.error(`PDF processing failed for ${savedDrawing.id}: ${err.message}`, err.stack);

      await this.drawingRepository.update(savedDrawing.id, {
        uploadStatus: 'completed', // Mark completed even on parse failure — file is uploaded
        metadata: { pdfParseError: err.message } as any,
      });

      return {
        id: savedDrawing.id,
        message: `PDF uploaded. Text extraction had issues: ${err.message}`,
        status: 'completed',
        extractedDimensions: null,
      };
    }
  }

  async getDrawing(id: string, companyId: string) {
    const drawing = await this.drawingRepository.findOne({
      where: { id },
      relations: ['geometryElements'],
    });

    if (!drawing) {
      throw new NotFoundException('Drawing not found');
    }

    return drawing;
  }

  async listDrawings(companyId: string, projectId?: string) {
    try {
      this.logger.log(`Listing drawings for companyId: ${companyId}, projectId: ${projectId}`);
      
      const query = this.drawingRepository.createQueryBuilder('drawing');

      if (projectId) {
        query.where('drawing.projectId = :projectId', { projectId });
      }

      query.orderBy('drawing.uploadedAt', 'DESC');

      const result = await query.getMany();
      this.logger.log(`Found ${result.length} drawings`);
      return result;
    } catch (error) {
      this.logger.error(`Error listing drawings: ${error.message}`);
      this.logger.error(`Full error: ${JSON.stringify(error, null, 2)}`);
      this.logger.error(`Stack: ${error.stack}`);
      return [];
    }
  }

  async updateDrawingStatus(
    id: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    metadata?: any,
  ) {
    await this.drawingRepository.update(id, {
      uploadStatus: status,
      metadata: metadata || undefined,
    });
  }

  async updateDrawingGeometry(id: string, normalizedGeometry: any) {
    await this.drawingRepository.update(id, {
      normalizedGeometry,
      uploadStatus: 'completed',
    });
  }

  /**
   * Fallback: Convert PDF first page to a high-resolution image using Puppeteer,
   * then run the full OCR dimension extraction pipeline on it.
   * This handles scanned PDFs and CAD-exported PDFs where text extraction is garbled.
   */
  private async tryPdfToImageOcr(pdfPath: string, filename: string): Promise<ExtractedDimensions | null> {
    let browser: any = null;
    const outputImagePath = pdfPath.replace(/\.pdf$/i, '_pdf_render.png');

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const puppeteer = require('puppeteer');
      
      this.logger.log(`Launching headless browser for PDF rendering...`);
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const page = await browser.newPage();

      // Set a large viewport for high-resolution rendering
      await page.setViewport({ width: 2400, height: 3200, deviceScaleFactor: 2 });

      // Read PDF file and convert to data URL for navigation
      const pdfBuffer = fs.readFileSync(pdfPath);
      const base64Pdf = pdfBuffer.toString('base64');
      const dataUrl = `data:application/pdf;base64,${base64Pdf}`;

      this.logger.log(`Navigating to PDF (${pdfBuffer.length} bytes)...`);
      
      // Navigate to PDF - Chromium has built-in PDF rendering
      await page.goto(dataUrl, { 
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Wait a moment for PDF rendering
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Take a full-page screenshot
      await page.screenshot({
        path: outputImagePath,
        fullPage: true,
        type: 'png',
      });

      await browser.close();
      browser = null;

      this.logger.log(`PDF rendered to image: ${outputImagePath}`);

      // Check if the image was created and has content
      if (!fs.existsSync(outputImagePath)) {
        this.logger.warn('PDF render failed: output image not created');
        return null;
      }

      const stats = fs.statSync(outputImagePath);
      if (stats.size < 1000) {
        this.logger.warn(`PDF render produced very small image (${stats.size} bytes), likely failed`);
        try { fs.unlinkSync(outputImagePath); } catch {}
        return null;
      }

      // Run OCR on the rendered image
      this.logger.log(`Running OCR on rendered PDF image (${stats.size} bytes)...`);
      const ocrResult = await this.imageDimensionExtractor.extractDimensions(outputImagePath, filename);

      // Cleanup temp image
      try { fs.unlinkSync(outputImagePath); } catch {}

      return ocrResult;
    } catch (err: any) {
      this.logger.warn(`PDF-to-image OCR fallback failed: ${err.message}`);
      if (browser) {
        try { await browser.close(); } catch {}
      }
      // Cleanup temp image if it exists
      try { fs.unlinkSync(outputImagePath); } catch {}
      return null;
    }
  }

  private getFormat(filename: string): DrawingFileFormat {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'dxf') return 'dxf';
    if (ext === 'dwg') return 'dwg';
    if (ext === 'jww') return 'jww';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    if (ext === 'png') return 'png';
    if (ext === 'gif') return 'gif';
    if (ext === 'bmp') return 'bmp';
    if (ext === 'webp') return 'webp';
    if (ext === 'svg') return 'svg';
    if (ext === 'tif' || ext === 'tiff') return 'tif';
    throw new Error(`Unsupported file format: ${ext}`);
  }
}
