import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

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
