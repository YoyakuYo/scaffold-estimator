import { Injectable, Logger } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import sharp from 'sharp';

/**
 * Generates PDF exports for 2D and 3D scaffold views.
 */
@Injectable()
export class ScaffoldPdfService {
  private readonly logger = new Logger(ScaffoldPdfService.name);

  /**
   * Rasterize client SVG (full color) and embed in a landscape A4 PDF.
   */
  async generate2DPdf(svgContent: string, configId: string): Promise<Buffer> {
    this.logger.log(`Generating 2D PDF for config ${configId}`);
    const trimmed = (svgContent || '').trim();
    if (!trimmed) {
      throw new Error('Empty SVG content');
    }

    const pngBuffer = await sharp(Buffer.from(trimmed, 'utf-8'), { density: 192 })
      .resize({
        width: 3200,
        height: 3200,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margins: { top: 40, bottom: 40, left: 40, right: 40 },
          autoFirstPage: true,
        });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        doc.fontSize(14).text('足場組立図 (2D)', { align: 'center' });
        doc.moveDown(0.35);

        const margin = 40;
        const usableW = doc.page.width - margin * 2;
        const usableH = doc.page.height - doc.y - margin;

        doc.image(pngBuffer, {
          fit: [usableW, Math.max(160, usableH)],
          align: 'center',
        });

        doc.moveDown(0.5);
        doc.fontSize(8).fillColor('#525252').text(`Config: ${configId}`, { align: 'center' });
        doc.fillColor('#000000');
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Embed a full-color PNG (WebGL screenshot) from the client.
   */
  async generate3DPdf(imageBase64: string, configId: string): Promise<Buffer> {
    this.logger.log(`Generating 3D PDF for config ${configId}`);

    return new Promise((resolve, reject) => {
      try {
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margins: { top: 40, bottom: 40, left: 40, right: 40 },
        });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        doc.fontSize(14).text('足場組立図 (3D)', { align: 'center' });
        doc.moveDown(0.35);

        const margin = 40;
        const usableW = doc.page.width - margin * 2;
        const usableH = doc.page.height - doc.y - margin;

        doc.image(imageBuffer, {
          fit: [usableW, Math.max(160, usableH)],
          align: 'center',
        });

        doc.moveDown(0.5);
        doc.fontSize(8).fillColor('#525252').text(`Config: ${configId}`, { align: 'center' });
        doc.fillColor('#000000');
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
