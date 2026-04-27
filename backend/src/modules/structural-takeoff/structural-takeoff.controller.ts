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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProductAccessGuard } from '../../common/guards/product-access.guard';
import { RequiresProduct } from '../../common/decorators/requires-product.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StructuralTakeoffService } from './structural-takeoff.service';
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
      // Phase 3 foundation persists metadata only; storage path wiring is
      // an integration follow-up (Supabase storage bucket + signed URLs).
      storagePath: null,
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
}
