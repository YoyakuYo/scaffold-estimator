import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EstimateService } from './estimate.service';
import { CreateEstimateDto } from './dto/create-estimate.dto';
import { UpdateBOMDto } from './dto/update-bom.dto';

@Controller('estimates')
@UseGuards(JwtAuthGuard)
export class EstimateController {
  constructor(private readonly estimateService: EstimateService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async createEstimate(
    @Body() createEstimateDto: CreateEstimateDto,
    @CurrentUser() user: any,
  ) {
    return await this.estimateService.createEstimate(
      createEstimateDto.drawingId,
      createEstimateDto.structureType,
      new Date(createEstimateDto.rentalStartDate),
      new Date(createEstimateDto.rentalEndDate),
      createEstimateDto.rentalType,
      user.id,
      createEstimateDto.projectId,
    );
  }

  @Get()
  async listEstimates(
    @CurrentUser() user: any,
    @Query('projectId') projectId?: string,
  ) {
    return await this.estimateService.listEstimates(user.companyId, projectId);
  }

  @Get(':id')
  async getEstimate(@Param('id') id: string) {
    return await this.estimateService.getEstimate(id);
  }

  @Patch(':id/bom')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async updateBillOfMaterials(
    @Param('id') id: string,
    @Body() updateBOMDto: UpdateBOMDto,
  ) {
    return await this.estimateService.updateBillOfMaterials(
      id,
      updateBOMDto.componentId,
      updateBOMDto.quantity,
      updateBOMDto.reason,
    );
  }
}
