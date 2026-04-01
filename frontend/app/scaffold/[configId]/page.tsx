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
  ScaffoldMaterial,
  type EdgeHashiraLabeling,
} from '@/lib/api/scaffold-configs';
import {
  mergeScaffoldSummaryForQuotation,
  baseEnglishMaterialName,
  scaffoldWallQuantityKey,
  type MergedScaffoldSummaryRow,
} from '@/lib/merge-scaffold-summary-rows';
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
  Download,
  Plus,
  QrCode,
  MapPin,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Scaffold2DView from './scaffold-2d-view';
import { MaterialBreakdownTable } from '@/components/material-breakdown-table';
import ScaffoldPlanView from './scaffold-plan-view';
import { correctLegacyMassingTiersIfNeeded } from '@/lib/correct-legacy-massing-tiers';
import { edgeChordName, edgeHashiraColumnRangeSegment } from '@/lib/edge-hashira-labels';
import { EdgeHashiraResultPanel } from '@/components/edge-hashira-result-panel';

// Dynamic import — Three.js cannot run during SSR
const Scaffold3DView = dynamic(() => import('./scaffold-3d-view'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center" style={{ height: '600px' }}>
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  ),
});

type TabView = 'table' | 'breakdown' | '2d' | 'plan' | '3d';

/** Cumulative per-level summary: approximate quantities up to visibleLevels (scale by visibleLevels/totalLevels). */
function getLevelSummary(
  result: { summary: CalculatedComponent[]; totalLevels?: number; walls?: WallCalculationResult[] },
  visibleLevels: number,
): { totalLevels: number; visibleLevels: number; summary: CalculatedComponent[] } {
  const totalLevels = result.totalLevels ?? Math.max(1, ...(result.walls?.map((w) => w.levelCalc?.fullLevels ?? 1) ?? [1]));
  const ratio = totalLevels > 0 ? Math.min(1, visibleLevels / totalLevels) : 1;
  const summary: CalculatedComponent[] = (result.summary ?? []).map((c) => ({
    ...c,
    quantity: Math.round(c.quantity * ratio),
  }));
  return { totalLevels, visibleLevels, summary };
}

function formatWallSide(
  side: string,
  sideJp?: string,
  locale?: string,
  opts?: { wallIndex?: number; wallCount?: number; closedLoop?: boolean },
): string {
  if (
    opts?.wallIndex != null &&
    opts.wallCount != null &&
    opts.wallCount > 0 &&
    opts.wallIndex >= 0 &&
    opts.wallIndex < opts.wallCount
  ) {
    const closed = opts.closedLoop ?? opts.wallCount >= 3;
    return edgeChordName(opts.wallIndex, opts.wallCount, closed);
  }
  if (/^[A-Z]{1,2}[A-Z]{1,2}$/.test(side)) return side;
  if (['north', 'south', 'east', 'west'].includes(side)) {
    const cardinalMap: Record<string, Record<string, string>> = {
      north: { ja: '北面', en: 'North', fr: 'Nord' },
      south: { ja: '南面', en: 'South', fr: 'Sud' },
      east: { ja: '東面', en: 'East', fr: 'Est' },
      west: { ja: '西面', en: 'West', fr: 'Ouest' },
    };
    return cardinalMap[side]?.[locale ?? 'en'] ?? side;
  }
  if (side.startsWith('edge-')) {
    const idx = parseInt(side.replace('edge-', ''), 10);
    const axis = idx % 2 === 0 ? 'X' : 'Y';
    const gridNum = Math.floor(idx / 2) + 1;
    return `${axis}${gridNum}`;
  }
  if (/^[XY]\d+/.test(side)) return side;
  if (sideJp && locale === 'ja') return sideJp;
  return side;
}

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
  const { t, locale } = useI18n();
  const configId = params.configId as string;
  const isAiBimFromUrl = searchParams.get('aiBim') === '1';
  const [showScanModal, setShowScanModal] = useState(false);

  // Support ?tab=3d, ?tab=2d from external links
  const rawTab = searchParams.get('tab');
  const normalizedTab =
    rawTab === 'perside'
      ? 'breakdown'
      : (rawTab as TabView);
  const initialTab = (normalizedTab || 'table') as TabView;
  const [activeTab, setActiveTab] = useState<TabView>(
    ['table', 'breakdown', '2d', 'plan', '3d'].includes(initialTab) ? initialTab : 'table'
  );
  const [visibleLevels, setVisibleLevels] = useState<number>(1);
  const [materialPrices, setMaterialPrices] = useState<Record<string, number>>({});

  // Fetch config (includes calculationResult)
  const { data: config, isLoading } = useQuery<ScaffoldConfiguration>({
    queryKey: ['scaffold-config', configId],
    queryFn: () => scaffoldConfigsApi.get(configId),
  });

  const rawResult = config?.calculationResult;
  const resultWalls = Array.isArray(rawResult?.walls)
    ? rawResult.walls
    : Array.isArray((rawResult as any)?.result?.walls)
      ? (rawResult as any).result.walls
      : [];
  const result = rawResult
    ? {
        ...rawResult,
        walls: resultWalls.length > 0 ? resultWalls : undefined,
      }
    : undefined;

  const isAiBim = isAiBimFromUrl ||
    (Array.isArray(rawResult?.polygonVertices) && rawResult.polygonVertices.length >= 3) ||
    !!(rawResult as any)?.ifcFileUrl ||
    (Array.isArray((rawResult as any)?.massingTiers) && (rawResult as any).massingTiers.length > 0);

  /** Merge row-level scaffoldType / wakugumi fields into calculation JSON (older results omitted scaffoldType). */
  const resultMergedForViz = useMemo(() => {
    if (!result) return undefined;
    if (!config) return result;
    const st = (result.scaffoldType ??
      (rawResult as any)?.scaffold_type ??
      config.scaffoldType ??
      'kusabi') as 'kusabi' | 'wakugumi';
    return {
      ...result,
      scaffoldType: st,
      frameSizeMm: result.frameSizeMm ?? config.frameSizeMm,
      habakiCountPerSpan: result.habakiCountPerSpan ?? config.habakiCountPerSpan,
      endStopperType: (result.endStopperType ?? config.endStopperType ?? 'nuno') as 'nuno' | 'frame',
    };
  }, [result, config, rawResult]);

  const quotationMergedRows = useMemo(
    () => mergeScaffoldSummaryForQuotation(result?.summary ?? []),
    [result?.summary],
  );

  const resultFor3D = useMemo(() => {
    const base = resultMergedForViz ?? result;
    if (!base) return base;
    if (Array.isArray(base.walls) && base.walls.length > 0) {
      const configWalls = config?.walls?.filter((w) => w.enabled !== false) ?? [];
      const mergedWalls = base.walls.map((wall: WallCalculationResult, index: number) => {
        const cfgMatch = configWalls.find((cfg) => cfg.side === wall.side) ?? configWalls[index];
        return {
          ...wall,
          wallHeightMm: wall.wallHeightMm ?? cfgMatch?.wallHeightMm,
          baseHeightMm: (wall as any).baseHeightMm ?? (cfgMatch as any)?.baseHeightMm,
          tierGroup: (wall as any).tierGroup ?? (cfgMatch as any)?.tierGroup,
          tierIndex: (wall as any).tierIndex ?? (cfgMatch as any)?.tierIndex,
        };
      });
      return {
        ...base,
        walls: mergedWalls,
        ifcFileUrl: (base as any).ifcFileUrl ?? (config as any)?.ifcFileUrl,
      };
    }
    if (!config?.walls?.length) {
      const mergedUrl = (base as any).ifcFileUrl ?? (config as any)?.ifcFileUrl;
      return mergedUrl && mergedUrl !== (base as any).ifcFileUrl
        ? { ...base, ifcFileUrl: mergedUrl }
        : base;
    }
    const levelH = base.scaffoldType === 'wakugumi' ? (base.frameSizeMm ?? 1800) : 1800;
    const topGuardMm =
      base.scaffoldType === 'wakugumi'
        ? (base.frameSizeMm ?? 1700)
        : (base.topGuardHeightMm ?? 1800);
    const scaffoldWidthMm = config.scaffoldWidthMm ?? base.scaffoldWidthMm ?? 900;
    const minimalWalls: WallCalculationResult[] = config.walls
      .filter((w) => w.enabled !== false)
      .map((w) => {
        const wallH = w.wallHeightMm ?? config.buildingHeightMm ?? 3000;
        const wallLevels = Math.max(1, Math.floor(wallH / levelH));
        const stairAccessCount = w.stairAccessCount ?? 0;
        const needsExtBay = scaffoldWidthMm <= 600 && stairAccessCount > 0;
        return {
          side: w.side,
          sideJp: w.side,
          wallLengthMm: w.wallLengthMm,
          wallHeightMm: w.wallHeightMm,
          spans: [1800],
          totalSpans: 1,
          postPositions: 2,
          stairAccessCount,
          needsExtendedBay: needsExtBay,
          components: [],
          scaffoldWidthMm,
          layoutMode: 'double_post' as const,
          baseHeightMm: (w as any).baseHeightMm,
          tierGroup: (w as any).tierGroup,
          tierIndex: (w as any).tierIndex,
          levelCalc: {
            fullLevels: wallLevels,
            jackBaseAdjustmentMm: 0,
            topPlankHeightMm: wallLevels * levelH,
            topGuardHeightMm: topGuardMm,
            totalScaffoldHeightMm: wallLevels * levelH + topGuardMm,
            mainPostsPerLine: 2,
            mainPostHeightMm: levelH,
            topGuardPostHeightMm: topGuardMm,
          },
        };
      });
    return {
      ...base,
      walls: minimalWalls,
      ifcFileUrl: (base as any).ifcFileUrl ?? (config as any)?.ifcFileUrl,
    };
  }, [result, resultMergedForViz, config]);

  /** Old configs: replace bbox-style massing tiers with per-edge height synthesis (no DB migration). */
  const resultForViz = useMemo(() => {
    const base = resultFor3D ?? resultMergedForViz ?? result;
    if (!base) return base;
    const pv = (base as any).polygonVertices;
    const mt = (base as any).massingTiers;
    if (!Array.isArray(pv) || pv.length < 3 || !Array.isArray(mt) || mt.length < 2) return base;
    if (!Array.isArray(base.walls) || base.walls.length === 0) return base;
    const fixed = correctLegacyMassingTiersIfNeeded({
      storedVerts: pv,
      massingTiers: mt,
      walls: base.walls as any[],
    });
    if (!fixed || fixed.length < 2) return base;
    return { ...base, massingTiers: fixed };
  }, [resultFor3D, resultMergedForViz, result]);

  const maxLevels = result ? (result.totalLevels ?? Math.max(...(result.walls?.map((w: WallCalculationResult) => w.levelCalc?.fullLevels ?? 1) ?? [1]))) : 1;

  useEffect(() => {
    if (result && maxLevels >= 1) setVisibleLevels((prev) => Math.min(prev, maxLevels));
  }, [result, maxLevels]);

  /** Let WebGL / SVG layouts reflow before the browser captures the page for print. */
  useEffect(() => {
    const bump = () => {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    };
    window.addEventListener('beforeprint', bump);
    return () => window.removeEventListener('beforeprint', bump);
  }, []);

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

  // ─── Download BOM CSV ─────────────────────────────────────
  const handleBomCsvDownload = useCallback(async () => {
    if (!result?.summary?.length) return;
    let weightByCode = new Map<string, number>();
    try {
      const materials: ScaffoldMaterial[] = await scaffoldConfigsApi.listMaterials();
      weightByCode = new Map(
        materials
          .filter((m) => !!m.code && typeof m.weightKg === 'number' && isFinite(m.weightKg as number))
          .map((m) => [m.code, Number(m.weightKg)]),
      );
    } catch {
      // Weight column shows dash if materials lookup fails.
    }
    const col1 = t('result', 'bomCsvColPartName');
    const col2 = t('result', 'bomCsvColQuantity');
    const col3 = t('result', 'bomCsvColWeightKg');
    const dash = t('result', 'bomCsvWeightDash');
    const kg = t('result', 'bomCsvWeightKgSuffix');
    const header = `${col1},${col2},${col3}\n`;
    const rows = result.summary.map((c: CalculatedComponent) => {
      const name = (c.nameJp || c.name || c.type).replace(/,/g, ' ');
      const qty = String(c.quantity);
      const unitW = c.materialCode ? weightByCode.get(c.materialCode) : undefined;
      const totalW = typeof unitW === 'number' ? unitW * c.quantity : undefined;
      const weight = typeof totalW === 'number' ? `${totalW.toFixed(2)}${kg}` : dash;
      return `${name},${qty},${weight}`;
    });
    const csv = '\uFEFF' + header + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t('result', 'bomExportFilenamePrefix')}_${configId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, configId, t]);

  // ─── Excel Download ─────────────────────────────────────
  const handleExcelDownload = useCallback(async () => {
    try {
      const blob = await scaffoldConfigsApi.exportExcel(configId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${t('result', 'excelExportFilenamePrefix')}_${configId.slice(0, 8)}.xlsx`;
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
    <div className="scaffold-result-print min-h-screen bg-gray-50 print:bg-white">
      <div className="max-w-7xl mx-auto px-4 py-6 print:max-w-none print:px-2 print:overflow-visible">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => router.push('/scaffold')}
              className="p-2 rounded-lg hover:bg-gray-200 transition-colors print:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <CheckCircle className="h-6 w-6 text-green-500" />
                {t('result', 'title')}
                {result.scaffoldType === 'wakugumi' && (
                  <span className="ml-2 text-sm font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    {t('result', 'scaffoldTypeWakugumiShort')}
                  </span>
                )}
                {(!result.scaffoldType || result.scaffoldType === 'kusabi') && (
                  <span className="ml-2 text-sm font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    {t('result', 'scaffoldTypeKusabiShort')}
                  </span>
                )}
              </h1>
              <p className="text-sm text-gray-500">{t('result', 'subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 print:hidden">
            <button
              onClick={() => setShowScanModal(true)}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-colors border border-gray-300"
            >
              <QrCode className="h-4 w-4" />
              {t('result', 'scanShare')}
            </button>
            <button
              onClick={handleBomCsvDownload}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg transition-colors shadow"
            >
              <Download className="h-4 w-4" />
              {t('result', 'downloadBomCsv')}
            </button>
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

        {(config?.siteName ||
          config?.siteAddress ||
          config?.siteEmail ||
          config?.sitePhone ||
          config?.siteFax) && (
          <div className="mb-4 p-4 rounded-xl bg-white border border-gray-200 text-sm text-gray-700 print:break-inside-avoid">
            <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-600" />
              {t('scaffold', 'siteInfoSection')}
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
              {config?.siteName ? (
                <>
                  <dt className="text-gray-500">{t('scaffold', 'siteName')}</dt>
                  <dd className="font-medium">{config.siteName}</dd>
                </>
              ) : null}
              {config?.siteAddress ? (
                <>
                  <dt className="text-gray-500">{t('scaffold', 'siteAddress')}</dt>
                  <dd className="font-medium sm:col-span-1">{config.siteAddress}</dd>
                </>
              ) : null}
              {config?.siteEmail ? (
                <>
                  <dt className="text-gray-500">{t('scaffold', 'siteEmail')}</dt>
                  <dd>
                    <a href={`mailto:${config.siteEmail}`} className="text-blue-600 hover:underline">
                      {config.siteEmail}
                    </a>
                  </dd>
                </>
              ) : null}
              {config?.sitePhone ? (
                <>
                  <dt className="text-gray-500">{t('scaffold', 'sitePhone')}</dt>
                  <dd>
                    <a href={`tel:${config.sitePhone}`} className="text-blue-600 hover:underline">
                      {config.sitePhone}
                    </a>
                  </dd>
                </>
              ) : null}
              {config?.siteFax ? (
                <>
                  <dt className="text-gray-500">{t('scaffold', 'siteFax')}</dt>
                  <dd className="font-medium">{config.siteFax}</dd>
                </>
              ) : null}
            </dl>
          </div>
        )}

        {/* Summary Cards */}
        <div
          className={`grid grid-cols-2 ${result.scaffoldType === 'wakugumi' ? 'md:grid-cols-6' : 'md:grid-cols-5'} gap-3 mb-4 print:break-inside-avoid`}
        >
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
                value={`${result.habakiCountPerSpan}${result.habakiCountPerSpan === 1 ? t('result', 'habakiSingle') : t('result', 'habakiDouble')}`}
              />
              <SummaryCard
                icon={<ShieldCheck className="h-5 w-5" />}
                label={t('result', 'endStopperType')}
                value={
                  result.endStopperType === 'frame'
                    ? t('result', 'endStopperSummaryFrame')
                    : t('result', 'endStopperSummaryNuno')
                }
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

        {/* Scaffold spec hint (applies to 2D / Plan / 3D) */}
        <div className="mb-3 text-xs text-gray-500 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200">
            <ShieldCheck className="h-3.5 w-3.5 text-gray-600" />
            {result.scaffoldType === 'wakugumi' ? t('result', 'scaffoldTypeWakugumiShort') : t('result', 'scaffoldTypeKusabiShort')}
          </span>
          <span>
            {t('result', 'specWidth')} {result.scaffoldWidthMm}mm
            {result.scaffoldType === 'wakugumi'
              ? (result.frameSizeMm != null && ` · ${t('result', 'specFrame')} ${result.frameSizeMm}mm`) +
                  (result.endStopperType
                    ? ` · ${t('result', 'endStopperType')} ${
                        result.endStopperType === 'frame'
                          ? t('result', 'endStopperSpecShortFrame')
                          : t('result', 'endStopperSpecShortNuno')
                      }`
                    : '')
              : result.preferredMainTatejiMm != null && ` · ${t('result', 'specMainPost')} ${result.preferredMainTatejiMm}mm`}
          </span>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit print:hidden">
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
            onClick={() => setActiveTab('breakdown')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'breakdown'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Ruler className="h-4 w-4" />
            {t('result', 'materialBreakdownTitle')}
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

        {/* Tab content: only the active tab is printed (browser print / “Print this tab”). */}
        <div className={activeTab === 'table' ? 'block' : 'hidden'}>
          <h2 className="hidden print:block text-base font-bold text-gray-900 mb-3 pb-2 border-b-2 border-gray-300">
            {t('resultExtra', 'tabOverall')}
          </h2>
          <QuotationTable result={result} mergedRows={quotationMergedRows} />
        </div>

        {result.walls && (
          <div className={activeTab === 'breakdown' ? 'block' : 'hidden'}>
            <h2 className="hidden print:block text-base font-bold text-gray-900 mb-3 pb-2 border-b-2 border-gray-300">
              {t('result', 'materialBreakdownTitle')}
            </h2>
            <MaterialBreakdownTable
              walls={result.walls}
              summary={result.summary ?? []}
              buildingHeightMm={config?.buildingHeightMm ?? result.walls.reduce((m: number, w: WallCalculationResult) => Math.max(m, w.wallHeightMm ?? 0), 3000)}
              scaffoldWidthMm={result.scaffoldWidthMm ?? 900}
              totalLevels={maxLevels}
              levelHeightMm={result.scaffoldType === 'wakugumi' ? (result.frameSizeMm ?? 1800) : 1800}
              prices={materialPrices}
              onPriceChange={(code, price) => setMaterialPrices((prev) => ({ ...prev, [code]: price }))}
              edgeHashiraLabeling={(result as { edgeHashiraLabeling?: EdgeHashiraLabeling }).edgeHashiraLabeling}
              polygonVertexCount={Array.isArray(result.polygonVertices) ? result.polygonVertices.length : 0}
            />
          </div>
        )}

        <div className={`${activeTab === '2d' ? 'block' : 'hidden'} print:overflow-visible`}>
          <h2 className="hidden print:block text-base font-bold text-gray-900 mb-3 pb-2 border-b-2 border-gray-300">
            {t('result', 'tab2d')}
          </h2>
          <Scaffold2DView result={resultForViz ?? resultMergedForViz ?? result} />
        </div>

        <div className={`${activeTab === 'plan' ? 'block' : 'hidden'} print:overflow-visible`}>
          <h2 className="hidden print:block text-base font-bold text-gray-900 mb-3 pb-2 border-b-2 border-gray-300">
            {t('result', 'tabPlan')}
          </h2>
          <ScaffoldPlanView
            result={resultForViz ?? resultMergedForViz ?? result}
            configId={configId}
          />
        </div>

        <div className={`${activeTab === '3d' ? 'block' : 'hidden'} print:overflow-visible`}>
          <h2 className="hidden print:block text-base font-bold text-gray-900 mb-3 pb-2 border-b-2 border-gray-300">
            {t('result', 'tab3d')}
          </h2>
          <Scaffold3DView
            result={resultForViz ?? resultFor3D ?? resultMergedForViz ?? result}
            totalLevels={maxLevels}
            complianceMode={isAiBim ? 'ai_bim' : 'default'}
          />
        </div>

        {/* ─── Review & Approve Section ──────────────────────── */}
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6 print:hidden">
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
                  <div className="text-2xl font-bold text-gray-900">{quotationMergedRows.length}</div>
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
              {Array.isArray((result as any).obstacles) && (result as any).obstacles.length > 0 && (() => {
                const obs = (result as any).obstacles as Array<{ type: string }>;
                const bal = obs.filter((o) => o.type === 'balcony').length;
                const ac = obs.filter((o) => o.type === 'ac').length;
                return (
                  <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50">
                    <span className="text-xs font-medium text-slate-600 block mb-1">{t('result', 'obstaclesDetected')}</span>
                    <p className="text-sm text-slate-800">
                      {t('result', 'balconyCount')} {bal} {t('result', 'placesUnit')}{ac > 0 ? ` · ${t('result', 'acCount')} ${ac} ${t('result', 'placesUnit')}` : ''}
                    </p>
                  </div>
                );
              })()}

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

        {/* Scan / Share modal — QR code to open this result on another device */}
        {showScanModal && typeof window !== 'undefined' && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowScanModal(false)}
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 flex flex-col items-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900">{t('result', 'scanShare')}</h3>
              <p className="text-sm text-gray-500 text-center">{t('result', 'scanToOpen')}</p>
              <div className="p-3 bg-white rounded-lg border border-gray-200">
                <QRCodeSVG
                  value={`${window.location.origin}${window.location.pathname}${window.location.search}`}
                  size={200}
                  level="M"
                />
              </div>
              <button
                onClick={() => setShowScanModal(false)}
                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium"
              >
                {t('result', 'scanClose')}
              </button>
            </div>
          </div>
        )}
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

function QuotationTable({
  result,
  mergedRows,
}: {
  result: any;
  mergedRows: MergedScaffoldSummaryRow[];
}) {
  const { locale, t } = useI18n();
  const walls: WallCalculationResult[] = result.walls;
  const summary: CalculatedComponent[] = result.summary;
  const wallCount = walls.length;
  const poly = result.polygonVertices;
  const edgeLbl = (result as { edgeHashiraLabeling?: EdgeHashiraLabeling }).edgeHashiraLabeling;
  const chordOpts =
    wallCount > 0
      ? {
          wallCount,
          closedLoop: Array.isArray(poly) && poly.length >= 3,
        }
      : undefined;

  // Detect tier-walls and build tier group info for BOM display
  const hasTierWalls = walls.some((w: any) => w.tierGroup != null || (w.baseHeightMm ?? 0) > 0);
  const tierGroupOrder = useMemo(() => {
    if (!hasTierWalls) return null;
    const groups = new globalThis.Map<string, { label: string; wallIndices: number[] }>();
    walls.forEach((w: any, idx: number) => {
      const grp = w.tierGroup ?? w.side;
      if (!groups.has(grp)) {
        const baseLabel = grp.replace(/-T\d+$/, '');
        groups.set(grp, {
          label: formatWallSide(
            baseLabel,
            w.sideJp,
            locale,
            chordOpts ? { wallIndex: idx, ...chordOpts } : undefined,
          ),
          wallIndices: [],
        });
      }
      groups.get(grp)!.wallIndices.push(idx);
    });
    return groups;
  }, [walls, hasTierWalls, locale, chordOpts]);

  // Build per-wall quantity maps
  // IMPORTANT: Use the same key generation logic as backend aggregation
  // Use globalThis.Map so the built-in constructor is always used (avoids shadowing by lucide-react Map icon)
  const wallMaps = useMemo(() => {
    return walls.map((wall) => {
      const m = new globalThis.Map<string, number>();
      for (const comp of wall.components) {
        const key = scaffoldWallQuantityKey(comp);
        m.set(key, (m.get(key) || 0) + comp.quantity);
      }
      return m;
    });
  }, [walls]);

  // Group rows by category for visual separation
  const rowsWithGrouping = useMemo(() => {
    const rows: Array<
      { type: 'header'; category: string } | { type: 'row'; merged: MergedScaffoldSummaryRow; idx: number }
    > = [];
    let lastCategory = '';
    let itemNo = 0;
    for (const merged of mergedRows) {
      const cat =
        locale === 'ja'
          ? merged.category || ''
          : merged.categoryEn || merged.representative.categoryEn || merged.category || '';
      if (cat !== lastCategory) {
        rows.push({ type: 'header', category: cat });
        lastCategory = cat;
      }
      itemNo++;
      rows.push({ type: 'row', merged, idx: itemNo });
    }
    return rows;
  }, [mergedRows, locale]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Span Info per wall + wall dimensions + scaffold level labels */}
      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-600 mb-2">{t('result', 'spanConfig')}</h3>
        <EdgeHashiraResultPanel
          labeling={(result as { edgeHashiraLabeling?: EdgeHashiraLabeling }).edgeHashiraLabeling}
          walls={walls}
          closedFootprint={!!chordOpts?.closedLoop}
          className="mb-3"
        />
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
            const postAlongCard = (Array.isArray(wall.spans) ? wall.spans.length : 0) + 1;
            const hashiraCard = edgeHashiraColumnRangeSegment(
              edgeLbl,
              idx,
              walls.length,
              wall.sideJp ?? '',
              wall.side ?? '',
              postAlongCard,
            );
            return (
              <div key={`wall-${idx}-${wall.side}`} className="bg-white rounded-lg p-2 border border-gray-100">
                <div className="font-semibold text-gray-700">
                  {formatWallSide(
                    wall.side,
                    wall.sideJp,
                    locale,
                    chordOpts ? { wallIndex: idx, ...chordOpts } : undefined,
                  )}
                </div>
                {hashiraCard ? (
                  <div className="text-[11px] font-mono font-medium text-slate-600 mt-0.5">({hashiraCard})</div>
                ) : null}
                {(wall as any).baseHeightMm > 0 && (
                  <div className="text-xs text-violet-600">
                    {t('result', 'tierGlPlus').replace('{{m}}', ((wall as any).baseHeightMm / 1000).toFixed(1))}
                  </div>
                )}
                <div className="text-gray-500">
                  {t('result', 'wallLengthLabel')} {wall.wallLengthMm.toLocaleString()}mm | {t('result', 'wallHeight')} {scaffoldH.toLocaleString()}mm
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
        {/* Scaffold level labels (1段, 2段, ... with height range) */}
        {result.totalLevels > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-200">
            <h4 className="text-xs font-semibold text-gray-500 mb-2">
              {t('result', 'scaffoldLevelsHeader')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: result.totalLevels }, (_, i) => i + 1).map((f) => {
                const levelHeightMm = result.scaffoldType === 'wakugumi' ? (result.frameSizeMm || 1800) : 1800;
                const from = (f - 1) * levelHeightMm;
                const to = f * levelHeightMm;
                const label = t('result', 'scaffoldLevelBandLabel').replace(/\{\{n\}\}/g, String(f));
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
              {walls.map((wall, idx) => {
                const baseH = (wall as any).baseHeightMm ?? 0;
                const tierLabel =
                  baseH > 0 ? t('result', 'tierHeaderElevation').replace('{{m}}', (baseH / 1000).toFixed(0)) : '';
                const postAlong = (Array.isArray(wall.spans) ? wall.spans.length : 0) + 1;
                const hashiraSeg = edgeHashiraColumnRangeSegment(
                  edgeLbl,
                  idx,
                  walls.length,
                  wall.sideJp ?? '',
                  wall.side ?? '',
                  postAlong,
                );
                return (
                  <th key={`wall-th-${idx}-${wall.side}`} className="px-3 py-2 text-center font-medium min-w-[80px]">
                    <div>
                      {formatWallSide(
                        wall.side,
                        wall.sideJp,
                        locale,
                        chordOpts ? { wallIndex: idx, ...chordOpts } : undefined,
                      )}
                    </div>
                    {hashiraSeg ? (
                      <div className="text-[10px] font-normal opacity-95 font-mono tracking-tight">({hashiraSeg})</div>
                    ) : null}
                    {tierLabel && <div className="text-[10px] font-normal opacity-80">{tierLabel}</div>}
                  </th>
                );
              })}
              {/* Tier group subtotal columns */}
              {hasTierWalls && tierGroupOrder && Array.from(tierGroupOrder.entries()).map(([grp, info]) => (
                info.wallIndices.length > 1 ? (
                  <th key={`grp-${grp}`} className="px-3 py-2 text-center font-medium min-w-[80px] bg-blue-500">
                    <div>{info.label}</div>
                    <div className="text-[10px] font-normal opacity-80">{t('result', 'subtotal')}</div>
                  </th>
                ) : null
              ))}
              <th className="px-3 py-2 text-center font-medium min-w-[80px] bg-blue-700">{t('result', 'colTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {rowsWithGrouping.map((row, ri) => {
              const subtotalColCount = hasTierWalls && tierGroupOrder
                ? Array.from(tierGroupOrder.values()).filter((g) => g.wallIndices.length > 1).length
                : 0;

              if (row.type === 'header') {
                return (
                  <tr key={`cat-${ri}`} className="bg-gray-100 border-b border-gray-200">
                    <td colSpan={5 + walls.length + subtotalColCount + 1} className="px-3 py-1.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                      {row.category}
                    </td>
                  </tr>
                );
              }

              const { merged, idx } = row;
              const perWall = wallMaps.map((m) =>
                merged.keys.reduce((sum, k) => sum + (m.get(k) || 0), 0),
              );
              let total: number;
              if (merged.hasPattankoOnly) {
                const pc = summary.find((c: CalculatedComponent) => c.materialCode === 'PATTANKO');
                total = pc?.quantity ?? perWall.reduce((a, b) => a + b, 0);
              } else {
                total = perWall.reduce((a, b) => a + b, 0);
              }
              const catLabel =
                locale === 'ja'
                  ? merged.category || ''
                  : merged.categoryEn || merged.representative.categoryEn || merged.category || '';
              const displayName =
                locale === 'ja'
                  ? merged.nameJp
                  : baseEnglishMaterialName(merged.representative.name) || merged.representative.name || merged.nameJp;
              const rowKey = `${merged.sortOrder}-${merged.keys.slice().sort().join('|')}`;

              return (
                <tr
                  key={rowKey}
                  className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}
                >
                  <td className="px-3 py-2 text-gray-400 text-center">{idx}</td>
                  <td className="px-3 py-2 text-gray-400 text-xs">{catLabel}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{displayName}</td>
                  <td className="px-3 py-2 text-gray-600">{merged.sizeSpecJoined}</td>
                  <td className="px-3 py-2 text-center text-gray-500">{merged.unit}</td>
                  {perWall.map((qty, wi) => (
                    <td key={wi} className="px-3 py-2 text-center text-gray-700">
                      {qty > 0 ? qty : '-'}
                    </td>
                  ))}
                  {/* Tier group subtotal cells */}
                  {hasTierWalls && tierGroupOrder && Array.from(tierGroupOrder.entries()).map(([grp, info]) => {
                    if (info.wallIndices.length <= 1) return null;
                    const subtotal = info.wallIndices.reduce((sum, wi) => sum + (perWall[wi] || 0), 0);
                    return (
                      <td key={`sub-${grp}`} className="px-3 py-2 text-center font-semibold text-blue-600 bg-blue-50">
                        {subtotal > 0 ? subtotal : '-'}
                      </td>
                    );
                  })}
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

