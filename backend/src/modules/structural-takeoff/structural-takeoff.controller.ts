import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProductAccessGuard } from '../../common/guards/product-access.guard';
import { RequiresProduct } from '../../common/decorators/requires-product.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StructuralTakeoffService } from './structural-takeoff.service';
import { ExcelElementImportService } from './extractors/excel-import.service';
import { DxfLayerExtractorService } from './extractors/dxf-layer-extractor.service';
import { ConstructionPlanExcelService } from './schedule/construction-plan-excel.service';
import { runSequencer } from './schedule/erection-sequencer';
import { buildDeliveryPlan } from './schedule/delivery-plan';
import { todayIso } from './schedule/calendar';
import { PresenceService } from '../presence/presence.service';
import {
  CreateProjectDto,
  CreateSetDto,
  PatchClassificationDto,
  UpdateProjectDto,
  UpsertElementsDto,
} from './dto/construction-plan.dto';

const MAX_FILES = 30;
const FILE_SIZE_LIMIT = 50 * 1024 * 1024;

@Controller('structural-takeoff')
@UseGuards(JwtAuthGuard, ProductAccessGuard)
@RequiresProduct('construction_plan')
export class StructuralTakeoffController {
  constructor(
    private readonly service: StructuralTakeoffService,
    private readonly presence: PresenceService,
    private readonly excelImport: ExcelElementImportService,
    private readonly dxfLayerExtractor: DxfLayerExtractorService,
    private readonly excelExport: ConstructionPlanExcelService,
  ) {}

  // ─── Projects ─────────────────────────────────────────────

  @Get('projects')
  async listProjects(@CurrentUser() user: any) {
    return this.service.listProjects({ userId: user.id, companyId: user.companyId ?? null, role: user.role });
  }

  @Post('projects')
  async createProject(@CurrentUser() user: any, @Body() dto: CreateProjectDto) {
    return this.service.createProject(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      dto,
    );
  }

  /**
   * Phase 4 — gap #4. One-click sample loader so the user can verify the
   * schedule + truck plan + Excel exporter end-to-end without typing 100
   * elements. Creates a new project + set populated with a realistic
   * 5-floor / 2-block S-frame fixture.
   */
  @Post('projects/load-sample')
  async loadSample(@CurrentUser() user: any) {
    return this.service.loadSampleProject({
      userId: user.id,
      companyId: user.companyId ?? null,
      role: user.role,
    });
  }

  @Get('projects/:projectId')
  async getProject(@CurrentUser() user: any, @Param('projectId') projectId: string) {
    return this.service.getProject(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      projectId,
    );
  }

  @Put('projects/:projectId')
  async updateProject(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.service.updateProject(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      projectId,
      dto,
    );
  }

  @Delete('projects/:projectId')
  async deleteProject(@CurrentUser() user: any, @Param('projectId') projectId: string) {
    await this.service.deleteProject(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      projectId,
    );
    return { ok: true };
  }

  // ─── Drawing sets ─────────────────────────────────────────

  @Get('projects/:projectId/sets')
  async listSets(@CurrentUser() user: any, @Param('projectId') projectId: string) {
    return this.service.listSetsForProject(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      projectId,
    );
  }

  @Post('projects/:projectId/sets')
  async createSet(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSetDto,
  ) {
    return this.service.createSet(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      projectId,
      dto.name,
      dto.notes,
    );
  }

  @Get('sets/:setId')
  async getSetReview(@CurrentUser() user: any, @Param('setId') setId: string) {
    return this.service.getSetReview(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      setId,
    );
  }

  // ─── Multi-file upload + auto-classification ─────────────

  @Post('sets/:setId/files')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: FILE_SIZE_LIMIT, files: MAX_FILES },
    }),
  )
  async uploadFiles(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded.');
    }
    const ctx = { userId: user.id, companyId: user.companyId ?? null, role: user.role };
    const inputs = files.map((f) => ({
      filename: f.originalname,
      mimeType: f.mimetype || null,
      sizeBytes: f.size ?? null,
      // Pass the buffer through so the service can persist the bytes to
      // the construction-plan-files Supabase Storage bucket.
      buffer: ((f as any).buffer as Buffer | undefined) ?? null,
    }));
    const saved = await this.service.addFilesToSet(ctx, setId, inputs);

    // Mirror into the unified upload feed so the superadmin cockpit sees
    // construction-plan uploads too.
    for (const f of files) {
      await this.presence.recordUpload({
        userId: user.id,
        companyId: user.companyId ?? null,
        productCode: 'construction_plan',
        kind: 'drawing',
        filename: f.originalname,
        mimeType: f.mimetype || null,
        sizeBytes: f.size ?? null,
        refId: setId,
        metadata: { setId },
      });
    }
    return saved;
  }

  @Patch('sets/:setId/files/:fileId')
  async patchFileClassification(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @Param('fileId') fileId: string,
    @Body() patch: PatchClassificationDto,
  ) {
    return this.service.patchFileClassification(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      setId,
      fileId,
      patch,
    );
  }

  @Delete('sets/:setId/files/:fileId')
  async deleteFile(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @Param('fileId') fileId: string,
  ) {
    await this.service.deleteFile(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      setId,
      fileId,
    );
    return { ok: true };
  }

  /**
   * Short-lived signed download URL for an uploaded file. Returns 404 when
   * the file is metadata-only (no stored bytes).
   */
  @Get('sets/:setId/files/:fileId/url')
  async getFileSignedUrl(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.service.getFileSignedUrl(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      setId,
      fileId,
    );
  }

  // ─── Manual element entry ────────────────────────────────

  @Get('sets/:setId/elements')
  async listElements(@CurrentUser() user: any, @Param('setId') setId: string) {
    return this.service.listElementsForSet(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      setId,
    );
  }

  @Post('sets/:setId/elements')
  async upsertElements(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @Body() dto: UpsertElementsDto,
  ) {
    return this.service.upsertElements(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      setId,
      dto,
      'manual',
    );
  }

  @Delete('sets/:setId/elements/:elementId')
  async deleteElement(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @Param('elementId') elementId: string,
  ) {
    await this.service.deleteElement(
      { userId: user.id, companyId: user.companyId ?? null, role: user.role },
      setId,
      elementId,
    );
    return { ok: true };
  }

  // ─── Phase 3 follow-up: Excel/CSV import ────────────────

  @Post('sets/:setId/import/excel')
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async importElementsFromExcel(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    const buffer = (file as any).buffer as Buffer | undefined;
    if (!buffer?.length) throw new BadRequestException('File has no content.');
    const result = await this.excelImport.parseBuffer(buffer, file.originalname);
    const ctx = { userId: user.id, companyId: user.companyId ?? null, role: user.role };

    if (result.rows.length === 0) {
      return { saved: [], proposals: result.rows, warnings: result.warnings };
    }

    const saved = await this.service.upsertElements(
      ctx,
      setId,
      {
        rows: result.rows.map((r) => ({
          level: r.level,
          block: r.block,
          elementType: r.elementType,
          label: r.label,
          section: r.section,
          qty: r.qty,
          grid: r.grid,
          notes: r.notes,
        })),
      },
      'excel',
    );

    await this.presence.recordUpload({
      userId: user.id,
      companyId: user.companyId ?? null,
      productCode: 'construction_plan',
      kind: 'excel',
      filename: file.originalname,
      mimeType: file.mimetype || null,
      sizeBytes: file.size ?? null,
      refId: setId,
      metadata: { setId, rowsImported: result.rows.length, mode: 'excel' },
    });

    return { saved, proposals: result.rows, warnings: result.warnings };
  }

  // ─── Phase 3 follow-up: DXF layer-based extraction ──────

  @Post('sets/:setId/import/dxf-layers')
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async extractFromDxfLayers(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('fallbackLevel') fallbackLevel?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    const buffer = (file as any).buffer as Buffer | undefined;
    if (!buffer?.length) throw new BadRequestException('File has no content.');
    const result = this.dxfLayerExtractor.extractFromBuffer(buffer, fallbackLevel || '1F');
    const ctx = { userId: user.id, companyId: user.companyId ?? null, role: user.role };

    let saved: ReturnType<typeof Array.prototype.slice> = [];
    if (result.proposals.length > 0) {
      saved = await this.service.upsertElements(
        ctx,
        setId,
        {
          rows: result.proposals.map((p) => ({
            level: p.level,
            block: p.block,
            elementType: p.elementType,
            label: null,
            section: null,
            qty: p.qty,
            grid: null,
            notes: `auto from DXF layer "${p.layer}"`,
          })),
        },
        'dxf',
      );
    }

    await this.presence.recordUpload({
      userId: user.id,
      companyId: user.companyId ?? null,
      productCode: 'construction_plan',
      kind: 'dxf',
      filename: file.originalname,
      mimeType: file.mimetype || null,
      sizeBytes: file.size ?? null,
      refId: setId,
      metadata: {
        setId,
        proposals: result.proposals.length,
        layers: result.layers.length,
        mode: 'dxf-layer',
      },
    });

    return {
      saved,
      proposals: result.proposals,
      warnings: result.warnings,
      layers: result.layers,
    };
  }

  // ─── Phase 4: schedule + delivery + Excel ────────────────

  @Get('sets/:setId/schedule')
  async getSchedule(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @Query('startDate') startDate?: string,
    @Query('workSaturday') workSaturdayQuery?: string,
  ) {
    const ctx = { userId: user.id, companyId: user.companyId ?? null, role: user.role };
    const review = await this.service.getSetReview(ctx, setId);
    const startDateIso = startDate || todayIso();
    const workSaturday = workSaturdayQuery !== 'false';
    const result = runSequencer({
      levels: review.project.levels.length > 0 ? review.project.levels : ['1F'],
      blocks: review.project.blocks ?? [],
      elements: review.elements,
      calendar: { startDateIso, workSaturday },
    });
    return {
      project: review.project,
      set: review.set,
      activities: result.activities,
      workingDays: result.workingDays,
      endIso: result.endIso,
      startDateIso,
    };
  }

  @Get('sets/:setId/delivery-plan')
  async getDeliveryPlan(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @Query('startDate') startDate?: string,
    @Query('workSaturday') workSaturdayQuery?: string,
  ) {
    const ctx = { userId: user.id, companyId: user.companyId ?? null, role: user.role };
    const review = await this.service.getSetReview(ctx, setId);
    const startDateIso = startDate || todayIso();
    const workSaturday = workSaturdayQuery !== 'false';
    const seq = runSequencer({
      levels: review.project.levels.length > 0 ? review.project.levels : ['1F'],
      blocks: review.project.blocks ?? [],
      elements: review.elements,
      calendar: { startDateIso, workSaturday },
    });
    const plan = buildDeliveryPlan(seq.activities, seq.dailyDemand);
    return {
      project: review.project,
      set: review.set,
      startDateIso,
      ...plan,
    };
  }

  @Get('sets/:setId/excel')
  async exportExcel(
    @CurrentUser() user: any,
    @Param('setId') setId: string,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('workSaturday') workSaturdayQuery?: string,
  ) {
    const ctx = { userId: user.id, companyId: user.companyId ?? null, role: user.role };
    const review = await this.service.getSetReview(ctx, setId);
    const startDateIso = startDate || todayIso();
    const workSaturday = workSaturdayQuery !== 'false';
    const { buffer, filename } = await this.excelExport.build(review.project, review.set, review.elements, {
      startDateIso,
      workSaturday,
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    await this.presence.recordUpload({
      userId: user.id,
      companyId: user.companyId ?? null,
      productCode: 'construction_plan',
      kind: 'excel_export',
      filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: buffer.length,
      refId: setId,
      metadata: { setId, startDateIso, workSaturday },
    });
    res.end(buffer);
  }
}
