import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
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
import { ScaffoldConfigService } from './scaffold-config.service';
import { CreateScaffoldConfigDto } from './dto/create-config.dto';
import { UpdateQuantityDto } from './dto/update-quantity.dto';
import { PatchResultLabelsDto } from './dto/patch-result-labels.dto';
import { ScaffoldExcelService } from './scaffold-excel.service';
import { ScaffoldPdfService } from './scaffold-pdf.service';
import { ScaffoldCadService } from './scaffold-cad.service';
import { SubscriptionActiveGuard } from '../../common/guards/subscription-active.guard';

@Controller('scaffold-configs')
@UseGuards(JwtAuthGuard, SubscriptionActiveGuard)
export class ScaffoldConfigController {
  private readonly logger = new Logger(ScaffoldConfigController.name);

  constructor(
    private readonly configService: ScaffoldConfigService,
    private readonly excelService: ScaffoldExcelService,
    private readonly pdfService: ScaffoldPdfService,
    private readonly cadService: ScaffoldCadService,
  ) {}

  /**
   * GET /scaffold-configs/rules
   * Returns all dropdown options for the frontend.
   */
  @Get('rules')
  getRules() {
    return this.configService.getRules();
  }

  /**
   * POST /scaffold-configs
   * Create configuration + run calculation in one step. All authenticated users (viewer, estimator, superadmin) can create.
   */
  @Post()
  async createAndCalculate(
    @Body() dto: CreateScaffoldConfigDto,
    @CurrentUser() user: any,
  ) {
    this.logger.log(`Creating scaffold config (mode: ${dto.mode})`);
    return await this.configService.createAndCalculate(dto, user.id);
  }

  /**
   * PATCH /scaffold-configs/:id/result-labels
   * Save plan-view X/Y 支柱番号 without full recalculation.
   */
  @Patch(':id/result-labels')
  async patchResultLabels(
    @Param('id') id: string,
    @Body() dto: PatchResultLabelsDto,
    @CurrentUser() user: any,
  ) {
    return await this.configService.patchEdgeHashiraLabeling(id, dto, user.id);
  }

  /**
   * PATCH /scaffold-configs/:id
   * Update config with new inputs and recalculate (same body as POST). All authenticated users can update.
   */
  @Patch(':id')
  async updateAndRecalculate(
    @Param('id') id: string,
    @Body() dto: CreateScaffoldConfigDto,
    @CurrentUser() user: any,
  ) {
    this.logger.log(`Updating scaffold config ${id}`);
    return await this.configService.updateAndRecalculate(id, dto, user.id);
  }

  /**
   * GET /scaffold-configs?projectId=xxx
   */
  @Get()
  async listConfigs(@Query('projectId') projectId?: string) {
    return await this.configService.listConfigs(projectId);
  }

  // ─── Materials catalog (optional seed) — must be BEFORE :id routes ───────

  @Get('materials')
  async listMaterials() {
    return await this.configService.listMaterials();
  }

  @Post('materials/seed')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async seedMaterials() {
    return await this.configService.seedMaterials();
  }

  // ─── Config CRUD ────────────────────────────────────────────

  /**
   * GET /scaffold-configs/by-drawing/:drawingId
   */
  @Get('by-drawing/:drawingId')
  async getConfigByDrawing(@Param('drawingId') drawingId: string) {
    return await this.configService.getConfigByDrawing(drawingId);
  }

  /**
   * GET /scaffold-configs/:id
   */
  @Get(':id')
  async getConfig(@Param('id') id: string) {
    return await this.configService.getConfig(id);
  }

  /**
   * GET /scaffold-configs/:id/quantities
   */
  @Get(':id/quantities')
  async getQuantities(@Param('id') configId: string) {
    return await this.configService.getQuantities(configId);
  }

  /**
   * PATCH /scaffold-configs/quantities/:quantityId/unit-price
   */
  @Patch('quantities/:quantityId/unit-price')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async patchQuantityUnitPrice(
    @Param('quantityId') quantityId: string,
    @Body('unitPrice') unitPrice: number,
  ) {
    if (typeof unitPrice !== 'number' || Number.isNaN(unitPrice)) {
      throw new BadRequestException('unitPrice is required');
    }
    return await this.configService.updateQuantityUnitPrice(quantityId, unitPrice);
  }

  /**
   * PATCH /scaffold-configs/quantities/:quantityId
   */
  @Patch('quantities/:quantityId')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async updateQuantity(
    @Param('quantityId') quantityId: string,
    @Body() dto: UpdateQuantityDto,
  ) {
    return await this.configService.updateQuantity(
      quantityId,
      dto.adjustedQuantity,
      dto.adjustmentReason,
    );
  }

  /**
   * PATCH /scaffold-configs/:id/quantity-unit-prices
   * Bulk save monthly rental unit prices (quote wizard step 1).
   */
  @Patch(':id/quantity-unit-prices')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async bulkQuantityUnitPrices(
    @Param('id') configId: string,
    @Body() body: { updates: Array<{ quantityId: string; unitPrice: number }> },
  ) {
    if (!body?.updates?.length) {
      throw new BadRequestException('updates[] is required');
    }
    return await this.configService.bulkUpdateQuantityUnitPrices(configId, body.updates);
  }

  /**
   * POST /scaffold-configs/:id/review
   */
  @Post(':id/review')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async markReviewed(@Param('id') configId: string) {
    return await this.configService.markReviewed(configId);
  }

  /**
   * DELETE /scaffold-configs/:id
   * Delete a scaffold configuration
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  async deleteConfig(@Param('id') configId: string) {
    this.logger.log(`Deleting scaffold config ${configId}`);
    await this.configService.deleteConfig(configId);
    return { message: 'Configuration deleted successfully' };
  }

  /**
   * GET /scaffold-configs/:id/export/excel
   * Download Excel quotation file.
   */
  @Get(':id/export/excel')
  async exportExcel(
    @Param('id') configId: string,
    @Query('lang') lang: string | undefined,
    @Res() res: Response,
  ) {
    const config = await this.configService.getConfig(configId);
    if (!config.calculationResult) {
      res.status(400).json({ message: 'Calculation not yet performed' });
      return;
    }

    const buffer = await this.excelService.generateQuotation(config, lang);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="scaffold_quotation_${configId.slice(0, 8)}.xlsx"`,
    );
    res.send(buffer);
  }

  /**
   * POST /scaffold-configs/:id/export/pdf/2d
   * Generate PDF from 2D SVG data
   */
  @Post(':id/export/pdf/2d')
  async export2DPdf(
    @Param('id') configId: string,
    @Body() body: { svgContent: string },
    @Res() res: Response,
  ) {
    const config = await this.configService.getConfig(configId);
    if (!config.calculationResult) {
      res.status(400).json({ message: 'Calculation not yet performed' });
      return;
    }

    const buffer = await this.pdfService.generate2DPdf(body.svgContent, configId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="scaffold_2d_${configId.slice(0, 8)}.pdf"`,
    );
    res.send(buffer);
  }

  /**
   * POST /scaffold-configs/:id/export/pdf/3d
   * Generate PDF from 3D screenshot
   */
  @Post(':id/export/pdf/3d')
  async export3DPdf(
    @Param('id') configId: string,
    @Body() body: { imageBase64: string },
    @Res() res: Response,
  ) {
    const config = await this.configService.getConfig(configId);
    if (!config.calculationResult) {
      res.status(400).json({ message: 'Calculation not yet performed' });
      return;
    }

    const buffer = await this.pdfService.generate3DPdf(body.imageBase64, configId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="scaffold_3d_${configId.slice(0, 8)}.pdf"`,
    );
    res.send(buffer);
  }

  /**
   * GET /scaffold-configs/:id/export/cad/2d?wall=...
   * Download DXF file for 2D scaffold drawing
   */
  @Get(':id/export/cad/2d')
  async export2DCad(
    @Param('id') configId: string,
    @Query('wall') wallSide: string,
    @Res() res: Response,
  ) {
    const config = await this.configService.getConfig(configId);
    if (!config.calculationResult) {
      res.status(400).json({ message: 'Calculation not yet performed' });
      return;
    }

    const buffer = await this.cadService.generate2DDxf(config, wallSide);

    res.setHeader('Content-Type', 'application/dxf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="scaffold_2d_${wallSide || 'all'}_${configId.slice(0, 8)}.dxf"`,
    );
    res.send(buffer);
  }

  /**
   * GET /scaffold-configs/:id/export/cad/3d?wall=...
   * Download OBJ file for 3D scaffold model
   */
  @Get(':id/export/cad/3d')
  async export3DCad(
    @Param('id') configId: string,
    @Query('wall') wallSide: string,
    @Res() res: Response,
  ) {
    const config = await this.configService.getConfig(configId);
    if (!config.calculationResult) {
      res.status(400).json({ message: 'Calculation not yet performed' });
      return;
    }

    const buffer = await this.cadService.generate3DObj(config, wallSide);

    res.setHeader('Content-Type', 'model/obj');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="scaffold_3d_${wallSide || 'all'}_${configId.slice(0, 8)}.obj"`,
    );
    res.send(buffer);
  }
}
