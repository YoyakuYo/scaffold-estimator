import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TeamChatService } from './team-chat.service';
import { TeamChatController } from './team-chat.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [TeamChatController],
  providers: [TeamChatService],
})
export class TeamChatModule {}
