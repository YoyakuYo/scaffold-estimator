'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  scaffoldConfigsApi,
  CreateScaffoldConfigDto,
  ScaffoldRules,
  WallInput,
  WallSegment,
} from '@/lib/api/scaffold-configs';
import { useI18n } from '@/lib/i18n';
import { PerimeterModel } from '@/lib/perimeter-model';
import {
  Calculator,
  Building2,
  ArrowRight,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  LayoutList,
} from 'lucide-react';
import dynamic from 'next/dynamic';

// Dynamic import for PerimeterTracer (uses browser APIs)
const PerimeterTracer = dynamic(
  () =>
    import('@/components/perimeter-tracer/PerimeterTracer').then(m => ({
      default: m.PerimeterTracer,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-96 flex items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200">
        Loading Perimeter Tracer…
      </div>
    ),
  },
);

// ─── Types ──────────────────────────────────────────────────

interface WallState {
  side: string;
  enabled: boolean;
  lengthMm: number;
  heightMm: number;
  stairAccessCount: number;
  kaidanCount: number;
  kaidanOffsets: number[];
  isMultiSegment: boolean;
  segments: WallSegment[];
}

interface AiVisionPrefillPayload {
  buildingHeightMm?: number | null;
  scaffoldType?: 'kusabi' | 'wakugumi' | null;
  scaffoldWidthMm?: number | null;
  structureType?: '改修工事' | 'S造' | 'RC造' | null;
  preferredMainTatejiMm?: number | null;
  topGuardHeightMm?: number | null;
  frameSizeMm?: number | null;
  walls?: Array<{
    side: string;
    lengthMm: number | null;
    heightMm: number | null;
    wallLengthMm?: number | null;
    wallHeightMm?: number | null;
    enabled?: boolean;
    stairAccessCount?: number;
  }>;
}

function calcTotalFromSegments(segments: WallSegment[]): number {
  if (segments.length === 0) return 0;
  let total = 0;
  for (const seg of segments) total += seg.lengthMm;
  for (let i = 1; i < segments.length; i++) {
    total += Math.abs(segments[i].offsetMm - segments[i - 1].offsetMm);
  }
  return total;
}

// ─── Page Component ─────────────────────────────────────────

export default function ScaffoldPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const wallLabel = (side: string) => {
    if (side === 'north' || side === 'south' || side === 'east' || side === 'west') {
      return t('scaffold', side as 'north' | 'south' | 'east' | 'west');
    }
    if (side.startsWith('edge-')) {
      const edgeNum = parseInt(side.replace('edge-', ''), 10) + 1;
      return `辺${edgeNum} / Edge ${edgeNum}`;
    }
    return side;
  };

  // ─── Perimeter Model ────────────────────────────────────
  const [perimeterModel] = useState(() => new PerimeterModel());

  // ─── Form state ─────────────────────────────────────────
  const [scaffoldType, setScaffoldType] = useState<'kusabi' | 'wakugumi'>('kusabi');
  const [structureType, setStructureType] = useState<'改修工事' | 'S造' | 'RC造'>('改修工事');
  const [scaffoldWidthMm, setScaffoldWidthMm] = useState(600);
  // Kusabi-specific
  const [preferredMainTatejiMm, setPreferredMainTatejiMm] = useState(1800);
  const [topGuardHeightMm, setTopGuardHeightMm] = useState(900);
  // Wakugumi-specific
  const [frameSizeMm, setFrameSizeMm] = useState(1700);
  const [habakiCountPerSpan, setHabakiCountPerSpan] = useState(2);
  const [endStopperType, setEndStopperType] = useState<'nuno' | 'frame'>('nuno');
  const [walls, setWalls] = useState<WallState[]>([]);
  const [buildingHeightMm, setBuildingHeightMm] = useState<number | null>(null);
  const [polygonVertices, setPolygonVertices] = useState<Array<{ x: number; y: number }>>([]);
  const [aiPrefilled, setAiPrefilled] = useState(false);

  useEffect(() => {
    const fromAi = searchParams.get('fromAi');
    if (fromAi !== '1') return;

    try {
      const raw = sessionStorage.getItem('aiScaffoldPrefill') || sessionStorage.getItem('aiVisionResult');
      if (!raw) return;
      const data = JSON.parse(raw) as AiVisionPrefillPayload;

      if (data.scaffoldType && ['kusabi', 'wakugumi'].includes(data.scaffoldType)) {
        setScaffoldType(data.scaffoldType);
      }
      if (typeof data.scaffoldWidthMm === 'number' && [600, 900, 1200].includes(data.scaffoldWidthMm)) {
        setScaffoldWidthMm(data.scaffoldWidthMm);
      }
      if (data.structureType && ['改修工事', 'S造', 'RC造'].includes(data.structureType)) {
        setStructureType(data.structureType);
      }
      if (typeof data.preferredMainTatejiMm === 'number' && [1800, 2700, 3600].includes(data.preferredMainTatejiMm)) {
        setPreferredMainTatejiMm(data.preferredMainTatejiMm);
      }
      if (typeof data.topGuardHeightMm === 'number' && [900, 1350, 1800].includes(data.topGuardHeightMm)) {
        setTopGuardHeightMm(data.topGuardHeightMm);
      }
      if (typeof data.frameSizeMm === 'number' && [1700, 1800, 1900].includes(data.frameSizeMm)) {
        setFrameSizeMm(data.frameSizeMm);
      }

      const prefillHeight =
        typeof data.buildingHeightMm === 'number' && data.buildingHeightMm > 0
          ? data.buildingHeightMm
          : null;
      if (prefillHeight) {
        setBuildingHeightMm(prefillHeight);
      }

      if (Array.isArray(data.walls) && data.walls.length > 0) {
        const mappedWalls: WallState[] = data.walls
          .filter((w) => typeof w?.side === 'string' && ((w.lengthMm ?? w.wallLengthMm ?? 0) > 0))
          .map((w) => {
            const inputLength = w.lengthMm ?? w.wallLengthMm ?? 0;
            const inputHeight = w.heightMm ?? w.wallHeightMm ?? null;
            const inferredHeight =
              typeof inputHeight === 'number' && inputHeight > 0
                ? inputHeight
                : prefillHeight || 3000;
            return {
              side: w.side,
              enabled: w.enabled ?? true,
              lengthMm: Number(inputLength) || 0,
              heightMm: inferredHeight,
              stairAccessCount: Number(w.stairAccessCount) || 0,
              kaidanCount: 0,
              kaidanOffsets: [],
              isMultiSegment: false,
              segments: [],
            };
          });
        if (mappedWalls.length > 0) {
          setWalls(mappedWalls);
          setAiPrefilled(true);
        }
      }
    } catch {
      // Ignore malformed prefill payload.
    }
  }, [searchParams]);

  // ─── Fetch rules from backend ───────────────────────────
  const { data: rules } = useQuery<ScaffoldRules>({
    queryKey: ['scaffold-rules'],
    queryFn: () => scaffoldConfigsApi.getRules(),
    staleTime: 1000 * 60 * 30,
  });

  // ─── Calculate mutation ─────────────────────────────────
  const calculateMutation = useMutation({
    mutationFn: (dto: CreateScaffoldConfigDto) =>
      scaffoldConfigsApi.createAndCalculate(dto),
    onSuccess: (data) => {
      router.push(`/scaffold/${data.config.id}`);
    },
  });

  const updateWall = (index: number, updates: Partial<WallState>) => {
    setWalls((prev) =>
      prev.map((w, i) => (i === index ? { ...w, ...updates } : w)),
    );
  };

  // ─── Walls detected from PerimeterTracer ────────────────
  const handleWallsDetected = useCallback(
    (
      detected: Array<{ side: string; lengthMm: number }>,
      vertices?: Array<{ x: number; y: number }>,
    ) => {
      if (vertices && vertices.length >= 3) {
        setPolygonVertices(vertices);
      }
      setWalls((prev) => {
        // Preserve existing wall settings (height, kaidan, multi-segment) when lengths update
        return detected.map((w, i) => {
          const existing = prev[i];
          if (existing && existing.side === w.side) {
            return { ...existing, lengthMm: w.lengthMm };
          }
          return {
            side: w.side,
        enabled: true,
            lengthMm: w.lengthMm,
            heightMm: buildingHeightMm || 0,
        stairAccessCount: 0,
        kaidanCount: 0,
        kaidanOffsets: [],
        isMultiSegment: false,
        segments: [],
          };
        });
      });
    },
    [buildingHeightMm],
  );

  // ─── Segment edited in tracer right panel → update wall ──
  const handleSegmentEdit = useCallback(
    (index: number, lengthMm: number) => {
      setWalls((prev) =>
        prev.map((w, i) => (i === index ? { ...w, lengthMm } : w)),
      );
    },
    [],
  );

  // Sync building height to all enabled walls
  useEffect(() => {
    if (buildingHeightMm && buildingHeightMm > 0) {
      setWalls((prev) =>
        prev.map((w) => (w.enabled ? { ...w, heightMm: buildingHeightMm } : w)),
      );
    }
  }, [buildingHeightMm]);

  // ─── Calculate handler ──────────────────────────────────
  const handleCalculate = () => {
    if (!perimeterModel.isClosed && !aiPrefilled) {
      alert('Please close the polygon first.\nポリゴンを閉じてください。');
      return;
    }
    if (!buildingHeightMm || buildingHeightMm <= 0) {
      alert('Please enter building height.\n建物の高さを入力してください。');
      return;
    }

    const enabledWalls: WallInput[] = walls
      .filter((w) => w.enabled && w.lengthMm > 0)
      .map((w) => ({
        side: w.side,
        wallLengthMm: w.isMultiSegment ? calcTotalFromSegments(w.segments) : w.lengthMm,
        wallHeightMm: w.heightMm || buildingHeightMm,
        stairAccessCount: w.stairAccessCount,
        kaidanCount: w.kaidanCount,
        kaidanOffsets: w.kaidanOffsets,
        ...(w.isMultiSegment && w.segments.length > 0
          ? { isMultiSegment: true, segments: w.segments }
          : {}),
    }));

    if (enabledWalls.length === 0) {
      alert('No enabled wall segments.\n有効な壁セグメントがありません。');
      return;
    }

    // Validate minimum wall lengths (backend requires >= 600mm)
    const tooShort = enabledWalls.filter(w => w.wallLengthMm < 600);
    if (tooShort.length > 0) {
      alert(
        `Some walls are too short (min 600mm):\n${tooShort.map(w => `${w.side}: ${w.wallLengthMm}mm`).join('\n')}\n\nPlease enter real wall dimensions in mm.\n壁の長さは最低600mm必要です。`,
      );
      return;
    }

    // Validate minimum wall heights (backend requires >= 1000mm)
    const tooLow = enabledWalls.filter(w => w.wallHeightMm < 1000);
    if (tooLow.length > 0) {
      alert(
        `Some walls have invalid height (min 1000mm):\n${tooLow.map(w => `${w.side}: ${w.wallHeightMm}mm`).join('\n')}\n\n壁の高さは最低1000mm必要です。`,
      );
      return;
    }

    calculateMutation.mutate({
      projectId: 'default-project',
      mode: 'manual',
      scaffoldType,
      structureType,
      walls: enabledWalls,
      scaffoldWidthMm,
      // Kusabi-specific
      ...(scaffoldType === 'kusabi' && {
        preferredMainTatejiMm,
        topGuardHeightMm,
      }),
      // Wakugumi-specific
      ...(scaffoldType === 'wakugumi' && {
        frameSizeMm,
        habakiCountPerSpan,
        endStopperType,
      }),
      // Send actual polygon shape for plan/3D views
      ...(polygonVertices.length >= 3 && {
        buildingOutline: polygonVertices.map(v => ({ xFrac: v.x, yFrac: v.y })),
      }),
    });
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-gray-50" suppressHydrationWarning>
        {/* Header */}
      <div className="max-w-[1600px] mx-auto px-4 pt-6 pb-4">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Calculator className="h-7 w-7 text-blue-600" />
            {t('scaffold', 'title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600">{t('scaffold', 'subtitle')}</p>
        </div>

      {/* ═══════════════════════════════════════════════════════
          PERIMETER TRACER — Full-Width Split Screen
         ═══════════════════════════════════════════════════════ */}
      <div className="max-w-[1600px] mx-auto px-4 mb-6">
        <PerimeterTracer
          perimeterModel={perimeterModel}
          onWallsDetected={handleWallsDetected}
          onSegmentEdit={handleSegmentEdit}
          externalWallLengths={walls.map(w => w.lengthMm)}
          buildingHeightMm={buildingHeightMm}
          onBuildingHeightChange={setBuildingHeightMm}
        />
          </div>

      {/* ═══════════════════════════════════════════════════════
          SCAFFOLD SETTINGS + WALL CONFIG (shown when walls exist)
         ═══════════════════════════════════════════════════════ */}
      {walls.length > 0 && (
        <div className="max-w-[1600px] mx-auto px-4 pb-8">

        {/* Building & Scaffold Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            {t('scaffold', 'buildingSettings')}
          </h2>

            {/* Scaffold Type Selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                足場タイプ / Scaffold Type
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setScaffoldType('kusabi')}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                    scaffoldType === 'kusabi'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <div className="text-base">くさび式足場</div>
                  <div className="text-xs font-normal mt-0.5 opacity-70">Kusabi (Wedge)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setScaffoldType('wakugumi')}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                    scaffoldType === 'wakugumi'
                      ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <div className="text-base">枠組足場</div>
                  <div className="text-xs font-normal mt-0.5 opacity-70">Wakugumi (Frame)</div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Structure Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('scaffold', 'structureType')}
              </label>
              <select
                value={structureType}
                onChange={(e) => setStructureType(e.target.value as '改修工事' | 'S造' | 'RC造')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="改修工事">{t('scaffold', 'structureTypeRenovation')} (1.25x)</option>
                <option value="S造">{t('scaffold', 'structureTypeSteel')} (1.0x)</option>
                <option value="RC造">{t('scaffold', 'structureTypeConcrete')} (0.9x)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">{t('scaffold', 'structureTypeHint')}</p>
            </div>

            {/* Scaffold Width */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('scaffold', 'scaffoldWidth')}
              </label>
              <select
                value={scaffoldWidthMm}
                onChange={(e) => setScaffoldWidthMm(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(rules?.scaffoldWidths || [
                  { value: 600, label: '600mm' },
                  { value: 900, label: '900mm' },
                  { value: 1200, label: '1200mm' },
                ]).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* ─── Kusabi-specific fields ─── */}
            {scaffoldType === 'kusabi' && (
              <>
                {/* Main Tateji */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('scaffold', 'postSize')}
                  </label>
                  <select
                    value={preferredMainTatejiMm}
                    onChange={(e) => setPreferredMainTatejiMm(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {(rules?.mainTatejiOptions || [
                      { value: 1800, label: '1800mm' },
                      { value: 2700, label: '2700mm' },
                      { value: 3600, label: '3600mm' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Top Guard */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('scaffold', 'topGuard')}
                  </label>
                  <select
                    value={topGuardHeightMm}
                    onChange={(e) => setTopGuardHeightMm(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {(rules?.topGuardOptions || [
                      { value: 900, label: '900mm' },
                      { value: 1350, label: '1350mm' },
                      { value: 1800, label: '1800mm' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* ─── Wakugumi-specific fields ─── */}
            {scaffoldType === 'wakugumi' && (
              <>
                {/* Frame Size (建枠サイズ) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    建枠サイズ / Frame Size
                  </label>
                  <select
                    value={frameSizeMm}
                    onChange={(e) => setFrameSizeMm(Number(e.target.value))}
                    className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-orange-50/30"
                  >
                    {(rules?.wakugumi?.frameSizeOptions || [
                      { value: 1700, label: '1700mm (標準)' },
                      { value: 1800, label: '1800mm' },
                      { value: 1900, label: '1900mm' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">レベル高さ = 建枠サイズ</p>
                </div>

                {/* Habaki Count (巾木枚数) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    巾木枚数 / Habaki Count
                  </label>
                  <select
                    value={habakiCountPerSpan}
                    onChange={(e) => setHabakiCountPerSpan(Number(e.target.value))}
                    className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-orange-50/30"
                  >
                    {(rules?.wakugumi?.habakiCountOptions || [
                      { value: 1, label: '1枚 (片面)' },
                      { value: 2, label: '2枚 (両面)' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* End Stopper Type (端部タイプ) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    端部タイプ / End Stopper
                  </label>
                  <select
                    value={endStopperType}
                    onChange={(e) => setEndStopperType(e.target.value as 'nuno' | 'frame')}
                    className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-orange-50/30"
                  >
                    {(rules?.wakugumi?.endStopperTypeOptions || [
                      { value: 'nuno', label: '布材タイプ (端部布材)' },
                      { value: 'frame', label: '枠タイプ (妻側枠)' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Wall Configuration */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">{t('scaffold', 'wallConfig')}</h2>

          {/* Quick Height Estimator */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs font-medium text-blue-800 mb-2">
              📐 {t('scaffold', 'quickHeightEstimate')}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '1F (3,900mm)', value: 3900 },
                { label: '2F (6,900mm)', value: 6900 },
                { label: '3F (9,900mm)', value: 9900 },
                { label: '4F (12,900mm)', value: 12900 },
                { label: '5F (15,900mm)', value: 15900 },
                { label: '6F+', value: 0 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    if (preset.value === 0) {
                      const floors = prompt(t('scaffold', 'enterFloorCount') || 'Enter number of floors (6-20):', '6');
                      if (floors) {
                        const n = parseInt(floors, 10);
                        if (n >= 1 && n <= 50) {
                          const height = 3300 + (n - 1) * 3000 + 900;
                            setBuildingHeightMm(height);
                            setWalls((prev) => prev.map((w) => (w.enabled ? { ...w, heightMm: height } : w)));
                        }
                      }
                    } else {
                        setBuildingHeightMm(preset.value);
                        setWalls((prev) => prev.map((w) => (w.enabled ? { ...w, heightMm: preset.value } : w)));
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-white border border-blue-300 rounded-lg hover:bg-blue-100 text-blue-700 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-blue-500 mt-1.5">
              {t('scaffold', 'quickHeightNote')}
            </p>
          </div>

          <div className="space-y-3">
            {walls.map((wall, i) => (
              <div
                key={wall.side}
                className={`rounded-lg border p-4 transition-all ${
                  wall.enabled
                    ? 'border-blue-200 bg-blue-50/50'
                    : 'border-gray-200 bg-gray-50 opacity-60'
                }`}
              >
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Enable checkbox */}
                  <label className="flex items-center gap-2 cursor-pointer min-w-[80px]">
                    <input
                      type="checkbox"
                      checked={wall.enabled}
                      onChange={(e) => updateWall(i, { enabled: e.target.checked })}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="font-semibold text-gray-800">{wallLabel(wall.side)}</span>
                  </label>

                  {/* Wall Length */}
                    <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600 whitespace-nowrap">{t('scaffold', 'wallLength')}</label>
                      <input
                        type="number"
                        value={(wall.isMultiSegment && wall.segments.length > 0
                          ? calcTotalFromSegments(wall.segments)
                          : wall.lengthMm) || ''}
                        onChange={(e) => {
                          if (!wall.isMultiSegment) {
                            updateWall(i, { lengthMm: Number(e.target.value) || 0 });
                          }
                        }}
                        disabled={!wall.enabled || wall.isMultiSegment}
                        readOnly={wall.isMultiSegment}
                        placeholder="0"
                        className={`w-32 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${
                          wall.isMultiSegment ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-gray-300'
                        }`}
                        min={600}
                        step={100}
                      />
                      <span className="text-sm text-gray-500">mm</span>
                        <span className="text-xs text-gray-400 min-w-[50px]">
                          {wall.lengthMm > 0 ? `${(wall.lengthMm / 1000).toFixed(2)}m` : ''}
                        </span>
                      {wall.isMultiSegment && (
                        <span className="text-xs text-orange-500" title="Auto-calculated from segments">⚡</span>
                      )}
                    </div>
                  </div>

                  {/* Wall Height */}
                    <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600 whitespace-nowrap">{t('scaffold', 'wallHeight')}</label>
                      <input
                        type="number"
                        value={wall.heightMm || ''}
                        onChange={(e) => updateWall(i, { heightMm: Number(e.target.value) || 0 })}
                        disabled={!wall.enabled}
                        placeholder="0"
                        className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        min={1000}
                        step={100}
                      />
                      <span className="text-sm text-gray-500">mm</span>
                        <span className="text-xs text-gray-400 min-w-[50px]">
                          {wall.heightMm > 0 ? `${(wall.heightMm / 1000).toFixed(1)}m` : ''}
                        </span>
                    </div>
                  </div>
                </div>

                {/* Multi-Segment Wall Editor */}
                {wall.enabled && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex items-center gap-2 mb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={wall.isMultiSegment}
                          onChange={(e) => {
                            const multi = e.target.checked;
                            if (multi && wall.segments.length === 0) {
                              updateWall(i, {
                                isMultiSegment: true,
                                segments: [{ lengthMm: wall.lengthMm || 5000, offsetMm: 0 }],
                              });
                            } else {
                              updateWall(i, { isMultiSegment: multi });
                              if (!multi && wall.segments.length > 0) {
                                updateWall(i, {
                                  isMultiSegment: false,
                                  lengthMm: calcTotalFromSegments(wall.segments),
                                });
                              }
                            }
                          }}
                          className="h-3.5 w-3.5 text-orange-600 rounded border-gray-300 focus:ring-orange-500"
                        />
                        <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
                          <LayoutList className="h-3.5 w-3.5" />
                          Multi-Segment Wall / 多段壁
                        </span>
                      </label>
                      {wall.isMultiSegment && (
                        <span className="text-xs text-orange-600 font-medium ml-auto">
                          Total: {calcTotalFromSegments(wall.segments).toLocaleString()}mm
                          {wall.segments.length > 1 && (
                            <span className="text-gray-400 ml-1">
                              ({wall.segments.length} segments + {
                                  wall.segments.reduce(
                                    (sum, _, idx) =>
                                      idx > 0
                                        ? sum + Math.abs(wall.segments[idx].offsetMm - wall.segments[idx - 1].offsetMm)
                                        : sum,
                                    0,
                                ).toLocaleString()
                              }mm returns)
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    {wall.isMultiSegment && (
                      <div className="space-y-2 ml-4">
                        {wall.segments.length > 1 && (
                          <div className="bg-gray-100 rounded-lg p-2 mb-2">
                              <svg
                                viewBox={`0 0 ${Math.max(200, wall.segments.reduce((s, seg) => s + seg.lengthMm, 0) / 50)} 80`}
                                className="w-full h-12"
                                preserveAspectRatio="xMidYMid meet"
                              >
                              {(() => {
                                const scale = 1 / 50;
                                let segX = 0;
                                  const maxOffset = Math.max(...wall.segments.map((s) => Math.abs(s.offsetMm)));
                                const oScale = maxOffset > 0 ? 25 / maxOffset : 1;
                                const baseline = 50;
                                const rects: JSX.Element[] = [];
                                wall.segments.forEach((seg, idx) => {
                                  const w = seg.lengthMm * scale;
                                  const segY = baseline - seg.offsetMm * oScale;
                                  rects.push(
                                      <rect
                                        key={`seg-${idx}`}
                                        x={segX}
                                        y={segY - 4}
                                        width={w}
                                        height={8}
                                        fill="#f97316"
                                        opacity={0.7}
                                        rx={1}
                                      />,
                                  );
                                  if (idx > 0) {
                                    const prevY = baseline - wall.segments[idx - 1].offsetMm * oScale;
                                    rects.push(
                                        <line
                                          key={`ret-${idx}`}
                                          x1={segX}
                                          y1={prevY}
                                          x2={segX}
                                          y2={segY}
                                          stroke="#9ca3af"
                                          strokeWidth={1.5}
                                          strokeDasharray="3,2"
                                        />,
                                    );
                                  }
                                  segX += w;
                                });
                                return rects;
                              })()}
                            </svg>
                          </div>
                        )}

                        {wall.segments.map((seg, segIdx) => (
                            <div
                              key={segIdx}
                              className="flex items-center gap-2 bg-orange-50 rounded-lg px-3 py-2 border border-orange-200"
                            >
                              <span className="text-xs font-medium text-orange-700 w-6">{segIdx + 1}.</span>
                            <div className="flex items-center gap-1">
                              <label className="text-xs text-gray-600">L:</label>
                              <input
                                type="number"
                                value={seg.lengthMm || ''}
                                onChange={(e) => {
                                  const newSegs = [...wall.segments];
                                  newSegs[segIdx] = { ...newSegs[segIdx], lengthMm: Number(e.target.value) || 0 };
                                  const total = calcTotalFromSegments(newSegs);
                                  updateWall(i, { segments: newSegs, lengthMm: total });
                                }}
                                placeholder="5000"
                                className="w-24 rounded border border-orange-300 px-2 py-1 text-xs focus:ring-1 focus:ring-orange-500"
                                min={600}
                                step={100}
                              />
                              <span className="text-xs text-gray-400">mm</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <label className="text-xs text-gray-600">Offset:</label>
                              <input
                                type="number"
                                value={seg.offsetMm}
                                onChange={(e) => {
                                  const newSegs = [...wall.segments];
                                  newSegs[segIdx] = { ...newSegs[segIdx], offsetMm: Number(e.target.value) || 0 };
                                  const total = calcTotalFromSegments(newSegs);
                                  updateWall(i, { segments: newSegs, lengthMm: total });
                                }}
                                placeholder="0"
                                className="w-20 rounded border border-orange-300 px-2 py-1 text-xs focus:ring-1 focus:ring-orange-500"
                                step={100}
                              />
                              <span className="text-xs text-gray-400">mm</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const newSegs = wall.segments.filter((_, k) => k !== segIdx);
                                const total = calcTotalFromSegments(newSegs);
                                updateWall(i, { segments: newSegs, lengthMm: total });
                              }}
                              className="ml-auto p-1 text-red-400 hover:text-red-600 disabled:opacity-30"
                              disabled={wall.segments.length <= 1}
                              title="Remove segment"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => {
                              const lastOffset =
                                wall.segments.length > 0
                              ? wall.segments[wall.segments.length - 1].offsetMm
                              : 0;
                            const newSegs = [...wall.segments, { lengthMm: 3000, offsetMm: lastOffset }];
                            const total = calcTotalFromSegments(newSegs);
                            updateWall(i, { segments: newSegs, lengthMm: total });
                          }}
                          className="flex items-center gap-1.5 text-xs text-orange-600 hover:text-orange-800 font-medium px-3 py-1.5 rounded-lg border border-dashed border-orange-300 hover:bg-orange-50 transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Segment / セグメント追加
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Kaidan Placement Section */}
                  {wall.enabled &&
                    (wall.isMultiSegment ? calcTotalFromSegments(wall.segments) : wall.lengthMm) > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200 w-full">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-medium text-gray-700">
                        {t('scaffold', 'kaidanPlacement') || 'Kaidan Placement'}
                      </label>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-600 whitespace-nowrap">
                          {t('scaffold', 'kaidanCount') || 'Number of accesses:'}
                        </label>
                        <select
                          value={wall.kaidanCount || 0}
                          onChange={(e) => {
                            const count = Number(e.target.value) || 0;
                            const currentOffsets = wall.kaidanOffsets || [];
                            let newOffsets: number[];
                            if (count === 0) {
                              newOffsets = [];
                            } else if (count > currentOffsets.length) {
                              newOffsets = [...currentOffsets];
                              for (let j = currentOffsets.length; j < count; j++) {
                                const position = Math.round((wall.lengthMm / (count + 1)) * (j + 1));
                                newOffsets.push(Math.round(position / 100) * 100);
                              }
                            } else {
                              newOffsets = currentOffsets.slice(0, count);
                            }
                            updateWall(i, {
                              kaidanCount: count,
                              kaidanOffsets: newOffsets,
                              stairAccessCount: count,
                            });
                          }}
                          className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500"
                        >
                          {[0, 1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                          ))}
                        </select>
                      </div>
                    </div>

                        {wall.kaidanCount > 0 &&
                          (wall.kaidanOffsets || []).map((offset, kaidanIdx) => (
                      <div key={kaidanIdx} className="mb-4 last:mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-medium text-gray-600">
                            {t('scaffold', 'kaidan') || 'Kaidan'} {kaidanIdx + 1}:
                          </label>
                                <span className="text-xs text-gray-500">{offset.toLocaleString()}mm</span>
                        </div>
                        {(() => {
                                const effectiveLength =
                                  wall.isMultiSegment && wall.segments.length > 0
                            ? calcTotalFromSegments(wall.segments)
                            : wall.lengthMm;
                          return (
                            <>
                              <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                                <span>0mm</span>
                                <span>{effectiveLength.toLocaleString()}mm</span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={effectiveLength}
                                step={100}
                                value={offset}
                                onChange={(e) => {
                                  const raw = Number(e.target.value) || 0;
                                  const snapped = Math.round(raw / 100) * 100;
                                  const newOffsets = [...(wall.kaidanOffsets || [])];
                                  newOffsets[kaidanIdx] = snapped;
                                  updateWall(i, { kaidanOffsets: newOffsets });
                                }}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                style={{
                                        background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(offset / effectiveLength) * 100}%, #e5e7eb ${(offset / effectiveLength) * 100}%, #e5e7eb 100%)`,
                                }}
                              />
                            </>
                          );
                        })()}
                        <div className="mt-1 text-[10px] text-gray-400 italic">
                                {t('scaffold', 'kaidanPlacementHint') ||
                                  'Drag to position - kaidan will be placed in 2 spans closest to this position'}
                        </div>
                      </div>
                    ))}

                    {wall.kaidanCount === 0 && (
                      <p className="text-xs text-gray-400 italic">
                            {t('scaffold', 'selectKaidanCount') ||
                              'Select number of kaidan accesses above to position them'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Error message */}
        {calculateMutation.isError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div className="text-red-700 text-sm">
              <span>{t('scaffold', 'calcError')}</span>
              {(calculateMutation.error as Error)?.message && (
                <span className="block mt-1 text-red-500">
                  {(calculateMutation.error as Error).message}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Calculate Button */}
        <button
          onClick={handleCalculate}
          disabled={calculateMutation.isPending || walls.filter((w) => w.enabled).length === 0}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-3 text-lg shadow-lg"
        >
          {calculateMutation.isPending ? (
            <span className="flex items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>{t('scaffold', 'calculating')}</span>
            </span>
          ) : (
            <span className="flex items-center gap-3">
              <Calculator className="h-6 w-6" />
              <span>{t('scaffold', 'calcButton')}</span>
              <ArrowRight className="h-5 w-5" />
            </span>
          )}
        </button>
      </div>
      )}
    </div>
  );
}
