import { BadRequestException, Body, Controller, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformService } from './platform.service';

@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  /** Public status for signup page and marketing layouts. */
  @Get('public-status')
  async publicStatus() {
    return this.platformService.getPublicStatus();
  }

  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Post('analytics/track')
  async track(
    @Body()
    body: {
      eventType?: string;
      path?: string;
      referrer?: string;
      anonKey?: string;
    },
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.platformService.trackEvent({
      eventType: body.eventType?.trim() || 'page_view',
      path: body.path?.slice(0, 2000),
      referrer: (body.referrer || (req.headers.referer as string) || '')?.slice(0, 2000),
      userAgent: (req.headers['user-agent'] as string)?.slice(0, 800),
      anonKey: body.anonKey?.slice(0, 128),
      userId: null,
    });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('settings')
  settings() {
    return this.platformService.getSettingsForSuperadmin();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Put('settings')
  updateSettings(
    @CurrentUser() user: { id: string },
    @Body()
    body: Partial<{
      featureDisableSignup: boolean;
      featureDisableAiExtraction: boolean;
      featureDisableFileUploads: boolean;
      maintenanceMode: boolean;
      maintenanceMessage: string | null;
    }>,
  ) {
    return this.platformService.updateSettings(user.id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('analytics/summary')
  analyticsSummary() {
    return this.platformService.getAnalyticsSummary();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  async analyticsLogins(@Query('limit') limit?: string) {
    const n = parseInt(limit || '80', 10);
    return this.platformService.listRecentLoginsWithEmails(Number.isFinite(n) ? n : 80);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  audit(@Query('limit') limit?: string) {
    const n = parseInt(limit || '80', 10);
    return this.platformService.listAudit(Number.isFinite(n) ? n : 80);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('broadcast')
  broadcast(
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      title: string;
      body?: string;
      link?: string;
      audience?: 'subscribed' | 'all_approved';
      sendEmail?: boolean;
    },
  ) {
    const title = body.title?.trim();
    if (!title) throw new BadRequestException('title is required');
    return this.platformService.broadcastToAudience({
      actorId: user.id,
      title,
      body: body.body?.trim(),
      link: body.link?.trim(),
      audience: body.audience === 'all_approved' ? 'all_approved' : 'subscribed',
      sendEmail: !!body.sendEmail,
    });
  }
}
