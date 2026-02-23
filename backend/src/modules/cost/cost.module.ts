import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CostController } from './cost.controller';
import { CostCalculationService } from './cost-calculation.service';
import { FormulaEvaluationService } from './formula-evaluation.service';
import { CostMasterService } from './cost-master.service';
import { CostLineItem } from './cost-line-item.entity';
import { CostMasterData } from './cost-master.entity';
import { Estimate } from '../estimate/estimate.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CostLineItem, CostMasterData, Estimate])],
  controllers: [CostController],
  providers: [CostCalculationService, FormulaEvaluationService, CostMasterService],
  exports: [CostCalculationService, CostMasterService, FormulaEvaluationService],
})
export class CostModule {}
