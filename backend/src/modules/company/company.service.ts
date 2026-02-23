import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../auth/company.entity';
import { CompanyBranch } from './company-branch.entity';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateBranchDto, UpdateBranchDto } from './dto/create-branch.dto';

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    @InjectRepository(CompanyBranch)
    private branchRepository: Repository<CompanyBranch>,
  ) {}

  // ─── Company ───────────────────────────────────────────────

  async getCompany(companyId: string): Promise<Company> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['branches'],
    });
    if (!company) throw new NotFoundException('会社が見つかりません。');
    return company;
  }

  async updateCompany(companyId: string, dto: UpdateCompanyDto): Promise<Company> {
    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('会社が見つかりません。');

    if (dto.name !== undefined) company.name = dto.name;
    if (dto.taxId !== undefined) company.taxId = dto.taxId;
    if (dto.phone !== undefined) company.phone = dto.phone;
    if (dto.email !== undefined) company.email = dto.email;
    if (dto.postalCode !== undefined) company.postalCode = dto.postalCode;
    if (dto.prefecture !== undefined) company.prefecture = dto.prefecture;
    if (dto.city !== undefined) company.city = dto.city;
    if (dto.town !== undefined) company.town = dto.town;
    if (dto.addressLine !== undefined) company.addressLine = dto.addressLine;
    if (dto.building !== undefined) company.building = dto.building;

    return this.companyRepository.save(company);
  }

  // ─── Branches ──────────────────────────────────────────────

  async listBranches(companyId: string): Promise<CompanyBranch[]> {
    return this.branchRepository.find({
      where: { companyId },
      order: { isHeadquarters: 'DESC', createdAt: 'ASC' },
    });
  }

  async getBranch(companyId: string, branchId: string): Promise<CompanyBranch> {
    const branch = await this.branchRepository.findOne({
      where: { id: branchId, companyId },
    });
    if (!branch) throw new NotFoundException('支店が見つかりません。');
    return branch;
  }

  async createBranch(companyId: string, dto: CreateBranchDto): Promise<CompanyBranch> {
    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('会社が見つかりません。');

    if (dto.isHeadquarters) {
      await this.branchRepository.update(
        { companyId, isHeadquarters: true },
        { isHeadquarters: false },
      );
    }

    const branch = this.branchRepository.create({
      companyId,
      ...dto,
    });
    return this.branchRepository.save(branch);
  }

  async updateBranch(companyId: string, branchId: string, dto: UpdateBranchDto): Promise<CompanyBranch> {
    const branch = await this.branchRepository.findOne({
      where: { id: branchId, companyId },
    });
    if (!branch) throw new NotFoundException('支店が見つかりません。');

    if (dto.isHeadquarters) {
      await this.branchRepository.update(
        { companyId, isHeadquarters: true },
        { isHeadquarters: false },
      );
    }

    Object.assign(branch, dto);
    return this.branchRepository.save(branch);
  }

  async deleteBranch(companyId: string, branchId: string): Promise<{ success: boolean }> {
    const branch = await this.branchRepository.findOne({
      where: { id: branchId, companyId },
    });
    if (!branch) throw new NotFoundException('支店が見つかりません。');
    if (branch.isHeadquarters) {
      throw new BadRequestException('本社は削除できません。先に別の支店を本社に設定してください。');
    }

    await this.branchRepository.remove(branch);
    return { success: true };
  }
}
