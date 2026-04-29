import { Module } from '@nestjs/common';
import { BimController } from './bim.controller';
import { BimService } from './bim.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [SubscriptionModule, PresenceModule],
  controllers: [BimController],
  providers: [BimService],
  exports: [BimService],
})
export class BimModule {}
