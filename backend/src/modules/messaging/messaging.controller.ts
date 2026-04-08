import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessagingService } from './messaging.service';
import { SendMessageDto } from './dto/send-message.dto';
import { AdminStartConversationDto } from './dto/admin-start-conversation.dto';
import { PublicContactDto } from './dto/public-contact.dto';

@Controller('messages')
export class MessagingController {
  private readonly logger = new Logger(MessagingController.name);

  constructor(private messagingService: MessagingService) {}

  /** Public landing-page contact (no auth). Emails superadmins + in-app notification. */
  @Post('public-contact')
  @HttpCode(HttpStatus.OK)
  async publicContact(@Body() dto: PublicContactDto) {
    return this.messagingService.submitPublicContact(dto.name, dto.email, dto.message, dto.hp);
  }

  /** Get my conversation (user). */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMyConversation(@CurrentUser() user: any) {
    this.logger.log(`GET messages/me userId=${user.id}`);
    const conv = await this.messagingService.getMyConversation(user.id);
    if (!conv) return { conversation: null, messages: [] };
    const messages = await this.messagingService.getMessages(conv.id, user.id, false);
    return { conversation: conv, messages };
  }

  /** Get unread count (user). */
  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: any) {
    this.logger.log(`GET messages/unread-count userId=${user.id}`);
    const count = await this.messagingService.getUnreadCountForUser(user.id);
    return { count };
  }

  /** Send a message as current user (user support page). */
  @UseGuards(JwtAuthGuard)
  @Post('send')
  async sendAsUser(@CurrentUser() user: any, @Body() dto: SendMessageDto) {
    this.logger.log(`POST messages/send userId=${user.id} bodyLength=${dto.body?.length ?? 0}`);
    const msg = await this.messagingService.sendMessageByUser(user.id, dto.body);
    return msg;
  }

  /** Mark my conversation as read (user). */
  @UseGuards(JwtAuthGuard)
  @Post('mark-read')
  async markRead(@CurrentUser() user: any) {
    this.logger.log(`POST messages/mark-read userId=${user.id}`);
    const conv = await this.messagingService.getMyConversation(user.id);
    if (conv) await this.messagingService.markAsRead(conv.id, user.id);
    return { ok: true };
  }

  // ─── Admin ─────────────────────────────────────────────────

  /** List all conversations (admin). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('admin/conversations')
  async listConversations() {
    this.logger.log('GET messages/admin/conversations');
    return this.messagingService.getAllConversations();
  }

  /** Get messages in a conversation (admin). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('admin/conversations/:id/messages')
  async getConversationMessages(@CurrentUser() user: any, @Param('id') id: string) {
    this.logger.log(`GET messages/admin/conversations/${id}/messages adminId=${user.id}`);
    return this.messagingService.getMessages(id, user.id, true);
  }

  /** Admin replies to a conversation. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('admin/conversations/:id/reply')
  async adminReply(
    @CurrentUser() admin: any,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    this.logger.log(
      `POST messages/admin/conversations/${conversationId}/reply adminId=${admin.id} bodyLength=${dto.body?.length ?? 0}`,
    );
    const msg = await this.messagingService.sendMessage(
      conversationId,
      admin.id,
      dto.body,
    );
    return msg;
  }

  /** Admin initiates a new conversation with any user. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('admin/new')
  async adminCreateConversation(
    @CurrentUser() admin: any,
    @Body() dto: AdminStartConversationDto,
  ) {
    this.logger.log(`POST messages/admin/new adminId=${admin.id} targetUserId=${dto.userId}`);
    return this.messagingService.createConversationAndSend(
      admin.id,
      dto.userId,
      dto.body,
    );
  }

  /** Admin marks conversation as read. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('admin/conversations/:id/mark-read')
  async adminMarkRead(@CurrentUser() admin: any, @Param('id') id: string) {
    this.logger.log(`POST messages/admin/conversations/${id}/mark-read adminId=${admin.id}`);
    await this.messagingService.markAsRead(id, admin.id);
    return { ok: true };
  }
}
