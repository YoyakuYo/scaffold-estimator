import { Injectable } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import { promises as fs } from 'fs';
import { join } from 'path';

@Injectable()
export class EstimateTemplateService {
  async renderEstimate(estimate: any, companyInfo: any): Promise<string> {
    const templatePath = join(__dirname, 'templates', 'estimate-ja.hbs');
    const templateContent = await fs.readFile(templatePath, 'utf-8');

    // Register Japanese formatting helpers
    Handlebars.registerHelper('formatCurrency', (value: number) => {
      if (typeof value !== 'number') return '¥0';
      return new Intl.NumberFormat('ja-JP', {
        style: 'currency',
        currency: 'JPY',
        minimumFractionDigits: 0,
      }).format(value);
    });

    Handlebars.registerHelper('formatDate', (date: Date | string) => {
      const d = typeof date === 'string' ? new Date(date) : date;
      return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    });

    Handlebars.registerHelper('multiply', (a: number, b: number) => {
      return (a || 0) * (b || 0);
    });

    const template = Handlebars.compile(templateContent);
    return template({
      ...estimate,
      company: companyInfo,
      issueDate: new Date(),
      validUntilDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      estimateNumber: `EST-${estimate.id.substring(0, 8).toUpperCase()}`,
    });
  }
}
