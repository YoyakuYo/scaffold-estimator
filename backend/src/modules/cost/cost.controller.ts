import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CostCalculationService } from './cost-calculation.service';
import { CostMasterService } from './cost-master.service';
import { UpdateCostLineItemDto } from './dto/update-cost-line-item.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

@Controller('costs')
@UseGuards(JwtAuthGuard)
export class CostController {
  constructor(
    private costCalculationService: CostCalculationService,
    private costMasterService: CostMasterService,
    private supabase: SupabaseService,
  ) {}

  @Post('estimates/:estimateId/calculate')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async calculateCosts(
    @Param('estimateId') estimateId: string,
    @CurrentUser() user: any,
  ) {
    return await this.costCalculationService.compute(estimateId, user.companyId);
  }

  @Get('estimates/:estimateId')
  async getCostBreakdown(@Param('estimateId') estimateId: string) {
    const { data: rows } = await this.supabase
      .getClient()
      .from('cost_line_items')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('created_at', { ascending: true });
    return mapRowsToCamel(rows || []);
  }

  @Patch('line-items/:id')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async updateCostLineItem(
    @Param('id') id: string,
    @Body() updateDto: UpdateCostLineItemDto,
    @CurrentUser() user: any,
  ) {
    const { data: row } = await this.supabase.getClient().from('cost_line_items').select('*').eq('id', id).maybeSingle();
    if (!row) throw new Error('Cost line item not found');
    const updates: Record<string, unknown> = { editedBy: user.id, editedAt: new Date() };
    if (updateDto.userEditedValue !== undefined) updates.userEditedValue = updateDto.userEditedValue;
    if (updateDto.isLocked !== undefined) updates.isLocked = updateDto.isLocked;
    if (updateDto.editReason !== undefined) updates.editReason = updateDto.editReason;
    const { data: saved, error } = await this.supabase.getClient().from('cost_line_items').update(mapPayloadToSnake(updates)).eq('id', id).select().single();
    if (error || !saved) throw new Error(error?.message || 'Update failed');
    return mapRowToCamel(saved as Record<string, unknown>);
  }
}
