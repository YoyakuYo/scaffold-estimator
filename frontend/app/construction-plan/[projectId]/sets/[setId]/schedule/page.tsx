'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Calendar,
  Loader2,
  AlertTriangle,
  FileSpreadsheet,
  Truck,
  Save,
  RotateCcw,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePresence, usePresenceActions } from '@/lib/page-presence-context';
import {
  structuralTakeoffApi,
  type StructuralElementType,
} from '@/lib/api/structural-takeoff';

const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];

function formatDateMonthDay(iso: string): string {
  return iso.slice(5);
}

/** Same block+level → same tint so schedule rows align visually with erection grouping. */
const SCHEDULE_ROW_TINTS = [
  'bg-amber-50/90',
  'bg-teal-50/90',
  'bg-violet-50/90',
  'bg-rose-50/90',
  'bg-sky-50/90',
  'bg-emerald-50/90',
] as const;

function scheduleActivityRowTint(block: string | null, level: string): string {
  const s = `${block ?? ''}\u0000${level}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return SCHEDULE_ROW_TINTS[Math.abs(h) % SCHEDULE_ROW_TINTS.length]!;
}

export default function ConstructionPlanSchedulePage() {
  const params = useParams();
  const { t } = useI18n();
  const elementTypeJa = (et: StructuralElementType) =>
    t('constructionPlanReview', `elementType_${et}` as 'elementType_hashira');
  const projectId = (params?.projectId as string) || '';
  const setId = (params?.setId as string) || '';
  usePresence({
    pageKey: `construction-plan/schedule/${setId}`,
    label: 'Construction Plan: schedule + delivery',
  });
  const presenceActions = usePresenceActions();
  const queryClient = useQueryClient();

  const todayIso = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [workSaturday, setWorkSaturday] = useState<boolean>(true);
  const [includeTruckPlan, setIncludeTruckPlan] = useState<boolean>(false);

  // Foreman overrides on the generated truck plan. Keyed by `date|binNo`
  // so the user can swap truck types without re-running the sequencer.
  const [overridesDraft, setOverridesDraft] = useState<
    Record<string, { date: string; binNo: number; truckType: string }>
  >({});

  const sched = useQuery({
    queryKey: ['structural-takeoff', 'schedule', setId, startDate, workSaturday],
    queryFn: () =>
      structuralTakeoffApi.getSchedule(setId, { startDate, workSaturday }),
    enabled: !!setId,
  });

  const plan = useQuery({
    queryKey: ['structural-takeoff', 'delivery-plan', setId, startDate, workSaturday, includeTruckPlan],
    queryFn: () =>
      structuralTakeoffApi.getDeliveryPlan(setId, { startDate, workSaturday }),
    enabled: !!setId && includeTruckPlan,
  });

  useEffect(() => {
    const id = window.location.hash?.replace(/^#/, '');
    if (!id) return;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [sched.data, plan.data]);

  // Seed the local override draft from server every time the plan reloads.
  useEffect(() => {
    const data = plan.data as unknown as
      | { overrides?: { trucks?: Array<{ date: string; binNo: number; truckType?: string }> } }
      | undefined;
    const trucks = data?.overrides?.trucks ?? [];
    const next: Record<string, { date: string; binNo: number; truckType: string }> = {};
    for (const t of trucks) {
      if (t?.date && typeof t.binNo === 'number' && t.truckType) {
        next[`${t.date}|${t.binNo}`] = { date: t.date, binNo: t.binNo, truckType: t.truckType };
      }
    }
    setOverridesDraft(next);
  }, [plan.data]);

  const overridesDirty = useMemo(() => {
    const data = plan.data as unknown as
      | { overrides?: { trucks?: Array<{ date: string; binNo: number; truckType?: string }> } }
      | undefined;
    const original = data?.overrides?.trucks ?? [];
    const originalMap = new Map<string, string>();
    for (const t of original) {
      if (t?.date && typeof t.binNo === 'number' && t.truckType) {
        originalMap.set(`${t.date}|${t.binNo}`, t.truckType);
      }
    }
    const draftMap = new Map<string, string>();
    for (const k of Object.keys(overridesDraft)) {
      draftMap.set(k, overridesDraft[k].truckType);
    }
    if (originalMap.size !== draftMap.size) return true;
    for (const [k, v] of originalMap) if (draftMap.get(k) !== v) return true;
    return false;
  }, [plan.data, overridesDraft]);

  const saveOverrides = useMutation({
    mutationFn: () =>
      structuralTakeoffApi.saveDeliveryOverrides(setId, {
        trucks: Object.values(overridesDraft),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['structural-takeoff', 'delivery-plan', setId],
      });
      presenceActions.recordAction(`Saved truck overrides for set ${setId.slice(0, 8)}`);
    },
  });

  const dateColumns = useMemo(() => sched.data?.workingDays ?? [], [sched.data]);
  const dateIndex = useMemo(() => {
    const m = new Map<string, number>();
    dateColumns.forEach((d, i) => m.set(d, i));
    return m;
  }, [dateColumns]);

  const downloadExcel = async () => {
    try {
      const blob = await structuralTakeoffApi.downloadExcel(setId, {
        startDate,
        workSaturday,
        includeTruckPlan,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `construction_plan_${setId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      presenceActions.recordAction(`Downloaded construction plan Excel for set ${setId.slice(0, 8)}`);
    } catch (err) {
      // Best-effort; presence stays.
    }
  };

  if (sched.isLoading || !sched.data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (sched.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white border border-red-200 rounded-xl p-6 max-w-md flex items-start gap-2 text-red-700">
          <AlertTriangle className="h-5 w-5 mt-0.5" />
          <p>{t('constructionPlanSchedule', 'loadFailed')}</p>
        </div>
      </div>
    );
  }

  const project = sched.data.project;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div>
          <Link
            href={`/construction-plan/${projectId}/sets/${setId}`}
            className="inline-flex items-center gap-1.5 text-sm text-amber-700 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('constructionPlanSchedule', 'backToSet')}
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="h-6 w-6 text-amber-600" />
            {t('constructionPlanSchedule', 'title')} - {project.name}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('constructionPlanSchedule', 'startDate')}: {sched.data.startDateIso} ·{' '}
            {t('constructionPlanSchedule', 'endDate')}: {sched.data.endIso}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-sm">
              {t('constructionPlanSchedule', 'startDate')}:
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded-md text-sm"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={workSaturday}
                onChange={(e) => setWorkSaturday(e.target.checked)}
              />
              {t('constructionPlanSchedule', 'workSaturday')}
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={includeTruckPlan}
                onChange={(e) => setIncludeTruckPlan(e.target.checked)}
              />
              {t('constructionPlanSchedule', 'includeTruckPlan')}
            </label>
            <button
              onClick={downloadExcel}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-sm"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {t('constructionPlanSchedule', 'downloadExcel')}
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-500">{t('constructionPlanSchedule', 'excelIncludesSteel')}</p>
          <p className="mt-1 text-xs text-gray-500">{t('constructionPlanSchedule', 'excelTruckSheetsHint')}</p>
        </div>

        <div
          id="cp-master-gantt"
          className="bg-white rounded-2xl border border-gray-200 overflow-hidden scroll-mt-24"
        >
          <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('constructionPlanSchedule', 'masterGantt')}
            </h2>
            <span className="text-sm text-gray-500">
              {sched.data.activities.length} {t('constructionPlanSchedule', 'activities')}
            </span>
          </div>
          <p className="px-6 pb-3 text-xs text-gray-500 border-b border-gray-100">
            {t('constructionPlanSchedule', 'scheduleSteelMembersNote')}
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 border border-gray-200 px-2 py-1 text-left">
                    {t('constructionPlanSchedule', 'block')}
                  </th>
                  <th className="sticky left-12 z-10 bg-gray-50 border border-gray-200 px-2 py-1 text-left">
                    {t('constructionPlanSchedule', 'level')}
                  </th>
                  <th className="sticky left-24 z-10 bg-gray-50 border border-gray-200 px-2 py-1 text-left">
                    {t('constructionPlanSchedule', 'element')}
                  </th>
                  {dateColumns.map((d) => (
                    <th
                      key={d}
                      className="border border-gray-200 px-1 py-1 text-center text-[10px] text-gray-700"
                      style={{ minWidth: 22, writingMode: 'vertical-rl', whiteSpace: 'nowrap' }}
                    >
                      {formatDateMonthDay(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sched.data.activities.length === 0 ? (
                  <tr>
                    <td
                      className="border border-gray-200 px-4 py-6 text-sm text-gray-600 text-center"
                      colSpan={3 + dateColumns.length}
                    >
                      {t('constructionPlanSchedule', 'noActivitiesYet')}
                    </td>
                  </tr>
                ) : (
                  sched.data.activities.map((a, i) => {
                    const startCol = dateIndex.get(a.startIso) ?? -1;
                    const endCol = dateIndex.get(a.endIso) ?? -1;
                    const rowTint = scheduleActivityRowTint(a.block, a.level);
                    return (
                      <tr key={`${a.block}-${a.level}-${a.elementType}-${i}`}>
                        <td className={`sticky left-0 z-10 border border-gray-200 px-2 py-1 ${rowTint}`}>
                          {a.block ?? '—'}
                        </td>
                        <td className={`sticky left-12 z-10 border border-gray-200 px-2 py-1 ${rowTint}`}>
                          {a.level}
                        </td>
                        <td className={`sticky left-24 z-10 border border-gray-200 px-2 py-1 ${rowTint}`}>
                          {elementTypeJa(a.elementType)}
                        </td>
                        {dateColumns.map((d, ci) => {
                          const inSpan = startCol >= 0 && endCol >= 0 && ci >= startCol && ci <= endCol;
                          const isStart = ci === startCol;
                          return (
                            <td
                              key={d}
                              className={`border border-gray-100 ${inSpan ? 'bg-blue-200' : rowTint}`}
                              style={{ minWidth: 22 }}
                              title={inSpan ? `${a.totalPieces}本 / ${a.totalWeightKg}kg` : undefined}
                            >
                              {isStart && inSpan ? (
                                <span className="block text-center text-[10px] font-bold text-blue-900 px-1">
                                  {a.totalPieces}本
                                </span>
                              ) : (
                                ''
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div
          id="cp-delivery-plan"
          className="bg-white rounded-2xl border border-gray-200 overflow-hidden scroll-mt-24"
        >
          <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Truck className="h-5 w-5 text-blue-500" />
              {t('constructionPlanSchedule', 'deliveryPlanTitle')}
            </h2>
            {includeTruckPlan && plan.data ? (
              <div className="flex items-center gap-2">
                {overridesDirty && (
                  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                    {t('constructionPlanSchedule', 'unsavedOverrides')}
                  </span>
                )}
                {overridesDirty && (
                  <button
                    type="button"
                    onClick={() => {
                      const data = plan.data as unknown as
                        | { overrides?: { trucks?: Array<{ date: string; binNo: number; truckType?: string }> } }
                        | undefined;
                      const trucks = data?.overrides?.trucks ?? [];
                      const next: Record<string, { date: string; binNo: number; truckType: string }> = {};
                      for (const tr of trucks) {
                        if (tr?.date && typeof tr.binNo === 'number' && tr.truckType) {
                          next[`${tr.date}|${tr.binNo}`] = { date: tr.date, binNo: tr.binNo, truckType: tr.truckType };
                        }
                      }
                      setOverridesDraft(next);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border border-gray-200 hover:bg-gray-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t('constructionPlanSchedule', 'discardOverrides')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => saveOverrides.mutate()}
                  disabled={!overridesDirty || saveOverrides.isPending}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40"
                >
                  {saveOverrides.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  {t('constructionPlanSchedule', 'saveOverrides')}
                </button>
                <span className="text-sm text-gray-500">
                  {plan.data.trucks.length} {t('constructionPlanSchedule', 'trucks')}
                </span>
              </div>
            ) : null}
          </div>
          {!includeTruckPlan ? (
            <p className="px-6 py-8 text-sm text-gray-600">{t('constructionPlanSchedule', 'truckPlanDisabledHint')}</p>
          ) : plan.isLoading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            </div>
          ) : plan.isError || !plan.data ? (
            <p className="px-6 py-8 text-sm text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              {t('constructionPlanSchedule', 'truckPlanLoadFailed')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'date')}</th>
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'dow')}</th>
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'binNo')}</th>
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'truckType')}</th>
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'block')}</th>
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'level')}</th>
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'items')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'pieces')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'weightT')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'lengthM')}</th>
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'notes')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {plan.data.trucks.map((tr, idx) => {
                    const head = tr.load.items[0];
                    const totalPieces = tr.load.items.reduce((s, i) => s + i.pieces, 0);
                    return (
                      <tr key={`${tr.date}-${tr.binNo}-${idx}`}>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-700">{tr.date}</td>
                        <td className="px-3 py-2 text-gray-700">{DOW_JP[(tr.dow % 7 + 7) % 7]}</td>
                        <td className="px-3 py-2 text-gray-700">{tr.binNo}</td>
                        <td className="px-3 py-2 text-gray-900">
                          <select
                            value={
                              overridesDraft[`${tr.date}|${tr.binNo}`]?.truckType ?? tr.load.truckType
                            }
                            onChange={(e) => {
                              const k = `${tr.date}|${tr.binNo}`;
                              setOverridesDraft((prev) => ({
                                ...prev,
                                [k]: { date: tr.date, binNo: tr.binNo, truckType: e.target.value },
                              }));
                            }}
                            className="px-2 py-0.5 border border-gray-200 rounded-md text-xs"
                          >
                            <option value="4tunic">4tユニック</option>
                            <option value="4t">4t平</option>
                            <option value="10t">10t平</option>
                            <option value="25t_trailer">25tトレーラー</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{head?.block ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{head?.level ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-700 text-xs">
                          {tr.load.items
                            .map((i) => `${elementTypeJa(i.elementType)}×${i.pieces}`)
                            .join(' / ')}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900">{totalPieces}</td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {(Math.round(tr.load.totalKg / 100) / 10).toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {(Math.round(tr.load.totalLengthMm / 100) / 10).toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-xs text-amber-700">
                          {tr.load.notes.join(', ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {includeTruckPlan && plan.data && !plan.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-3 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('constructionPlanSchedule', 'monthlyTitle')}
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'month')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'days')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'pieces')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'weightT')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'trucksCount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {plan.data.monthly.map((m) => (
                    <tr key={m.month}>
                      <td className="px-3 py-2 text-gray-900">{m.month}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{m.days}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{m.pieces}</td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {(Math.round(m.kg / 100) / 10).toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">{m.trucks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-3 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('constructionPlanSchedule', 'weeklyTitle')}
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">{t('constructionPlanSchedule', 'isoWeek')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'days')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'pieces')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'weightT')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('constructionPlanSchedule', 'trucksCount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {plan.data.weekly.map((w) => (
                    <tr key={w.isoWeek}>
                      <td className="px-3 py-2 text-gray-900">{w.isoWeek}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{w.days}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{w.pieces}</td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {(Math.round(w.kg / 100) / 10).toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">{w.trucks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
