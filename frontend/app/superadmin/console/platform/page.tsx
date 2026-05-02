'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformApi, type PlatformSettings } from '@/lib/api/platform';
import { authApi } from '@/lib/api/auth';
import { Loader2, Send, Shield } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function SuperAdminPlatformPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ['platform-settings'], queryFn: platformApi.getSettings });
  const { data: audit } = useQuery({ queryKey: ['platform-audit'], queryFn: platformApi.listAudit, refetchInterval: 60000 });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [audience, setAudience] = useState<'subscribed' | 'all_approved'>('subscribed');
  const [sendEmail, setSendEmail] = useState(false);

  const [impersonateId, setImpersonateId] = useState('');

  const mutate = useMutation({
    mutationFn: (patch: Partial<PlatformSettings>) => platformApi.updateSettings(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-settings'] }),
  });

  const broadcast = useMutation({
    mutationFn: platformApi.broadcast,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-audit'] }),
  });

  const apply = (patch: Partial<PlatformSettings>) => mutate.mutate(patch);

  if (isLoading || !settings) {
    return (
      <div className="flex justify-center py-24 text-slate-400 gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-10 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-white tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6 text-amber-400" />
          {t('superadminConsole', 'platform')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">{t('superadminConsole', 'suiteSubtitle')}</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-slate-200">{t('superadminConsole', 'platformFlagsTitle')}</h2>
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-300">{t('superadminConsole', 'signupClosed')}</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-500"
              checked={settings.featureDisableSignup}
              onChange={(e) => apply({ featureDisableSignup: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-300">{t('superadminConsole', 'maintenanceOn')}</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-500"
              checked={settings.maintenanceMode}
              onChange={(e) => apply({ maintenanceMode: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-300">{t('superadminConsole', 'disableAi')}</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-500"
              checked={settings.featureDisableAiExtraction}
              onChange={(e) => apply({ featureDisableAiExtraction: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-300">{t('superadminConsole', 'disableUploads')}</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-500"
              checked={settings.featureDisableFileUploads}
              onChange={(e) => apply({ featureDisableFileUploads: e.target.checked })}
            />
          </label>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Maintenance message</label>
          <textarea
            key={(settings.updatedAt as string) || 'm'}
            className="w-full rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-sm px-3 py-2 min-h-[72px]"
            defaultValue={settings.maintenanceMessage ?? ''}
            onBlur={(e) => apply({ maintenanceMessage: e.target.value || null })}
            placeholder="Optional banner text"
          />
        </div>
        {mutate.isPending && (
          <p className="text-xs text-amber-400 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-200">{t('superadminConsole', 'broadcastCard')}</h2>
        <div className="space-y-3">
          <input
            className="w-full rounded-lg bg-slate-950 border border-slate-800 text-white text-sm px-3 py-2"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="w-full rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-sm px-3 py-2 min-h-[80px]"
            placeholder="Message body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <input
            className="w-full rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-sm px-3 py-2"
            placeholder="Deep link path (optional), e.g. /billing"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <div className="flex flex-wrap gap-4 text-sm text-slate-300">
            <span>{t('superadminConsole', 'broadcastAudience')}:</span>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="aud"
                checked={audience === 'subscribed'}
                onChange={() => setAudience('subscribed')}
              />
              {t('superadminConsole', 'broadcastSubscribed')}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="aud"
                checked={audience === 'all_approved'}
                onChange={() => setAudience('all_approved')}
              />
              {t('superadminConsole', 'broadcastAllApproved')}
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            {t('superadminConsole', 'sendEmailAlso')}
          </label>
          <button
            type="button"
            disabled={broadcast.isPending || !title.trim()}
            onClick={() => broadcast.mutate({ title: title.trim(), body: body.trim() || undefined, link: link.trim() || undefined, audience, sendEmail })}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2"
          >
            {broadcast.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t('superadminConsole', 'sendBroadcast')}
          </button>
          {broadcast.isSuccess && (
            <p className="text-xs text-green-400">
              Notified {broadcast.data.notified}; email attempts {broadcast.data.emailsAttempted}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">{t('superadminConsole', 'accessTitle')}</h2>
        <p className="text-xs text-slate-500">{t('superadminConsole', 'accessSubtitle')}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-sm px-3 py-2 font-mono"
            placeholder={t('superadminConsole', 'impersonateCta')}
            value={impersonateId}
            onChange={(e) => setImpersonateId(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-slate-100 text-slate-900 text-sm font-semibold px-4 py-2 hover:bg-white"
            onClick={async () => {
              const id = impersonateId.trim();
              if (!id) return;
              await authApi.impersonateUser(id);
              window.location.href = '/dashboard';
            }}
          >
            {t('superadminConsole', 'startSession')}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
        <h2 className="text-sm font-semibold text-slate-200 mb-3">{t('superadminConsole', 'auditTrail')}</h2>
        <ul className="space-y-2 text-xs text-slate-400 max-h-64 overflow-y-auto font-mono">
          {(audit || []).map((row: any) => (
            <li key={String(row.id)} className="border-b border-slate-800/60 pb-2">
              <span className="text-slate-500">{row.createdAt ? new Date(row.createdAt).toISOString() : ''}</span>{' '}
              <span className="text-amber-200/90">{row.action}</span> {row.targetType}:{row.targetId}{' '}
              {row.meta ? JSON.stringify(row.meta) : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
