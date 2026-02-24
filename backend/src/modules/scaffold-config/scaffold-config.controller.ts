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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ScaffoldConfigService } from './scaffold-config.service';
import { CreateScaffoldConfigDto } from './dto/create-config.dto';
import { UpdateQuantityDto } from './dto/update-quantity.dto';
import { ScaffoldExcelService } from './scaffold-excel.service';
import { ScaffoldPdfService } from './scaffold-pdf.service';
import { ScaffoldCadService } from './scaffold-cad.service';
import { PriceTableParserService } from './price-table-parser.service';
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
    private readonly priceParserService: PriceTableParserService,
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

  // ─── Materials Price Master ──────────────────────────────────
  // These must be BEFORE :id routes to avoid param conflicts

  /**
   * GET /scaffold-configs/materials
   * List all scaffold materials with prices.
   */
  @Get('materials')
  async listMaterials() {
    return await this.configService.listMaterials();
  }

  /**
   * POST /scaffold-configs/materials/seed
   * Seed default materials if table is empty.
   */
  @Post('materials/seed')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async seedMaterials() {
    return await this.configService.seedMaterials();
  }

  /**
   * PATCH /scaffold-configs/materials/bulk
   * Bulk update material prices.
   */
  @Patch('materials/bulk')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async bulkUpdatePrices(
    @Body() body: { updates: Array<{ id: string; rentalPriceMonthly: number }> },
  ) {
    return await this.configService.bulkUpdatePrices(body.updates);
  }

  /**
   * PATCH /scaffold-configs/materials/:materialId
   * Update a material's price.
   */
  @Patch('materials/:materialId')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async updateMaterialPrice(
    @Param('materialId') materialId: string,
    @Body() body: { rentalPriceMonthly?: number; purchasePrice?: number; isActive?: boolean },
  ) {
    return await this.configService.updateMaterialPrice(materialId, body);
  }

  /**
   * POST /scaffold-configs/materials/upload-price-table
   * Upload Excel price table and get matched prices preview.
   */
  @Post('materials/upload-price-table')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `price-table-${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
          'application/vnd.ms-excel', // .xls
          'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm
        ];
        const ext = extname(file.originalname).toLowerCase();
        const allowedExts = ['.xlsx', '.xls', '.xlsm'];
        
        if (!allowedMimes.includes(file.mimetype) && !allowedExts.includes(ext)) {
          cb(new BadRequestException('Invalid file format. Only Excel files (.xlsx, .xls, .xlsm) are supported.'), false);
        } else {
          cb(null, true);
        }
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    }),
  )
  async uploadPriceTable(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    try {
      // Parse Excel file
      const mappings = await this.priceParserService.parseExcel(file);
      
      // Match to materials
      const matched = await this.priceParserService.matchToMaterials(mappings);
      
      return {
        success: true,
        totalRows: mappings.length,
        matched: matched.length,
        unmatched: mappings.length - matched.length,
        matches: matched.map((m) => ({
          materialId: m.material.id,
          materialCode: m.material.code,
          materialName: m.material.nameJp,
          sizeSpec: m.material.sizeSpec,
          oldPrice: m.oldPrice,
          newPrice: m.newPrice,
          confidence: m.confidence,
          matchReason: m.matchReason,
        })),
      };
    } catch (error) {
      this.logger.error(`Price table upload failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to process price table: ${error.message}`);
    }
  }

  /**
   * POST /scaffold-configs/materials/apply-price-table
   * Apply matched prices from uploaded price table.
   */
  @Post('materials/apply-price-table')
  @UseGuards(RolesGuard)
  @Roles('superadmin', 'estimator')
  async applyPriceTable(@Body() body: { matches: Array<{ materialId: string; newPrice: number }> }) {
    if (!body.matches || body.matches.length === 0) {
      throw new BadRequestException('No price matches provided');
    }

    try {
      const updates = body.matches.map((m) => ({
        id: m.materialId,
        rentalPriceMonthly: m.newPrice,
      }));

      const result = await this.configService.bulkUpdatePrices(updates);
      
      return {
        success: true,
        updated: result.length,
        message: `Successfully updated ${result.length} material prices`,
      };
    } catch (error) {
      this.logger.error(`Failed to apply price table: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to apply prices: ${error.message}`);
    }
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
  async exportExcel(@Param('id') configId: string, @Res() res: Response) {
    const config = await this.configService.getConfig(configId);
    if (!config.calculationResult) {
      res.status(400).json({ message: 'Calculation not yet performed' });
      return;
    }

    const buffer = await this.excelService.generateQuotation(config);

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
