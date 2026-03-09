import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Company } from '../auth/company.entity';
import { CompanyBranch } from './company-branch.entity';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateBranchDto, UpdateBranchDto } from './dto/create-branch.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

@Injectable()
export class CompanyService {
  constructor(private readonly supabase: SupabaseService) {}

  async getCompany(companyId: string): Promise<Company & { branches?: CompanyBranch[] }> {
    const { data: companyRow, error: companyErr } = await this.supabase
      .getClient()
      .from('companies')
      .select('*, company_branches(*)')
      .eq('id', companyId)
      .maybeSingle();
    if (companyErr || !companyRow) throw new NotFoundException('会社が見つかりません。');
    const company = mapRowToCamel<Company & { company_branches?: unknown[] }>(companyRow as Record<string, unknown>);
    if (!company) throw new NotFoundException('会社が見つかりません。');
    const branches = (company as any).companyBranches;
    if (Array.isArray(branches)) {
      (company as any).branches = mapRowsToCamel<CompanyBranch>(branches as Record<string, unknown>[]);
      delete (company as any).companyBranches;
    }
    return company as Company & { branches?: CompanyBranch[] };
  }

  async updateCompany(companyId: string, dto: UpdateCompanyDto): Promise<Company> {
    const { data: row } = await this.supabase.getClient().from('companies').select('*').eq('id', companyId).maybeSingle();
    if (!row) throw new NotFoundException('会社が見つかりません。');
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.taxId !== undefined) updates.taxId = dto.taxId;
    if (dto.phone !== undefined) updates.phone = dto.phone;
    if (dto.email !== undefined) updates.email = dto.email;
    if (dto.postalCode !== undefined) updates.postalCode = dto.postalCode;
    if (dto.prefecture !== undefined) updates.prefecture = dto.prefecture;
    if (dto.city !== undefined) updates.city = dto.city;
    if (dto.town !== undefined) updates.town = dto.town;
    if (dto.addressLine !== undefined) updates.addressLine = dto.addressLine;
    if (dto.building !== undefined) updates.building = dto.building;
    if (Object.keys(updates).length === 0) return mapRowToCamel<Company>(row as Record<string, unknown>)!;
    const { data: saved, error } = await this.supabase.getClient().from('companies').update(mapPayloadToSnake(updates)).eq('id', companyId).select().single();
    if (error || !saved) throw new BadRequestException('Update failed.');
    return mapRowToCamel<Company>(saved as Record<string, unknown>)!;
  }

  async listBranches(companyId: string): Promise<CompanyBranch[]> {
    const { data: rows } = await this.supabase
      .getClient()
      .from('company_branches')
      .select('*')
      .eq('company_id', companyId)
      .order('is_headquarters', { ascending: false })
      .order('created_at', { ascending: true });
    return mapRowsToCamel<CompanyBranch>(rows || []);
  }

  async getBranch(companyId: string, branchId: string): Promise<CompanyBranch> {
    const { data: row, error } = await this.supabase
      .getClient()
      .from('company_branches')
      .select('*')
      .eq('id', branchId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (error || !row) throw new NotFoundException('支店が見つかりません。');
    const branch = mapRowToCamel<CompanyBranch>(row as Record<string, unknown>);
    if (!branch) throw new NotFoundException('支店が見つかりません。');
    return branch;
  }

  async createBranch(companyId: string, dto: CreateBranchDto): Promise<CompanyBranch> {
    const { data: companyRow } = await this.supabase.getClient().from('companies').select('id').eq('id', companyId).maybeSingle();
    if (!companyRow) throw new NotFoundException('会社が見つかりません。');
    if (dto.isHeadquarters) {
      await this.supabase.getClient().from('company_branches').update({ is_headquarters: false }).eq('company_id', companyId);
    }
    const ins = mapPayloadToSnake<Record<string, unknown>>({ companyId, ...dto });
    const { data: saved, error } = await this.supabase.getClient().from('company_branches').insert(ins).select().single();
    if (error || !saved) throw new BadRequestException('Failed to create branch.');
    return mapRowToCamel<CompanyBranch>(saved as Record<string, unknown>)!;
  }

  async updateBranch(companyId: string, branchId: string, dto: UpdateBranchDto): Promise<CompanyBranch> {
    const branch = await this.getBranch(companyId, branchId);
    if (dto.isHeadquarters) {
      await this.supabase.getClient().from('company_branches').update({ is_headquarters: false }).eq('company_id', companyId);
    }
    const updates = mapPayloadToSnake(dto as Record<string, unknown>);
    const { data: saved, error } = await this.supabase.getClient().from('company_branches').update(updates).eq('id', branchId).eq('company_id', companyId).select().single();
    if (error || !saved) throw new BadRequestException('Update failed.');
    return mapRowToCamel<CompanyBranch>(saved as Record<string, unknown>)!;
  }

  async deleteBranch(companyId: string, branchId: string): Promise<{ success: boolean }> {
    const branch = await this.getBranch(companyId, branchId);
    if (branch.isHeadquarters) {
      throw new BadRequestException('本社は削除できません。先に別の支店を本社に設定してください。');
    }
    await this.supabase.getClient().from('company_branches').delete().eq('id', branchId).eq('company_id', companyId);
    return { success: true };
  }
}
