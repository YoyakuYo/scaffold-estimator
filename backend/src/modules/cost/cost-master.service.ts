import { Injectable, Logger } from '@nestjs/common';
import { CostMasterData } from './cost-master.entity';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

@Injectable()
export class CostMasterService {
  private readonly logger = new Logger(CostMasterService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getCostConfigurations(_companyId: string, region: string = '東京'): Promise<Record<string, any>> {
    const currentYear = new Date().getFullYear();
    const { data: rows } = await this.supabase
      .getClient()
      .from('cost_master_data')
      .select('*')
      .eq('region', region)
      .eq('fiscal_year', currentYear)
      .order('created_at', { ascending: false })
      .limit(1);
    const config = rows?.[0] ? mapRowToCamel<CostMasterData>(rows[0] as Record<string, unknown>) : null;
    if (!config) {
      return {
        materialBasicRate: 5000,
        wearRatePercent: 1.0,
        transportRate: 500,
        disposalRatePercent: 5,
        surfacePrepRatePercent: 3,
        repairRate: 2,
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

  async updateCostConfiguration(id: string, updates: Partial<CostMasterData>, userId: string): Promise<CostMasterData> {
    const { data: row } = await this.supabase.getClient().from('cost_master_data').select('*').eq('id', id).maybeSingle();
    if (!row) throw new Error('Cost configuration not found');
    const config = mapRowToCamel<CostMasterData>(row as Record<string, unknown>)!;
    const auditEntry = {
      user: userId,
      timestamp: new Date(),
      oldValue: { ...config },
      newValue: { ...updates },
      field: Object.keys(updates).join(', '),
    };
    const auditLog = [...(config.auditLog || []), auditEntry];
    const payload = mapPayloadToSnake({ ...updates, auditLog });
    const { data: saved, error } = await this.supabase.getClient().from('cost_master_data').update(payload).eq('id', id).select().single();
    if (error || !saved) throw new Error(error?.message || 'Update failed');
    return mapRowToCamel<CostMasterData>(saved as Record<string, unknown>)!;
  }

  async createCostConfiguration(
    category: string,
    region: string,
    fiscalYear: number,
    rates: Partial<CostMasterData>,
    createdBy: string,
  ): Promise<CostMasterData> {
    const ins = mapPayloadToSnake({ category, region, fiscalYear, ...rates, createdBy } as Record<string, unknown>);
    const { data: saved, error } = await this.supabase.getClient().from('cost_master_data').insert(ins).select().single();
    if (error || !saved) throw new Error(error?.message || 'Insert failed');
    return mapRowToCamel<CostMasterData>(saved as Record<string, unknown>)!;
  }
}
