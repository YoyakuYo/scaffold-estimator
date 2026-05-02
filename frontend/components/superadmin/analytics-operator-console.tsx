'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar as HBar,
} from 'recharts';
import type { PlatformAnalyticsSummary, TelemetryWindowDays } from '@/lib/api/platform';
import { presenceApi } from '@/lib/api/presence';
import { useI18n } from '@/lib/i18n';

const AMBER_LINE = '#d97706';
const BAR_FILL = '#94a3b8';
const GRID = '#cbd5e1';
const AXIS = '#64748b';

type LoginRow = Record<string, unknown> & {
  created_at?: string;
  userEmail?: string | null;
  user_id?: string;
  ip_address?: string | null;
};

function toDayUtc(iso?: string): string | null {
  if (!iso || typeof iso !== 'string') return null;
  return iso.slice(0, 10);
}

function Card({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className ?? ''}`}>
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

const ChartTooltip = ({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
}) =>
  active && payload?.length ? (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-mono text-slate-500">{label}</p>
      <ul className="space-y-1">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2 text-slate-800 tabular-nums">
            <span className="h-2 w-2 rounded-[1px]" style={{ backgroundColor: p.color }} />
            <span className="text-slate-500">{p.name}</span>
            <span>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

function trimFilename(name: string | null | undefined, max = 42): string {
  const s = name?.trim() ?? '';
  if (!s) return '—';
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function AnalyticsOperatorConsole({
  summary,
  logins,
  telemetryDays,
  onTelemetryDaysChange,
}: {
  summary: PlatformAnalyticsSummary;
  logins: LoginRow[];
  telemetryDays: TelemetryWindowDays;
  onTelemetryDaysChange: (v: TelemetryWindowDays) => void;
}) {
  const { t } = useI18n();
  const windowDays = summary.telemetryWindowDays ?? telemetryDays;

  const [pathSortHitsFirst, setPathSortHitsFirst] = useState(true);

  const sinceIso = useMemo(
    () => new Date(Date.now() - telemetryDays * 24 * 60 * 60 * 1000).toISOString(),
    [telemetryDays],
  );

  const { data: recentUploads = [], isLoading: uploadsLoading } = useQuery({
    queryKey: ['analytics-upload-feed', telemetryDays],
    queryFn: () => presenceApi.getRecentUploads({ limit: 80, sinceIso }),
    staleTime: 20_000,
  });

  const loginByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of logins) {
      const day = toDayUtc(row.created_at as string | undefined);
      if (!day) continue;
      m.set(day, (m.get(day) ?? 0) + 1);
    }
    return m;
  }, [logins]);

  const mergedSeries = useMemo(() => {
    const visits = summary.visitsByDay ?? [];
    return visits.map((v) => ({
      label: v.day.slice(5),
      day: v.day,
      pv: v.count,
      logins: loginByDay.get(v.day) ?? 0,
    }));
  }, [summary.visitsByDay, loginByDay]);

  const maxPv = Math.max(1, ...mergedSeries.map((d) => d.pv));
  const sortedPaths = useMemo(() => {
    const rows = [...(summary.pageViewsTopPaths ?? [])];
    rows.sort((a, b) => (pathSortHitsFirst ? b.count - a.count : a.path.localeCompare(b.path)));
    return rows;
  }, [summary.pageViewsTopPaths, pathSortHitsFirst]);

  const productRows = useMemo(() => {
    return (summary.uploadEventsByProduct ?? []).map((r) => {
      const code = r.productCode.toLowerCase();
      let label = r.productCode;
      if (code === 'scaffold') label = t('products', 'productScaffold');
      else if (code === 'bim') label = t('products', 'productBim');
      else if (code === 'construction_plan') label = t('products', 'productConstructionPlan');
      return { ...r, label };
    });
  }, [summary.uploadEventsByProduct, t]);

  const maxProduct = Math.max(1, ...productRows.map((p) => p.count));

  const uploadsLabel = t('superadminConsole', 'analyticsOperatorUploadsPeriod').replace('{days}', String(windowDays));

  const ranges: TelemetryWindowDays[] = [7, 14, 28];

  const recentLoginsRows = (logins.length ? logins : []).slice(0, 40);

  return (
    <div className="-mx-4 rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-6 text-slate-900 shadow-sm sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-8">
      <div className="space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t('superadminConsole', 'analyticsOperatorTitle')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('superadminConsole', 'analyticsOperatorSubtitle')}</p>
          </div>
          <div className="shrink-0">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {t('superadminConsole', 'analyticsOperatorWindow')}
            </p>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              {ranges.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onTelemetryDaysChange(d)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                    telemetryDays === d
                      ? 'bg-amber-100 text-amber-900 shadow-sm ring-1 ring-amber-300/60'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {d === 7 ? t('superadminConsole', 'analyticsRange7') : d === 14 ? t('superadminConsole', 'analyticsRange14') : t('superadminConsole', 'analyticsRange28')}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title={t('superadminConsole', 'analyticsOperatorWhoSignedIn')}
            description={t('superadminConsole', 'analyticsOperatorWhoSignedInDesc')}
          >
            <div className="max-h-[320px] overflow-auto rounded-lg border border-slate-100">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('adminDashboard', 'colTime')}</th>
                    <th className="px-3 py-2 font-medium">{t('adminDashboard', 'colUser')}</th>
                    <th className="px-3 py-2 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[12px] text-slate-700">
                  {recentLoginsRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center text-slate-500">
                        {t('superadminConsole', 'analyticsHudNoLogins')}
                      </td>
                    </tr>
                  ) : (
                    recentLoginsRows.map((row, idx) => (
                      <tr key={String(row.id ?? `${row.created_at}-${idx}`)} className="hover:bg-amber-50/50">
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                          {row.created_at ? new Date(row.created_at as string).toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900">{String(row.userEmail ?? row.user_id ?? '—')}</td>
                        <td className="px-3 py-2 text-slate-500">{String(row.ip_address ?? '—')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title={t('superadminConsole', 'analyticsOperatorWhoUploaded')}
            description={t('superadminConsole', 'analyticsOperatorWhoUploadedDesc').replace('{days}', String(windowDays))}
          >
            {uploadsLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
                <span className="text-sm">{t('common', 'loading')}</span>
              </div>
            ) : (
              <div className="max-h-[320px] overflow-auto rounded-lg border border-slate-100">
                <table className="w-full min-w-[320px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('adminDashboard', 'colTime')}</th>
                      <th className="px-3 py-2 font-medium">{t('adminDashboard', 'colUser')}</th>
                      <th className="px-3 py-2 font-medium">{t('adminDashboard', 'colCompany')}</th>
                      <th className="px-3 py-2 font-medium">{t('superadminConsole', 'analyticsColKind')}</th>
                      <th className="px-3 py-2 font-medium">{t('adminDashboard', 'colFilename')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[12px] text-slate-700">
                    {recentUploads.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                          {t('superadminConsole', 'analyticsOperatorNoUploads')}
                        </td>
                      </tr>
                    ) : (
                      recentUploads.map((u) => (
                        <tr key={u.id} className="hover:bg-amber-50/50">
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-600">
                            {u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-900">{u.userEmail ?? u.userId ?? '—'}</td>
                          <td className="max-w-[140px] truncate px-3 py-2 text-slate-600" title={u.companyName ?? ''}>
                            {u.companyName ?? '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-700">{u.kind}</td>
                          <td
                            className="max-w-[200px] truncate px-3 py-2 font-mono text-slate-600"
                            title={u.filename ?? ''}
                          >
                            {trimFilename(u.filename)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label={t('superadminConsole', 'kpiPageViews24h')} value={summary.pageViews24h.toLocaleString()} />
          <StatTile label={t('superadminConsole', 'kpiPageViews7d')} value={summary.pageViews7d.toLocaleString()} />
          <StatTile label={t('superadminConsole', 'kpiLogins24h')} value={summary.logins24h.toLocaleString()} />
          <StatTile label={t('superadminConsole', 'kpiLogins7d')} value={summary.logins7d.toLocaleString()} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label={t('superadminConsole', 'analyticsHudRibbonApproved')} value={summary.tenantApprovedUsers.toLocaleString()} />
          <StatTile label={t('superadminConsole', 'analyticsHudRibbonPending')} value={summary.tenantPendingUsers.toLocaleString()} />
          <StatTile label={t('superadminConsole', 'analyticsHudRibbonCompanies')} value={summary.tenantCompaniesWithMembers.toLocaleString()} />
          <StatTile label={uploadsLabel} value={(summary.uploadsPeriodTotal ?? 0).toLocaleString()} />
        </div>

        <Card title={t('superadminConsole', 'analyticsOperatorTrafficTitle')} description={t('superadminConsole', 'analyticsOperatorTrafficDesc')}>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={mergedSeries.length ? mergedSeries : [{ label: '—', pv: 0, logins: 0 }]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" stroke={GRID} strokeOpacity={0.9} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
                <YAxis yAxisId="pv" tick={{ fill: AXIS, fontSize: 11 }} width={40} stroke="transparent" domain={[0, Math.ceil(maxPv * 1.05)]} />
                <YAxis yAxisId="lg" orientation="right" tick={{ fill: AXIS, fontSize: 11 }} width={34} stroke="transparent" domain={[0, 'auto']} />
                <Tooltip content={<ChartTooltip />} />
                <Bar yAxisId="pv" dataKey="pv" name={t('superadminConsole', 'chartVisits')} radius={[4, 4, 0, 0]} fill={BAR_FILL} barSize={10} opacity={0.9} />
                <Line
                  yAxisId="lg"
                  type="monotone"
                  dataKey="logins"
                  name={t('superadminConsole', 'analyticsHudBarsLogins')}
                  stroke={AMBER_LINE}
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">{t('superadminConsole', 'analyticsOperatorTrafficFootnote')}</p>
        </Card>

        <div className="grid gap-4 xl:grid-cols-12">
          <Card
            title={t('superadminConsole', 'analyticsOperatorRoutesTitle')}
            description={t('superadminConsole', 'analyticsOperatorRoutesDesc').replace('{days}', String(windowDays))}
            className="xl:col-span-7"
          >
            <div className="mb-3 flex gap-4 text-[11px] text-slate-600">
              <button
                type="button"
                onClick={() => setPathSortHitsFirst(true)}
                className={pathSortHitsFirst ? 'font-medium text-amber-800' : 'hover:text-slate-900'}
              >
                {t('superadminConsole', 'analyticsSortByVolume')}
              </button>
              <span className="text-slate-300">/</span>
              <button
                type="button"
                onClick={() => setPathSortHitsFirst(false)}
                className={!pathSortHitsFirst ? 'font-medium text-amber-800' : 'hover:text-slate-900'}
              >
                {t('superadminConsole', 'analyticsSortByPath')}
              </button>
            </div>
            <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-100">
              <table className="w-full min-w-[460px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('superadminConsole', 'analyticsColRoute')}</th>
                    <th className="px-3 py-2 font-medium text-right tabular-nums">{t('superadminConsole', 'analyticsColHits')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {sortedPaths.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-3 py-8 text-center text-slate-500">
                        {t('superadminConsole', 'analyticsHudEmptyPaths')}
                      </td>
                    </tr>
                  ) : (
                    sortedPaths.map((row) => (
                      <tr key={row.path} className="hover:bg-slate-50">
                        <td className="max-w-[1px] truncate px-3 py-2.5 font-mono text-[13px]" title={row.path}>
                          {row.path}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{row.count.toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-4 xl:col-span-5">
            <Card
              title={t('superadminConsole', 'analyticsOperatorKindsTitle')}
              description={t('superadminConsole', 'analyticsOperatorKindsDesc').replace('{days}', String(windowDays))}
            >
              <div className="max-h-[168px] overflow-auto rounded-lg border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('superadminConsole', 'analyticsColKind')}</th>
                      <th className="px-3 py-2 font-medium text-right">{t('superadminConsole', 'analyticsColCount')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(summary.uploadEventsByKind ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-3 py-8 text-center text-slate-500">
                          {t('superadminConsole', 'analyticsHudEmptyUploadKinds')}
                        </td>
                      </tr>
                    ) : (
                      (summary.uploadEventsByKind ?? []).map((row) => (
                        <tr key={row.kind} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-[13px] text-slate-800">{row.kind}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.count.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title={t('superadminConsole', 'analyticsOperatorProductsTitle')} description={t('superadminConsole', 'analyticsOperatorProductsDesc')}>
              {productRows.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">{t('superadminConsole', 'analyticsHudEmptyProducts')}</p>
              ) : (
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={productRows} margin={{ top: 8, left: 4, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.6} horizontal={false} />
                      <XAxis type="number" domain={[0, maxProduct]} tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
                      <YAxis type="category" dataKey="label" width={120} tick={{ fill: AXIS, fontSize: 11 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <HBar dataKey="count" fill={BAR_FILL} fillOpacity={0.88} radius={[0, 6, 6, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-500">{t('superadminConsole', 'analyticsHudSourceNote')}</p>
      </div>
    </div>
  );
}
