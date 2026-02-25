'use client';

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import {
  scaffoldConfigsApi,
  ScaffoldConfiguration,
  WallCalculationResult,
  CalculatedComponent,
} from '@/lib/api/scaffold-configs';
import { useI18n } from '@/lib/i18n';
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Box,
  Table,
  Loader2,
  CheckCircle,
  Building2,
  Layers,
  Map as MapIcon,
  Ruler,
  ShieldCheck,
  RefreshCw,
  ClipboardCheck,
} from 'lucide-react';
import Scaffold2DView from './scaffold-2d-view';
import ScaffoldPlanView from './scaffold-plan-view';

// Dynamic import — Three.js cannot run during SSR
const Scaffold3DView = dynamic(() => import('./scaffold-3d-view'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center" style={{ height: '600px' }}>
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  ),
});

type TabView = 'table' | 'perside' | '2d' | 'plan' | '3d';

export default function ScaffoldResultPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>}>
      <ScaffoldResultPage />
    </Suspense>
  );
}

function ScaffoldResultPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const configId = params.configId as string;

  // Support ?tab=3d, ?tab=2d from external links
  const initialTab = (searchParams.get('tab') as TabView) || 'table';
  const [activeTab, setActiveTab] = useState<TabView>(
    ['table', 'perside', '2d', 'plan', '3d'].includes(initialTab) ? initialTab : 'table'
  );

  // Fetch config (includes calculationResult)
  const { data: config, isLoading } = useQuery<ScaffoldConfiguration>({
    queryKey: ['scaffold-config', configId],
    queryFn: () => scaffoldConfigsApi.get(configId),
  });

  // Review/approve mutation
  const reviewMutation = useMutation({
    mutationFn: () => scaffoldConfigsApi.markReviewed(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scaffold-config', configId] });
    },
  });

  // Approve + navigate to quotation creation
  const handleApproveAndCreate = async () => {
    try {
      await reviewMutation.mutateAsync();
      router.push(`/quotations/create?configId=${configId}&projectId=${config?.projectId || 'default-project'}`);
    } catch {
      // Error is handled by mutation
    }
  };

  const result = config?.calculationResult;

  // ─── Excel Download ─────────────────────────────────────
  const handleExcelDownload = useCallback(async () => {
    try {
      const blob = await scaffoldConfigsApi.exportExcel(configId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `足場材料見積書_${configId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(t('result', 'excelFailed'));
    }
  }, [configId, t]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">{t('result', 'noResult')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/scaffold')}
              className="p-2 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <CheckCircle className="h-6 w-6 text-green-500" />
                {t('result', 'title')}
                {result.scaffoldType === 'wakugumi' && (
                  <span className="ml-2 text-sm font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    枠組足場
                  </span>
                )}
                {(!result.scaffoldType || result.scaffoldType === 'kusabi') && (
                  <span className="ml-2 text-sm font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    くさび式
                  </span>
                )}
              </h1>
              <p className="text-sm text-gray-500">{t('result', 'subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExcelDownload}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors shadow"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {t('result', 'excelExport')}
            </button>
            {config?.status === 'reviewed' && (
              <button
                onClick={() => router.push(`/quotations/create?configId=${configId}&projectId=${config?.projectId || 'default-project'}`)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors shadow"
              >
                <FileText className="h-4 w-4" />
                {t('result', 'createQuotation')}
              </button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <SummaryCard
            icon={<Building2 className="h-5 w-5" />}
            label={t('result', 'maxHeight') || 'Max Height'}
            value={`${Math.max(...result.walls.map((w: WallCalculationResult) => w.levelCalc.topPlankHeightMm + w.levelCalc.topGuardHeightMm), 0).toLocaleString()}mm`}
          />
          <SummaryCard
            icon={<Ruler className="h-5 w-5" />}
            label={t('result', 'scaffoldWidth')}
            value={`${result.scaffoldWidthMm}mm`}
          />
          <SummaryCard
            icon={<Layers className="h-5 w-5" />}
            label={t('result', 'levels')}
            value={`${result.totalLevels}${t('result', 'levelsUnit')}`}
          />
          {result.scaffoldType === 'wakugumi' ? (
            <>
              <SummaryCard
                icon={<Ruler className="h-5 w-5" />}
                label={t('result', 'frameSize')}
                value={`${result.frameSizeMm}mm`}
              />
              <SummaryCard
                icon={<Ruler className="h-5 w-5" />}
                label={t('result', 'habakiCount')}
                value={`${result.habakiCountPerSpan}${result.habakiCountPerSpan === 1 ? '枚 (片面)' : '枚 (両面)'}`}
              />
            </>
          ) : (
            <>
              <SummaryCard
                icon={<Ruler className="h-5 w-5" />}
                label={t('result', 'postSize')}
                value={`${result.preferredMainTatejiMm}mm`}
              />
              <SummaryCard
                icon={<Ruler className="h-5 w-5" />}
                label={t('result', 'topGuard')}
                value={`${result.topGuardHeightMm}mm`}
              />
            </>
          )}
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('table')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'table'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Table className="h-4 w-4" />
            {t('resultExtra', 'tabOverall')}
          </button>
          <button
            onClick={() => setActiveTab('perside')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'perside'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Building2 className="h-4 w-4" />
            {t('resultExtra', 'tabPerSide')}
          </button>
          <button
            onClick={() => setActiveTab('2d')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === '2d'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Layers className="h-4 w-4" />
            {t('result', 'tab2d')}
          </button>
          <button
            onClick={() => setActiveTab('plan')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'plan'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <MapIcon className="h-4 w-4" />
            {t('result', 'tabPlan')}
          </button>
          <button
            onClick={() => setActiveTab('3d')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === '3d'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Box className="h-4 w-4" />
            {t('result', 'tab3d')}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'table' && <QuotationTable result={result} />}
        {activeTab === 'perside' && <PerSideBreakdown result={result} />}
        {activeTab === '2d' && <Scaffold2DView result={result} />}
        {activeTab === 'plan' && <ScaffoldPlanView result={result} />}
        {activeTab === '3d' && <Scaffold3DView result={result} />}

        {/* ─── Review & Approve Section ──────────────────────── */}
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 p-3 rounded-full bg-blue-50">
              <ClipboardCheck className="h-6 w-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                {t('result', 'reviewTitle')}
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                {t('result', 'reviewDescription')}
              </p>

              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{result.summary.length}</div>
                  <div className="text-xs text-gray-500">{t('result', 'totalComponents')}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">
                    {result.summary.reduce((sum: number, c: CalculatedComponent) => sum + c.quantity, 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">{t('result', 'totalParts')}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{result.walls.length}</div>
                  <div className="text-xs text-gray-500">{t('result', 'wallsActive')}</div>
                </div>
              </div>

              {/* Status indicator */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm font-medium text-gray-600">{t('result', 'reviewStatus')}</span>
                {config?.status === 'reviewed' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4" />
                    {t('result', 'statusReviewed')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
                    <Loader2 className="h-4 w-4" />
                    {t('result', 'statusCalculated')}
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 flex-wrap">
                {config?.status !== 'reviewed' ? (
                  <button
                    onClick={handleApproveAndCreate}
                    disabled={reviewMutation.isPending}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white px-6 py-3 rounded-lg transition-colors shadow-sm font-medium"
                  >
                    {reviewMutation.isPending ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        {t('result', 'approving')}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-5 w-5" />
                        {t('result', 'approveAndCreate')}
                      </>
                    )}
                  </button>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-green-600 font-medium">
                      <CheckCircle className="h-5 w-5" />
                      {t('result', 'approved')}
                    </div>
                    <button
                      onClick={() => router.push(`/quotations/create?configId=${configId}&projectId=${config?.projectId || 'default-project'}`)}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors shadow-sm font-medium"
                    >
                      <FileText className="h-5 w-5" />
                      {t('result', 'createQuotation')}
                    </button>
                  </>
                )}
                <button
                  onClick={() => router.push(`/scaffold?edit=${configId}`)}
                  className="flex items-center gap-2 text-gray-600 hover:text-gray-800 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  {t('result', 'recalculate')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className="text-lg font-bold text-gray-900">{value}</div>
    </div>
  );
}

// ─── Quotation Table ──────────────────────────────────────────

function QuotationTable({ result }: { result: any }) {
  const { locale, t } = useI18n();
  const walls: WallCalculationResult[] = result.walls;
  const summary: CalculatedComponent[] = result.summary;

  // Build per-wall quantity maps
  // IMPORTANT: Use the same key generation logic as backend aggregation
  // Use globalThis.Map so the built-in constructor is always used (avoids shadowing by lucide-react Map icon)
  const wallMaps = useMemo(() => {
    return walls.map((wall) => {
      const m = new globalThis.Map<string, number>();
      for (const comp of wall.components) {
        // For Nuno Bars, group by category + sizeSpec (same as backend aggregation)
        // For other components, use materialCode or type-sizeSpec
        let key: string;
        if (comp.category === '布材') {
          // Group all nuno bars by size: "布材-600", "布材-900", etc.
          key = `${comp.category}-${comp.sizeSpec}`;
        } else {
          // For other components, use materialCode or type-sizeSpec
          key = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
        }
        m.set(key, (m.get(key) || 0) + comp.quantity);
      }
      return m;
    });
  }, [walls]);

  // Group rows by category for visual separation
  const rowsWithGrouping = useMemo(() => {
    const rows: Array<{ type: 'header'; category: string } | { type: 'row'; comp: CalculatedComponent; idx: number }> = [];
    let lastCategory = '';
    let itemNo = 0;
    for (const comp of summary) {
      const cat = locale === 'ja' ? (comp.category || '') : (comp.categoryEn || comp.category || '');
      if (cat !== lastCategory) {
        rows.push({ type: 'header', category: cat });
        lastCategory = cat;
      }
      itemNo++;
      rows.push({ type: 'row', comp, idx: itemNo });
    }
    return rows;
  }, [summary, locale]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Span Info per wall + wall dimensions + floor labels */}
      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-600 mb-2">{t('result', 'spanConfig')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {walls.map((wall, idx) => {
            const spanGroups: Record<number, number> = {};
            wall.spans.forEach((s: number) => {
              spanGroups[s] = (spanGroups[s] || 0) + 1;
            });
            const spanStr = Object.entries(spanGroups)
              .map(([sz, ct]) => `${sz}mm×${ct}`)
              .join(' + ');
            const scaffoldH = wall.levelCalc.topPlankHeightMm + wall.levelCalc.topGuardHeightMm;
            return (
              <div key={`wall-${idx}-${wall.side}`} className="bg-white rounded-lg p-2 border border-gray-100">
                <div className="font-semibold text-gray-700">
                  {locale === 'ja' ? wall.sideJp : (wall.side.charAt(0).toUpperCase() + wall.side.slice(1))}
                </div>
                <div className="text-gray-500">
                  {t('result', 'wallLengthLabel')} {wall.wallLengthMm.toLocaleString()}mm | 高さ {scaffoldH.toLocaleString()}mm
                </div>
                <div className="text-gray-500">
                  {wall.totalSpans}{t('result', 'spansLabel')} | {wall.levelCalc.fullLevels}{t('result', 'levelsUnit')}
                </div>
                <div className="text-gray-400">{spanStr}</div>
                <div className="text-gray-400">
                  {t('result', 'stairsLabel')} {wall.stairAccessCount}{t('result', 'stairsUnit')}
                </div>
              </div>
            );
          })}
        </div>
        {/* Floor labels (1階, 2階, ... with height range) */}
        {result.totalLevels > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-200">
            <h4 className="text-xs font-semibold text-gray-500 mb-2">
              {locale === 'ja' ? '階（フロア）' : 'Floors'}
            </h4>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: result.totalLevels }, (_, i) => i + 1).map((f) => {
                const levelHeightMm = result.scaffoldType === 'wakugumi' ? (result.frameSizeMm || 1800) : 1800;
                const from = (f - 1) * levelHeightMm;
                const to = f * levelHeightMm;
                const label = f === 1 ? (locale === 'ja' ? '1階' : '1st') : f === 2 ? (locale === 'ja' ? '2階' : '2nd') : locale === 'ja' ? `${f}階` : `${f}th`;
                return (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-gray-200 text-xs text-gray-700"
                  >
                    <span className="font-medium">{label}</span>
                    <span className="text-gray-400">{from.toLocaleString()}～{to.toLocaleString()}mm</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Material Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-blue-600 text-white">
              <th className="px-3 py-2 text-left font-medium w-12">{t('result', 'colNo')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('result', 'colCategory')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('result', 'colName')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('result', 'colSpec')}</th>
              <th className="px-3 py-2 text-center font-medium w-14">{t('result', 'colUnit')}</th>
              {walls.map((wall, idx) => (
                <th key={`wall-th-${idx}-${wall.side}`} className="px-3 py-2 text-center font-medium min-w-[80px]">
                  {locale === 'ja' ? wall.sideJp : (wall.side.charAt(0).toUpperCase() + wall.side.slice(1))}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-medium min-w-[80px] bg-blue-700">{t('result', 'colTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {rowsWithGrouping.map((row, ri) => {
              if (row.type === 'header') {
                return (
                  <tr key={`cat-${ri}`} className="bg-gray-100 border-b border-gray-200">
                    <td colSpan={5 + walls.length + 1} className="px-3 py-1.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                      {row.category}
                    </td>
                  </tr>
                );
              }

              const { comp, idx } = row;
              // Use the same key generation logic as backend aggregation and wallMaps
              let key: string;
              if (comp.category === '布材') {
                key = `${comp.category}-${comp.sizeSpec}`;
              } else {
                key = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
              }
              const perWall = wallMaps.map((m) => m.get(key) || 0);
              const total = comp.materialCode === 'PATTANKO' ? comp.quantity : perWall.reduce((a, b) => a + b, 0);
              const catLabel = locale === 'ja' ? (comp.category || '') : (comp.categoryEn || comp.category || '');

              return (
                <tr
                  key={key}
                  className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}
                >
                  <td className="px-3 py-2 text-gray-400 text-center">{idx}</td>
                  <td className="px-3 py-2 text-gray-400 text-xs">{catLabel}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">
                    {locale === 'ja' ? comp.nameJp : (comp.name || comp.nameJp)}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{comp.sizeSpec}</td>
                  <td className="px-3 py-2 text-center text-gray-500">{comp.unit}</td>
                  {perWall.map((qty, wi) => (
                    <td key={wi} className="px-3 py-2 text-center text-gray-700">
                      {qty > 0 ? qty : '-'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center font-bold text-blue-700 bg-blue-50">
                    {total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Per-Side Breakdown ──────────────────────────────────────

function PerSideBreakdown({ result }: { result: any }) {
  const { locale, t } = useI18n();
  const walls: WallCalculationResult[] = result.walls;

  return (
    <div className="space-y-6">
      {walls.map((wall, idx) => {
        const wallLabel = locale === 'ja' ? wall.sideJp : (wall.side.charAt(0).toUpperCase() + wall.side.slice(1));
        const componentsByCategory: Record<string, CalculatedComponent[]> = {};
        for (const comp of wall.components) {
          const cat = locale === 'ja' ? (comp.category || '他') : (comp.categoryEn || comp.category || 'Other');
          if (!componentsByCategory[cat]) componentsByCategory[cat] = [];
          componentsByCategory[cat].push(comp);
        }

        return (
          <div key={`perside-${idx}-${wall.side}`} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-blue-50 to-white border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">{wallLabel}</h3>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span>{t('resultExtra', 'wallLength')}: {wall.wallLengthMm.toLocaleString()}mm</span>
                  <span>{t('resultExtra', 'spans')}: {wall.totalSpans}</span>
                  <span>{t('resultExtra', 'stairs')}: {wall.stairAccessCount}{t('resultExtra', 'stairsUnit')}</span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-2 text-left font-medium text-gray-600 w-10">#</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">{t('resultExtra', 'colCategory')}</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">{t('resultExtra', 'colName')}</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">{t('resultExtra', 'colSpec')}</th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">{t('resultExtra', 'colUnit')}</th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">{t('resultExtra', 'colQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(componentsByCategory).map(([category, comps]) => (
                    <>
                      <tr key={`cat-${category}`} className="bg-gray-100">
                        <td colSpan={6} className="px-4 py-1.5 text-xs font-bold text-gray-500 uppercase tracking-wider">
                          {category}
                        </td>
                      </tr>
                      {comps.map((comp, ci) => (
                        <tr key={`${comp.materialCode || comp.type}-${ci}`} className={`border-b border-gray-50 ${ci % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                          <td className="px-4 py-2 text-gray-400 text-center">{ci + 1}</td>
                          <td className="px-4 py-2 text-gray-400 text-xs">{category}</td>
                          <td className="px-4 py-2 font-medium text-gray-800">
                            {locale === 'ja' ? comp.nameJp : (comp.name || comp.nameJp)}
                          </td>
                          <td className="px-4 py-2 text-gray-600">{comp.sizeSpec}</td>
                          <td className="px-4 py-2 text-center text-gray-500">{comp.unit}</td>
                          <td className="px-4 py-2 text-center font-bold text-blue-700">{comp.quantity}</td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
