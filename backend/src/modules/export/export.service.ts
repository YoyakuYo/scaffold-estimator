import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EstimateExport } from './estimate-export.entity';
import { PDFGeneratorService } from './pdf-generator.service';
import { ExcelGeneratorService } from './excel-generator.service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';
import { Estimate } from '../estimate/estimate.entity';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private s3Client: S3Client | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private pdfGenerator: PDFGeneratorService,
    private excelGenerator: ExcelGeneratorService,
    private configService: ConfigService,
  ) {
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    if (accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: this.configService.get<string>('AWS_REGION') || 'ap-northeast-1',
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  async exportEstimate(
    estimateId: string,
    format: 'pdf' | 'excel',
    generatedBy: string,
  ): Promise<{ buffer: Buffer; filename: string; exportId: string }> {
    const { data: row } = await this.supabase.getClient().from('estimates').select('*, cost_line_items(*)').eq('id', estimateId).maybeSingle();
    if (!row) throw new NotFoundException('Estimate not found');
    const estimate = mapRowToCamel(row as Record<string, unknown>);
    if (!estimate) throw new NotFoundException('Estimate not found');
    const costBreakdown = (row as any).cost_line_items ? mapRowsToCamel((row as any).cost_line_items) : [];
    (estimate as any).costBreakdown = costBreakdown;

    const companyInfo = {
      name: '株式会社サンプル',
      address: '東京都千代田区1-1-1',
      phone: '03-1234-5678',
    };

    let buffer: Buffer;
    let filename: string;
    let mimeType: string;

    if (format === 'pdf') {
      buffer = await this.pdfGenerator.generateEstimate(estimate as unknown as Estimate, companyInfo);
      filename = `estimate-${estimateId.substring(0, 8)}.pdf`;
      mimeType = 'application/pdf';
    } else {
      buffer = await this.excelGenerator.generateEstimate(estimate as unknown as Estimate, companyInfo);
      filename = `estimate-${estimateId.substring(0, 8)}.xlsx`;
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    let filePath: string;
    let s3Url: string | undefined;

    if (this.s3Client) {
      const s3Key = `exports/${estimateId}/${filename}`;
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.configService.get('AWS_S3_BUCKET'),
          Key: s3Key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
      s3Url = `https://${this.configService.get('AWS_S3_BUCKET')}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${s3Key}`;
      filePath = s3Key;
    } else {
      const fs = require('fs').promises;
      const path = require('path');
      const uploadsDir = path.join(process.cwd(), 'exports');
      await fs.mkdir(uploadsDir, { recursive: true });
      filePath = path.join(uploadsDir, filename);
      await fs.writeFile(filePath, buffer);
    }

    const ins = mapPayloadToSnake({
      estimateId,
      exportFormat: format,
      filePath,
      fileSizeBytes: buffer.length,
      generatedBy,
      s3Url: s3Url || null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const { data: saved, error } = await this.supabase.getClient().from('estimate_exports').insert(ins).select().single();
    if (error || !saved) throw new Error(error?.message || 'Insert failed');
    const savedEntity = mapRowToCamel<EstimateExport>(saved as Record<string, unknown>)!;

    this.logger.log(`Export created: ${savedEntity.id} for estimate ${estimateId}`);

    return { buffer, filename, exportId: savedEntity.id };
  }

  async getExport(exportId: string): Promise<EstimateExport> {
    const { data: row } = await this.supabase.getClient().from('estimate_exports').select('*, estimates(*)').eq('id', exportId).maybeSingle();
    if (!row) throw new NotFoundException('Export not found');
    return mapRowToCamel<EstimateExport>(row as Record<string, unknown>)!;
  }
}
