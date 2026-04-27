import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { ProductAccessGuard } from '../../common/guards/product-access.guard';

@Module({
  imports: [],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, ProductAccessGuard],
  exports: [SubscriptionService, ProductAccessGuard],
})
export class SubscriptionModule {}
