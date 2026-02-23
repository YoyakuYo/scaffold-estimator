import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

@Injectable()
export class PdfParsingService {
  private readonly logger = new Logger(PdfParsingService.name);

  async extract(filePath: string): Promise<any> {
    try {
      const dataBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(dataBuffer);

      // Extract text and try to find dimensions/scale
      const text = pdfData.text;
      const scale = this.extractScaleFromText(text);

      // For PDF, we'll extract basic metadata
      // Full geometry extraction would require more advanced PDF parsing
      // or OCR for scanned drawings
      return {
        id: Math.random().toString(36).substring(7),
        fileId: filePath,
        elements: this.extractTextElements(pdfData),
        boundingBox: {
          minX: 0,
          minY: 0,
          maxX: pdfData.info?.PageWidth || 1000,
          maxY: pdfData.info?.PageHeight || 1000,
        },
        scale: scale || 1,
        unit: 'mm',
        layers: [],
        text: text, // Full text for dimension extraction pipeline
      };
    } catch (error) {
      this.logger.error(`PDF parsing failed: ${error.message}`);
      throw error;
    }
  }

  private extractScaleFromText(text: string): number | null {
    // Try to find scale patterns like "1:100", "SCALE 1/100", etc.
    const scalePatterns = [
      /(?:SCALE|縮尺|スケール)[\s:]*1[:\/](\d+)/i,
      /1[:\/](\d+)/,
    ];

    for (const pattern of scalePatterns) {
      const match = text.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    return null;
  }

  private extractTextElements(pdfData: any): any[] {
    const elements: any[] = [];

    // Extract text annotations that might contain dimensions
    if (pdfData.text) {
      const lines = pdfData.text.split('\n');
      lines.forEach((line: string, index: number) => {
        // Look for dimension patterns
        const dimensionMatch = line.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m|メートル)/i);
        if (dimensionMatch) {
          elements.push({
            type: 'text',
            coordinates: [[0, index * 20]], // Approximate positioning
            layer: 'dimensions',
            properties: {
              text: line.trim(),
              value: parseFloat(dimensionMatch[1]),
              unit: dimensionMatch[2],
            },
          });
        }
      });
    }

    return elements;
  }
}
