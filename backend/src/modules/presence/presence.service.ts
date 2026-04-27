import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowsToCamel } from '../../common/utils/db-mapper';
import type { UploadProductCode } from './upload-event.entity';

const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export interface PresenceUpdate {
  pageKey?: string | null;
  label?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ActionUpdate extends PresenceUpdate {
  action: string;
}

export interface RecordUploadInput {
  userId: string;
  companyId?: string | null;
  productCode?: UploadProductCode;
  kind: string;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  refId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface LivePresenceRow {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  companyId: string | null;
  companyName: string | null;
  pageKey: string | null;
  label: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
  updatedAt: string;
  ipAddress: string | null;
}

export interface UploadEventRow {
  id: string;
  userId: string;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  companyId: string | null;
  companyName: string | null;
  productCode: string;
  kind: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  refId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Upsert live presence for a user. Called every ~30s from the frontend
   * heartbeat plus piggy-backed on most user actions.
   */
  async updatePresence(userId: string, update: PresenceUpdate): Promise<{ ok: boolean }> {
    const payload: Record<string, unknown> = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    if (update.pageKey !== undefined) payload.page_key = update.pageKey ?? null;
    if (update.label !== undefined) payload.label = update.label ?? null;
    if (update.ipAddress !== undefined) payload.ip_address = update.ipAddress ?? null;
    if (update.userAgent !== undefined) payload.user_agent = update.userAgent ?? null;

    const { error } = await this.supabase
      .getClient()
      .from('user_presence')
      .upsert(payload, { onConflict: 'user_id' });
    if (error) this.logger.warn(`updatePresence failed: ${error.message}`);

    // Mirror onto users.last_active_at so existing online queries keep working.
    await this.supabase
      .getClient()
      .from('users')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', userId);

    return { ok: !error };
  }

  /** Record a user action (e.g. "uploaded plan.pdf") and refresh presence. */
  async recordAction(userId: string, update: ActionUpdate): Promise<{ ok: boolean }> {
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      user_id: userId,
      last_action: update.action,
      last_action_at: now,
      updated_at: now,
    };
    if (update.pageKey !== undefined) payload.page_key = update.pageKey ?? null;
    if (update.label !== undefined) payload.label = update.label ?? null;
    if (update.ipAddress !== undefined) payload.ip_address = update.ipAddress ?? null;
    if (update.userAgent !== undefined) payload.user_agent = update.userAgent ?? null;

    const { error } = await this.supabase
      .getClient()
      .from('user_presence')
      .upsert(payload, { onConflict: 'user_id' });
    if (error) this.logger.warn(`recordAction failed: ${error.message}`);

    await this.supabase
      .getClient()
      .from('users')
      .update({ last_active_at: now })
      .eq('id', userId);

    return { ok: !error };
  }

  /**
   * Server-side hook: write an upload event AND set the user's last_action.
   * Never throws — failures here must not break the upload flow.
   */
  async recordUpload(input: RecordUploadInput): Promise<void> {
    try {
      const sizeBytes =
        typeof input.sizeBytes === 'number' && Number.isFinite(input.sizeBytes)
          ? input.sizeBytes
          : null;
      const productCode = input.productCode ?? 'scaffold';
      const filename = input.filename ?? null;

      const { error } = await this.supabase.getClient().from('upload_events').insert({
        user_id: input.userId,
        company_id: input.companyId ?? null,
        product_code: productCode,
        kind: input.kind,
        filename,
        mime_type: input.mimeType ?? null,
        size_bytes: sizeBytes,
        ref_id: input.refId ?? null,
        metadata: input.metadata ?? null,
      });
      if (error) this.logger.warn(`recordUpload insert failed: ${error.message}`);

      const actionLabel = filename
        ? `Uploaded ${input.kind} "${filename}"`
        : `Uploaded ${input.kind}`;
      await this.recordAction(input.userId, { action: actionLabel });
    } catch (err) {
      this.logger.warn(`recordUpload threw: ${(err as Error)?.message}`);
    }
  }

  /**
   * Live presence list for the superadmin cockpit. Joins users + companies
   * for display fields. Considers a user online if updated_at within the
   * last 3 minutes. Excludes superadmin and synthetic accounts.
   */
  async getLivePresence(): Promise<LivePresenceRow[]> {
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
    const { data, error } = await this.supabase
      .getClient()
      .from('user_presence')
      .select(
        `
          user_id, page_key, label, last_action, last_action_at, ip_address, updated_at,
          users:users!inner ( id, email, first_name, last_name, role, company_id,
            companies:companies ( id, name )
          )
        `,
      )
      .gte('updated_at', cutoff)
      .order('updated_at', { ascending: false });

    if (error) {
      this.logger.warn(`getLivePresence failed: ${error.message}`);
      return [];
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const result: LivePresenceRow[] = [];
    for (const row of rows) {
      const user = (row.users as Record<string, unknown>) || {};
      const role = (user.role as string) || 'viewer';
      if (role === 'superadmin') continue;
      const email = (user.email as string) || '';
      if (email.toLowerCase().includes('__landing_contact__')) continue;
      const company = (user.companies as Record<string, unknown> | null) || null;
      result.push({
        userId: String(row.user_id ?? user.id ?? ''),
        email,
        firstName: (user.first_name as string) ?? null,
        lastName: (user.last_name as string) ?? null,
        role,
        companyId: (user.company_id as string) ?? null,
        companyName: (company?.name as string) ?? null,
        pageKey: (row.page_key as string) ?? null,
        label: (row.label as string) ?? null,
        lastAction: (row.last_action as string) ?? null,
        lastActionAt: (row.last_action_at as string) ?? null,
        updatedAt: (row.updated_at as string) ?? '',
        ipAddress: (row.ip_address as string) ?? null,
      });
    }
    return result;
  }

  /**
   * Recent upload events for the superadmin cockpit. Joined with user/company.
   */
  async getRecentUploadEvents(opts?: {
    limit?: number;
    sinceIso?: string;
    productCode?: UploadProductCode;
    companyId?: string;
  }): Promise<UploadEventRow[]> {
    const limit = Math.max(1, Math.min(opts?.limit ?? 100, 500));
    let query = this.supabase
      .getClient()
      .from('upload_events')
      .select(
        `
          id, user_id, company_id, product_code, kind, filename, mime_type,
          size_bytes, ref_id, metadata, created_at,
          users:users ( email, first_name, last_name ),
          companies:companies ( name )
        `,
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (opts?.sinceIso) query = query.gte('created_at', opts.sinceIso);
    if (opts?.productCode) query = query.eq('product_code', opts.productCode);
    if (opts?.companyId) query = query.eq('company_id', opts.companyId);

    const { data, error } = await query;
    if (error) {
      this.logger.warn(`getRecentUploadEvents failed: ${error.message}`);
      return [];
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const user = (row.users as Record<string, unknown> | null) || null;
      const company = (row.companies as Record<string, unknown> | null) || null;
      const sizeRaw = row.size_bytes;
      const sizeBytes =
        typeof sizeRaw === 'number'
          ? sizeRaw
          : typeof sizeRaw === 'string' && sizeRaw
            ? Number(sizeRaw)
            : null;
      return {
        id: String(row.id ?? ''),
        userId: String(row.user_id ?? ''),
        userEmail: (user?.email as string) ?? null,
        userFirstName: (user?.first_name as string) ?? null,
        userLastName: (user?.last_name as string) ?? null,
        companyId: (row.company_id as string) ?? null,
        companyName: (company?.name as string) ?? null,
        productCode: String(row.product_code ?? 'scaffold'),
        kind: String(row.kind ?? ''),
        filename: (row.filename as string) ?? null,
        mimeType: (row.mime_type as string) ?? null,
        sizeBytes: Number.isFinite(sizeBytes) ? (sizeBytes as number) : null,
        refId: (row.ref_id as string) ?? null,
        metadata: (row.metadata as Record<string, unknown>) ?? null,
        createdAt: (row.created_at as string) ?? '',
      };
    });
  }

  /** Recent uploads for a specific company (used by company verify page). */
  async getCompanyUploadEvents(companyId: string, limit = 20): Promise<UploadEventRow[]> {
    return this.getRecentUploadEvents({ companyId, limit });
  }
}
