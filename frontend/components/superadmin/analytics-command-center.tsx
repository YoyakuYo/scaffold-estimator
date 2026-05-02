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
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
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

type LoginRow = Record<string, unknown> & { created_at?: string; userEmail?: string | null; user_id?: string; ip_address?: string | null };

function toDayUtc(iso?: string): string | null {
  if (!iso || typeof iso !== 'string') return null;
  return iso.slice(0, 10);
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
      <div className="font-mono text-cyan-200/90 mb-1">{label}</div>
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

/** Decorative “mesh” centerpiece (FineReport-inspired, no heavy 3D). */
function MeshHero({ labels }: { labels: readonly string[] }) {
  const nodes = labels.map((label, i) => ({ label, angle: (i / labels.length) * Math.PI * 2 - Math.PI / 2 }));
  return (
    <div className="relative flex h-[min(320px,40vh)] w-full items-center justify-center rounded-md border border-cyan-400/35 bg-[#020617]/90 shadow-[inset_0_0_60px_rgba(34,211,238,0.06),0_0_40px_rgba(34,211,238,0.05)] overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: `
            radial-gradient(ellipse at 50% 40%, rgba(34,211,238,0.35), transparent 55%),
            linear-gradient(rgba(34,211,238,0.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,211,238,0.12) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 26px 26px, 26px 26px',
          backgroundRepeat: 'no-repeat, repeat, repeat',
        }}
      />
      <svg viewBox="-120 -120 240 240" className="relative z-[1] w-[92%] max-w-[400px]" aria-hidden>
        <defs>
          <linearGradient id="meshLine" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={CYAN} stopOpacity={0} />
            <stop offset="50%" stopColor={CYAN} stopOpacity={0.55} />
            <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
          </linearGradient>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {nodes.slice(1).map((_, i) => (
          <line
            key={`spoke-${i}`}
            x1={Math.cos(nodes[i].angle) * 40}
            y1={Math.sin(nodes[i].angle) * 40}
            x2={Math.cos(nodes[i].angle) * 96}
            y2={Math.sin(nodes[i].angle) * 96}
            stroke="url(#meshLine)"
            strokeWidth={0.6}
            opacity={0.7}
          />
        ))}
        <polygon points="-38,-62 92,-28 72,74 -94,62 -92,-46" fill="rgba(34,211,238,0.06)" stroke={CYAN} strokeWidth={0.5} opacity={0.9} filter="url(#glow)" />
        <polygon points="-14,-74 104,8 6,104 -118,56" fill="rgba(250,204,21,0.04)" stroke={GOLD} strokeWidth={0.4} opacity={0.75} />
        <circle cx={0} cy={0} r={18} fill="rgba(6,182,212,0.85)" opacity={0.35} />
        <circle cx={0} cy={0} r={14} stroke={CYAN} strokeWidth={0.8} fill="rgba(2,6,23,0.85)" opacity={1} />
      </svg>
      {/* Floating node labels */}
      <div className="absolute inset-0 z-[2] pointer-events-none">
        {nodes.map((n, i) => {
          const px = Math.cos(n.angle) * 42 + 50;
          const py = Math.sin(n.angle) * 42 + 50;
          return (
            <span
              key={n.label}
              className="absolute text-[10px] font-mono uppercase tracking-wider text-cyan-100/85 whitespace-nowrap -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${px}%`,
                top: `${py}%`,
                textShadow: '0 0 10px rgba(34,211,238,0.45)',
              }}
            >
              {n.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function AnalyticsCommandCenter({ summary, logins }: { summary: PlatformAnalyticsSummary; logins: LoginRow[] }) {
  const { t } = useI18n();

  const loginByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of logins) {
      const d = toDayUtc(row.created_at as string | undefined);
      if (!d) continue;
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  }, [logins]);

  const visits = summary.visitsByDay ?? [];
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
      value: summary.pageViews24h,
    },
    {
      metric: t('superadminConsole', 'analyticsHudBarLoginShort'),
      value: summary.logins24h,
    },
    {
      metric: t('superadminConsole', 'analyticsHudBarAvgShort'),
      value: Math.round(meanVisit),
    },
  ];

  const maxBarMetric = Math.max(1, ...activityBars.map((b) => b.value));

  const pvSplitData = [
    { name: t('superadminConsole', 'analyticsHudSlice24'), value: summary.pageViews24h },
    {
      name: t('superadminConsole', 'analyticsHudSliceRest'),
      value: Math.max(0, summary.pageViews7d - summary.pageViews24h),
    },
  ];
  const loginSplitData = [
    { name: t('superadminConsole', 'analyticsHudSlice24'), value: summary.logins24h },
    { name: t('superadminConsole', 'analyticsHudSliceRest'), value: Math.max(0, summary.logins7d - summary.logins24h) },
  ];

  const pvSharePct = summary.pageViews7d > 0 ? (summary.pageViews24h / summary.pageViews7d) * 100 : 0;
  const lgSharePct = summary.logins7d > 0 ? (summary.logins24h / summary.logins7d) * 100 : 0;

  /** Risk-style ratio: high short-term share → higher “heat” for coloring */
  const riskRatio = Math.min(100, Math.round((pvSharePct + lgSharePct) / 2));

  const riskDonut = [
    { name: 'heat', value: riskRatio },
    { name: 'cool', value: 100 - riskRatio },
  ];

  const radarRows = useMemo(() => {
    const burst = visits.length ? Math.max(...visits.map((d) => d.count)) : 0;
    const axes = [
      summary.pageViews24h,
      summary.pageViews7d / 7,
      summary.logins24h * 4,
      summary.logins7d,
      meanVisit * 3,
      burst,
    ];
    const cap = Math.max(...axes, 1);
    const labels = [
      t('superadminConsole', 'analyticsHudRadarPv24'),
      t('superadminConsole', 'analyticsHudRadarPvAvg'),
      t('superadminConsole', 'analyticsHudRadarAuth'),
      t('superadminConsole', 'analyticsHudRadarAuthW'),
      t('superadminConsole', 'analyticsHudRadarMean'),
      t('superadminConsole', 'analyticsHudRadarPeak'),
    ];
    return labels.map((subject, i) => ({
      subject,
      value: Math.round((axes[i] / cap) * 100),
    }));
  }, [summary, visits, meanVisit, t]);

  const cumulative = useMemo(() => {
    let acc = 0;
    return visits.map((d) => {
      acc += d.count;
      return { label: d.day.slice(5), cum: acc, raw: d.count };
    });
  }, [visits]);




  const meshLabels = useMemo(
    () => [
      t('superadminConsole', 'analyticsHudMeshQuotes'),
      t('superadminConsole', 'analyticsHudMeshAi'),
      t('superadminConsole', 'analyticsHudMeshIfc'),
      t('superadminConsole', 'analyticsHudMeshCad'),
      t('superadminConsole', 'analyticsHudMeshIdentity'),
      t('superadminConsole', 'analyticsHudMeshSubs'),
      t('superadminConsole', 'analyticsHudMeshExports'),
    ],
    [t],
  );

  const recent = logins.slice(0, 14);

  return (
    <div
      className="space-y-5 text-slate-100"
      style={{
        backgroundImage: `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(34,211,238,0.08), transparent 50%)`,
      }}
    >
      <header className="relative text-center py-2">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(640px,90%)] h-12 border border-cyan-500/20 rounded-sm bg-cyan-500/[0.03] shadow-[0_0_40px_rgba(34,211,238,0.08)] pointer-events-none" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-cyan-300/80">{t('superadminConsole', 'analyticsHudEyebrow')}</p>
        <h1 className="relative mt-1 text-xl sm:text-2xl font-bold tracking-tight text-white [text-shadow:0_0_24px_rgba(34,211,238,0.35)]">
          {t('superadminConsole', 'analyticsHudTitle')}
        </h1>
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
                  <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CYAN} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 4" stroke={CYAN_DIM} strokeOpacity={0.25} vertical={false} />
                <XAxis dataKey="label" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={34} />
                <Tooltip content={<DarkTooltip />} />
                <Area type="stepAfter" dataKey="cum" name={t('superadminConsole', 'analyticsHudCumulative')} stroke={CYAN} strokeWidth={1.5} fill="url(#cumFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </HudPanel>
        </div>

        <div className="xl:col-span-6 flex flex-col gap-3">
          <div className="rounded-md border border-cyan-500/35 bg-[#020617]/80 p-4 shadow-[0_0_50px_rgba(34,211,238,0.06)]">
            <p className="text-[11px] text-center text-cyan-200/65 uppercase tracking-[0.22em] mb-4">{t('superadminConsole', 'analyticsHudMeshCaption')}</p>
            <MeshHero labels={meshLabels} />
            <ResponsiveContainer width="100%" height={260} className="mt-6">
              <RadarChart cx="50%" cy="52%" outerRadius="72%" data={radarRows}>
                <PolarGrid stroke={CYAN_DIM} radialLines strokeOpacity={0.45} />
                <PolarAngleAxis dataKey="subject" tick={{ fill: LABEL, fontSize: 10 }} />
                <Radar dataKey="value" stroke={CYAN} fill={CYAN} fillOpacity={0.35} strokeWidth={1.25} dot={{ r: 2, strokeWidth: 0, fill: CYAN }} />
                <Tooltip content={<DarkTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
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

          <HudPanel title={t('superadminConsole', 'analyticsHudPanelHeat')} subtitle={t('superadminConsole', 'analyticsHudPanelHeatSub')} accent="amber">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={riskDonut} dataKey="value" cx="45%" cy="50%" outerRadius={58} innerRadius={36} stroke="none" paddingAngle={1}>
                    {riskDonut.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? ROSE : '#0f172a'} fillOpacity={i === 0 ? 1 : 0.9} />
                    ))}
                  </Pie>
                  <Tooltip content={<DarkTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-xs text-slate-400 px-3">
                <p className="font-mono text-amber-200/95 text-xl">{riskRatio}%</p>
                <p className="mt-2 leading-snug">{t('superadminConsole', 'analyticsHudHeatExplainer')}</p>
              </div>
            </div>
          </HudPanel>

          <HudPanel title={t('superadminConsole', 'analyticsHudPanelSpark')} subtitle={t('superadminConsole', 'analyticsHudPanelSparkSub')} className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height={172}>
              <BarChart data={activityBars}>
                <CartesianGrid strokeDasharray="3 4" stroke={CYAN_DIM} strokeOpacity={0.25} />
                <XAxis dataKey="metric" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} />
                <YAxis stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={38} domain={[0, maxBarMetric]} />
                <Tooltip content={<DarkTooltip />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {activityBars.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? '#a5f3fc' : i === 1 ? '#fde047' : '#38bdf8'} fillOpacity={0.9} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </HudPanel>
        </div>
      </div>

      <HudPanel title={t('superadminConsole', 'analyticsHudWideTitle')} subtitle={t('superadminConsole', 'analyticsHudWideSub')} className="min-h-[280px]">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={mergedTimeline.length ? mergedTimeline : [{ label: '—', visits: 0, logins: 0 }]} margin={{ top: 8, left: -12, right: 8, bottom: 4 }}>
            <defs>
              <linearGradient id="pvBarGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CYAN} stopOpacity={0.95} />
                <stop offset="100%" stopColor="#0f172a" stopOpacity={0.85} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 4" stroke={CYAN_DIM} strokeOpacity={0.35} vertical={false} />
            <XAxis dataKey="label" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} interval={Math.max(0, Math.ceil(mergedTimeline.length / 10) - 1)} />
            <YAxis yAxisId="left" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={38} domain={[0, 'auto']} />
            <YAxis yAxisId="right" orientation="right" stroke={LABEL} tick={{ fill: LABEL, fontSize: 10 }} width={38} domain={[0, 'auto']} />
            <Tooltip content={<DarkTooltip />} />
            <Bar yAxisId="left" dataKey="visits" name={t('superadminConsole', 'chartVisits')} fill="url(#pvBarGlow)" barSize={14} radius={[2, 2, 0, 0]} />
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
          <span className="text-[10px] font-mono text-slate-500">{logins.length} rows</span>
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
