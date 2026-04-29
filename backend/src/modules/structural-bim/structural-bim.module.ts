import { Module } from '@nestjs/common';
import { BimModule } from '../bim/bim.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { StructuralBimController } from './structural-bim.controller';
import { StructuralBimService } from './structural-bim.service';

@Module({
  imports: [BimModule, SubscriptionModule],
  controllers: [StructuralBimController],
  providers: [StructuralBimService],
  exports: [StructuralBimService],
})
export class StructuralBimModule {}
