import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { EstimateTemplateService } from './estimate-template.service';

@Injectable()
export class PDFGeneratorService {
  private readonly logger = new Logger(PDFGeneratorService.name);

  constructor(private templateService: EstimateTemplateService) {}

  async generateEstimate(estimate: any, companyInfo: any): Promise<Buffer> {
    try {
      // Render HTML from template
      const html = await this.templateService.renderEstimate(estimate, companyInfo);

      // Launch Puppeteer
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();

      // Set content & generate PDF
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdf = await page.pdf({
        format: 'A4',
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm',
        },
        printBackground: true,
        scale: 1,
      });

      await browser.close();

      return Buffer.from(pdf);
    } catch (error) {
      this.logger.error(`PDF generation failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
