import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapPayloadToSnake, mapRowToCamel, mapRowsToCamel } from '../../common/utils/db-mapper';
import { NotificationsService } from '../notifications/notifications.service';
import { MailerService } from '../mailer/mailer.service';

export type PlatformSettingsView = {
  featureDisableSignup: boolean;
  featureDisableAiExtraction: boolean;
  featureDisableFileUploads: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
};

function rowToSettings(row: Record<string, unknown>): PlatformSettingsView {
  const r = mapRowToCamel<{
    featureDisableSignup: boolean;
    featureDisableAiExtraction: boolean;
    featureDisableFileUploads: boolean;
    maintenanceMode: boolean;
    maintenanceMessage: string | null;
    updatedAt: string | null;
    updatedByUserId: string | null;
  }>(row)!;
  return {
    featureDisableSignup: r.featureDisableSignup,
    featureDisableAiExtraction: r.featureDisableAiExtraction,
    featureDisableFileUploads: r.featureDisableFileUploads,
    maintenanceMode: r.maintenanceMode,
    maintenanceMessage: r.maintenanceMessage,
    updatedAt: r.updatedAt,
    updatedByUserId: r.updatedByUserId,
  };
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notificationsService: NotificationsService,
    private readonly mailerService: MailerService,
  ) {}

  async getPublicStatus(): Promise<{
    maintenanceMode: boolean;
    maintenanceMessage: string | null;
    signupDisabled: boolean;
  }> {
    const row = await this.ensureSettingsRow();
    return {
      maintenanceMode: !!(row as any).maintenance_mode,
      maintenanceMessage: ((row as any).maintenance_message as string) || null,
      signupDisabled: !!(row as any).feature_disable_signup,
    };
  }

  private async ensureSettingsRow(): Promise<Record<string, unknown>> {
    const client = this.supabase.getClient();
    let { data, error } = await client.from('platform_settings').select('*').eq('id', 1).maybeSingle();
    if (error) {
      this.logger.warn(`platform_settings read: ${error.message}`);
    }
    if (!data) {
      const ins = { id: 1 };
      const r = await client.from('platform_settings').insert(ins).select('*').single();
      data = r.data as Record<string, unknown> | null;
    }
    return (data || {}) as Record<string, unknown>;
  }

  async getSettingsForSuperadmin(): Promise<PlatformSettingsView> {
    const row = await this.ensureSettingsRow();
    return rowToSettings(row);
  }

  async updateSettings(
    actorId: string,
    patch: Partial<{
      featureDisableSignup: boolean;
      featureDisableAiExtraction: boolean;
      featureDisableFileUploads: boolean;
      maintenanceMode: boolean;
      maintenanceMessage: string | null;
    }>,
  ): Promise<PlatformSettingsView> {
    await this.ensureSettingsRow();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by_user_id: actorId,
    };
    if (patch.featureDisableSignup !== undefined) updates.feature_disable_signup = patch.featureDisableSignup;
    if (patch.featureDisableAiExtraction !== undefined) {
      updates.feature_disable_ai_extraction = patch.featureDisableAiExtraction;
    }
    if (patch.featureDisableFileUploads !== undefined) {
      updates.feature_disable_file_uploads = patch.featureDisableFileUploads;
    }
    if (patch.maintenanceMode !== undefined) updates.maintenance_mode = patch.maintenanceMode;
    if (patch.maintenanceMessage !== undefined) updates.maintenance_message = patch.maintenanceMessage;

    const { data: saved, error } = await this.supabase
      .getClient()
      .from('platform_settings')
      .update(updates)
      .eq('id', 1)
      .select('*')
      .single();
    if (error || !saved) throw new BadRequestException('Failed to update platform settings.');
    await this.appendAudit(actorId, 'platform_settings.update', 'platform', '1', patch);
    return rowToSettings(saved as Record<string, unknown>);
  }

  async appendAudit(
    actorId: string | null,
    action: string,
    targetType: string | null,
    targetId: string | null,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const row = mapPayloadToSnake({
      actorId,
      action,
      targetType,
      targetId,
      meta,
    });
    const { error } = await this.supabase.getClient().from('platform_audit_log').insert(row);
    if (error) this.logger.warn(`audit log insert failed: ${error.message}`);
  }

  async listAudit(limit = 80): Promise<any[]> {
    const { data } = await this.supabase
      .getClient()
      .from('platform_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(200, Math.max(1, limit)));
    return mapRowsToCamel<any>(data || []);
  }

  async assertSignupAllowed(): Promise<void> {
    const row = await this.ensureSettingsRow();
    if ((row as any).feature_disable_signup) {
      throw new ForbiddenException('New registrations are temporarily disabled. Please try again later.');
    }
  }

  async assertAiExtractionAllowed(): Promise<void> {
    const row = await this.ensureSettingsRow();
    if ((row as any).feature_disable_ai_extraction) {
      throw new ForbiddenException('AI extraction is temporarily disabled by the platform operator.');
    }
  }

  async assertFileUploadAllowed(): Promise<void> {
    const row = await this.ensureSettingsRow();
    if ((row as any).feature_disable_file_uploads) {
      throw new ForbiddenException('File uploads are temporarily disabled by the platform operator.');
    }
  }

  async trackEvent(input: {
    eventType: string;
    path?: string;
    referrer?: string;
    userAgent?: string;
    anonKey?: string;
    userId?: string | null;
  }): Promise<void> {
    const row = mapPayloadToSnake({
      eventType: input.eventType,
      path: input.path ?? null,
      referrer: input.referrer ?? null,
      userAgent: input.userAgent ?? null,
      anonKey: input.anonKey ?? null,
      userId: input.userId ?? null,
    });
    const { error } = await this.supabase.getClient().from('site_analytics_events').insert(row);
    if (error) this.logger.debug?.(`site_analytics_events: ${error.message}`);
  }

  async getAnalyticsSummary(): Promise<{
    pageViews24h: number;
    pageViews7d: number;
    logins24h: number;
    logins7d: number;
    visitsByDay: { day: string; count: number }[];
  }> {
    const client = this.supabase.getClient();
    const now = Date.now();
    const d24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const pv24 = await client
      .from('site_analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'page_view')
      .gte('created_at', d24);

    const pv7 = await client
      .from('site_analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'page_view')
      .gte('created_at', d7);

    const lg24 = await client
      .from('login_history')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', d24);

    const lg7 = await client
      .from('login_history')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', d7);

    const visitsByDay = await this.fallbackPageViewsByDay(client, 14);

    return {
      pageViews24h: pv24.count ?? 0,
      pageViews7d: pv7.count ?? 0,
      logins24h: lg24.count ?? 0,
      logins7d: lg7.count ?? 0,
      visitsByDay,
    };
  }

  private async fallbackPageViewsByDay(client: any, days: number): Promise<{ day: string; count: number }[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await client
      .from('site_analytics_events')
      .select('created_at')
      .eq('event_type', 'page_view')
      .gte('created_at', since);
    const map = new Map<string, number>();
    for (const r of data || []) {
      const d = new Date((r as any).created_at as string).toISOString().slice(0, 10);
      map.set(d, (map.get(d) || 0) + 1);
    }
    return [...map.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day));
  }

  async listRecentLogins(limit = 80): Promise<any[]> {
    const { data } = await this.supabase
      .getClient()
      .from('login_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(200, Math.max(1, limit)));
    return data || [];
  }

  async listRecentLoginsWithEmails(limit = 80): Promise<any[]> {
    const rows = await this.listRecentLogins(limit);
    const ids = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))];
    if (!ids.length) return rows;
    const { data: users } = await this.supabase.getClient().from('users').select('id, email').in('id', ids);
    const map = new Map((users || []).map((u: any) => [String(u.id), String(u.email || '')]));
    return rows.map((r: any) => ({
      ...r,
      userEmail: map.get(String(r.user_id)) || null,
    }));
  }

  async broadcastToAudience(input: {
    actorId: string;
    title: string;
    body?: string;
    link?: string;
    audience: 'subscribed' | 'all_approved';
    sendEmail: boolean;
  }): Promise<{ notified: number; emailsAttempted: number }> {
    const client = this.supabase.getClient();
    let userIds: string[] = [];

    if (input.audience === 'subscribed') {
      const { data: subs } = await client
        .from('subscriptions')
        .select('user_id, status')
        .in('status', ['active', 'trialing']);
      const ids = [...new Set((subs || []).map((s: any) => String(s.user_id)).filter(Boolean))];
      if (ids.length) {
        const { data: users } = await client
          .from('users')
          .select('id, email, role, approval_status, is_active')
          .in('id', ids);
        userIds = (users || [])
          .filter(
            (u: any) =>
              u.role !== 'superadmin' && u.is_active && u.approval_status === 'approved',
          )
          .map((u: any) => String(u.id));
      }
    } else {
      const { data: users } = await client
        .from('users')
        .select('id, role, approval_status, is_active')
        .eq('approval_status', 'approved')
        .eq('is_active', true);
      userIds = (users || [])
        .filter((u: any) => u.role !== 'superadmin')
        .map((u: any) => String(u.id));
    }

    let emailsAttempted = 0;
    for (const uid of userIds) {
      await this.notificationsService
        .create(uid, 'system', input.title, { body: input.body, link: input.link })
        .catch(() => {});
      if (input.sendEmail) {
        const { data: u } = await client.from('users').select('email').eq('id', uid).maybeSingle();
        const email = u ? String((u as any).email || '') : '';
        if (email) {
          emailsAttempted++;
          const text = [input.title, '', input.body || '', input.link ? `\n${input.link}` : ''].filter(Boolean).join('\n');
          await this.mailerService.send(email, input.title, text).catch(() => {});
        }
      }
    }

    await this.appendAudit(input.actorId, 'broadcast', 'users', null, {
      audience: input.audience,
      sendEmail: input.sendEmail,
      title: input.title,
      notified: userIds.length,
    });

    return { notified: userIds.length, emailsAttempted };
  }
}
