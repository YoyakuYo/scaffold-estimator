import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Estimate } from './estimate.entity';
import { DrawingService } from '../drawing/drawing.service';
import { CalculationStrategyFactory } from './strategies/calculation-strategy.factory';
import { StructureType } from '../drawing/drawing.entity';

@Injectable()
export class EstimateService {
  private readonly logger = new Logger(EstimateService.name);

  constructor(
    @InjectRepository(Estimate)
    private estimateRepository: Repository<Estimate>,
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
    // Get drawing with normalized geometry
    const drawing = await this.drawingService.getDrawing(drawingId, ''); // Company check would be here

    if (!drawing || !drawing.normalizedGeometry) {
      throw new NotFoundException('Drawing not found or not processed');
    }

    // Get strategy for structure type
    const strategy = CalculationStrategyFactory.create(structureType);

    // Calculate bill of materials
    const billOfMaterials = strategy.calculateMaterials(drawing.normalizedGeometry);

    // Create estimate
    const estimate = this.estimateRepository.create({
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

    return await this.estimateRepository.save(estimate);
  }

  async getEstimate(id: string) {
    const estimate = await this.estimateRepository.findOne({
      where: { id },
      relations: ['drawing', 'costBreakdown'],
    });

    if (!estimate) {
      throw new NotFoundException('Estimate not found');
    }

    return estimate;
  }

  async listEstimates(companyId: string, projectId?: string) {
    const query = this.estimateRepository.createQueryBuilder('estimate');

    if (projectId) {
      query.where('estimate.projectId = :projectId', { projectId });
    }

    query.orderBy('estimate.createdAt', 'DESC');

    return await query.getMany();
  }

  async updateBillOfMaterials(
    estimateId: string,
    componentId: string,
    quantity: number,
    reason?: string,
  ) {
    const estimate = await this.getEstimate(estimateId);

    const component = estimate.billOfMaterials.components.find(
      (c) => c.componentId === componentId,
    );

    if (component) {
      component.quantity = quantity;
      component.manualOverride = true;
      component.overrideReason = reason;
    }

    await this.estimateRepository.save(estimate);
    return estimate;
  }
}
