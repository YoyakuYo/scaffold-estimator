import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Quotation } from './quotation.entity';
import { QuotationItem } from './quotation-item.entity';
import { QuotationCostItem } from './quotation-cost-item.entity';
import { ScaffoldAccessActor, ScaffoldConfigService } from '../scaffold-config/scaffold-config.service';
import { QuotationCostService } from './quotation-cost.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

function effectiveCostLineAmount(item: { userEditedValue?: number | null; calculatedValue?: number | null }): number {
  const v = item.userEditedValue ?? item.calculatedValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class QuotationService {
  private readonly logger = new Logger(QuotationService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private configService: ScaffoldConfigService,
    private costService: QuotationCostService,
  ) {}

  async create(dto: CreateQuotationDto, actor: ScaffoldAccessActor): Promise<Quotation> {
    try {
      const config = await this.configService.getConfig(dto.configId, actor);
      if (!config) throw new NotFoundException(`Configuration with ID ${dto.configId} not found.`);
      const quantities = await this.configService.getQuantities(dto.configId, actor);
      if (quantities.length === 0) throw new BadRequestException('No calculated quantities found. Please run the calculation first.');

      if (config.status !== 'reviewed') {
        if (config.status === 'calculated') {
          await this.configService.markReviewed(dto.configId, actor);
          const updatedConfig = await this.configService.getConfig(dto.configId, actor);
          if (updatedConfig.status !== 'reviewed') throw new BadRequestException('Failed to mark configuration as reviewed.');
        } else {
          throw new BadRequestException(`Configuration must be calculated and reviewed. Current status: '${config.status}'.`);
        }
      }

      const startDay = dto.rentalStartDate.slice(0, 10);
      const endDay = dto.rentalEndDate.slice(0, 10);
      if (endDay < startDay) {
        throw new BadRequestException('Rental end date must be on or after the start date.');
      }

      const items: Partial<QuotationItem>[] = quantities.map((q) => {
        const qty = q.adjustedQuantity ?? q.calculatedQuantity;
        const price = Number(q.unitPrice) || 0;
        return { componentType: q.componentType, componentName: q.componentName, sizeSpec: q.sizeSpec, unit: q.unit, quantity: qty, unitPrice: price, lineTotal: qty * price, sortOrder: q.sortOrder };
      });
      const materialSubtotal = items.reduce((sum, item) => sum + (item.lineTotal || 0), 0);

      const client = this.supabase.getClient();
      const quotationIns = mapPayloadToSnake({
        projectId: dto.projectId,
        configId: dto.configId,
        rentalStartDate: new Date(dto.rentalStartDate),
        rentalEndDate: new Date(dto.rentalEndDate),
        rentalType: dto.rentalType,
        materialSubtotal,
        costSubtotal: 0,
        subtotal: materialSubtotal,
        taxAmount: 0,
        totalAmount: 0,
        status: 'draft',
        createdBy: actor.id,
      });
      const { data: savedQuotationRow, error: qErr } = await client.from('quotations').insert(quotationIns).select().single();
      if (qErr || !savedQuotationRow) throw new Error(qErr?.message || 'Failed to create quotation');
      const savedQuotation = mapRowToCamel<Quotation>(savedQuotationRow as Record<string, unknown>)!;

      const itemInserts = items.map((item) => mapPayloadToSnake({ ...item, quotationId: savedQuotation.id }));
      await client.from('quotation_items').insert(itemInserts);

      const calcResult = config.calculationResult;
      const totalComponents = quantities.reduce((sum, q) => sum + (q.adjustedQuantity ?? q.calculatedQuantity), 0);
      const totalArea = (calcResult?.walls || []).reduce((sum: number, wall: any) => {
        const wallLengthM = (wall.wallLengthMm || 0) / 1000;
        const scaffoldHeightM = ((wall.levelCalc?.fullLevels || 0) * 1800) / 1000;
        return sum + wallLengthM * scaffoldHeightM;
      }, 0);

      const costItems = await this.costService.calculateCosts(
        savedQuotation,
        materialSubtotal,
        totalComponents,
        totalArea,
        actor.id,
        dto.rentalCostAmounts ?? null,
      );
      const costSubtotal = costItems.reduce((sum, item) => sum + effectiveCostLineAmount(item), 0);
      const subtotal = materialSubtotal + costSubtotal;
      const taxRate = dto.taxRatePercent != null ? Math.min(100, Math.max(0, Number(dto.taxRatePercent))) : 10;
      const taxAmount = Math.floor((subtotal * taxRate) / 100);
      const totalAmount = subtotal + taxAmount;

      await client.from('quotations').update(mapPayloadToSnake({ costSubtotal, subtotal, taxAmount, totalAmount })).eq('id', savedQuotation.id);

      return this.get(savedQuotation.id);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(`Failed to create quotation: ${(error as Error).message}`);
    }
  }

  async get(id: string): Promise<Quotation> {
    const { data: row } = await this.supabase.getClient().from('quotations').select('*, quotation_items(*), quotation_cost_items(*), scaffold_configurations(*)').eq('id', id).maybeSingle();
    if (!row) throw new NotFoundException('Quotation not found');
    const quotation = mapRowToCamel<Quotation>(row as Record<string, unknown>);
    if (!quotation) throw new NotFoundException('Quotation not found');
    (quotation as any).items = (row as any).quotation_items ? mapRowsToCamel((row as any).quotation_items) : [];
    (quotation as any).costItems = (row as any).quotation_cost_items ? mapRowsToCamel((row as any).quotation_cost_items) : [];
    (quotation as any).config = (row as any).scaffold_configurations ? mapRowToCamel((row as any).scaffold_configurations) : null;
    return quotation;
  }

  async list(projectId?: string): Promise<Quotation[]> {
    let q = this.supabase.getClient().from('quotations').select('*, quotation_items(*), quotation_cost_items(*), scaffold_configurations(*)').order('created_at', { ascending: false });
    if (projectId) q = q.eq('project_id', projectId);
    const { data: rows } = await q;
    if (!rows?.length) return [];
    return rows.map((row) => {
      const quotation = mapRowToCamel<Quotation>(row as Record<string, unknown>)!;
      (quotation as any).items = (row as any).quotation_items ? mapRowsToCamel((row as any).quotation_items) : [];
      (quotation as any).costItems = (row as any).quotation_cost_items ? mapRowsToCamel((row as any).quotation_cost_items) : [];
      (quotation as any).config = (row as any).scaffold_configurations ? mapRowToCamel((row as any).scaffold_configurations) : null;
      return quotation;
    });
  }

  async updateItemPrice(itemId: string, unitPrice: number): Promise<QuotationItem> {
    const { data: itemRow } = await this.supabase.getClient().from('quotation_items').select('*').eq('id', itemId).maybeSingle();
    if (!itemRow) throw new NotFoundException('Quotation item not found');
    const item = mapRowToCamel<QuotationItem>(itemRow as Record<string, unknown>)!;
    const lineTotal = item.quantity * unitPrice;
    const { data: saved } = await this.supabase.getClient().from('quotation_items').update(mapPayloadToSnake({ unitPrice, lineTotal })).eq('id', itemId).select().single();
    if (!saved) throw new Error('Update failed');
    await this.recalculateTotals(item.quotationId);
    return mapRowToCamel<QuotationItem>(saved as Record<string, unknown>)!;
  }

  async updateCostItemAmount(costItemId: string, amount: number | null): Promise<QuotationCostItem> {
    const client = this.supabase.getClient();
    const { data: costRow, error: cErr } = await client.from('quotation_cost_items').select('*').eq('id', costItemId).maybeSingle();
    if (cErr || !costRow) throw new NotFoundException('Cost item not found');
    const costItem = mapRowToCamel<QuotationCostItem>(costRow as Record<string, unknown>)!;
    const { data: qRow } = await client.from('quotations').select('status').eq('id', costItem.quotationId).maybeSingle();
    if (!qRow) throw new NotFoundException('Quotation not found');
    if (qRow.status === 'finalized') throw new BadRequestException('Cannot edit rental costs on a finalized quotation.');
    if (amount !== null && (typeof amount !== 'number' || Number.isNaN(amount) || amount < 0)) {
      throw new BadRequestException('amount must be a non-negative number or null to use the formula value');
    }
    const updatePayload = mapPayloadToSnake({
      userEditedValue: amount,
      isLocked: amount !== null,
    });
    const { data: saved, error: uErr } = await client.from('quotation_cost_items').update(updatePayload).eq('id', costItemId).select().single();
    if (uErr || !saved) throw new InternalServerErrorException(uErr?.message || 'Failed to update cost item');
    await this.recalculateTotals(costItem.quotationId);
    return mapRowToCamel<QuotationCostItem>(saved as Record<string, unknown>)!;
  }

  /** Re-sync line unit prices from calculated_quantities and re-run rental cost formulas (no global price master). */
  async repopulatePrices(quotationId: string, actor: ScaffoldAccessActor): Promise<Quotation> {
    const quotation = await this.get(quotationId);
    if (quotation.status === 'finalized') throw new BadRequestException('Cannot update prices on a finalized quotation.');
    const config = await this.configService.getConfig(quotation.configId, actor);
    const quantities = await this.configService.getQuantities(quotation.configId, actor);
    const keyOf = (componentType: string, sizeSpec: string) => `${componentType}|${sizeSpec}`;
    const unitPriceByKey = new Map<string, number>();
    for (const q of quantities) {
      unitPriceByKey.set(keyOf(q.componentType, q.sizeSpec), Number(q.unitPrice) || 0);
    }

    const client = this.supabase.getClient();
    let materialSubtotal = 0;
    for (const item of quotation.items) {
      const key = keyOf(item.componentType, item.sizeSpec);
      const newPrice = unitPriceByKey.has(key) ? unitPriceByKey.get(key)! : Number(item.unitPrice) || 0;
      const lineTotal = item.quantity * newPrice;
      materialSubtotal += lineTotal;
      await client.from('quotation_items').update(mapPayloadToSnake({ unitPrice: newPrice, lineTotal })).eq('id', item.id);
    }

    await client.from('quotation_cost_items').delete().eq('quotation_id', quotationId);
    const calcResult = config.calculationResult;
    const totalComponents = quotation.items.reduce((sum, i) => sum + i.quantity, 0);
    const totalArea = (calcResult?.walls || []).reduce((sum: number, wall: any) => {
      const wallLengthM = (wall.wallLengthMm || 0) / 1000;
      const scaffoldHeightM = ((wall.levelCalc?.fullLevels || 0) * 1800) / 1000;
      return sum + wallLengthM * scaffoldHeightM;
    }, 0);

    const costItems = await this.costService.calculateCosts(quotation, materialSubtotal, totalComponents, totalArea, actor.id, null);
    const costSubtotal = costItems.reduce((sum, item) => sum + effectiveCostLineAmount(item), 0);
    const subtotal = materialSubtotal + costSubtotal;
    const taxAmount = Math.floor(subtotal * 0.1);
    const totalAmount = subtotal + taxAmount;
    await client.from('quotations').update(mapPayloadToSnake({ materialSubtotal, costSubtotal, subtotal, taxAmount, totalAmount })).eq('id', quotationId);
    return this.get(quotationId);
  }

  async finalize(id: string): Promise<Quotation> {
    const quotation = await this.get(id);
    await this.supabase.getClient().from('quotations').update(mapPayloadToSnake({ status: 'finalized', finalizedAt: new Date() })).eq('id', id);
    quotation.status = 'finalized';
    quotation.finalizedAt = new Date();
    return quotation;
  }

  private async recalculateTotals(quotationId: string): Promise<void> {
    const quotation = await this.get(quotationId);
    const materialSubtotal = quotation.items.reduce((sum, i) => sum + Number(i.lineTotal), 0);
    const costSubtotal = quotation.costItems.reduce((sum, i) => sum + effectiveCostLineAmount(i), 0);
    const subtotal = materialSubtotal + costSubtotal;
    const taxAmount = Math.floor(subtotal * 0.1);
    const totalAmount = subtotal + taxAmount;
    await this.supabase.getClient().from('quotations').update(mapPayloadToSnake({ materialSubtotal, costSubtotal, subtotal, taxAmount, totalAmount })).eq('id', quotationId);
  }
}
