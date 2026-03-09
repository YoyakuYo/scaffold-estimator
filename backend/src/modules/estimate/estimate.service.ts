import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Estimate } from './estimate.entity';
import { DrawingService } from '../drawing/drawing.service';
import { CalculationStrategyFactory } from './strategies/calculation-strategy.factory';
import { StructureType } from '../drawing/drawing.entity';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

@Injectable()
export class EstimateService {
  private readonly logger = new Logger(EstimateService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private drawingService: DrawingService,
  ) {}

  async createEstimate(
    drawingId: string,
    structureType: StructureType,
    rentalStartDate: Date,
    rentalEndDate: Date,
    rentalType: 'weekly' | 'monthly' | 'custom',
    createdBy: string,
    projectId: string,
  ) {
    const drawing = await this.drawingService.getDrawing(drawingId, '');
    if (!drawing || !drawing.normalizedGeometry) {
      throw new NotFoundException('Drawing not found or not processed');
    }
    const strategy = CalculationStrategyFactory.create(structureType);
    const billOfMaterials = strategy.calculateMaterials(drawing.normalizedGeometry);
    const ins = mapPayloadToSnake({
      projectId,
      drawingId,
      structureType,
      rentalStartDate,
      rentalEndDate,
      rentalType,
      billOfMaterials: {
        scaffoldingType: billOfMaterials.scaffoldingType,
        components: billOfMaterials.components,
        totalArea: billOfMaterials.totalArea,
        totalHeight: billOfMaterials.totalHeight,
        estimatedWeight: billOfMaterials.estimatedWeight,
        adjustmentCoefficient: billOfMaterials.adjustmentCoefficient,
        confidence: billOfMaterials.confidence,
      },
      createdBy,
      status: 'draft',
    });
    const { data: saved, error } = await this.supabase.getClient().from('estimates').insert(ins).select().single();
    if (error || !saved) throw new Error(error?.message || 'Failed to create estimate');
    return mapRowToCamel<Estimate>(saved as Record<string, unknown>)!;
  }

  async getEstimate(id: string) {
    const { data: row, error } = await this.supabase
      .getClient()
      .from('estimates')
      .select('*, drawings(*), cost_line_items(*)')
      .eq('id', id)
      .maybeSingle();
    if (error || !row) throw new NotFoundException('Estimate not found');
    const estimate = mapRowToCamel<Estimate>(row as Record<string, unknown>);
    if (!estimate) throw new NotFoundException('Estimate not found');
    return estimate;
  }

  async listEstimates(_companyId: string, projectId?: string) {
    let q = this.supabase.getClient().from('estimates').select('*').order('created_at', { ascending: false });
    if (projectId) q = q.eq('project_id', projectId);
    const { data: rows } = await q;
    return mapRowsToCamel<Estimate>(rows || []);
  }

  async updateBillOfMaterials(estimateId: string, componentId: string, quantity: number, reason?: string) {
    const estimate = await this.getEstimate(estimateId);
    const component = estimate.billOfMaterials?.components?.find((c: any) => c.componentId === componentId);
    if (component) {
      component.quantity = quantity;
      component.manualOverride = true;
      component.overrideReason = reason;
    }
    await this.supabase.getClient().from('estimates').update(mapPayloadToSnake({ billOfMaterials: estimate.billOfMaterials })).eq('id', estimateId);
    return estimate;
  }
}
