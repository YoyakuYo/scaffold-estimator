import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CostMasterData } from './cost-master.entity';

@Injectable()
export class CostMasterService {
  private readonly logger = new Logger(CostMasterService.name);

  constructor(
    @InjectRepository(CostMasterData)
    private costMasterRepository: Repository<CostMasterData>,
  ) {}

  async getCostConfigurations(companyId: string, region: string = '東京'): Promise<Record<string, any>> {
    const currentYear = new Date().getFullYear();

    const config = await this.costMasterRepository.findOne({
      where: {
        region,
        fiscalYear: currentYear,
      },
      order: { createdAt: 'DESC' },
    });

    if (!config) {
      // Return defaults
      return {
        materialBasicRate: 5000, // ¥/m²/month
        wearRatePercent: 1.0, // % per day
        transportRate: 500, // ¥ per component
        disposalRatePercent: 5, // % of material value
        surfacePrepRatePercent: 3, // % of material value
        repairRate: 2, // % of material cost
      };
    }

    return {
      materialBasicRate: config.materialBasicRate || 5000,
      wearRatePercent: config.wearRatePercent || 1.0,
      transportRate: config.transportRate || 500,
      disposalRatePercent: config.disposalRatePercent || 5,
      surfacePrepRatePercent: config.surfacePrepRatePercent || 3,
      repairRate: config.repairRate || 2,
    };
  }

  async updateCostConfiguration(
    id: string,
    updates: Partial<CostMasterData>,
    userId: string,
  ): Promise<CostMasterData> {
    const config = await this.costMasterRepository.findOne({ where: { id } });

    if (!config) {
      throw new Error('Cost configuration not found');
    }

    // Create audit log entry
    const auditEntry = {
      user: userId,
      timestamp: new Date(),
      oldValue: { ...config },
      newValue: { ...updates },
      field: Object.keys(updates).join(', '),
    };

    config.auditLog = config.auditLog || [];
    config.auditLog.push(auditEntry);

    // Update fields
    Object.assign(config, updates);

    return await this.costMasterRepository.save(config);
  }

  async createCostConfiguration(
    category: string,
    region: string,
    fiscalYear: number,
    rates: Partial<CostMasterData>,
    createdBy: string,
  ): Promise<CostMasterData> {
    const config = this.costMasterRepository.create({
      category: category as any,
      region,
      fiscalYear,
      ...rates,
      createdBy,
    });

    return await this.costMasterRepository.save(config);
  }
}
