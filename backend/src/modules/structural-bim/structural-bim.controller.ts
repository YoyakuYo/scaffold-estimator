import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProductAccessGuard } from '../../common/guards/product-access.guard';
import { RequiresProduct } from '../../common/decorators/requires-product.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StructuralBimService } from './structural-bim.service';
import {
  CreateStructuralProjectDto,
  ImportMembersCsvDto,
  PatchStructuralModelDto,
} from './dto/structural-bim.dto';

function caller(user: { id: string; companyId?: string | null; role: string }) {
  return { userId: user.id, companyId: user.companyId ?? null, role: user.role };
}

/** Phase 6 — API for grid/member model and IFC generation (BIM product). */
@Controller('structural-bim')
@UseGuards(JwtAuthGuard, ProductAccessGuard)
@RequiresProduct('bim')
export class StructuralBimController {
  constructor(private readonly service: StructuralBimService) {}

  @Post('projects')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  create(@CurrentUser() user: any, @Body() dto: CreateStructuralProjectDto) {
    return this.service.createProject(caller(user), dto?.name ?? null);
  }

  @Get('projects')
  list(@CurrentUser() user: any) {
    return this.service.listProjects(caller(user));
  }

  @Get('projects/:id')
  get(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.getProject(caller(user), id);
  }

  @Patch('projects/:id/model')
  patchModel(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: PatchStructuralModelDto) {
    return this.service.patchModelJson(caller(user), id, dto.modelJson);
  }

  @Post('projects/:id/import-members-csv')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  importCsv(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ImportMembersCsvDto) {
    return this.service.importCsv(caller(user), id, dto.csvText);
  }

  @Post('projects/:id/generate-ifc')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  generateIfc(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.generateIfc(caller(user), id);
  }

  @Delete('projects/:id')
  delete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.deleteProject(caller(user), id).then(() => ({ ok: true }));
  }
}
