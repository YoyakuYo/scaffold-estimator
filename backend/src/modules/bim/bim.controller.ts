import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProductAccessGuard } from '../../common/guards/product-access.guard';
import { RequiresProduct } from '../../common/decorators/requires-product.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PresenceService } from '../presence/presence.service';
import { BimService } from './bim.service';
import { PatchBimModelDto } from './dto/patch-bim-model.dto';

interface TrackUploadDto {
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

function caller(user: any) {
  return { userId: user.id, companyId: user.companyId ?? null, role: user.role };
}

/**
 * BIM Viewer API: audit trail (track-upload), persisted models (Storage +
 * bim_viewer_models), and signed download URLs for the SPA viewer.
 */
@Controller('bim')
@UseGuards(JwtAuthGuard, ProductAccessGuard)
@RequiresProduct('bim')
export class BimController {
  constructor(
    private readonly presence: PresenceService,
    private readonly bim: BimService,
  ) {}

  @Post('track-upload')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async trackUpload(@CurrentUser() user: any, @Body() dto: TrackUploadDto) {
    if (!dto?.filename) throw new BadRequestException('filename is required');
    const lower = dto.filename.toLowerCase();
    const kind = lower.endsWith('.ifc')
      ? 'ifc'
      : lower.endsWith('.dxf')
        ? 'dxf'
        : lower.endsWith('.pdf')
          ? 'pdf'
          : lower.endsWith('.dwg')
            ? 'dwg'
            : lower.endsWith('.png') ||
                lower.endsWith('.jpg') ||
                lower.endsWith('.jpeg') ||
                lower.endsWith('.webp') ||
                lower.endsWith('.gif') ||
                lower.endsWith('.bmp')
              ? 'image'
              : 'bim_other';
    await this.presence.recordUpload({
      userId: user.id,
      companyId: user.companyId ?? null,
      productCode: 'bim',
      kind,
      filename: dto.filename,
      mimeType: dto.mimeType ?? null,
      sizeBytes: typeof dto.sizeBytes === 'number' ? dto.sizeBytes : null,
      metadata: dto.metadata ?? null,
    });
    return { ok: true };
  }

  @Get('models')
  async listModels(@CurrentUser() user: any) {
    return this.bim.listModels(caller(user));
  }

  @Post('models')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 120 * 1024 * 1024 },
    }),
  )
  async uploadModel(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    const buffer = (file as any).buffer as Buffer | undefined;
    if (!buffer?.length) throw new BadRequestException('File has no content.');
    const raw = (req.body as { displayName?: unknown })?.displayName;
    const displayName =
      typeof raw === 'string' && raw.trim().length > 0 ? raw.trim().slice(0, 200) : null;
    return this.bim.createModelFromUpload(caller(user), {
      filename: file.originalname,
      mimeType: file.mimetype || null,
      buffer,
      displayName,
      metadata: {},
    });
  }

  @Get('models/:id')
  async getModel(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bim.getModel(caller(user), id);
  }

  @Get('models/:id/download-url')
  async downloadUrl(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bim.getSignedDownloadUrl(caller(user), id);
  }

  @Patch('models/:id')
  async patchModel(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: PatchBimModelDto,
  ) {
    return this.bim.patchModel(caller(user), id, dto);
  }

  @Delete('models/:id')
  async deleteModel(@CurrentUser() user: any, @Param('id') id: string) {
    await this.bim.deleteModel(caller(user), id);
    return { ok: true };
  }
}
