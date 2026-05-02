import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionModule } from '../subscription/subscription.module';
import { SubscriptionActiveGuard } from '../../common/guards/subscription-active.guard';
import { SubscriptionAiGuard } from '../../common/guards/subscription-ai.guard';
import { VisionBimController } from './vision-bim.controller';
import { VisionBimService } from './vision-bim.service';
import { PresenceModule } from '../presence/presence.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [ConfigModule, SubscriptionModule, PresenceModule, PlatformModule],
  controllers: [VisionBimController],
  providers: [VisionBimService, SubscriptionActiveGuard, SubscriptionAiGuard],
  exports: [VisionBimService],
})
export class VisionBimModule {}
