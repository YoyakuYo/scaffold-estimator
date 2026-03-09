import { Module } from '@nestjs/common';
import { CostController } from './cost.controller';
import { CostCalculationService } from './cost-calculation.service';
import { FormulaEvaluationService } from './formula-evaluation.service';
import { CostMasterService } from './cost-master.service';

@Module({
  imports: [],
  controllers: [CostController],
  providers: [CostCalculationService, FormulaEvaluationService, CostMasterService],
  exports: [CostCalculationService, CostMasterService, FormulaEvaluationService],
})
export class CostModule {}
