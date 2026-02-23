import { Injectable, Logger } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { ScaffoldConfiguration } from './scaffold-config.entity';
import { ScaffoldCalculationResult } from './scaffold-calculator.service';

/**
 * Generates PDF exports for 2D and 3D scaffold views.
 */
@Injectable()
export class ScaffoldPdfService {
  private readonly logger = new Logger(ScaffoldPdfService.name);

  /**
   * Generate PDF from 2D SVG data (sent from frontend)
   */
  async generate2DPdf(svgContent: string, configId: string): Promise<Buffer> {
    this.logger.log(`Generating 2D PDF for config ${configId}`);

    return new Promise((resolve, reject) => {
      try {
        // For 2D, we'll use puppeteer to render SVG to PDF
        // But for now, create a simple PDF with the SVG embedded
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape' });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });
        doc.on('error', reject);

        // Add title
        doc.fontSize(18).text('足場組立図 (2D)', { align: 'center' });
        doc.moveDown();

        // Add note that SVG should be rendered separately
        doc.fontSize(12).text('Note: This PDF contains scaffold 2D drawing data.', { align: 'center' });
        doc.fontSize(10).text(`Config ID: ${configId}`, { align: 'center' });
        doc.moveDown();

        // For full SVG rendering, we'd need puppeteer
        // This is a placeholder - frontend will handle SVG to PDF conversion
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate PDF from 3D screenshot (sent from frontend as base64)
   */
  async generate3DPdf(imageBase64: string, configId: string): Promise<Buffer> {
    this.logger.log(`Generating 3D PDF for config ${configId}`);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape' });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });
        doc.on('error', reject);

        // Add title
        doc.fontSize(18).text('足場組立図 (3D)', { align: 'center' });
        doc.moveDown();

        // Convert base64 to buffer and add image
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const imgWidth = doc.page.width - 100;
        const imgHeight = (imgWidth * 3) / 4; // Maintain aspect ratio

        doc.image(imageBuffer, {
          fit: [imgWidth, imgHeight],
          align: 'center',
          valign: 'center',
        });

        doc.moveDown();
        doc.fontSize(10).text(`Config ID: ${configId}`, { align: 'center' });
        doc.text(`Generated: ${new Date().toLocaleString('ja-JP')}`, { align: 'center' });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
