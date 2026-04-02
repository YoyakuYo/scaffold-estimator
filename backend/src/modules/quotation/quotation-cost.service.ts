import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { QuotationCostItem, CostCategory } from './quotation-cost-item.entity';
import { Quotation } from './quotation.entity';
import { FormulaEvaluationService } from '../cost/formula-evaluation.service';
import { CostMasterService } from '../cost/cost-master.service';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

@Injectable()
export class QuotationCostService {
  private readonly logger = new Logger(QuotationCostService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private formulaService: FormulaEvaluationService,
    private costMasterService: CostMasterService,
  ) {}

  async calculateCosts(
    quotation: Quotation,
    materialSubtotal: number,
    totalComponents: number,
    totalArea: number,
    companyId: string,
    costAmountOverrides?: Record<string, number> | null,
  ): Promise<QuotationCostItem[]> {
    try {
      if (!quotation?.id) throw new Error('Quotation is required and must have an id');
      if (!quotation.rentalStartDate || !quotation.rentalEndDate) throw new Error('Quotation must have rental start and end dates');
      if (typeof materialSubtotal !== 'number' || isNaN(materialSubtotal)) materialSubtotal = 0;
      if (typeof totalComponents !== 'number' || isNaN(totalComponents)) totalComponents = 0;
      if (typeof totalArea !== 'number' || isNaN(totalArea)) totalArea = 0;

      const costConfigs = await this.costMasterService.getCostConfigurations(companyId || 'default', '東京');
      const rentalStart = new Date(quotation.rentalStartDate);
      const rentalEnd = new Date(quotation.rentalEndDate);
      if (isNaN(rentalStart.getTime()) || isNaN(rentalEnd.getTime())) throw new Error('Invalid rental dates');
      const rentalDays = Math.ceil((rentalEnd.getTime() - rentalStart.getTime()) / (1000 * 60 * 60 * 24));
      if (rentalDays < 0) {
        throw new BadRequestException('Rental end date must be on or after the start date.');
      }
      const rentalWeeks = Math.ceil(rentalDays / 7);
      const rentalMonths = Math.ceil(rentalDays / 30);

      const context = {
        materialSubtotal,
        totalComponents,
        totalArea,
        rentalDays,
        rentalWeeks,
        rentalMonths,
        ...costConfigs,
      };

      const costItems = await this.createCostItems(quotation.id, costConfigs, context);

      for (const item of costItems) {
        const override =
          costAmountOverrides && Object.prototype.hasOwnProperty.call(costAmountOverrides, item.code)
            ? Number(costAmountOverrides[item.code])
            : undefined;
        if (override !== undefined && Number.isFinite(override)) {
          item.calculatedValue = override;
        } else if (item.isLocked && item.userEditedValue != null) {
          item.calculatedValue = item.userEditedValue;
        } else {
          try {
            item.calculatedValue = await this.formulaService.evaluate(item.formulaExpression, item.formulaVariables, context);
          } catch (error) {
            this.logger.error(`Formula evaluation failed for ${item.code}:`, error);
            item.calculatedValue = 0;
          }
        }
      }

      const client = this.supabase.getClient();
      for (const item of costItems) {
        await client.from('quotation_cost_items').update(mapPayloadToSnake({ calculatedValue: item.calculatedValue })).eq('id', item.id);
      }
      return costItems;
    } catch (error) {
      this.logger.error(`Failed to calculate costs: ${(error as Error).message}`);
      throw error;
    }
  }

  private async createCostItems(quotationId: string, costConfigs: Record<string, any>, context: Record<string, any>): Promise<QuotationCostItem[]> {
    const items: Partial<QuotationCostItem>[] = [
      { quotationId, code: 'basic_material', name: '仮設材基本料', category: 'basic_charge' as CostCategory, formulaExpression: 'totalArea * materialBasicRate * rentalMonths', formulaVariables: { totalArea: { name: 'totalArea (m²)', source: 'geometry', value: context.totalArea }, materialBasicRate: { name: 'materialBasicRate (¥/m²/月)', source: 'master_data', value: costConfigs.materialBasicRate || 200 }, rentalMonths: { name: 'rentalMonths', source: 'rental_config', value: context.rentalMonths } }, calculatedValue: 0, sortOrder: 1 },
      { quotationId, code: 'material_wear', name: '仮設材損料', category: 'damage_charge' as CostCategory, formulaExpression: 'materialSubtotal * (wearRatePercent / 100) * rentalMonths', formulaVariables: { materialSubtotal: { name: 'materialSubtotal', source: 'user_input', value: context.materialSubtotal }, wearRatePercent: { name: 'wearRatePercent (%/月)', source: 'master_data', value: costConfigs.wearRatePercent || 1.5 }, rentalMonths: { name: 'rentalMonths', source: 'rental_config', value: context.rentalMonths } }, calculatedValue: 0, sortOrder: 2 },
      { quotationId, code: 'transportation', name: '運搬費', category: 'transport' as CostCategory, formulaExpression: 'totalComponents * transportRate', formulaVariables: { totalComponents: { name: 'totalComponents', source: 'geometry', value: context.totalComponents }, transportRate: { name: 'transportRate (¥/個)', source: 'master_data', value: costConfigs.transportRate || 30 } }, calculatedValue: 0, sortOrder: 3 },
      { quotationId, code: 'disposal', name: '滅失費', category: 'loss' as CostCategory, formulaExpression: '(materialSubtotal * disposalRatePercent) / 100', formulaVariables: { materialSubtotal: { name: 'materialSubtotal', source: 'user_input', value: context.materialSubtotal }, disposalRatePercent: { name: 'disposalRatePercent (%)', source: 'master_data', value: costConfigs.disposalRatePercent || 3 } }, calculatedValue: 0, sortOrder: 4 },
      { quotationId, code: 'surface_prep', name: 'ケレン費', category: 'cleaning' as CostCategory, formulaExpression: '(materialSubtotal * surfacePrepRatePercent) / 100', formulaVariables: { materialSubtotal: { name: 'materialSubtotal', source: 'user_input', value: context.materialSubtotal }, surfacePrepRatePercent: { name: 'surfacePrepRatePercent (%)', source: 'master_data', value: costConfigs.surfacePrepRatePercent || 2 } }, calculatedValue: 0, sortOrder: 5 },
      { quotationId, code: 'repair_reserve', name: '修理代金', category: 'repair' as CostCategory, formulaExpression: '(materialSubtotal * repairRate) / 100', formulaVariables: { materialSubtotal: { name: 'materialSubtotal', source: 'user_input', value: context.materialSubtotal }, repairRate: { name: 'repairRate (%)', source: 'master_data', value: costConfigs.repairRate || 1 } }, calculatedValue: 0, sortOrder: 6 },
    ];
    const inserts = items.map((i) => mapPayloadToSnake(i as Record<string, unknown>));
    const { data: saved } = await this.supabase.getClient().from('quotation_cost_items').insert(inserts).select();
    return mapRowsToCamel<QuotationCostItem>(saved || []);
  }
}
