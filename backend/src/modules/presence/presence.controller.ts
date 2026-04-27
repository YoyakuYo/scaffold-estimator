import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PresenceService } from './presence.service';
import { RecordActionDto, UpdatePresenceDto } from './dto/update-presence.dto';
import type { UploadProductCode } from './upload-event.entity';

function ipFromReq(req: any): string | null {
  const xff = (req?.headers?.['x-forwarded-for'] as string | undefined) || '';
  const first = xff.split(',')[0]?.trim();
  return first || req?.ip || req?.socket?.remoteAddress || null;
}

function uaFromReq(req: any): string | null {
  return (req?.headers?.['user-agent'] as string | undefined) || null;
}

@Controller()
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 240, ttl: 60000 } })
  @Post('presence/update')
  async update(
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: UpdatePresenceDto,
  ) {
    return this.presence.updatePresence(user.id, {
      pageKey: dto.pageKey ?? null,
      label: dto.label ?? null,
      ipAddress: ipFromReq(req),
      userAgent: uaFromReq(req),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 240, ttl: 60000 } })
  @Post('presence/action')
  async action(
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: RecordActionDto,
  ) {
    return this.presence.recordAction(user.id, {
      action: dto.action,
      pageKey: dto.pageKey ?? null,
      label: dto.label ?? null,
      ipAddress: ipFromReq(req),
      userAgent: uaFromReq(req),
    });
  }

  // ─── User-scoped: my recent uploads (per product, for product dashboards) ─

  @UseGuards(JwtAuthGuard)
  @Get('uploads/mine')
  async getMyUploads(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('productCode') productCode?: UploadProductCode,
  ) {
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    return this.presence.getMyRecentUploads({
      userId: user.id,
      companyId: user.companyId ?? null,
      productCode,
      limit: Number.isFinite(parsed as number) ? (parsed as number) : undefined,
    });
  }

  // ─── Superadmin cockpit ────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('admin/presence/live')
  async getLivePresence() {
    return this.presence.getLivePresence();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('admin/upload-events')
  async getUploadEvents(
    @Query('limit') limit?: string,
    @Query('since') since?: string,
    @Query('productCode') productCode?: UploadProductCode,
    @Query('companyId') companyId?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.presence.getRecentUploadEvents({
      limit: Number.isFinite(parsedLimit as number) ? (parsedLimit as number) : undefined,
      sinceIso: since,
      productCode,
      companyId,
    });
  }
}
