import { Body, Controller, Get, Patch, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { WebPushService } from './web-push.service';
import { PushSubscribeDto } from './dto/push-subscribe.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private webPushService: WebPushService,
  ) {}

  /** Register Web Push subscription (PWA / installed app). Requires VAPID keys on the server. */
  @UseGuards(JwtAuthGuard)
  @Post('push/subscribe')
  async subscribePush(@CurrentUser() user: any, @Body() dto: PushSubscribeDto, @Req() req: Request) {
    await this.webPushService.saveSubscription(user.id, dto, req.headers['user-agent']);
    return { ok: true };
  }

  /** Public (no auth): used by the client to subscribe with `pushManager.subscribe`. */
  @Get('push/vapid-public-key')
  vapidPublicKey() {
    return { publicKey: this.webPushService.getPublicKey() };
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@CurrentUser() user: any) {
    return this.notificationsService.listForUser(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: any) {
    const count = await this.notificationsService.getUnreadCount(user.id);
    return { count };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('read-all')
  async markAllRead(@CurrentUser() user: any) {
    await this.notificationsService.markAllAsRead(user.id);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  async markRead(@CurrentUser() user: any, @Param('id') id: string) {
    await this.notificationsService.markAsRead(id, user.id);
    return { ok: true };
  }
}
