import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapPayloadToSnake, mapRowToCamel, mapRowsToCamel } from '../../common/utils/db-mapper';
import { ConstructionPlanProject } from './construction-plan-project.entity';
import { DrawingSet } from './drawing-set.entity';
import { DrawingSetFile } from './drawing-set-file.entity';
import { ExtractedElement } from './extracted-element.entity';
import { classifyDrawingFilename } from './drawing-classifier';
import {
  STRUCTURAL_ELEMENT_TYPES,
  type ExtractionSource,
  type StructuralElementType,
} from './element-types';
import {
  CreateProjectDto,
  PatchClassificationDto,
  UpdateProjectDto,
  UpsertElementsDto,
} from './dto/construction-plan.dto';

const DEFAULT_LEVELS = ['1F', '2F', '3F', 'RF'];
const DEFAULT_BLOCKS: string[] = [];

interface CallerContext {
  userId: string;
  companyId: string | null;
  role: string;
}

interface UploadFileInput {
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string | null;
}

@Injectable()
export class StructuralTakeoffService {
  private readonly logger = new Logger(StructuralTakeoffService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ─── Projects ───────────────────────────────────────────────

  async createProject(ctx: CallerContext, dto: CreateProjectDto): Promise<ConstructionPlanProject> {
    const ins = mapPayloadToSnake({
      name: dto.name,
      siteAddress: dto.siteAddress ?? null,
      notes: dto.notes ?? null,
      blocks: dto.blocks ?? DEFAULT_BLOCKS,
      levels: dto.levels ?? DEFAULT_LEVELS,
      companyId: ctx.companyId,
      createdBy: ctx.userId,
    });
    const { data, error } = await this.supabase
      .getClient()
      .from('construction_plan_projects')
      .insert(ins)
      .select()
      .single();
    if (error || !data) {
      this.logger.error(`createProject failed: ${error?.message}`);
      throw new BadRequestException('Could not create construction plan project.');
    }
    return mapRowToCamel<ConstructionPlanProject>(data as Record<string, unknown>)!;
  }

  async listProjects(ctx: CallerContext): Promise<ConstructionPlanProject[]> {
    const client = this.supabase.getClient();
    let q = client
      .from('construction_plan_projects')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (ctx.role !== 'superadmin') {
      if (!ctx.companyId) {
        q = q.eq('created_by', ctx.userId);
      } else {
        q = q.eq('company_id', ctx.companyId);
      }
    }
    const { data, error } = await q;
    if (error) {
      this.logger.warn(`listProjects: ${error.message}`);
      return [];
    }
    return mapRowsToCamel<ConstructionPlanProject>(data || []);
  }

  async getProject(ctx: CallerContext, projectId: string): Promise<ConstructionPlanProject> {
    const { data, error } = await this.supabase
      .getClient()
      .from('construction_plan_projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Project not found.');
    const project = mapRowToCamel<ConstructionPlanProject>(data as Record<string, unknown>)!;
    this.assertProjectAccess(ctx, project);
    return project;
  }

  async updateProject(
    ctx: CallerContext,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ConstructionPlanProject> {
    await this.getProject(ctx, projectId); // access check
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.siteAddress !== undefined) updates.siteAddress = dto.siteAddress;
    if (dto.notes !== undefined) updates.notes = dto.notes;
    if (dto.blocks !== undefined) updates.blocks = dto.blocks;
    if (dto.levels !== undefined) updates.levels = dto.levels;
    if (Object.keys(updates).length === 0) return this.getProject(ctx, projectId);
    const { data, error } = await this.supabase
      .getClient()
      .from('construction_plan_projects')
      .update(mapPayloadToSnake(updates))
      .eq('id', projectId)
      .select()
      .single();
    if (error || !data) throw new BadRequestException('Update failed.');
    return mapRowToCamel<ConstructionPlanProject>(data as Record<string, unknown>)!;
  }

  async deleteProject(ctx: CallerContext, projectId: string): Promise<void> {
    await this.getProject(ctx, projectId);
    const { error } = await this.supabase
      .getClient()
      .from('construction_plan_projects')
      .delete()
      .eq('id', projectId);
    if (error) throw new BadRequestException('Delete failed.');
  }

  private assertProjectAccess(ctx: CallerContext, project: ConstructionPlanProject): void {
    if (ctx.role === 'superadmin') return;
    if (ctx.companyId && project.companyId === ctx.companyId) return;
    if (project.createdBy === ctx.userId) return;
    throw new ForbiddenException('You cannot access this project.');
  }

  // ─── Drawing sets (batch uploads) ──────────────────────────

  async createSet(
    ctx: CallerContext,
    projectId: string,
    name?: string,
    notes?: string,
  ): Promise<DrawingSet> {
    await this.getProject(ctx, projectId);
    const ins = mapPayloadToSnake({
      projectId,
      uploadedBy: ctx.userId,
      name: name ?? null,
      notes: notes ?? null,
      status: 'classifying',
    });
    const { data, error } = await this.supabase
      .getClient()
      .from('drawing_sets')
      .insert(ins)
      .select()
      .single();
    if (error || !data) throw new BadRequestException('Could not create drawing set.');
    return mapRowToCamel<DrawingSet>(data as Record<string, unknown>)!;
  }

  async listSetsForProject(
    ctx: CallerContext,
    projectId: string,
  ): Promise<DrawingSet[]> {
    await this.getProject(ctx, projectId);
    const { data, error } = await this.supabase
      .getClient()
      .from('drawing_sets')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.warn(`listSetsForProject: ${error.message}`);
      return [];
    }
    return mapRowsToCamel<DrawingSet>(data || []);
  }

  async getSet(ctx: CallerContext, setId: string): Promise<DrawingSet> {
    const set = await this.getSetRaw(setId);
    await this.assertSetAccess(ctx, set);
    return set;
  }

  private async getSetRaw(setId: string): Promise<DrawingSet> {
    const { data, error } = await this.supabase
      .getClient()
      .from('drawing_sets')
      .select('*')
      .eq('id', setId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Drawing set not found.');
    return mapRowToCamel<DrawingSet>(data as Record<string, unknown>)!;
  }

  private async assertSetAccess(ctx: CallerContext, set: DrawingSet): Promise<void> {
    const project = await this.getProjectRaw(set.projectId);
    this.assertProjectAccess(ctx, project);
  }

  private async getProjectRaw(projectId: string): Promise<ConstructionPlanProject> {
    const { data, error } = await this.supabase
      .getClient()
      .from('construction_plan_projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Project not found.');
    return mapRowToCamel<ConstructionPlanProject>(data as Record<string, unknown>)!;
  }

  // ─── File upload + classification ──────────────────────────

  /**
   * Persist uploaded files for an existing set and run the deterministic
   * filename classifier. Returns the inserted file rows with classifications.
   * No AI is invoked. Storage is not strictly required for this milestone:
   * if `storagePath` is null we still record the file metadata + classification
   * so the UI can drive the manual review workflow.
   */
  async addFilesToSet(
    ctx: CallerContext,
    setId: string,
    files: UploadFileInput[],
  ): Promise<DrawingSetFile[]> {
    const set = await this.getSet(ctx, setId);
    if (files.length === 0) return [];

    const rows = files.map((f) => {
      const cls = classifyDrawingFilename(f.filename);
      return mapPayloadToSnake({
        setId: set.id,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        storagePath: f.storagePath,
        kind: cls.kind,
        level: cls.level,
        block: cls.block,
        classificationSource: 'auto',
        classificationConfidence: cls.confidence,
      });
    });

    const { data, error } = await this.supabase
      .getClient()
      .from('drawing_set_files')
      .insert(rows)
      .select();
    if (error) {
      this.logger.error(`addFilesToSet failed: ${error.message}`);
      throw new BadRequestException('Could not save uploaded files.');
    }
    return mapRowsToCamel<DrawingSetFile>(data || []);
  }

  async listFilesForSet(ctx: CallerContext, setId: string): Promise<DrawingSetFile[]> {
    await this.getSet(ctx, setId);
    const { data, error } = await this.supabase
      .getClient()
      .from('drawing_set_files')
      .select('*')
      .eq('set_id', setId)
      .order('created_at', { ascending: true });
    if (error) {
      this.logger.warn(`listFilesForSet: ${error.message}`);
      return [];
    }
    return mapRowsToCamel<DrawingSetFile>(data || []);
  }

  async patchFileClassification(
    ctx: CallerContext,
    setId: string,
    fileId: string,
    patch: PatchClassificationDto,
  ): Promise<DrawingSetFile> {
    await this.getSet(ctx, setId);
    const updates: Record<string, unknown> = {
      classificationSource: 'manual',
    };
    if (patch.kind !== undefined) updates.kind = patch.kind;
    if (patch.level !== undefined) updates.level = patch.level;
    if (patch.block !== undefined) updates.block = patch.block;
    const { data, error } = await this.supabase
      .getClient()
      .from('drawing_set_files')
      .update(mapPayloadToSnake(updates))
      .eq('id', fileId)
      .eq('set_id', setId)
      .select()
      .single();
    if (error || !data) throw new BadRequestException('Update failed.');
    return mapRowToCamel<DrawingSetFile>(data as Record<string, unknown>)!;
  }

  async deleteFile(ctx: CallerContext, setId: string, fileId: string): Promise<void> {
    await this.getSet(ctx, setId);
    const { error } = await this.supabase
      .getClient()
      .from('drawing_set_files')
      .delete()
      .eq('id', fileId)
      .eq('set_id', setId);
    if (error) throw new BadRequestException('Delete failed.');
  }

  // ─── Manual element entry ──────────────────────────────────

  async listElementsForSet(ctx: CallerContext, setId: string): Promise<ExtractedElement[]> {
    await this.getSet(ctx, setId);
    const { data, error } = await this.supabase
      .getClient()
      .from('extracted_elements')
      .select('*')
      .eq('set_id', setId)
      .order('level', { ascending: true })
      .order('block', { ascending: true })
      .order('element_type', { ascending: true });
    if (error) {
      this.logger.warn(`listElementsForSet: ${error.message}`);
      return [];
    }
    return mapRowsToCamel<ExtractedElement>(data || []);
  }

  async upsertElements(
    ctx: CallerContext,
    setId: string,
    payload: UpsertElementsDto,
    source: ExtractionSource = 'manual',
  ): Promise<ExtractedElement[]> {
    await this.getSet(ctx, setId);
    if (!Array.isArray(payload.rows) || payload.rows.length === 0) return [];
    const rows = payload.rows.map((row) => {
      if (!STRUCTURAL_ELEMENT_TYPES.includes(row.elementType as StructuralElementType)) {
        throw new BadRequestException(`Unknown element type: ${row.elementType}`);
      }
      const qty = Number.isFinite(row.qty) ? Math.max(0, Math.floor(row.qty)) : 0;
      return mapPayloadToSnake({
        id: row.id ?? undefined,
        setId,
        level: row.level,
        block: row.block ?? null,
        elementType: row.elementType,
        label: row.label ?? null,
        section: row.section ?? null,
        qty,
        grid: row.grid ?? null,
        notes: row.notes ?? null,
        source,
      });
    });
    const { data, error } = await this.supabase
      .getClient()
      .from('extracted_elements')
      .upsert(rows, { onConflict: 'id' })
      .select();
    if (error) {
      this.logger.error(`upsertElements failed: ${error.message}`);
      throw new BadRequestException('Could not save elements.');
    }
    return mapRowsToCamel<ExtractedElement>(data || []);
  }

  async deleteElement(ctx: CallerContext, setId: string, elementId: string): Promise<void> {
    await this.getSet(ctx, setId);
    const { error } = await this.supabase
      .getClient()
      .from('extracted_elements')
      .delete()
      .eq('id', elementId)
      .eq('set_id', setId);
    if (error) throw new BadRequestException('Delete failed.');
  }

  /** Rich review payload: project + set + files + elements in one round-trip. */
  async getSetReview(ctx: CallerContext, setId: string): Promise<{
    project: ConstructionPlanProject;
    set: DrawingSet;
    files: DrawingSetFile[];
    elements: ExtractedElement[];
  }> {
    const set = await this.getSet(ctx, setId);
    const project = await this.getProject(ctx, set.projectId);
    const [files, elements] = await Promise.all([
      this.listFilesForSet(ctx, setId),
      this.listElementsForSet(ctx, setId),
    ]);
    return { project, set, files, elements };
  }
}
