import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionActiveGuard } from '../../common/guards/subscription-active.guard';
import { SubscriptionAiGuard } from '../../common/guards/subscription-ai.guard';
import { VisionBimService, VisionFootprintResult } from './vision-bim.service';

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
}
