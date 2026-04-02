import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuotationService } from './quotation.service';
import { QuotationExcelService } from './quotation-excel.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';

@Controller('quotations')
@UseGuards(JwtAuthGuard)
export class QuotationController {
  private readonly logger = new Logger(QuotationController.name);

  constructor(
    private readonly quotationService: QuotationService,
    private readonly quotationExcelService: QuotationExcelService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async create(@Body() dto: CreateQuotationDto, @CurrentUser() user: any) {
    return await this.quotationService.create(dto, user.id);
  }

  @Get()
  async list(@Query('projectId') projectId?: string) {
    return await this.quotationService.list(projectId);
  }

  /**
   * GET /quotations/:id/export/excel
   * Budget quotation: line items, rental costs, and totals.
   */
  @Get(':id/export/excel')
  async exportExcel(@Param('id') id: string, @Res() res: Response) {
    const quotation = await this.quotationService.get(id);
    const buffer = await this.quotationExcelService.generateBudgetWorkbook(quotation as any);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="quotation_budget_${id.slice(0, 8)}.xlsx"`,
    );
    res.send(buffer);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return await this.quotationService.get(id);
  }

  @Patch('items/:itemId/price')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async updateItemPrice(
    @Param('itemId') itemId: string,
    @Body('unitPrice') unitPrice: number,
  ) {
    return await this.quotationService.updateItemPrice(itemId, unitPrice);
  }

  /** Override a rental cost line amount, or pass amount: null to use the formula value again. */
  @Patch('cost-items/:costItemId/amount')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async updateCostItemAmount(
    @Param('costItemId') costItemId: string,
    @Body() body: { amount?: number | null },
  ) {
    if (!Object.prototype.hasOwnProperty.call(body, 'amount')) {
      throw new BadRequestException('amount is required (use null to clear manual override)');
    }
    return await this.quotationService.updateCostItemAmount(costItemId, body.amount ?? null);
  }

  /**
   * POST /quotations/:id/repopulate-prices
   * Re-populate unit prices from the materials master and recalculate costs.
   */
  @Post(':id/repopulate-prices')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async repopulatePrices(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.quotationService.repopulatePrices(id, user.id);
  }

  @Post(':id/finalize')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async finalize(@Param('id') id: string) {
    return await this.quotationService.finalize(id);
  }
}
