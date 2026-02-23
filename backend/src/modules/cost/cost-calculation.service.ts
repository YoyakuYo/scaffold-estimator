import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CostLineItem, CostCategory } from './cost-line-item.entity';
import { Estimate } from '../estimate/estimate.entity';
import { FormulaEvaluationService } from './formula-evaluation.service';
import { CostMasterService } from './cost-master.service';

@Injectable()
export class CostCalculationService {
  private readonly logger = new Logger(CostCalculationService.name);

  constructor(
    @InjectRepository(CostLineItem)
    private costItemRepository: Repository<CostLineItem>,
    @InjectRepository(Estimate)
    private estimateRepository: Repository<Estimate>,
    private formulaService: FormulaEvaluationService,
    private costMasterService: CostMasterService,
  ) {}

  async compute(estimateId: string, companyId: string): Promise<CostLineItem[]> {
    const estimate = await this.estimateRepository.findOne({
      where: { id: estimateId },
      relations: ['costBreakdown'],
    });

    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    // Get cost master data for company
    const costConfigs = await this.costMasterService.getCostConfigurations(companyId);

    // Calculate rental duration
    const rentalStart = new Date(estimate.rentalStartDate);
    const rentalEnd = new Date(estimate.rentalEndDate);
    const rentalDays = Math.ceil((rentalEnd.getTime() - rentalStart.getTime()) / (1000 * 60 * 60 * 24));
    const rentalWeeks = Math.ceil(rentalDays / 7);
    const rentalMonths = Math.ceil(rentalDays / 30);

    // Build evaluation context
    const context = {
      totalArea: estimate.billOfMaterials.totalArea,
      totalHeight: estimate.billOfMaterials.totalHeight,
      rentalDays,
      rentalWeeks,
      rentalMonths,
      totalComponents: estimate.billOfMaterials.components.reduce(
        (sum, comp) => sum + comp.quantity,
        0,
      ),
      adjustmentCoefficient: estimate.billOfMaterials.adjustmentCoefficient,
      ...costConfigs,
    };

    // Get or create cost line items
    let costItems = estimate.costBreakdown || [];

    if (costItems.length === 0) {
      // Create initial cost line items
      costItems = await this.createInitialCostLineItems(estimateId, costConfigs);
    }

    // Evaluate formulas in dependency order
    for (const item of costItems) {
      if (item.isLocked && item.userEditedValue !== null) {
        // Use user-edited value if locked
        item.computedValue = item.userEditedValue;
      } else {
        try {
          item.computedValue = await this.formulaService.evaluate(
            item.formulaExpression,
            item.formulaVariables,
            context,
          );
        } catch (error) {
          this.logger.error(`Formula evaluation failed for ${item.code}:`, error);
          item.computedValue = 0; // Fallback
        }
      }
    }

    // Save updated values
    await this.costItemRepository.save(costItems);

    // Update estimate total
    const total = costItems.reduce((sum, item) => sum + item.computedValue, 0);
    await this.estimateRepository.update(estimateId, {
      totalEstimatedCost: total,
    });

    return costItems;
  }

  private async createInitialCostLineItems(
    estimateId: string,
    costConfigs: Record<string, any>,
  ): Promise<CostLineItem[]> {
    const items: Partial<CostLineItem>[] = [
      {
        estimateId,
        code: 'basic_material',
        name: '仮設材基本料',
        category: 'basic_charge',
        formulaExpression: 'totalArea * materialBasicRate * rentalMonths * adjustmentCoefficient',
        formulaVariables: {
          totalArea: { name: 'totalArea', source: 'geometry' },
          materialBasicRate: { name: 'materialBasicRate', source: 'master_data', value: costConfigs.materialBasicRate || 5000 },
          rentalMonths: { name: 'rentalMonths', source: 'rental_config' },
          adjustmentCoefficient: { name: 'adjustmentCoefficient', source: 'geometry' },
        },
        computedValue: 0,
      },
      {
        estimateId,
        code: 'material_wear',
        name: '仮設材損料',
        category: 'damage_charge',
        formulaExpression: 'basicMaterialCost * (wearRatePercent / 100) * rentalDays',
        formulaVariables: {
          basicMaterialCost: { name: 'basicMaterialCost', source: 'user_input' },
          wearRatePercent: { name: 'wearRatePercent', source: 'master_data', value: costConfigs.wearRatePercent || 1.0 },
          rentalDays: { name: 'rentalDays', source: 'rental_config' },
        },
        computedValue: 0,
      },
      {
        estimateId,
        code: 'transportation',
        name: '運搬費',
        category: 'transport',
        formulaExpression: 'totalComponents * transportCostPerComponent',
        formulaVariables: {
          totalComponents: { name: 'totalComponents', source: 'geometry' },
          transportCostPerComponent: { name: 'transportCostPerComponent', source: 'master_data', value: costConfigs.transportRate || 500 },
        },
        computedValue: 0,
      },
      {
        estimateId,
        code: 'disposal',
        name: '滅失費',
        category: 'loss',
        formulaExpression: '(totalMaterialValue * disposalRatePercent) / 100',
        formulaVariables: {
          totalMaterialValue: { name: 'totalMaterialValue', source: 'user_input' },
          disposalRatePercent: { name: 'disposalRatePercent', source: 'master_data', value: costConfigs.disposalRatePercent || 5 },
        },
        computedValue: 0,
      },
      {
        estimateId,
        code: 'surface_prep',
        name: 'ケレン費',
        category: 'cleaning',
        formulaExpression: '(totalMaterialValue * surfacePrepRatePercent) / 100',
        formulaVariables: {
          totalMaterialValue: { name: 'totalMaterialValue', source: 'user_input' },
          surfacePrepRatePercent: { name: 'surfacePrepRatePercent', source: 'master_data', value: costConfigs.surfacePrepRatePercent || 3 },
        },
        computedValue: 0,
      },
      {
        estimateId,
        code: 'repair_reserve',
        name: '修理代金',
        category: 'repair',
        formulaExpression: '(basicMaterialCost * repairRatePercent / 100) * durationFactor',
        formulaVariables: {
          basicMaterialCost: { name: 'basicMaterialCost', source: 'user_input' },
          repairRatePercent: { name: 'repairRatePercent', source: 'master_data', value: costConfigs.repairRate || 2 },
          durationFactor: { name: 'durationFactor', source: 'rental_config' },
        },
        computedValue: 0,
      },
    ];

    return await this.costItemRepository.save(items as CostLineItem[]);
  }
}
