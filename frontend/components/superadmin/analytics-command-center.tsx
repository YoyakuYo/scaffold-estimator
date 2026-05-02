'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
} from 'recharts';
import type { PlatformAnalyticsSummary } from '@/lib/api/platform';
import { useI18n } from '@/lib/i18n';

const CYAN = '#22d3ee';
const CYAN_DIM = '#0e7490';
const GOLD = '#facc15';
const ROSE = '#fb7185';
const MUTED = '#334155';
const LABEL = '#94a3b8';

const PIE_PALETTE = ['#22d3ee', '#facc15', '#fb7185', '#a78bfa', '#34d399', '#f97316', '#38bdf8', '#e879f9', '#4ade80', '#f472b6'];

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

function safeSummary(s: PlatformAnalyticsSummary): Required<
  Pick<
    PlatformAnalyticsSummary,
    | 'pageViewsTopPaths'
    | 'uploadEventsByKind'
    | 'uploadEventsByProduct'
    | 'uploads7dTotal'
    | 'tenantApprovedUsers'
    | 'tenantPendingUsers'
    | 'tenantCompaniesWithMembers'
  >
> &
  PlatformAnalyticsSummary {
  return {
    ...s,
    pageViewsTopPaths: s.pageViewsTopPaths ?? [],
    uploadEventsByKind: s.uploadEventsByKind ?? [],
    uploadEventsByProduct: s.uploadEventsByProduct ?? [],
    uploads7dTotal: s.uploads7dTotal ?? 0,
    tenantApprovedUsers: s.tenantApprovedUsers ?? 0,
    tenantPendingUsers: s.tenantPendingUsers ?? 0,
    tenantCompaniesWithMembers: s.tenantCompaniesWithMembers ?? 0,
  };
}

function truncatePath(path: string, max = 44): string {
  if (path.length <= max) return path;
  return `${path.slice(0, max - 1)}…`;
}

function HudPanel({
  title,
  subtitle,
  accent = 'cyan',
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  accent?: 'cyan' | 'amber';
  className?: string;
  children: React.ReactNode;
}) {
  const glow = accent === 'amber' ? 'shadow-[0_0_24px_rgba(250,204,21,0.06)]' : 'shadow-[0_0_24px_rgba(34,211,238,0.07)]';
  const ring = accent === 'amber' ? 'border-amber-400/25' : 'border-cyan-400/35';
  return (
    <div
      className={`relative flex flex-col min-h-[180px] overflow-hidden rounded-md border ${ring} bg-[#050a12]/92 backdrop-blur-sm ${glow} ${className ?? ''}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: `linear-gradient(${accent === 'amber' ? 'rgba(250,204,21,0.25)' : 'rgba(34,211,238,0.25)'} 1px, transparent 1px), linear-gradient(90deg, ${
            accent === 'amber' ? 'rgba(250,204,21,0.14)' : 'rgba(34,211,238,0.14)'
          } 1px, transparent 1px)`,
          backgroundSize: '18px 18px',
        }}
      />
      <div className="relative border-b border-cyan-500/10 px-3 py-2.5 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/70 truncate">{title}</p>
            {subtitle ? <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{subtitle}</p> : null}
          </div>
          <span className="shrink-0 h-2 w-2 rounded-full bg-cyan-400/80 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.9)]" aria-hidden />
        </div>
        <div className="absolute left-0 bottom-0 h-px w-full bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
      </div>
      <div className="relative flex-1 min-h-[140px] p-2">{children}</div>
    </div>
  );
}

const DarkTooltip = ({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ color?: string; name?: string; value?: number }>;
}) =>
  active && payload && payload.length ? (
    <div className="rounded border border-cyan-500/40 bg-slate-950/96 px-2.5 py-1.5 text-[11px] text-slate-100 shadow-[0_0_18px_rgba(34,211,238,0.2)]">
      <div className="font-mono text-cyan-200/90 mb-1 break-all max-w-[min(320px,80vw)]">{label}</div>
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: p.color }} />
            <span className="text-slate-400">{p.name ?? '—'}</span>
            <span className="font-mono text-slate-100 tabular-nums">{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

function PathTrafficTooltip({
  active,
  payload,
  hitsLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { path: string; count: number } }>;
  hitsLabel: string;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded border border-cyan-500/40 bg-slate-950/96 px-2.5 py-1.5 text-[11px] text-slate-100 shadow-[0_0_18px_rgba(34,211,238,0.2)] max-w-[min(420px,90vw)]">
      <div className="font-mono text-cyan-200/90 mb-1 break-all">{row.path}</div>
      <p className="text-slate-300 tabular-nums">
        <span>{row.count.toLocaleString()}</span>{' '}
        <span className="uppercase tracking-wide text-[10px] text-slate-500">{hitsLabel}</span>
      </p>
    </div>
  );
}

function GaugeHalf({ valuePct, accent }: { valuePct: number; accent?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(valuePct)));
  const data = [
    { name: 'on', val: v },
    { name: 'off', val: 100 - v },
  ];
  return (
    <ResponsiveContainer width="100%" height={120}>
      <PieChart margin={{ top: 4, right: 8, bottom: -20, left: 8 }}>
        <Pie startAngle={180} endAngle={0} data={data} dataKey="val" cx="50%" cy="85%" outerRadius={70} innerRadius={52} stroke="none" paddingAngle={0}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === 0 ? accent ?? CYAN : MUTED} fillOpacity={i === 0 ? 1 : 0.45} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export function AnalyticsCommandCenter({ summary, logins }: { summary: PlatformAnalyticsSummary; logins: LoginRow[] }) {
  const { t } = useI18n();
  const s = safeSummary(summary);

  const loginByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of logins) {
      const day = toDayUtc(row.created_at as string | undefined);
      if (!day) continue;
      m.set(day, (m.get(day) ?? 0) + 1);
    }
    return m;
  }, [logins]);

  const visits = s.visitsByDay ?? [];
  const maxVisit = Math.max(1, ...visits.map((d) => d.count));
  const meanVisit = visits.length ? visits.reduce((a, d) => a + d.count, 0) / visits.length : 0;

  const mergedTimeline = useMemo(
    () =>
      visits.map((v) => ({
        label: v.day.slice(5),
        fullDay: v.day,
        visits: v.count,
        logins: loginByDay.get(v.day) ?? 0,
      })),
    [visits, loginByDay],
  );

  const activityBars = [
    {
      metric: t('superadminConsole', 'analyticsHudBarPvShort'),
      value: s.pageViews24h,
    },
    {
      metric: t('superadminConsole', 'analyticsHudBarLoginShort'),
      value: s.logins24h,
    },
    {
      metric: t('superadminConsole', 'analyticsHudBarAvgShort'),
      value: Math.round(meanVisit),
    },
  ];

  const maxBarMetric = Math.max(1, ...activityBars.map((b) => b.value));

  const pvSplitData = [
    { name: t('superadminConsole', 'analyticsHudSlice24'), value: s.pageViews24h },
    {
      name: t('superadminConsole', 'analyticsHudSliceRest'),
      value: Math.max(0, s.pageViews7d - s.pageViews24h),
    },
  ];
  const loginSplitData = [
    { name: t('superadminConsole', 'analyticsHudSlice24'), value: s.logins24h },
    { name: t('superadminConsole', 'analyticsHudSliceRest'), value: Math.max(0, s.logins7d - s.logins24h) },
  ];

  const pvSharePct = s.pageViews7d > 0 ? (s.pageViews24h / s.pageViews7d) * 100 : 0;
  const lgSharePct = s.logins7d > 0 ? (s.logins24h / s.logins7d) * 100 : 0;

  const cumulative = useMemo(() => {
    let acc = 0;
    return visits.map((d) => {
      acc += d.count;
      return { label: d.day.slice(5), cum: acc };
    });
  }, [visits]);

  const recent = logins.slice(0, 14);

  const topPathsChart = useMemo(
    () =>
      s.pageViewsTopPaths.slice(0, 12).map((row, idx) => ({
        ...row,
        short: truncatePath(row.path, 52),
        rank: idx + 1,
      })),
    [s.pageViewsTopPaths],
  );
  const topPathsChartReversed = useMemo(() => [...topPathsChart].reverse(), [topPathsChart]);
  const maxPathCount = Math.max(1, ...topPathsChart.map((x) => x.count));

  const kindPieSlice = useMemo(() => {
    const rows = s.uploadEventsByKind;
    const cap = Math.min(rows.length > 12 ? 11 : rows.length, 12);
    const head = rows.slice(0, cap);
    const rest = rows.slice(cap).reduce((a, r) => a + r.count, 0);
    if (rest > 0) {
      head.push({ kind: t('superadminConsole', 'analyticsHudOtherKinds'), count: rest });
    }
    return head;
  }, [s.uploadEventsByKind, t]);

  const productBars = useMemo(() => {
    return s.uploadEventsByProduct.map((r) => {
      const code = r.productCode.toLowerCase();
      let label = r.productCode;
      if (code === 'scaffold') label = t('products', 'productScaffold');
      else if (code === 'bim') label = t('products', 'productBim');
      else if (code === 'construction_plan') label = t('products', 'productConstructionPlan');
      return {
        ...r,
        label,
      };
    });
  }, [s.uploadEventsByProduct, t]);

  const maxProduct = Math.max(1, ...productBars.map((p) => p.count));

  return (
    <div
      className="space-y-5 text-slate-100"
      style={{
        backgroundImage: `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(34,211,238,0.08), transparent 50%)`,
      }}
    >
      <header className="relative space-y-3 py-2">
        <div className="absolute left-1/2 top-[3.75rem] -translate-x-1/2 w-[min(960px,95%)] h-24 border border-cyan-500/15 rounded-sm bg-cyan-500/[0.03] shadow-[0_0_40px_rgba(34,211,238,0.08)] pointer-events-none" />
        <div className="relative text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-cyan-300/80">{t('superadminConsole', 'analyticsHudEyebrow')}</p>
          <h1 className="relative mt-1 text-xl sm:text-2xl font-bold tracking-tight text-white [text-shadow:0_0_24px_rgba(34,211,238,0.35)]">
            {t('superadminConsole', 'analyticsHudTitle')}
          </h1>
          <p className="mt-1 text-xs text-slate-400 max-w-2xl mx-auto">{t('superadminConsole', 'analyticsHudSourceNote')}</p>
        </div>

        <div className="relative grid grid-cols-2 lg:grid-cols-5 gap-2 max-w-[1100px] mx-auto">
          {[
            [t('superadminConsole', 'analyticsHudRibbonApproved'), s.tenantApprovedUsers],
            [t('superadminConsole', 'analyticsHudRibbonPending'), s.tenantPendingUsers],
            [t('superadminConsole', 'analyticsHudRibbonCompanies'), s.tenantCompaniesWithMembers],
            [t('superadminConsole', 'analyticsHudRibbonUploads7d'), s.uploads7dTotal],
            [t('superadminConsole', 'kpiPageViews24h'), s.pageViews24h],
          ].map(([label, val]) => (
            <div
              key={String(label)}
              className="rounded border border-cyan-500/20 bg-[#050a12]/90 px-3 py-2 text-center shadow-[inset_0_0_20px_rgba(34,211,238,0.04)]"
            >
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-mono tabular-nums text-cyan-100">{typeof val === 'number' ? val.toLocaleString() : val}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 xl:gap-4">
        <div className="xl:col-span-3 flex flex-col gap-3">
          <HudPanel title={t('superadminConsole', 'analyticsHudPanelActivity')} subtitle={t('superadminConsole', 'analyticsHudPanelActivitySub')} className="min-h-[200px]">
            <ResponsiveContainer width="100%" height={172}>
              <BarChart layout="vertical" data={activityBars} margin={{ top: 0, left: 4, right: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CYAN_DIM} strokeOpacity={0.35} horizontal={false} />
                <XAxis type="number" hide domain={[0, maxBarMetric]} />
                <YAxis type="category" dataKey="metric" width={88} tick={{ fill: LABEL, fontSize: 11 }} axisLine={{ stroke: MUTED }} tickLine={false} />
                <Tooltip content={<DarkTooltip />} />
                <Bar dataKey="value" name={t('superadminConsole', 'analyticsHudCount')} radius={[0, 3, 3, 0]}>
                  {activityBars.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? CYAN : i === 1 ? GOLD : '#38bdf8'} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </HudPanel>

          <HudPanel title={t('superadminConsole', 'analyticsHudPanelSplit')} subtitle={t('superadminConsole', 'analyticsHudPanelSplitSub')} className="min-h-[210px]">
            <div className="flex flex-wrap gap-3 justify-around items-center">
              {[pvSplitData, loginSplitData].map((pieData, pi) => (
                <div key={pi} className="flex flex-col items-center w-[calc(50%-6px)] min-w-[120px]">
                  <ResponsiveContainer width={130} height={130}>
                    <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={56} stroke="none" paddingAngle={2}>
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={pi === 0 ? (i === 0 ? CYAN : '#155e75') : i === 0 ? GOLD : '#92400e'} fillOpacity={i === 0 ? 1 : 0.75} />
                        ))}
                      </Pie>
                      <Tooltip content={<DarkTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">
                    {pi === 0 ? t('superadminConsole', 'kpiPageViews7d') : t('superadminConsole', 'kpiLogins7d')}
                  </span>
                </div>
              ))}
            </div>
          </HudPanel>

          <HudPanel title={t('superadminConsole', 'analyticsHudPanelWave')} className="min-h-[210px]">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={mergedTimeline.length ? mergedTimeline : [{ label: '—', visits: 0 }]} margin={{ top: 4, left: -18, right: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" stroke={CYAN_DIM} strokeOpacity={0.28} vertical={false} />
                <XAxis dataKey="label" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={32} domain={[0, maxVisit]} />
                <Tooltip content={<DarkTooltip />} />
                <Line type="monotone" dataKey="visits" name={t('superadminConsole', 'chartVisits')} stroke={GOLD} strokeWidth={2} dot={{ r: 2, stroke: GOLD }} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </HudPanel>

          <HudPanel title={t('superadminConsole', 'analyticsHudPanelSlope')} subtitle={t('superadminConsole', 'analyticsHudPanelSlopeSub')} className="flex-1 min-h-[210px]" accent="amber">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={cumulative.length ? cumulative : [{ label: '—', cum: 0 }]} margin={{ top: 4, left: -18, right: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="cumFill2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CYAN} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 4" stroke={CYAN_DIM} strokeOpacity={0.25} vertical={false} />
                <XAxis dataKey="label" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={34} />
                <Tooltip content={<DarkTooltip />} />
                <Area type="stepAfter" dataKey="cum" name={t('superadminConsole', 'analyticsHudCumulative')} stroke={CYAN} strokeWidth={1.5} fill="url(#cumFill2)" />
              </AreaChart>
            </ResponsiveContainer>
          </HudPanel>
        </div>

        <div className="xl:col-span-6 flex flex-col gap-3">
          <HudPanel
            title={t('superadminConsole', 'analyticsHudTopRoutes')}
            subtitle={t('superadminConsole', 'analyticsHudTopRoutesSub')}
            className="min-h-[440px]"
          >
            {!topPathsChart.length ? (
              <div className="flex h-[300px] items-center justify-center text-sm text-slate-500">{t('superadminConsole', 'analyticsHudEmptyPaths')}</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.min(420, 140 + topPathsChart.length * 44)}>
                <BarChart layout="vertical" data={topPathsChartReversed} margin={{ left: 4, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CYAN_DIM} strokeOpacity={0.35} horizontal={false} />
                  <XAxis type="number" domain={[0, maxPathCount]} stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} />
                  <YAxis
                    type="category"
                    width={420}
                    dataKey="short"
                    stroke={LABEL}
                    tick={{
                      fill: LABEL,
                      fontSize: 10,
                      width: 400,
                      style: { textAnchor: 'end' },
                    }}
                    interval={0}
                  />
                  <Tooltip content={<PathTrafficTooltip hitsLabel={t('superadminConsole', 'analyticsHudPathHits')} />} />
                  <Bar dataKey="count" name={t('superadminConsole', 'chartVisits')} radius={[0, 4, 4, 0]} fillOpacity={0.88}>
                    {topPathsChartReversed.map((row) => (
                      <Cell key={row.path} fill={row.rank <= 3 ? GOLD : CYAN} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </HudPanel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <HudPanel title={t('superadminConsole', 'analyticsHudUploadKinds')} subtitle={t('superadminConsole', 'analyticsHudUploadKindsSub')} accent="amber">
              {!kindPieSlice.length ? (
                <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-500">{t('superadminConsole', 'analyticsHudEmptyUploadKinds')}</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={kindPieSlice} dataKey="count" nameKey="kind" cx="50%" cy="50%" outerRadius={78} innerRadius={44} paddingAngle={1} stroke="none">
                      {kindPieSlice.map((_, i) => (
                        <Cell key={`${kindPieSlice[i].kind}-${i}`} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<DarkTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </HudPanel>

            <HudPanel title={t('superadminConsole', 'analyticsHudProductMix')} subtitle={t('superadminConsole', 'analyticsHudProductMixSub')} className="min-h-[232px]">
              {!productBars.length ? (
                <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-500">{t('superadminConsole', 'analyticsHudEmptyProducts')}</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart layout="vertical" data={productBars} margin={{ top: 8, left: 4, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CYAN_DIM} strokeOpacity={0.3} horizontal={false} />
                    <XAxis type="number" domain={[0, maxProduct]} stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} />
                    <YAxis type="category" width={148} dataKey="label" tick={{ fill: LABEL, fontSize: 10 }} />
                    <Tooltip content={<DarkTooltip />} />
                    <Bar dataKey="count" name={t('superadminConsole', 'analyticsHudUploads')} fill={CYAN} fillOpacity={0.82} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </HudPanel>
          </div>
        </div>

        <div className="xl:col-span-3 flex flex-col gap-3">
          <HudPanel title={t('superadminConsole', 'analyticsHudPanelTargets')} subtitle={t('superadminConsole', 'analyticsHudPanelTargetsSub')}>
            <div className="grid grid-cols-2 gap-1">
              <div>
                <p className="text-center text-[10px] uppercase tracking-wide text-slate-500">{t('superadminConsole', 'analyticsHudGaugePvShare')}</p>
                <GaugeHalf valuePct={pvSharePct} accent={CYAN} />
                <p className="-mt-16 text-center font-mono text-lg text-cyan-200">{Math.round(pvSharePct)}%</p>
              </div>
              <div>
                <p className="text-center text-[10px] uppercase tracking-wide text-slate-500">{t('superadminConsole', 'analyticsHudGaugeAuthShare')}</p>
                <GaugeHalf valuePct={lgSharePct} accent={GOLD} />
                <p className="-mt-16 text-center font-mono text-lg text-amber-200">{Math.round(lgSharePct)}%</p>
              </div>
            </div>
          </HudPanel>

          <HudPanel title={t('superadminConsole', 'analyticsHudPanelIdentity')} subtitle={t('superadminConsole', 'analyticsHudPanelIdentitySub')}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={mergedTimeline.slice(-12)} margin={{ top: 4, left: -12, right: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CYAN_DIM} strokeOpacity={0.3} vertical={false} />
                <XAxis dataKey="label" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} interval={0} angle={-12} height={54} />
                <YAxis yAxisId="pv" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={34} orientation="left" />
                <YAxis yAxisId="lg" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={34} orientation="right" />
                <Tooltip content={<DarkTooltip />} />
                <Bar yAxisId="pv" dataKey="visits" name={t('superadminConsole', 'analyticsHudBarsPv')} fill={ROSE} fillOpacity={0.45} radius={[2, 2, 0, 0]} maxBarSize={18} />
                <Bar yAxisId="lg" dataKey="logins" name={t('superadminConsole', 'analyticsHudBarsLogins')} fill={CYAN} fillOpacity={0.9} radius={[2, 2, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </HudPanel>

          <HudPanel title={t('superadminConsole', 'analyticsHudTenantShare')} subtitle={t('superadminConsole', 'analyticsHudTenantShareSub')}>
            {(() => {
              const approvedLabel = t('superadminConsole', 'analyticsHudApprovedSlice');
              const pendingLabel = t('superadminConsole', 'analyticsHudPendingSlice');
              const pieSlice = [
                { name: approvedLabel, count: s.tenantApprovedUsers },
                { name: pendingLabel, count: s.tenantPendingUsers },
              ].filter((x) => x.count > 0);
              return (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  {!pieSlice.length ? (
                    <div className="flex min-h-[140px] w-full items-center justify-center text-sm text-slate-500">
                      {t('superadminConsole', 'analyticsHudEmptyTenantPie')}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={pieSlice} dataKey="count" cx="50%" cy="50%" outerRadius={70} innerRadius={44} paddingAngle={1} stroke="none">
                          {pieSlice.map((slice) => (
                            <Cell key={slice.name} fill={slice.name === approvedLabel ? CYAN : GOLD} />
                          ))}
                        </Pie>
                        <Tooltip content={<DarkTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                  <div className="text-xs text-slate-400 px-2 space-y-1">
                    <p>
                      <span className="text-cyan-200 font-mono">{s.tenantApprovedUsers}</span> {t('superadminConsole', 'analyticsHudApprovedUsers')}
                    </p>
                    <p>
                      <span className="text-amber-200 font-mono">{s.tenantPendingUsers}</span> {t('superadminConsole', 'analyticsHudPendingUsers')}
                    </p>
                    <p className="text-slate-500 pt-1">{t('superadminConsole', 'analyticsHudTenantShareFoot')}</p>
                  </div>
                </div>
              );
            })()}
          </HudPanel>
        </div>
      </div>

      <HudPanel title={t('superadminConsole', 'analyticsHudWideTitle')} subtitle={t('superadminConsole', 'analyticsHudWideSub')} className="min-h-[280px]">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={mergedTimeline.length ? mergedTimeline : [{ label: '—', visits: 0, logins: 0 }]} margin={{ top: 8, left: -12, right: 8, bottom: 4 }}>
            <defs>
              <linearGradient id="pvBarGlow3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CYAN} stopOpacity={0.95} />
                <stop offset="100%" stopColor="#0f172a" stopOpacity={0.85} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 4" stroke={CYAN_DIM} strokeOpacity={0.35} vertical={false} />
            <XAxis dataKey="label" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} interval={Math.max(0, Math.ceil(mergedTimeline.length / 10) - 1)} />
            <YAxis yAxisId="left" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={38} domain={[0, 'auto']} />
            <YAxis yAxisId="right" orientation="right" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={38} domain={[0, 'auto']} />
            <Tooltip content={<DarkTooltip />} />
            <Bar yAxisId="left" dataKey="visits" name={t('superadminConsole', 'chartVisits')} fill="url(#pvBarGlow3)" barSize={14} radius={[2, 2, 0, 0]} />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="logins"
              name={t('superadminConsole', 'analyticsHudLineLogins')}
              stroke={GOLD}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </HudPanel>

      <div className="rounded-md border border-cyan-500/25 bg-[#020617]/90 overflow-hidden shadow-[0_0_30px_rgba(34,211,238,0.05)]">
        <div className="px-4 py-3 border-b border-cyan-500/15 flex items-center justify-between bg-cyan-950/20">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/90">{t('superadminConsole', 'recentLogins')}</h2>
          <span className="text-[10px] font-mono text-slate-500">{logins.length}</span>
        </div>
        <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-cyan-500/10 bg-slate-950/80 sticky top-0">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('adminDashboard', 'colTime')}</th>
                <th className="px-4 py-2.5 font-medium">{t('adminDashboard', 'colUser')}</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-500/5 font-mono text-xs">
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                    {t('superadminConsole', 'analyticsHudNoLogins')}
                  </td>
                </tr>
              ) : (
                recent.map((row, idx) => (
                  <tr key={String(row.id ?? `${row.created_at}-${row.user_id}-${idx}`)} className="hover:bg-cyan-500/[0.04]">
                    <td className="px-4 py-2 text-slate-300 whitespace-nowrap">
                      {row.created_at ? new Date(row.created_at as string).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-100">{String(row.userEmail ?? row.user_id ?? '—')}</td>
                    <td className="px-4 py-2 text-slate-400">{String(row.ip_address ?? '—')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
