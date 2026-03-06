import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionModule } from '../subscription/subscription.module';
import { SubscriptionActiveGuard } from '../../common/guards/subscription-active.guard';
import { VisionBimController } from './vision-bim.controller';
import { VisionBimService } from './vision-bim.service';

@Module({
  imports: [ConfigModule, SubscriptionModule],
  controllers: [VisionBimController],
  providers: [VisionBimService, SubscriptionActiveGuard],
  exports: [VisionBimService],
})
export class VisionBimModule {}
