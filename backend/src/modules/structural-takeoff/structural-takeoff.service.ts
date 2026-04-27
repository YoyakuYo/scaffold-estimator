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
import { buildSampleFixture } from './sample-fixtures';
import { TitleBlockVisionService } from './extractors/title-block-vision.service';
import { AiElementVisionService } from './extractors/ai-element-vision.service';
import type { DeliveryPlanOverridesPayload } from './schedule/delivery-plan-overrides';

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
  /**
   * Raw bytes. When supplied, the service uploads the buffer to the
   * `construction-plan-files` bucket and persists the resulting object
   * key as `storagePath`. When undefined, only metadata is recorded.
   */
  buffer?: Buffer | null;
}

/** Private Supabase Storage bucket holding all Construction Plan uploads. */
const CONSTRUCTION_PLAN_BUCKET = 'construction-plan-files';
/** Default signed-URL TTL for downloads (seconds). 5 minutes is plenty for one-shot reviews. */
const SIGNED_URL_TTL_SECONDS = 60 * 5;

@Injectable()
export class StructuralTakeoffService {
  private readonly logger = new Logger(StructuralTakeoffService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly titleBlockVision: TitleBlockVisionService,
    private readonly aiElementVision: AiElementVisionService,
  ) {}

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
   * Persist uploaded files for an existing set, run the deterministic
   * filename classifier, AND store raw bytes in the
   * `construction-plan-files` Supabase Storage bucket so they can be
   * downloaded, previewed, or re-classified later (AI vision pass).
   *
   * If a buffer is omitted (e.g. callers that only have metadata), the row
   * is created with `storage_path = null` and the file simply isn't
   * downloadable. Storage failures are logged but never block the metadata
   * insert — the user shouldn't lose classification work over a transient
   * storage hiccup.
   */
  async addFilesToSet(
    ctx: CallerContext,
    setId: string,
    files: UploadFileInput[],
  ): Promise<DrawingSetFile[]> {
    const set = await this.getSet(ctx, setId);
    if (files.length === 0) return [];

    const client = this.supabase.getClient();

    // Insert metadata first so we have a stable file id for the storage path.
    const metaRows = files.map((f) => {
      const cls = classifyDrawingFilename(f.filename);
      return mapPayloadToSnake({
        setId: set.id,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        storagePath: null,
        kind: cls.kind,
        level: cls.level,
        block: cls.block,
        classificationSource: 'auto',
        classificationConfidence: cls.confidence,
      });
    });

    const { data: inserted, error: insertErr } = await client
      .from('drawing_set_files')
      .insert(metaRows)
      .select();
    if (insertErr || !inserted) {
      this.logger.error(`addFilesToSet meta insert failed: ${insertErr?.message}`);
      throw new BadRequestException('Could not save uploaded files.');
    }

    // Upload bytes for any file that came with a buffer; update storage_path.
    for (let i = 0; i < inserted.length; i++) {
      const row = inserted[i] as Record<string, unknown>;
      const file = files[i];
      if (!file?.buffer || !Buffer.isBuffer(file.buffer)) continue;
      const fileId = String(row.id);
      const ext = this.extractExtension(file.filename);
      const objectKey = `${set.id}/${fileId}${ext}`;
      const { error: upErr } = await client.storage
        .from(CONSTRUCTION_PLAN_BUCKET)
        .upload(objectKey, file.buffer, {
          contentType: file.mimeType || 'application/octet-stream',
          upsert: true,
        });
      if (upErr) {
        this.logger.warn(
          `addFilesToSet storage upload failed for ${fileId}: ${upErr.message}`,
        );
        continue;
      }
      const { error: patchErr } = await client
        .from('drawing_set_files')
        .update({ storage_path: objectKey })
        .eq('id', fileId);
      if (patchErr) {
        this.logger.warn(
          `addFilesToSet storage_path patch failed for ${fileId}: ${patchErr.message}`,
        );
      } else {
        (row as { storage_path: string }).storage_path = objectKey;
      }
    }

    return mapRowsToCamel<DrawingSetFile>(inserted as Record<string, unknown>[]);
  }

  private extractExtension(filename: string): string {
    const m = filename.match(/\.[^./\\]+$/);
    return m ? m[0].toLowerCase() : '';
  }

  /**
   * Generate a short-lived signed URL so a Construction Plan member can
   * download / preview an uploaded file without exposing the bucket.
   */
  async getFileSignedUrl(
    ctx: CallerContext,
    setId: string,
    fileId: string,
    ttlSeconds = SIGNED_URL_TTL_SECONDS,
  ): Promise<{ url: string; expiresInSeconds: number; filename: string }> {
    await this.getSet(ctx, setId);
    const { data: row, error } = await this.supabase
      .getClient()
      .from('drawing_set_files')
      .select('id, filename, storage_path, set_id')
      .eq('id', fileId)
      .eq('set_id', setId)
      .maybeSingle();
    if (error || !row) throw new NotFoundException('File not found.');
    const r = row as Record<string, unknown>;
    const path = r.storage_path as string | null | undefined;
    if (!path) {
      throw new NotFoundException('File has no stored bytes (metadata-only).');
    }
    const { data, error: signErr } = await this.supabase
      .getClient()
      .storage.from(CONSTRUCTION_PLAN_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    if (signErr || !data?.signedUrl) {
      this.logger.warn(`getFileSignedUrl failed: ${signErr?.message}`);
      throw new BadRequestException('Could not create download link.');
    }
    return {
      url: data.signedUrl,
      expiresInSeconds: ttlSeconds,
      filename: String(r.filename),
    };
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
    const client = this.supabase.getClient();
    // Look up storage path first so we can clean up the bucket after a
    // successful row delete. Storage failures here are warnings — a stale
    // object is much less harmful than a row delete that silently rolls back.
    const { data: existing } = await client
      .from('drawing_set_files')
      .select('storage_path')
      .eq('id', fileId)
      .eq('set_id', setId)
      .maybeSingle();
    const storagePath = (existing as { storage_path?: string | null } | null)?.storage_path ?? null;

    const { error } = await client
      .from('drawing_set_files')
      .delete()
      .eq('id', fileId)
      .eq('set_id', setId);
    if (error) throw new BadRequestException('Delete failed.');

    if (storagePath) {
      const { error: rmErr } = await client.storage
        .from(CONSTRUCTION_PLAN_BUCKET)
        .remove([storagePath]);
      if (rmErr) {
        this.logger.warn(
          `deleteFile storage remove failed for ${storagePath}: ${rmErr.message}`,
        );
      }
    }
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
      let pieceLengthMm: number | null = null;
      if (row.pieceLengthMm != null && Number.isFinite(row.pieceLengthMm)) {
        const n = Math.floor(Number(row.pieceLengthMm));
        if (n > 0) pieceLengthMm = Math.min(120_000, Math.max(1, n));
      }
      // Omit null piece_length_mm so PostgREST does not require the column
      // (older DBs before migration 142). Non-null values still need the column.
      const payload: Record<string, unknown> = {
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
      };
      if (pieceLengthMm != null) payload.pieceLengthMm = pieceLengthMm;
      return mapPayloadToSnake(payload);
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

  /**
   * Phase 3 — gap #6. Re-classify a stored file from its title-block content
   * (not just its filename) using Claude Vision. PDFs are rasterized via
   * Sharp before sending. The returned suggestion is applied to the row
   * with classification_source='manual' so it is sticky and never gets
   * overwritten by a re-run of the filename heuristic.
   */
  async reclassifyFileFromContent(
    ctx: CallerContext,
    setId: string,
    fileId: string,
  ): Promise<{
    file: DrawingSetFile;
    suggestion: { kind: string | null; level: string | null; block: string | null; confidence: number };
  }> {
    if (!this.titleBlockVision.isConfigured()) {
      throw new BadRequestException(
        'Title-block vision is not configured. Set ANTHROPIC_API_KEY on the API.',
      );
    }
    await this.getSet(ctx, setId);
    const client = this.supabase.getClient();
    const { data: row, error } = await client
      .from('drawing_set_files')
      .select('*')
      .eq('id', fileId)
      .eq('set_id', setId)
      .maybeSingle();
    if (error || !row) throw new NotFoundException('File not found.');
    const fileRow = mapRowToCamel<DrawingSetFile>(row as Record<string, unknown>)!;
    const path = fileRow.storagePath;
    if (!path) {
      throw new BadRequestException('File has no stored bytes (metadata-only).');
    }
    const { data: bin, error: dlErr } = await client.storage
      .from(CONSTRUCTION_PLAN_BUCKET)
      .download(path);
    if (dlErr || !bin) {
      this.logger.warn(`reclassifyFileFromContent download failed: ${dlErr?.message}`);
      throw new BadRequestException('Could not read stored file.');
    }
    const arrayBuf = await bin.arrayBuffer();
    let imageBuffer: Buffer = Buffer.from(arrayBuf);
    const lower = (fileRow.filename ?? '').toLowerCase();
    // DWG is a binary CAD format; vision models can't read it. Tell the
    // caller plainly that they need to convert to DXF/PDF first.
    if (lower.endsWith('.dwg') || lower.endsWith('.jww')) {
      throw new BadRequestException(
        'AI cannot read DWG/JWW directly. Please re-upload as DXF or PDF for AI classification.',
      );
    }
    if (lower.endsWith('.pdf')) {
      try {
        const sharp = (await import('sharp')).default;
        imageBuffer = await sharp(imageBuffer, { density: 200 })
          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 7 })
          .toBuffer();
      } catch (sharpErr) {
        this.logger.warn(
          `reclassifyFileFromContent PDF→image failed: ${(sharpErr as Error).message}; sending raw buffer`,
        );
      }
    }

    const suggestion = await this.titleBlockVision.classifyImage(imageBuffer, fileRow.filename);

    const updates: Record<string, unknown> = { classificationSource: 'manual' };
    if (suggestion.kind) updates.kind = suggestion.kind;
    if (suggestion.level) updates.level = suggestion.level;
    if (suggestion.block) updates.block = suggestion.block;
    if (typeof suggestion.confidence === 'number') {
      updates.classificationConfidence = suggestion.confidence;
    }

    const { data: saved, error: patchErr } = await client
      .from('drawing_set_files')
      .update(mapPayloadToSnake(updates))
      .eq('id', fileId)
      .eq('set_id', setId)
      .select()
      .single();
    if (patchErr || !saved) {
      this.logger.warn(`reclassifyFileFromContent patch failed: ${patchErr?.message}`);
      throw new BadRequestException('Could not save AI classification.');
    }

    return {
      file: mapRowToCamel<DrawingSetFile>(saved as Record<string, unknown>)!,
      suggestion: {
        kind: suggestion.kind ?? null,
        level: suggestion.level ?? null,
        block: suggestion.block ?? null,
        confidence: suggestion.confidence,
      },
    };
  }

  /**
   * Phase 3 — gap #9. AI vision extraction of structural elements (柱/大梁/
   * 小梁/耐風梁/ブレース/階段/EV/デッキ) from a stored drawing. Pulls the file
   * from storage, rasterizes if PDF, sends to Claude with a kind-specific
   * prompt, and upserts the resulting rows with source='ai'.
   *
   * Caller is responsible for `aiExtract` capability gating; the service
   * itself only checks that the API key is configured.
   */
  async extractElementsWithAi(
    ctx: CallerContext,
    setId: string,
    fileId: string,
  ): Promise<{
    saved: ExtractedElement[];
    proposalCount: number;
    warnings: string[];
  }> {
    if (!this.aiElementVision.isConfigured()) {
      throw new BadRequestException(
        'AI element vision is not configured. Set ANTHROPIC_API_KEY on the API.',
      );
    }
    await this.getSet(ctx, setId);
    const client = this.supabase.getClient();
    const { data: row, error } = await client
      .from('drawing_set_files')
      .select('*')
      .eq('id', fileId)
      .eq('set_id', setId)
      .maybeSingle();
    if (error || !row) throw new NotFoundException('File not found.');
    const fileRow = mapRowToCamel<DrawingSetFile>(row as Record<string, unknown>)!;
    const path = fileRow.storagePath;
    if (!path) {
      throw new BadRequestException('File has no stored bytes (metadata-only).');
    }

    const { data: bin, error: dlErr } = await client.storage
      .from(CONSTRUCTION_PLAN_BUCKET)
      .download(path);
    if (dlErr || !bin) {
      this.logger.warn(`extractElementsWithAi download failed: ${dlErr?.message}`);
      throw new BadRequestException('Could not read stored file.');
    }
    const arrayBuf = await bin.arrayBuffer();
    let imageBuffer: Buffer = Buffer.from(arrayBuf);
    const lower = (fileRow.filename ?? '').toLowerCase();
    if (lower.endsWith('.dwg') || lower.endsWith('.jww')) {
      throw new BadRequestException(
        'AI cannot extract elements from DWG/JWW directly. Please re-upload as DXF or PDF for AI extraction.',
      );
    }
    if (lower.endsWith('.pdf')) {
      try {
        const sharp = (await import('sharp')).default;
        imageBuffer = await sharp(imageBuffer, { density: 200 })
          .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 7 })
          .toBuffer();
      } catch (sharpErr) {
        this.logger.warn(
          `extractElementsWithAi PDF→image failed: ${(sharpErr as Error).message}; sending raw buffer`,
        );
      }
    }

    const result = await this.aiElementVision.extract(imageBuffer, {
      filename: fileRow.filename,
      kind: fileRow.kind ?? null,
      level: fileRow.level ?? null,
      block: fileRow.block ?? null,
    });
    if (result.rows.length === 0) {
      return { saved: [], proposalCount: 0, warnings: result.warnings };
    }
    const saved = await this.upsertElements(
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
          notes: 'AI extracted from drawing',
        })),
      },
      'ai',
    );
    return { saved, proposalCount: result.rows.length, warnings: result.warnings };
  }

  /**
   * Phase 4 — gap #4. Create a brand-new project + drawing set populated
   * from the realistic sample fixture so the user (or QA) can validate the
   * schedule + truck plan + Excel exporter end to end without typing 100
   * elements by hand. Returns the new project + set for the frontend to
   * route into.
   */
  /**
   * Phase 4 — gap #7. Foreman overrides on the generated delivery plan.
   * Stored as a single JSON blob per set; merged at read time.
   */
  async getDeliveryOverrides(
    ctx: CallerContext,
    setId: string,
  ): Promise<DeliveryPlanOverridesPayload> {
    await this.getSet(ctx, setId);
    const { data, error } = await this.supabase
      .getClient()
      .from('delivery_plan_overrides')
      .select('edits')
      .eq('set_id', setId)
      .maybeSingle();
    if (error) {
      this.logger.warn(`getDeliveryOverrides: ${error.message}`);
      return {};
    }
    const edits = (data as { edits?: DeliveryPlanOverridesPayload } | null)?.edits ?? {};
    return edits;
  }

  async saveDeliveryOverrides(
    ctx: CallerContext,
    setId: string,
    payload: DeliveryPlanOverridesPayload,
  ): Promise<DeliveryPlanOverridesPayload> {
    await this.getSet(ctx, setId);
    const cleaned: DeliveryPlanOverridesPayload = {
      trucks: Array.isArray(payload?.trucks)
        ? payload.trucks
            .filter(
              (t) =>
                t &&
                typeof t.date === 'string' &&
                typeof t.binNo === 'number' &&
                t.binNo > 0,
            )
            .slice(0, 1000)
        : [],
    };
    const { data, error } = await this.supabase
      .getClient()
      .from('delivery_plan_overrides')
      .upsert(
        {
          set_id: setId,
          edits: cleaned,
          updated_by: ctx.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'set_id' },
      )
      .select()
      .single();
    if (error || !data) {
      this.logger.warn(`saveDeliveryOverrides failed: ${error?.message}`);
      throw new BadRequestException('Could not save delivery plan overrides.');
    }
    return cleaned;
  }

  async loadSampleProject(ctx: CallerContext): Promise<{
    project: ConstructionPlanProject;
    set: DrawingSet;
    elementCount: number;
  }> {
    const fixture = buildSampleFixture();
    const project = await this.createProject(ctx, {
      name: fixture.name,
      siteAddress: fixture.siteAddress,
      blocks: fixture.blocks,
      levels: fixture.levels,
    });
    const set = await this.createSet(ctx, project.id, 'サンプル抽出', 'fixture-loaded');
    const rows = fixture.elements.map((e) => ({
      level: e.level,
      block: e.block ?? null,
      elementType: e.elementType,
      label: e.label,
      section: e.section,
      qty: e.qty,
      grid: e.grid,
    }));
    await this.upsertElements(ctx, set.id, { rows }, 'manual');
    return { project, set, elementCount: rows.length };
  }
}
