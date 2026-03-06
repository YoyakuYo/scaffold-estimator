import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionActiveGuard } from '../../common/guards/subscription-active.guard';
import { VisionBimService, VisionFootprintResult } from './vision-bim.service';

@Controller('vision-bim')
@UseGuards(JwtAuthGuard, SubscriptionActiveGuard)
export class VisionBimController {
  constructor(private readonly visionBim: VisionBimService) {}

  /**
   * POST /vision-bim/analyze
   * Accepts image (PNG, JPEG, etc.), DXF, DWG, JWW, or PDF. Returns structured footprint JSON.
   */
  @Post('analyze')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
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
      throw new BadRequestException(err?.message || 'File processing failed');
    }
  }
}
