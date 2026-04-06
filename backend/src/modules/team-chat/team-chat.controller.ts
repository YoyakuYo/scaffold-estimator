import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TeamChatService } from './team-chat.service';
import { SendTeamChatMessageDto } from './dto/send-team-chat-message.dto';

@Controller('team-chat')
@UseGuards(JwtAuthGuard)
export class TeamChatController {
  constructor(private readonly teamChatService: TeamChatService) {}

  @Get('messages')
  async list(@CurrentUser() user: { id: string }, @Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 80;
    return this.teamChatService.listMessages(user.id, Number.isFinite(n) ? n : 80);
  }

  @Post('messages')
  async send(@CurrentUser() user: { id: string }, @Body() dto: SendTeamChatMessageDto) {
    return this.teamChatService.sendMessage(user.id, dto.body);
  }
}
