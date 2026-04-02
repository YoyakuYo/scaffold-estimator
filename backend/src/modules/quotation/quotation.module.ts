import { Module } from '@nestjs/common';
import { QuotationController } from './quotation.controller';
import { QuotationService } from './quotation.service';
import { QuotationCostService } from './quotation-cost.service';
import { QuotationExcelService } from './quotation-excel.service';
import { ScaffoldConfigModule } from '../scaffold-config/scaffold-config.module';
import { CostModule } from '../cost/cost.module';

@Module({
  imports: [ScaffoldConfigModule, CostModule],
  controllers: [QuotationController],
  providers: [QuotationService, QuotationCostService, QuotationExcelService],
  exports: [QuotationService],
})
export class QuotationModule {}
