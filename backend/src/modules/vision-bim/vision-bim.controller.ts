import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionActiveGuard } from '../../common/guards/subscription-active.guard';
import { SubscriptionAiGuard } from '../../common/guards/subscription-ai.guard';
import {
  VisionBimService,
  VisionFootprintResult,
  type PremiumScheduleImportResult,
  type SteppedMassingAiResult,
} from './vision-bim.service';

@Controller('vision-bim')
@UseGuards(JwtAuthGuard, SubscriptionActiveGuard, SubscriptionAiGuard)
export class VisionBimController {
  constructor(private readonly visionBim: VisionBimService) {}

  /**
   * POST /vision-bim/analyze
   * AI extraction: Accepts image (PNG/JPEG/WebP/GIF/BMP), PDF, or DXF.
   * Uses Claude Vision for images/PDFs; deterministic parser for DXF.
   * Returns structured footprint JSON with vertices, dimensions, and building height.
   */
  @Post('analyze')
  @Throttle({ default: { limit: 24, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async analyze(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<VisionFootprintResult> {
    if (!file) throw new BadRequestException('No file uploaded');
    const buffer = (file as any).buffer as Buffer | undefined;
    if (!buffer?.length) throw new BadRequestException('File has no content');
    const filename = file.originalname;
    try {
      return await this.visionBim.processFile(buffer, filename);
    } catch (err: any) {
      const msg = err?.message || 'File processing failed';
      if (
        msg.includes('ANTHROPIC_API_KEY') ||
        msg.includes('network') ||
        msg.includes('timeout')
      ) {
        throw new InternalServerErrorException(msg);
      }
      throw new BadRequestException(msg);
    }
  }

  /**
   * POST /vision-bim/extract-dimensions
   * Non-AI extraction: Accepts image (PNG/JPEG/WebP), PDF, or DXF.
   * For DXF: deterministic parser extracts geometry.
   * For images/PDFs: uses OCR-like dimension reading (still AI-backed but focused on dimensions only).
   * Returns same VisionFootprintResult structure.
   */
  @Post('extract-dimensions')
  @Throttle({ default: { limit: 24, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async extractDimensions(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<VisionFootprintResult> {
    if (!file) throw new BadRequestException('No file uploaded');
    const buffer = (file as any).buffer as Buffer | undefined;
    if (!buffer?.length) throw new BadRequestException('File has no content');
    const filename = file.originalname;
    try {
      return await this.visionBim.processFile(buffer, filename);
    } catch (err: any) {
      const msg = err?.message || 'File processing failed';
      if (
        msg.includes('ANTHROPIC_API_KEY') ||
        msg.includes('network') ||
        msg.includes('timeout')
      ) {
        throw new InternalServerErrorException(msg);
      }
      throw new BadRequestException(msg);
    }
  }

  /**
   * POST /vision-bim/analyze-stepped-massing
   * Raster images only: AI suggests depth, taper axis, per-tier lengths/heights for the stepped wizard.
   */
  @Post('analyze-stepped-massing')
  @Throttle({ default: { limit: 24, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async analyzeSteppedMassing(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<SteppedMassingAiResult> {
    if (!file) throw new BadRequestException('No file uploaded');
    const buffer = (file as any).buffer as Buffer | undefined;
    if (!buffer?.length) throw new BadRequestException('File has no content');
    const filename = file.originalname;
    try {
      return await this.visionBim.processSteppedMassingImage(buffer, filename);
    } catch (err: any) {
      const msg = err?.message || 'Stepped massing analysis failed';
      if (
        msg.includes('ANTHROPIC_API_KEY') ||
        msg.includes('network') ||
        msg.includes('timeout')
      ) {
        throw new InternalServerErrorException(msg);
      }
      throw new BadRequestException(msg);
    }
  }

  /**
   * Premium: Import companion wall schedule (JSON v1, CSV edge/length, or span-configuration .txt).
   * Same subscription guard as AI extraction (Premium tier).
   */
  @Post('import-premium-schedule')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  importPremiumSchedule(@UploadedFile() file: Express.Multer.File): PremiumScheduleImportResult {
    if (!file) throw new BadRequestException('No file uploaded');
    const buffer = (file as any).buffer as Buffer | undefined;
    if (!buffer?.length) throw new BadRequestException('File has no content');
    try {
      return this.visionBim.importPremiumSchedule(buffer, file.originalname);
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Schedule import failed');
    }
  }
}
