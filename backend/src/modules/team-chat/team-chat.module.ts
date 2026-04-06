import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TeamChatService } from './team-chat.service';
import { TeamChatController } from './team-chat.controller';

@Module({
  imports: [SupabaseModule, NotificationsModule],
  controllers: [TeamChatController],
  providers: [TeamChatService],
})
export class TeamChatModule {}
