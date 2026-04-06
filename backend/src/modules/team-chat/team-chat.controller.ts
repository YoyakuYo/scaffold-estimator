import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TeamChatService } from './team-chat.service';
import { SendTeamChatMessageDto } from './dto/send-team-chat-message.dto';

@Controller('team-chat')
@UseGuards(JwtAuthGuard)
export class TeamChatController {
  constructor(private readonly teamChatService: TeamChatService) {}

  @Get('peers')
  async peers(@CurrentUser() user: { id: string }) {
    return this.teamChatService.listPeers(user.id);
  }

  @Get('messages')
  async list(@CurrentUser() user: { id: string }, @Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 80;
    return this.teamChatService.listMessages(user.id, Number.isFinite(n) ? n : 80);
  }

  @Post('messages')
  async send(@CurrentUser() user: { id: string }, @Body() dto: SendTeamChatMessageDto) {
    return this.teamChatService.sendMessage(user.id, dto.body);
  }

  @Get('dm/:peerUserId/peer')
  async dmPeer(@CurrentUser() user: { id: string }, @Param('peerUserId') peerUserId: string) {
    return this.teamChatService.getDmPeerProfile(user.id, peerUserId);
  }

  @Get('dm/:peerUserId/messages')
  async listDm(
    @CurrentUser() user: { id: string },
    @Param('peerUserId') peerUserId: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 80;
    return this.teamChatService.listDmMessages(user.id, peerUserId, Number.isFinite(n) ? n : 80);
  }

  @Post('dm/:peerUserId/messages')
  async sendDm(
    @CurrentUser() user: { id: string },
    @Param('peerUserId') peerUserId: string,
    @Body() dto: SendTeamChatMessageDto,
  ) {
    return this.teamChatService.sendDmMessage(user.id, peerUserId, dto.body);
  }
}
