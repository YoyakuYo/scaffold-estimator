import { Module } from '@nestjs/common';
import { BimController } from './bim.controller';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [SubscriptionModule, PresenceModule],
  controllers: [BimController],
})
export class BimModule {}
