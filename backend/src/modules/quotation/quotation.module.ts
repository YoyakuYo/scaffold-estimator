import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quotation } from './quotation.entity';
import { QuotationItem } from './quotation-item.entity';
import { QuotationCostItem } from './quotation-cost-item.entity';
import { QuotationController } from './quotation.controller';
import { QuotationService } from './quotation.service';
import { QuotationCostService } from './quotation-cost.service';
import { ScaffoldConfigModule } from '../scaffold-config/scaffold-config.module';
import { CostModule } from '../cost/cost.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Quotation, QuotationItem, QuotationCostItem]),
    ScaffoldConfigModule,
    CostModule,
  ],
  controllers: [QuotationController],
  providers: [QuotationService, QuotationCostService],
  exports: [QuotationService],
})
export class QuotationModule {}
