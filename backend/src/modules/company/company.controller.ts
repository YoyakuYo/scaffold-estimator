import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CompanyService } from './company.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateBranchDto, UpdateBranchDto } from './dto/create-branch.dto';

@Controller('company')
@UseGuards(JwtAuthGuard)
export class CompanyController {
  constructor(private companyService: CompanyService) {}

  // ─── Company Info ──────────────────────────────────────────

  @Get()
  async getCompany(@CurrentUser() user: any) {
    return this.companyService.getCompany(user.companyId);
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles('superadmin')
  async updateCompany(@CurrentUser() user: any, @Body() dto: UpdateCompanyDto) {
    return this.companyService.updateCompany(user.companyId, dto);
  }

  // ─── Branches ──────────────────────────────────────────────

  @Get('branches')
  async listBranches(@CurrentUser() user: any) {
    return this.companyService.listBranches(user.companyId);
  }

  @Get('branches/:branchId')
  async getBranch(@CurrentUser() user: any, @Param('branchId') branchId: string) {
    return this.companyService.getBranch(user.companyId, branchId);
  }

  @Post('branches')
  @UseGuards(RolesGuard)
  @Roles('superadmin')
  async createBranch(@CurrentUser() user: any, @Body() dto: CreateBranchDto) {
    return this.companyService.createBranch(user.companyId, dto);
  }

  @Put('branches/:branchId')
  @UseGuards(RolesGuard)
  @Roles('superadmin')
  async updateBranch(
    @CurrentUser() user: any,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.companyService.updateBranch(user.companyId, branchId, dto);
  }

  @Delete('branches/:branchId')
  @UseGuards(RolesGuard)
  @Roles('superadmin')
  async deleteBranch(@CurrentUser() user: any, @Param('branchId') branchId: string) {
    return this.companyService.deleteBranch(user.companyId, branchId);
  }
}
