import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuotationService } from './quotation.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';

@Controller('quotations')
@UseGuards(JwtAuthGuard)
export class QuotationController {
  private readonly logger = new Logger(QuotationController.name);

  constructor(private readonly quotationService: QuotationService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async create(@Body() dto: CreateQuotationDto, @CurrentUser() user: any) {
    return await this.quotationService.create(dto, user.id);
  }

  @Get()
  async list(@Query('projectId') projectId?: string) {
    return await this.quotationService.list(projectId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return await this.quotationService.get(id);
  }

  @Patch('items/:itemId/price')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async updateItemPrice(
    @Param('itemId') itemId: string,
    @Body('unitPrice') unitPrice: number,
  ) {
    return await this.quotationService.updateItemPrice(itemId, unitPrice);
  }

  /**
   * POST /quotations/:id/repopulate-prices
   * Re-populate unit prices from the materials master and recalculate costs.
   */
  @Post(':id/repopulate-prices')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async repopulatePrices(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.quotationService.repopulatePrices(id, user.id);
  }

  @Post(':id/finalize')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async finalize(@Param('id') id: string) {
    return await this.quotationService.finalize(id);
  }
}
