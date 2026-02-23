import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessagingService } from './messaging.service';

@Controller('messages')
export class MessagingController {
  constructor(private messagingService: MessagingService) {}

  /** Get my conversation (user). */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMyConversation(@CurrentUser() user: any) {
    const conv = await this.messagingService.getMyConversation(user.id);
    if (!conv) return { conversation: null, messages: [] };
    const messages = await this.messagingService.getMessages(conv.id, user.id, false);
    return { conversation: conv, messages };
  }

  /** Get unread count (user). */
  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: any) {
    const count = await this.messagingService.getUnreadCountForUser(user.id);
    return { count };
  }

  /** Send a message as current user (user support page). */
  @UseGuards(JwtAuthGuard)
  @Post('send')
  async sendAsUser(@CurrentUser() user: any, @Body() body: { body: string }) {
    const msg = await this.messagingService.sendMessageByUser(user.id, body.body || '');
    return msg;
  }

  /** Mark my conversation as read (user). */
  @UseGuards(JwtAuthGuard)
  @Post('mark-read')
  async markRead(@CurrentUser() user: any) {
    const conv = await this.messagingService.getMyConversation(user.id);
    if (conv) await this.messagingService.markAsRead(conv.id, user.id);
    return { ok: true };
  }

  // ─── Admin ─────────────────────────────────────────────────

  /** List all conversations (admin). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('admin/conversations')
  async listConversations() {
    return this.messagingService.getAllConversations();
  }

  /** Get messages in a conversation (admin). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('admin/conversations/:id/messages')
  async getConversationMessages(@CurrentUser() user: any, @Param('id') id: string) {
    return this.messagingService.getMessages(id, user.id, true);
  }

  /** Admin replies to a conversation. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('admin/conversations/:id/reply')
  async adminReply(
    @CurrentUser() admin: any,
    @Param('id') conversationId: string,
    @Body() body: { body: string },
  ) {
    const msg = await this.messagingService.sendMessage(
      conversationId,
      admin.id,
      body.body || '',
    );
    return msg;
  }

  /** Admin marks conversation as read. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('admin/conversations/:id/mark-read')
  async adminMarkRead(@CurrentUser() admin: any, @Param('id') id: string) {
    await this.messagingService.markAsRead(id, admin.id);
    return { ok: true };
  }
}
