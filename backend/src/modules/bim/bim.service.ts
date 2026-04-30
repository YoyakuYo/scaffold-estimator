import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PresenceService } from '../presence/presence.service';
import { mapPayloadToSnake, mapRowToCamel, mapRowsToCamel } from '../../common/utils/db-mapper';

const BIM_BUCKET = 'bim-viewer-files';
const SIGNED_URL_TTL_SECONDS = 60 * 15;
const MAX_MODEL_BYTES = 120 * 1024 * 1024;

export type BimFileKind = 'ifc' | 'dxf' | 'pdf' | 'dwg' | 'image';

export interface BimViewerModel {
  id: string;
  companyId: string | null;
  createdBy: string | null;
  filename: string;
  displayName: string | null;
  mimeType: string | null;
  sizeBytes: number | string | null;
  storagePath: string | null;
  fileKind: BimFileKind;
  conversionStatus: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface CallerContext {
  userId: string;
  companyId: string | null;
  role: string;
}

function kindFromFilename(name: string): BimFileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ifc')) return 'ifc';
  if (lower.endsWith('.dxf')) return 'dxf';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.dwg')) return 'dwg';
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.bmp')
  ) {
    return 'image';
  }
  return null;
}

function extractExtension(filename: string): string {
  const m = filename.match(/\.[^./\\]+$/);
  return m ? m[0].toLowerCase() : '';
}

@Injectable()
export class BimService {
  private readonly logger = new Logger(BimService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly presence: PresenceService,
  ) {}

  async listModels(ctx: CallerContext): Promise<BimViewerModel[]> {
    const client = this.supabase.getClient();
    let q = client
      .from('bim_viewer_models')
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
      this.logger.warn(`listModels: ${error.message}`);
      return [];
    }
    return mapRowsToCamel<BimViewerModel>(data || []);
  }

  async getModel(ctx: CallerContext, id: string): Promise<BimViewerModel> {
    const row = await this.getModelRow(id);
    this.assertModelAccess(ctx, row);
    return mapRowToCamel<BimViewerModel>(row as Record<string, unknown>)!;
  }

  private async getModelRow(id: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase
      .getClient()
      .from('bim_viewer_models')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Model not found.');
    return data as Record<string, unknown>;
  }

  private assertModelAccess(ctx: CallerContext, row: Record<string, unknown>): void {
    if (ctx.role === 'superadmin') return;
    const companyId = row.company_id as string | null | undefined;
    const createdBy = row.created_by as string | null | undefined;
    if (ctx.companyId && companyId === ctx.companyId) return;
    if (createdBy === ctx.userId) return;
    throw new ForbiddenException('You cannot access this model.');
  }

  /**
   * Persist raw bytes to Storage and insert a bim_viewer_models row.
   * DWG rows get conversion_status=pending (worker hook point).
   */
  async createModelFromUpload(
    ctx: CallerContext,
    input: {
      filename: string;
      mimeType: string | null;
      buffer: Buffer;
      /** Optional friendly name shown in the saved-models list. */
      displayName?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<BimViewerModel> {
    const kind = kindFromFilename(input.filename);
    if (!kind) {
      throw new BadRequestException(
        'Only .ifc, .dxf, .pdf, .dwg, and raster images (.png, .jpg, .jpeg, .webp, .gif, .bmp) are supported.',
      );
    }
    if (!input.buffer?.length) {
      throw new BadRequestException('Empty file.');
    }
    if (input.buffer.length > MAX_MODEL_BYTES) {
      throw new BadRequestException(`File exceeds ${MAX_MODEL_BYTES / (1024 * 1024)} MB limit.`);
    }

    const conversionStatus = kind === 'dwg' ? 'pending' : 'na';
    const ins = mapPayloadToSnake({
      companyId: ctx.companyId,
      createdBy: ctx.userId,
      filename: input.filename,
      displayName:
        input.displayName && String(input.displayName).trim().length > 0
          ? String(input.displayName).trim().slice(0, 200)
          : null,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      storagePath: null,
      fileKind: kind,
      conversionStatus,
      metadata: input.metadata ?? {},
    });

    const { data: inserted, error: insertErr } = await this.supabase
      .getClient()
      .from('bim_viewer_models')
      .insert(ins)
      .select()
      .single();
    if (insertErr || !inserted) {
      this.logger.error(`createModel insert failed: ${insertErr?.message}`);
      throw new BadRequestException('Could not save model metadata.');
    }

    const row = inserted as Record<string, unknown>;
    const modelId = String(row.id);
    const ext = extractExtension(input.filename);
    const objectKey = `${ctx.userId}/${modelId}${ext}`;
    const { error: upErr } = await this.supabase
      .getClient()
      .storage.from(BIM_BUCKET)
      .upload(objectKey, input.buffer, {
        contentType: input.mimeType || 'application/octet-stream',
        upsert: true,
      });
    if (upErr) {
      await this.supabase.getClient().from('bim_viewer_models').delete().eq('id', modelId);
      this.logger.error(`createModel storage upload failed: ${upErr.message}`);
      throw new BadRequestException('Storage upload failed.');
    }

    const { data: patched, error: patchErr } = await this.supabase
      .getClient()
      .from('bim_viewer_models')
      .update({ storage_path: objectKey, updated_at: new Date().toISOString() })
      .eq('id', modelId)
      .select()
      .single();
    if (patchErr || !patched) {
      this.logger.error(`createModel storage_path patch failed: ${patchErr?.message}`);
      throw new BadRequestException('Could not finalize model record.');
    }

    const model = mapRowToCamel<BimViewerModel>(patched as Record<string, unknown>)!;
    await this.presence.recordUpload({
      userId: ctx.userId,
      companyId: ctx.companyId,
      productCode: 'bim',
      kind,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      refId: modelId,
      metadata: { modelId, savedModel: true, conversionStatus },
    });
    return model;
  }

  async patchModel(
    ctx: CallerContext,
    id: string,
    dto: { displayName?: string | null },
  ): Promise<BimViewerModel> {
    const row = await this.getModelRow(id);
    this.assertModelAccess(ctx, row);
    if (dto.displayName === undefined) {
      return mapRowToCamel<BimViewerModel>(row)!;
    }
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      display_name:
        dto.displayName === null || dto.displayName === ''
          ? null
          : String(dto.displayName).slice(0, 200),
    };
    const { data, error } = await this.supabase
      .getClient()
      .from('bim_viewer_models')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException('Update failed.');
    return mapRowToCamel<BimViewerModel>(data as Record<string, unknown>)!;
  }

  async deleteModel(ctx: CallerContext, id: string): Promise<void> {
    const row = await this.getModelRow(id);
    this.assertModelAccess(ctx, row);
    const storagePath = row.storage_path as string | null | undefined;
    if (storagePath) {
      const { error: rmErr } = await this.supabase
        .getClient()
        .storage.from(BIM_BUCKET)
        .remove([storagePath]);
      if (rmErr) {
        this.logger.warn(`deleteModel storage remove failed: ${rmErr.message}`);
      }
    }
    const { error } = await this.supabase.getClient().from('bim_viewer_models').delete().eq('id', id);
    if (error) throw new BadRequestException('Delete failed.');
  }

  async getSignedDownloadUrl(
    ctx: CallerContext,
    id: string,
  ): Promise<{ url: string; expiresInSeconds: number; filename: string }> {
    const row = await this.getModelRow(id);
    this.assertModelAccess(ctx, row);
    const path = row.storage_path as string | null | undefined;
    if (!path) throw new NotFoundException('No stored bytes for this model.');
    const filename = (row.filename as string) || 'model.bin';
    const { data, error } = await this.supabase
      .getClient()
      .storage.from(BIM_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      this.logger.warn(`getSignedDownloadUrl: ${error?.message}`);
      throw new BadRequestException('Could not create download URL.');
    }
    return {
      url: data.signedUrl,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      filename,
    };
  }
}
