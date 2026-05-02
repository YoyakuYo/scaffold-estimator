'use client';

import { useQuery } from '@tanstack/react-query';
import { platformApi } from '@/lib/api/platform';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function SuperAdminAnalyticsPage() {
  const { t } = useI18n();
  const { data: s, isLoading } = useQuery({
    queryKey: ['platform-analytics-summary'],
    queryFn: platformApi.getAnalyticsSummary,
    refetchInterval: 45000,
  });
  const { data: logins, isLoading: lg } = useQuery({
    queryKey: ['platform-recent-logins'],
    queryFn: platformApi.listRecentLogins,
    refetchInterval: 45000,
  });

  const maxBar = Math.max(1, ...(s?.visitsByDay?.map((d) => d.count) ?? []));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white tracking-tight">{t('superadminConsole', 'analyticsPageTitle')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('superadminConsole', 'suiteSubtitle')}</p>
      </div>

      {isLoading || !s ? (
        <div className="flex items-center gap-2 text-slate-400 py-16 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              [t('superadminConsole', 'kpiPageViews24h'), s.pageViews24h],
              [t('superadminConsole', 'kpiPageViews7d'), s.pageViews7d],
              [t('superadminConsole', 'kpiLogins24h'), s.logins24h],
              [t('superadminConsole', 'kpiLogins7d'), s.logins7d],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/80 to-slate-950 p-5 shadow-lg shadow-black/30"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                <p className="text-3xl font-bold text-white mt-2 tabular-nums">{val as number}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-semibold text-slate-200 mb-4">{t('superadminConsole', 'chartVisits')}</h2>
            <div className="flex items-end gap-1.5 h-40">
              {(s.visitsByDay || []).map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-amber-700 to-amber-400 min-h-[4px] transition-all"
                    style={{ height: `${Math.max(6, (d.count / maxBar) * 100)}%` }}
                    title={`${d.day}: ${d.count}`}
                  />
                  <span className="text-[10px] text-slate-500 truncate max-w-full">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">{t('superadminConsole', 'recentLogins')}</h2>
          {lg && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase tracking-wide border-b border-slate-800 bg-slate-900/60">
              <tr>
                <th className="px-6 py-3 font-medium">Time</th>
                <th className="px-6 py-3 font-medium">User</th>
                <th className="px-6 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {(logins || []).slice(0, 60).map((row: any) => (
                <tr key={String(row.id)} className="hover:bg-slate-900/50">
                  <td className="px-6 py-2.5 text-slate-300 whitespace-nowrap font-mono text-xs">
                    {row.created_at ? new Date(row.created_at as string).toLocaleString() : '—'}
                  </td>
                  <td className="px-6 py-2.5 text-slate-100">{row.userEmail ?? row.user_id}</td>
                  <td className="px-6 py-2.5 text-slate-400 font-mono text-xs">{String(row.ip_address ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
