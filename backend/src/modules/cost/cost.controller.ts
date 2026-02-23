import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CostCalculationService } from './cost-calculation.service';
import { CostMasterService } from './cost-master.service';
import { CostLineItem } from './cost-line-item.entity';
import { UpdateCostLineItemDto } from './dto/update-cost-line-item.dto';

@Controller('costs')
@UseGuards(JwtAuthGuard)
export class CostController {
  constructor(
    private costCalculationService: CostCalculationService,
    private costMasterService: CostMasterService,
    @InjectRepository(CostLineItem)
    private costLineItemRepository: Repository<CostLineItem>,
  ) {}

  @Post('estimates/:estimateId/calculate')
  @UseGuards(RolesGuard)
  @Roles('admin', 'estimator')
  async calculateCosts(
    @Param('estimateId') estimateId: string,
    @CurrentUser() user: any,
  ) {
    return await this.costCalculationService.compute(estimateId, user.companyId);
  }

  @Get('estimates/:estimateId')
  async getCostBreakdown(@Param('estimateId') estimateId: string) {
    const lineItems = await this.costLineItemRepository.find({
      where: { estimateId },
      order: { createdAt: 'ASC' },
    });
    return lineItems;
  }

  @Patch('line-items/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'estimator')
  async updateCostLineItem(
    @Param('id') id: string,
    @Body() updateDto: UpdateCostLineItemDto,
    @CurrentUser() user: any,
  ) {
    const lineItem = await this.costLineItemRepository.findOne({
      where: { id },
    });

    if (!lineItem) {
      throw new Error('Cost line item not found');
    }

    if (updateDto.userEditedValue !== undefined) {
      lineItem.userEditedValue = updateDto.userEditedValue;
    }
    if (updateDto.isLocked !== undefined) {
      lineItem.isLocked = updateDto.isLocked;
    }
    if (updateDto.editReason !== undefined) {
      lineItem.editReason = updateDto.editReason;
    }

    lineItem.editedBy = user.id;
    lineItem.editedAt = new Date();

    return await this.costLineItemRepository.save(lineItem);
  }

  @Get('master-data')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getMasterData(
    @Query('region') region: string,
    @CurrentUser() user: any,
  ) {
    return await this.costMasterService.getCostConfigurations(user.companyId, region || '東京');
  }
}
