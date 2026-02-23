import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Estimate } from '../estimate/estimate.entity';
import { EstimateExport } from './estimate-export.entity';
import { PDFGeneratorService } from './pdf-generator.service';
import { ExcelGeneratorService } from './excel-generator.service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private s3Client: S3Client | null = null;

  constructor(
    @InjectRepository(Estimate)
    private estimateRepository: Repository<Estimate>,
    @InjectRepository(EstimateExport)
    private exportRepository: Repository<EstimateExport>,
    private pdfGenerator: PDFGeneratorService,
    private excelGenerator: ExcelGeneratorService,
    private configService: ConfigService,
  ) {
    // Initialize S3 client if configured
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    if (accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: this.configService.get<string>('AWS_REGION') || 'ap-northeast-1',
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }
  }

  async exportEstimate(
    estimateId: string,
    format: 'pdf' | 'excel',
    generatedBy: string,
  ): Promise<{ buffer: Buffer; filename: string; exportId: string }> {
    const estimate = await this.estimateRepository.findOne({
      where: { id: estimateId },
      relations: ['costBreakdown'],
    });

    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    // Company info (would come from company service in production)
    const companyInfo = {
      name: '株式会社サンプル',
      address: '東京都千代田区1-1-1',
      phone: '03-1234-5678',
    };

    // Generate file
    let buffer: Buffer;
    let filename: string;
    let mimeType: string;

    if (format === 'pdf') {
      buffer = await this.pdfGenerator.generateEstimate(estimate, companyInfo);
      filename = `estimate-${estimateId.substring(0, 8)}.pdf`;
      mimeType = 'application/pdf';
    } else {
      buffer = await this.excelGenerator.generateEstimate(estimate, companyInfo);
      filename = `estimate-${estimateId.substring(0, 8)}.xlsx`;
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    // Store in S3 if configured, otherwise use local storage
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
      // Local storage fallback
      const fs = require('fs').promises;
      const path = require('path');
      const uploadsDir = path.join(process.cwd(), 'exports');
      await fs.mkdir(uploadsDir, { recursive: true });
      filePath = path.join(uploadsDir, filename);
      await fs.writeFile(filePath, buffer);
    }

    // Create export record
    const exportRecord = this.exportRepository.create({
      estimateId,
      exportFormat: format,
      filePath,
      fileSizeBytes: buffer.length,
      generatedBy,
      s3Url: s3Url || undefined,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    } as Partial<EstimateExport>);

    const savedExport = await this.exportRepository.save(exportRecord);

    // Handle save returning array or single entity
    const savedEntity = Array.isArray(savedExport) ? savedExport[0] : savedExport;

    this.logger.log(`Export created: ${savedEntity.id} for estimate ${estimateId}`);

    return {
      buffer,
      filename,
      exportId: savedEntity.id,
    };
  }

  async getExport(exportId: string): Promise<EstimateExport> {
    const export_ = await this.exportRepository.findOne({
      where: { id: exportId },
      relations: ['estimate'],
    });

    if (!export_) {
      throw new NotFoundException('Export not found');
    }

    return export_;
  }
}
