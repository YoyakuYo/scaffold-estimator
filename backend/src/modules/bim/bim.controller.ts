import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProductAccessGuard } from '../../common/guards/product-access.guard';
import { RequiresProduct } from '../../common/decorators/requires-product.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PresenceService } from '../presence/presence.service';

interface TrackUploadDto {
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Optional metadata: detected element type counts, storeys, etc. */
  metadata?: Record<string, unknown>;
}

/**
 * Phase 5 — BIM Viewer.
 *
 * IFC parsing happens client-side via `web-ifc` (already wired in
 * `frontend/lib/ifc-loader.ts`); the backend only logs the upload into
 * `upload_events` so the superadmin cockpit sees BIM activity in the unified
 * feed and the gate (@RequiresProduct('bim')) is exercised.
 */
@Controller('bim')
@UseGuards(JwtAuthGuard, ProductAccessGuard)
@RequiresProduct('bim')
export class BimController {
  constructor(private readonly presence: PresenceService) {}

  @Post('track-upload')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async trackUpload(@CurrentUser() user: any, @Body() dto: TrackUploadDto) {
    if (!dto?.filename) throw new BadRequestException('filename is required');
    const lower = dto.filename.toLowerCase();
    const kind = lower.endsWith('.ifc')
      ? 'ifc'
      : lower.endsWith('.dxf')
        ? 'dxf'
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
}
