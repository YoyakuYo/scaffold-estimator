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
import { groupScaffoldSummaryByMaterial, scaffoldWallQuantityKey } from '@/lib/merge-scaffold-summary-rows';
import { quotationComponentBaseName } from '@/lib/quotation-display-name';
import { useI18n } from '@/lib/i18n';
import { SCAFFOLD_WIDTH_MEDIUM_MM, SCAFFOLD_WIDTH_NARROW_MM } from '@/lib/scaffold-width-catalog';
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
  LayoutGrid,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Scaffold2DView from './scaffold-2d-view';
import Scaffold2DAllWallsOnePage from './scaffold-2d-all-walls-one-page';
import ScaffoldPlanView from './scaffold-plan-view';
import { correctLegacyMassingTiersIfNeeded } from '@/lib/correct-legacy-massing-tiers';
import { normalizeScaffoldResultForQuotation } from '@/lib/scaffold-quotation-normalize';
import { SiteContactFields } from '@/components/scaffold/building-scaffold-settings-panel';
import { buildWallMapsForScaffoldLevel, distributeByScaffoldLevel } from '@/lib/scaffold-per-level-distribute';
import { edgeChordName, edgeHashiraColumnRangeSegment } from '@/lib/edge-hashira-labels';
import { subscriptionsApi } from '@/lib/api/subscriptions';
import { formatMmAsMetersLabel, formatMmLabel } from '@/lib/dimension-meters';
import { displaySizeSpecForUi } from '@/lib/scaffold-display-size-spec';
import { MaterialGalleryTab } from '@/components/scaffold/material-gallery-tab';
import { usePresence, usePresenceActions } from '@/lib/page-presence-context';

// Dynamic import — Three.js cannot run during SSR
const Scaffold3DView = dynamic(() => import('./scaffold-3d-view'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center" style={{ height: '600px' }}>
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  ),
});

type TabView = 'table' | 'materials' | '2d' | 'plan' | '3d';

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

/** Legacy round nominal mm → shared span catalog (kusabi & wakugumi use the same bay sizes). */
const LEGACY_NOMINAL_SPAN_MM_TO_CATALOG: Record<number, number> = {
  600: 610,
  900: 914,
  1200: 1219,
  1500: 1524,
  1800: 1829,
};

function normalizeSpanMmForSummary(mm: number): number {
  if (!Number.isFinite(mm)) return mm;
  return LEGACY_NOMINAL_SPAN_MM_TO_CATALOG[mm] ?? mm;
}

/**
 * Per-wall span summary: aggregate counts by length (e.g. four 610 bays → `610×4`),
 * sort **longest first** (1219 before 610).
 */
function formatSpanLengthsSummaryMm(spans: number[]): string {
  if (!Array.isArray(spans) || spans.length === 0) return '—';
  const counts = new Map<number, number>();
  for (const raw of spans) {
    const mm = normalizeSpanMmForSummary(raw);
    counts.set(mm, (counts.get(mm) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[0] - a[0]);
  /** Catalog bay sizes — show in mm (same as scaffold width / materials), not meters. */
  return entries.map(([mm, n]) => `${Math.round(mm)}mm×${n}`).join(' ');
}

function buildWallSpanSummaryLines(
  walls: WallCalculationResult[],
  edgeLabeling: EdgeHashiraLabeling | undefined,
  polygonVertices: unknown[] | undefined,
  locale: string | undefined,
  spansWord: string,
): string[] {
  const wallCount = walls.length;
  if (wallCount === 0) return [];
  const closedLoop = Array.isArray(polygonVertices) && polygonVertices.length >= 3;
  return walls.map((w, i) => {
    const chord = formatWallSide(w.side, w.sideJp, locale, {
      wallIndex: i,
      wallCount,
      closedLoop,
    });
    const range = edgeHashiraColumnRangeSegment(
      edgeLabeling,
      i,
      wallCount,
      w.sideJp,
      w.side,
      w.postPositions,
    );
    const spanGroups = formatSpanLengthsSummaryMm(w.spans ?? []);
    const n = w.totalSpans ?? w.spans?.length ?? 0;
    if (range) {
      return `${chord} / ${range} (${n} ${spansWord} ${spanGroups})`;
    }
    return `${chord} (${n} ${spansWord} ${spanGroups})`;
  });
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
  usePresence({
    pageKey: `scaffold/result/${configId}`,
    label: 'Scaffold: reviewing results',
  });
  const presenceActions = usePresenceActions();
  const isAiBimFromUrl = searchParams.get('aiBim') === '1';
  const [showScanModal, setShowScanModal] = useState(false);
  const [excelExporting, setExcelExporting] = useState(false);
  const [exportSite, setExportSite] = useState({
    siteName: '',
    siteAddress: '',
    siteEmail: '',
    sitePhone: '',
    siteFax: '',
  });

  // Support ?tab=3d, ?tab=2d from external links
  const rawTab = searchParams.get('tab');
  const normalizedTab = (rawTab === 'perside' || rawTab === 'breakdown' ? 'table' : rawTab) as TabView;
  const initialTab = (normalizedTab || 'table') as TabView;
  const [activeTab, setActiveTab] = useState<TabView>(
    ['table', 'materials', '2d', 'plan', '3d'].includes(initialTab) ? initialTab : 'table',
  );
  const [visibleLevels, setVisibleLevels] = useState<number>(1);

  // Fetch config (includes calculationResult)
  const { data: config, isLoading } = useQuery<ScaffoldConfiguration>({
    queryKey: ['scaffold-config', configId],
    queryFn: () => scaffoldConfigsApi.get(configId),
  });

  const { data: subscription, isLoading: subscriptionLoading } = useQuery({
    queryKey: ['my-subscription'],
    queryFn: subscriptionsApi.getMine,
    retry: false,
    staleTime: 1000 * 60 * 2,
  });
  const canView3d = subscription?.capabilities?.view3d === true;

  useEffect(() => {
    if (!config) return;
    setExportSite({
      siteName: config.siteName ?? '',
      siteAddress: config.siteAddress ?? '',
      siteEmail: config.siteEmail ?? '',
      sitePhone: config.sitePhone ?? '',
      siteFax: config.siteFax ?? '',
    });
  }, [
    config?.id,
    config?.siteName,
    config?.siteAddress,
    config?.siteEmail,
    config?.sitePhone,
    config?.siteFax,
  ]);

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
      endStopperType: (result as { endStopperType?: string }).endStopperType ?? config.endStopperType ?? 'nuno',
      includePattanko: (result as { includePattanko?: boolean }).includePattanko ?? config.includePattanko ?? true,
    };
  }, [result, config, rawResult]);

  /** 見積表・内訳: merge top guard into posts + one row per plank/brace/nuno/habaki (works with stale API JSON). */
  const resultForDisplay = useMemo(() => {
    if (!result) return undefined;
    const base = resultMergedForViz ?? result;
    return normalizeScaffoldResultForQuotation(base);
  }, [result, resultMergedForViz]);

  const wallSpanSummaryLines = useMemo(() => {
    const base = resultMergedForViz ?? result;
    const walls = base?.walls;
    if (!walls?.length) return [];
    const edgeLabeling = (base as { edgeHashiraLabeling?: EdgeHashiraLabeling }).edgeHashiraLabeling;
    const poly = (base as { polygonVertices?: unknown[] }).polygonVertices;
    const spansWord = t('result', 'spansLabel');
    return buildWallSpanSummaryLines(walls, edgeLabeling, poly, locale, spansWord);
  }, [result, resultMergedForViz, locale, t]);

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
    const scaffoldWidthMm = config.scaffoldWidthMm ?? base.scaffoldWidthMm ?? SCAFFOLD_WIDTH_MEDIUM_MM;
    const minimalWalls: WallCalculationResult[] = config.walls
      .filter((w) => w.enabled !== false)
      .map((w) => {
        const wallH = w.wallHeightMm ?? config.buildingHeightMm ?? 3000;
        const wallLevels = Math.max(1, Math.floor(wallH / levelH));
        const stairAccessCount = w.stairAccessCount ?? 0;
        const needsExtBay = scaffoldWidthMm <= SCAFFOLD_WIDTH_NARROW_MM && stairAccessCount > 0;
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
      router.push(
        `/scaffold/${configId}/quote?step=1&projectId=${encodeURIComponent(config?.projectId || 'default-project')}`,
      );
    } catch {
      // Error is handled by mutation
    }
  };

  // ─── Download BOM CSV ─────────────────────────────────────
  const handleBomCsvDownload = useCallback(async () => {
    const bomResult = resultForDisplay ?? result;
    if (!bomResult?.summary?.length) return;
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
    const rows = bomResult.summary.map((c: CalculatedComponent) => {
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
  }, [result, resultForDisplay, configId, t]);

  // ─── Excel Download ─────────────────────────────────────
  const handleExcelDownload = useCallback(async () => {
    try {
      setExcelExporting(true);
      await scaffoldConfigsApi.patchSiteContact(configId, {
        siteName: exportSite.siteName.trim(),
        siteAddress: exportSite.siteAddress.trim(),
        siteEmail: exportSite.siteEmail.trim(),
        sitePhone: exportSite.sitePhone.trim(),
        siteFax: exportSite.siteFax.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ['scaffold-config', configId] });
      const blob = await scaffoldConfigsApi.exportExcel(configId, locale);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${t('result', 'excelExportFilenamePrefix')}_${configId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      presenceActions.recordAction(`Exported scaffold Excel for config ${configId.slice(0, 8)}`);
    } catch (e) {
      alert(t('result', 'excelFailed'));
    } finally {
      setExcelExporting(false);
    }
  }, [configId, locale, t, exportSite, queryClient, presenceActions]);

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
              disabled={excelExporting}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors shadow"
            >
              {excelExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              {excelExporting ? t('result', 'excelSaving') : t('result', 'excelExport')}
            </button>
            {config?.status === 'reviewed' && (
              <button
                onClick={() =>
                  router.push(
                    `/scaffold/${configId}/quote?step=1&projectId=${encodeURIComponent(config?.projectId || 'default-project')}`,
                  )
                }
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors shadow"
              >
                <FileText className="h-4 w-4" />
                {t('result', 'createQuotation')}
              </button>
            )}
          </div>
        </div>

        <div className="mb-4 p-4 rounded-xl bg-white border border-gray-200 text-sm print:break-inside-avoid">
          <div className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-emerald-600" />
            {t('scaffold', 'siteInfoSection')}
          </div>
          <p className="text-xs text-gray-500 mb-3 print:hidden">{t('result', 'excelSiteHeaderHint')}</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
            <div className="min-w-0">
              <SiteContactFields
                siteName={exportSite.siteName}
                setSiteName={(v) => setExportSite((s) => ({ ...s, siteName: v }))}
                siteAddress={exportSite.siteAddress}
                setSiteAddress={(v) => setExportSite((s) => ({ ...s, siteAddress: v }))}
                siteEmail={exportSite.siteEmail}
                setSiteEmail={(v) => setExportSite((s) => ({ ...s, siteEmail: v }))}
                sitePhone={exportSite.sitePhone}
                setSitePhone={(v) => setExportSite((s) => ({ ...s, sitePhone: v }))}
                siteFax={exportSite.siteFax}
                setSiteFax={(v) => setExportSite((s) => ({ ...s, siteFax: v }))}
              />
            </div>
            {wallSpanSummaryLines.length > 0 ? (
              <div className="min-w-0 rounded-lg border border-gray-100 bg-slate-50/90 p-3 print:break-inside-avoid">
                <div className="text-xs font-semibold text-gray-700 mb-2">{t('result', 'spanConfig')}</div>
                <ul className="space-y-1.5 text-[11px] sm:text-xs text-gray-800 leading-snug">
                  {wallSpanSummaryLines.map((line, idx) => (
                    <li
                      key={idx}
                      className="font-mono rounded-md border border-gray-200/90 bg-white px-2 py-1.5 break-all"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        {/* Summary Cards */}
        <div
          className={`grid grid-cols-2 ${result.scaffoldType === 'wakugumi' ? 'md:grid-cols-6' : 'md:grid-cols-4'} gap-3 mb-4 print:break-inside-avoid`}
        >
          <SummaryCard
            icon={<Building2 className="h-5 w-5" />}
            label={t('result', 'maxHeight') || 'Max Height'}
            value={formatMmAsMetersLabel(
              Math.max(
                ...result.walls.map((w: WallCalculationResult) => w.levelCalc.topPlankHeightMm + w.levelCalc.topGuardHeightMm),
                0,
              ),
            )}
          />
          <SummaryCard
            icon={<Ruler className="h-5 w-5" />}
            label={t('result', 'scaffoldWidth')}
            value={formatMmLabel(result.scaffoldWidthMm)}
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
                value={formatMmLabel(result.frameSizeMm ?? 0)}
              />
              <SummaryCard
                icon={<Ruler className="h-5 w-5" />}
                label={t('result', 'habakiCount')}
                value={`${result.habakiCountPerSpan}${result.habakiCountPerSpan === 1 ? t('result', 'habakiSingle') : t('result', 'habakiDouble')}`}
              />
            </>
          ) : (
            <SummaryCard
              icon={<Ruler className="h-5 w-5" />}
              label={t('result', 'postSize')}
              value={formatMmLabel(result.preferredMainTatejiMm ?? 0)}
            />
          )}
        </div>

        {/* Scaffold spec hint (applies to 2D / Plan / 3D) */}
        <div className="mb-3 text-xs text-gray-500 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200">
            <ShieldCheck className="h-3.5 w-3.5 text-gray-600" />
            {result.scaffoldType === 'wakugumi' ? t('result', 'scaffoldTypeWakugumiShort') : t('result', 'scaffoldTypeKusabiShort')}
          </span>
          <span>
            {t('result', 'specWidth')} {formatMmLabel(result.scaffoldWidthMm)}
            {result.scaffoldType === 'wakugumi'
              ? result.frameSizeMm != null &&
                  ` · ${t('result', 'specFrame')} ${formatMmLabel(result.frameSizeMm)}`
              : result.preferredMainTatejiMm != null &&
                  ` · ${t('result', 'specMainPost')} ${formatMmLabel(result.preferredMainTatejiMm)}`}
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
            type="button"
            onClick={() => setActiveTab('materials')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'materials'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            {t('resultExtra', 'tabMaterials')}
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
            type="button"
            onClick={() => setActiveTab('3d')}
            title={!subscriptionLoading && !canView3d ? t('result', 'view3dRequiresPlan') : undefined}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === '3d'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            } ${!subscriptionLoading && !canView3d ? 'ring-1 ring-amber-200/80' : ''}`}
          >
            <Box className="h-4 w-4" />
            {t('result', 'tab3d')}
          </button>
        </div>

        {/* Tab content: only the active tab is printed (browser print / “Print this tab”). */}
        <div className={activeTab === 'table' ? 'block space-y-8' : 'hidden'}>
          <QuotationTable
            result={resultForDisplay ?? result}
            heading={t('resultExtra', 'tabOverall')}
            sectionHeadingId="overall-totals-heading"
          />
          <PerLiftBomSection result={resultForDisplay ?? result} />
        </div>

        <div className={activeTab === 'materials' ? 'block space-y-4' : 'hidden'}>
          <h2 className="hidden print:block text-base font-bold text-gray-900 mb-3 pb-2 border-b-2 border-gray-300">
            {t('resultExtra', 'materialsGalleryPrintTitle')}
          </h2>
          <MaterialGalleryTab
            summary={(resultForDisplay ?? result).summary ?? []}
            scaffoldType={
              ((resultMergedForViz ?? result).scaffoldType ??
                'kusabi') as 'kusabi' | 'wakugumi'
            }
          />
        </div>

        <div className={`${activeTab === '2d' ? 'block' : 'hidden'} print:overflow-visible`}>
          <h2 className="hidden print:block text-base font-bold text-gray-900 mb-3 pb-2 border-b-2 border-gray-300">
            {t('result', 'tab2d')}
          </h2>
          <Scaffold2DView result={resultForViz ?? resultMergedForViz ?? result} />
          <Scaffold2DAllWallsOnePage result={resultForViz ?? resultMergedForViz ?? result} />
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
          {subscriptionLoading ? (
            <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-24">
              <Loader2 className="h-10 w-10 animate-spin text-blue-500" aria-hidden />
            </div>
          ) : canView3d ? (
            <Scaffold3DView
              result={resultForViz ?? resultFor3D ?? resultMergedForViz ?? result}
              totalLevels={maxLevels}
              complianceMode={isAiBim ? 'ai_bim' : 'default'}
            />
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-8 text-center max-w-lg mx-auto">
              <Box className="h-12 w-12 text-amber-600 mx-auto mb-4" aria-hidden />
              <p className="text-slate-800 font-medium mb-2">{t('result', 'view3dRequiresPlan')}</p>
              <p className="text-sm text-slate-600 mb-6">
                {subscription?.companySeat || subscription?.managesBilling === false
                  ? t('result', 'view3dSeatHolderHint')
                  : t('result', 'view3dUpgradeHint')}
              </p>
              {subscription?.companySeat !== true && subscription?.managesBilling !== false && (
                <button
                  type="button"
                  onClick={() => router.push('/billing')}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {t('result', 'view3dUpgradeCta')}
                </button>
              )}
            </div>
          )}
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
                  <div className="text-2xl font-bold text-gray-900">
                    {((resultForDisplay ?? result).summary ?? []).length}
                  </div>
                  <div className="text-xs text-gray-500">{t('result', 'totalComponents')}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">
                    {(resultForDisplay ?? result).summary.reduce(
                      (sum: number, c: CalculatedComponent) => sum + c.quantity,
                      0,
                    ).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">{t('result', 'totalParts')}</div>
                  <p className="text-[10px] text-gray-400 mt-1.5 leading-snug text-left px-0.5">
                    {t('result', 'totalPartsHint')}
                  </p>
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
                      onClick={() =>
                  router.push(
                    `/scaffold/${configId}/quote?step=1&projectId=${encodeURIComponent(config?.projectId || 'default-project')}`,
                  )
                }
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
  heading,
  wallMaps: wallMapsProp,
  levelSlice,
  headerVariant = 'blue',
  sectionHeadingId,
}: {
  result: any;
  heading?: string;
  wallMaps?: globalThis.Map<string, number>[];
  levelSlice?: { levelIndex: number; scaffoldLevelCount: number; maxFullLevels: number };
  headerVariant?: 'blue' | 'slate';
  sectionHeadingId?: string;
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

  // Build per-wall quantity maps (or use precomputed maps for per-lift tables)
  // IMPORTANT: Use the same key generation logic as backend aggregation
  // Use globalThis.Map so the built-in constructor is always used (avoids shadowing by lucide-react Map icon)
  const wallMaps = useMemo(() => {
    if (wallMapsProp) return wallMapsProp;
    return walls.map((wall) => {
      const m = new globalThis.Map<string, number>();
      for (const comp of wall.components) {
        const key = scaffoldWallQuantityKey(comp);
        m.set(key, (m.get(key) || 0) + comp.quantity);
      }
      return m;
    });
  }, [walls, wallMapsProp]);

  const headBg = headerVariant === 'slate' ? 'bg-slate-600' : 'bg-blue-600';
  const grpHeadBg = headerVariant === 'slate' ? 'bg-slate-500' : 'bg-blue-500';
  const totHeadBg = headerVariant === 'slate' ? 'bg-slate-700' : 'bg-blue-700';
  const headingDomId = heading ? sectionHeadingId ?? 'quotation-table-heading' : undefined;

  const materialGroups = useMemo(() => groupScaffoldSummaryByMaterial(summary), [summary]);

  const rowsWithGrouping = useMemo(() => {
    type Row =
      | { type: 'header'; category: string }
      | {
          type: 'detail';
          comp: CalculatedComponent;
          idx: number;
          nameDisplay: string;
          specDisplay: string;
        };
    const rows: Row[] = [];
    let lastCategory = '';
    let itemNo = 0;
    let prevDetailNameLogic = '';
    let prevDetailSpecLogic = '';
    const sameNameMark = t('result', 'quotationSameName');
    const sameSpecMark = t('result', 'quotationSameSpec');

    for (const grp of materialGroups) {
      const cat =
        locale === 'ja'
          ? grp.category || ''
          : grp.categoryEn || grp.components[0]?.categoryEn || grp.category || '';
      if (cat !== lastCategory) {
        rows.push({ type: 'header', category: cat });
        lastCategory = cat;
      }
      for (let j = 0; j < grp.components.length; j++) {
        const comp = grp.components[j];
        itemNo++;
        const nameLogic = quotationComponentBaseName(comp, locale);
        const nameDisplay =
          nameLogic === prevDetailNameLogic && prevDetailNameLogic !== ''
            ? sameNameMark
            : nameLogic;
        const specLogic = displaySizeSpecForUi(comp.sizeSpec || '');
        const specDisplay =
          specLogic === prevDetailSpecLogic &&
          prevDetailSpecLogic !== '' &&
          nameLogic === prevDetailNameLogic
            ? sameSpecMark
            : specLogic;
        prevDetailNameLogic = nameLogic;
        prevDetailSpecLogic = specLogic;
        rows.push({
          type: 'detail',
          comp,
          idx: itemNo,
          nameDisplay,
          specDisplay,
        });
      }
    }
    return rows;
  }, [materialGroups, locale, t]);

  return (
    <section
      className="print:break-inside-avoid"
      aria-labelledby={headingDomId}
    >
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {heading ? (
          <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-gray-200 bg-slate-50/90">
            <h2 id={headingDomId} className="text-lg font-bold text-gray-900 tracking-tight">
              {heading}
            </h2>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`${headBg} text-white`}>
                <th className="px-3 py-2 text-left font-medium w-12">{t('result', 'colNo')}</th>
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
                    <th key={`grp-${grp}`} className={`px-3 py-2 text-center font-medium min-w-[80px] ${grpHeadBg}`}>
                      <div>{info.label}</div>
                      <div className="text-[10px] font-normal opacity-80">{t('result', 'subtotal')}</div>
                    </th>
                  ) : null
                ))}
                <th className={`px-3 py-2 text-center font-medium min-w-[80px] ${totHeadBg}`}>{t('result', 'colTotal')}</th>
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
                      <td colSpan={4 + walls.length + subtotalColCount + 1} className="px-3 py-1.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                        {row.category}
                      </td>
                    </tr>
                  );
                }

                const { comp, idx, nameDisplay, specDisplay } = row;
                const key = scaffoldWallQuantityKey(comp);
                const perWall = wallMaps.map((m) => m.get(key) || 0);
                const total = (() => {
                  if (comp.materialCode === 'PATTANKO' && levelSlice) {
                    const arr = distributeByScaffoldLevel(
                      comp,
                      levelSlice.maxFullLevels,
                      levelSlice.scaffoldLevelCount,
                    );
                    return arr[levelSlice.levelIndex] ?? 0;
                  }
                  if (comp.materialCode === 'PATTANKO') return comp.quantity;
                  return perWall.reduce((a, b) => a + b, 0);
                })();
                const rowKey = `${comp.sortOrder}-${key}`;
                const nameIsMark = nameDisplay === t('result', 'quotationSameName');
                const specIsMark = specDisplay === t('result', 'quotationSameSpec');

                return (
                  <tr
                    key={rowKey}
                    className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}
                  >
                    <td className="px-3 py-2 text-gray-400 text-center">{idx}</td>
                    <td
                      className={`px-3 py-2 ${
                        nameIsMark
                          ? 'text-center text-slate-500 font-semibold'
                          : 'font-medium text-gray-800'
                      }`}
                    >
                      {nameDisplay}
                    </td>
                    <td
                      className={`px-3 py-2 text-gray-600 ${
                        specIsMark ? 'text-center text-slate-500 font-semibold' : ''
                      }`}
                    >
                      {specDisplay}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-500">{comp.unit}</td>
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
    </section>
  );
}

/** Per-scaffold-lift BOM tables (per-edge columns), same distribution rules as Excel export. */
function PerLiftBomSection({ result }: { result: any }) {
  const { t } = useI18n();
  const walls = result.walls as WallCalculationResult[] | undefined;
  const wallMapsByLevel = useMemo(() => {
    if (!Array.isArray(walls) || walls.length === 0) return null;
    const scaffoldLevelCount = Math.max(
      1,
      result.totalLevels ?? Math.max(1, ...walls.map((w) => w.levelCalc?.fullLevels ?? 1)),
    );
    if (scaffoldLevelCount <= 1) return null;
    return Array.from({ length: scaffoldLevelCount }, (_, li) =>
      buildWallMapsForScaffoldLevel(walls, li, scaffoldLevelCount),
    );
  }, [walls, result.totalLevels]);

  if (!wallMapsByLevel || !walls?.length) return null;

  const scaffoldType = result.scaffoldType ?? 'kusabi';
  const levelHeightMm = scaffoldType === 'wakugumi' ? (result.frameSizeMm ?? 1800) : 1800;
  const scaffoldLevelCount = wallMapsByLevel.length;
  const maxFullLevels = Math.max(1, ...walls.map((w) => w.levelCalc?.fullLevels ?? 1));

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">{t('resultExtra', 'perLiftSectionTitle')}</p>
        <p className="mt-1 text-slate-600">{t('resultExtra', 'perLiftSectionNote')}</p>
      </div>
      {wallMapsByLevel.map((wallMaps, li) => {
        const fromMm = li * levelHeightMm;
        const toMm = (li + 1) * levelHeightMm;
        const title = t('resultExtra', 'perLiftTableTitle')
          .replace(/\{\{n\}\}/g, String(li + 1))
          .replace(/\{\{fromMm\}\}/g, fromMm.toLocaleString())
          .replace(/\{\{toMm\}\}/g, toMm.toLocaleString());
        return (
          <QuotationTable
            key={li}
            result={result}
            heading={title}
            wallMaps={wallMaps}
            levelSlice={{ levelIndex: li, scaffoldLevelCount, maxFullLevels }}
            headerVariant="slate"
            sectionHeadingId={`per-lift-heading-${li}`}
          />
        );
      })}
    </div>
  );
}

