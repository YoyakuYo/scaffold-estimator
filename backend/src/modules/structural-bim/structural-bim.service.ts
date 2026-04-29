import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BimService, type BimViewerModel } from '../bim/bim.service';
import { mapPayloadToSnake, mapRowToCamel } from '../../common/utils/db-mapper';
import { defaultStructuralModel, parseStructuralModel, type StructuralModel } from './structural-model.types';
import { mergeMembersFromCsv } from './csv-import';
import { placeMembers } from './placement';
import { buildStructuralIfcDocument } from './ifc-minimal-writer';

export interface StructuralBimProjectRow {
  id: string;
  companyId: string | null;
  createdBy: string | null;
  name: string;
  modelJson: StructuralModel;
  jobStatus: string;
  jobError: string | null;
  outputModelId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CallerContext {
  userId: string;
  companyId: string | null;
  role: string;
}

@Injectable()
export class StructuralBimService {
  private readonly logger = new Logger(StructuralBimService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly bim: BimService,
  ) {}

  private assertAccess(ctx: CallerContext, row: Record<string, unknown>): void {
    if (ctx.role === 'superadmin') return;
    const companyId = row.company_id as string | null | undefined;
    const createdBy = row.created_by as string | null | undefined;
    if (ctx.companyId && companyId === ctx.companyId) return;
    if (createdBy === ctx.userId) return;
    throw new ForbiddenException('You cannot access this project.');
  }

  private async getRow(id: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase
      .getClient()
      .from('structural_bim_projects')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Project not found.');
    return data as Record<string, unknown>;
  }

  async createProject(ctx: CallerContext, name?: string | null): Promise<StructuralBimProjectRow> {
    const model = defaultStructuralModel();
    const ins = mapPayloadToSnake({
      companyId: ctx.companyId,
      createdBy: ctx.userId,
      name: (name && String(name).trim()) || 'Structural model',
      modelJson: model,
      jobStatus: 'idle',
      jobError: null,
      outputModelId: null,
    });
    const { data, error } = await this.supabase
      .getClient()
      .from('structural_bim_projects')
      .insert(ins)
      .select()
      .single();
    if (error || !data) {
      this.logger.error(`createProject: ${error?.message}`);
      throw new BadRequestException('Could not create project.');
    }
    return this.rowToDto(data as Record<string, unknown>);
  }

  async listProjects(ctx: CallerContext): Promise<StructuralBimProjectRow[]> {
    let q = this.supabase
      .getClient()
      .from('structural_bim_projects')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
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
    return (data || []).map((r) => this.rowToDto(r as Record<string, unknown>));
  }

  async getProject(ctx: CallerContext, id: string): Promise<StructuralBimProjectRow> {
    const row = await this.getRow(id);
    this.assertAccess(ctx, row);
    return this.rowToDto(row);
  }

  async patchModelJson(
    ctx: CallerContext,
    id: string,
    modelJsonString: string,
  ): Promise<StructuralBimProjectRow> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(modelJsonString) as unknown;
    } catch {
      throw new BadRequestException('modelJson must be valid JSON.');
    }
    const model = parseStructuralModel(parsed);
    const row = await this.getRow(id);
    this.assertAccess(ctx, row);
    const { data, error } = await this.supabase
      .getClient()
      .from('structural_bim_projects')
      .update({
        model_json: model,
        updated_at: new Date().toISOString(),
        job_status: 'idle',
        job_error: null,
      })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException('Update failed.');
    return this.rowToDto(data as Record<string, unknown>);
  }

  async importCsv(ctx: CallerContext, id: string, csvText: string): Promise<StructuralBimProjectRow> {
    const row = await this.getRow(id);
    this.assertAccess(ctx, row);
    const current = parseStructuralModel(row.model_json);
    const merged = mergeMembersFromCsv(current, csvText);
    const { data, error } = await this.supabase
      .getClient()
      .from('structural_bim_projects')
      .update({
        model_json: merged,
        updated_at: new Date().toISOString(),
        job_status: 'idle',
        job_error: null,
      })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException('CSV import failed.');
    return this.rowToDto(data as Record<string, unknown>);
  }

  /**
   * Phases 3–6: validate placement, emit IFC, persist via BimService, link output_model_id.
   */
  async generateIfc(ctx: CallerContext, id: string): Promise<{
    project: StructuralBimProjectRow;
    bimModel: BimViewerModel;
  }> {
    const row = await this.getRow(id);
    this.assertAccess(ctx, row);
    const model = parseStructuralModel(row.model_json);

    await this.supabase
      .getClient()
      .from('structural_bim_projects')
      .update({
        job_status: 'processing',
        job_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    try {
      const { columns, beams } = placeMembers(model);
      const firstStorey = model.storeys[0];
      const storeyElM = firstStorey ? firstStorey.elevationBottomMm / 1000 : 0;
      const ifcText = buildStructuralIfcDocument({
        projectName: String(row.name || 'Structural'),
        storeyName: firstStorey?.name ?? '1F',
        storeyElevationM: storeyElM,
        columns,
        beams,
      });
      const buffer = Buffer.from(ifcText, 'utf-8');
      const fname = `structural-${id.slice(0, 8)}.ifc`;
      const bimModel = await this.bim.createModelFromUpload(ctx, {
        filename: fname,
        mimeType: 'application/ifc',
        buffer,
        displayName: `Generated: ${row.name}`,
        metadata: {
          source: 'structural_bim_generator',
          structuralProjectId: id,
        },
      });

      const { data: updated, error: upErr } = await this.supabase
        .getClient()
        .from('structural_bim_projects')
        .update({
          job_status: 'ready',
          job_error: null,
          output_model_id: bimModel.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
      if (upErr || !updated) throw new Error(upErr?.message || 'Could not finalize job.');

      return { project: this.rowToDto(updated as Record<string, unknown>), bimModel };
    } catch (e) {
      const msg = (e as Error)?.message ?? 'Generation failed.';
      this.logger.warn(`generateIfc ${id}: ${msg}`);
      await this.supabase
        .getClient()
        .from('structural_bim_projects')
        .update({
          job_status: 'error',
          job_error: msg.slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      throw new BadRequestException(msg);
    }
  }

  async deleteProject(ctx: CallerContext, id: string): Promise<void> {
    const row = await this.getRow(id);
    this.assertAccess(ctx, row);
    const { error } = await this.supabase.getClient().from('structural_bim_projects').delete().eq('id', id);
    if (error) throw new BadRequestException('Delete failed.');
  }

  private rowToDto(row: Record<string, unknown>): StructuralBimProjectRow {
    const camel = mapRowToCamel<{
      id: string;
      companyId: string | null;
      createdBy: string | null;
      name: string;
      modelJson: unknown;
      jobStatus: string;
      jobError: string | null;
      outputModelId: string | null;
      createdAt: string;
      updatedAt: string;
    }>(row)!;
    return {
      ...camel,
      modelJson: parseStructuralModel(camel.modelJson),
    };
  }
}
