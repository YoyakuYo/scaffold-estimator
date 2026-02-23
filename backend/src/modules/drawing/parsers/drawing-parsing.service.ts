import { Injectable, Logger } from '@nestjs/common';
import { NormalizedGeometry } from '../interfaces/normalized-geometry.interface';
import { PdfParsingService } from './pdf.parser';
import { DxfParsingService } from './dxf.parser';
import { GeometryNormalizerService } from './geometry.normalizer';
import { DrawingFileFormat } from '../drawing.entity';

@Injectable()
export class DrawingParsingService {
  private readonly logger = new Logger(DrawingParsingService.name);

  constructor(
    private pdfParser: PdfParsingService,
    private dxfParser: DxfParsingService,
    private normalizer: GeometryNormalizerService,
  ) {}

  async parse(
    filePath: string,
    format: DrawingFileFormat,
  ): Promise<NormalizedGeometry> {
    try {
      let rawData;

      switch (format) {
        case 'pdf':
          rawData = await this.pdfParser.extract(filePath);
          break;
        case 'dxf':
        case 'dwg':
          rawData = await this.dxfParser.extract(filePath);
          break;
        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      // Normalize to common format
      return await this.normalizer.normalize(rawData, format);
    } catch (error) {
      this.logger.error(`Parsing failed for ${filePath}:`, error);
      throw error;
    }
  }

  detectStructureType(data: any): '改修工事' | 'S造' | 'RC造' {
    return this.normalizer.detectStructureType(data);
  }
}
