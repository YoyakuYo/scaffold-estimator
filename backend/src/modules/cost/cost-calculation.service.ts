import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CostLineItem, CostCategory } from './cost-line-item.entity';
import { FormulaEvaluationService } from './formula-evaluation.service';
import { CostMasterService } from './cost-master.service';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

interface EstimateWithBreakdown {
  id: string;
  rentalStartDate: Date | string;
  rentalEndDate: Date | string;
  billOfMaterials: {
    totalArea: number;
    totalHeight: number;
    adjustmentCoefficient: number;
    components: Array<{ quantity: number }>;
  };
}

@Injectable()
export class CostCalculationService {
  private readonly logger = new Logger(CostCalculationService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private formulaService: FormulaEvaluationService,
    private costMasterService: CostMasterService,
  ) {}

  async compute(estimateId: string, companyId: string): Promise<CostLineItem[]> {
    const { data: row } = await this.supabase.getClient().from('estimates').select('*, cost_line_items(*)').eq('id', estimateId).maybeSingle();
    if (!row) throw new NotFoundException('Estimate not found');
    const estimate = row as any;
    const costItemsRaw = estimate.cost_line_items;
    let costItems: CostLineItem[] = Array.isArray(costItemsRaw) ? mapRowsToCamel<CostLineItem>(costItemsRaw) : [];

    const costConfigs = await this.costMasterService.getCostConfigurations(companyId);
    const rentalStart = new Date(estimate.rental_start_date);
    const rentalEnd = new Date(estimate.rental_end_date);
    const rentalDays = Math.ceil((rentalEnd.getTime() - rentalStart.getTime()) / (1000 * 60 * 60 * 24));
    const rentalWeeks = Math.ceil(rentalDays / 7);
    const rentalMonths = Math.ceil(rentalDays / 30);

    const bill = estimate.bill_of_materials || {};
    const context = {
      totalArea: bill.totalArea ?? bill.total_area ?? 0,
      totalHeight: bill.totalHeight ?? bill.total_height ?? 0,
      rentalDays,
      rentalWeeks,
      rentalMonths,
      totalComponents: (bill.components || []).reduce((sum: number, comp: any) => sum + (comp.quantity ?? 0), 0),
      adjustmentCoefficient: bill.adjustmentCoefficient ?? bill.adjustment_coefficient ?? 1,
      ...costConfigs,
    };

    if (costItems.length === 0) {
      costItems = await this.createInitialCostLineItems(estimateId, costConfigs);
    }

    for (const item of costItems) {
      if (item.isLocked && item.userEditedValue != null) {
        item.computedValue = item.userEditedValue;
      } else {
        try {
          item.computedValue = await this.formulaService.evaluate(item.formulaExpression, item.formulaVariables, context);
        } catch (error) {
          this.logger.error(`Formula evaluation failed for ${item.code}:`, error);
          item.computedValue = 0;
        }
      }
    }

    const client = this.supabase.getClient();
    for (const item of costItems) {
      await client.from('cost_line_items').update(mapPayloadToSnake({ computedValue: item.computedValue })).eq('id', item.id);
    }
    const total = costItems.reduce((sum, item) => sum + item.computedValue, 0);
    await client.from('estimates').update(mapPayloadToSnake({ totalEstimatedCost: total })).eq('id', estimateId);
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

    const inserts = items.map((i) => mapPayloadToSnake(i as Record<string, unknown>));
    const { data: saved } = await this.supabase.getClient().from('cost_line_items').insert(inserts).select();
    return mapRowsToCamel<CostLineItem>(saved || []);
  }
}
