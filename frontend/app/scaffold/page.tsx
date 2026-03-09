'use client';

import { useState, useCallback, useEffect, useRef, Suspense } from 'react';
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
  Zap,
  PenTool,
  ScanLine,
  Upload,
  Check,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { QuickShapeBuilder, type QuickShapeConfig } from '@/components/quick-shape-builder';
import { visionBimApi } from '@/lib/api/vision-bim';
import { ScaffoldManager } from '@/lib/scaffold-manager';
import { getAiBimDefaults } from '@/lib/ai-bim-rules';

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

function calcTotalFromSegments(segments: WallSegment[]): number {
  if (segments.length === 0) return 0;
  let total = 0;
  for (const seg of segments) total += seg.lengthMm;
  for (let i = 1; i < segments.length; i++) {
    total += Math.abs(segments[i].offsetMm - segments[i - 1].offsetMm);
  }
  return total;
}

/** Fix likely mis-read: one edge 4xxx mm when dimension was 34.593 m (leading digit dropped). */
function correctWallLengthsMm(lengths: number[] | undefined): number[] | undefined {
  if (!Array.isArray(lengths) || lengths.length < 2) return lengths;
  const small = lengths.filter((l) => l >= 4000 && l < 6000);
  const large = lengths.filter((l) => l >= 10000);
  if (small.length !== 1 || large.length !== lengths.length - 1) return lengths;
  return lengths.map((l) => (l >= 4000 && l < 6000 ? l + 30000 : l));
}

/** Renders building footprint outline as SVG (for AI BIM double-check panel). */
function BuildingShapeSvg({
  outline,
  wallLengthsMm,
  className,
}: {
  outline: Array<{ xFrac: number; yFrac: number }>;
  wallLengthsMm?: number[];
  className?: string;
}) {
  if (outline.length < 3) return <div className={className} />;
  const xs = outline.map((p) => p.xFrac);
  const ys = outline.map((p) => p.yFrac);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const nx = (x: number) => (x - minX) / w;
  const ny = (y: number) => (y - minY) / h;
  const points = outline.map((p) => `${nx(p.xFrac)},${ny(p.yFrac)}`).join(' ');
  const labels = wallLengthsMm?.map((lenMm, i) => {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const mx = nx((a.xFrac + b.xFrac) / 2);
    const my = ny((a.yFrac + b.yFrac) / 2);
    return { mx, my, text: `${(lenMm / 1000).toFixed(3)}m` };
  }) ?? [];
  return (
    <svg viewBox="-0.1 -0.1 1.2 1.2" preserveAspectRatio="xMidYMid meet" className={className}>
      <polygon points={points} fill="#e0e7ff" stroke="#6366f1" strokeWidth={0.025} />
      {labels.map((l, i) => (
        <text key={i} x={l.mx} y={l.my} textAnchor="middle" dominantBaseline="middle"
          fontSize={0.07} fill="#3730a3" fontFamily="system-ui, sans-serif" fontWeight="600">
          {l.text}
        </text>
      ))}
    </svg>
  );
}

// ─── Manual building geometry: single closed footprint, walls derived from it ───

type FootprintPoint = { xFrac: number; yFrac: number };

/** Distance between two points (mm). */
function distMm(a: FootprintPoint, b: FootprintPoint): number {
  const dx = b.xFrac - a.xFrac;
  const dy = b.yFrac - a.yFrac;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Build a single closed polygon footprint from manual dimensions.
 * Vertices are ordered so edge i is vertex[i] → vertex[(i+1) % n]; the last edge explicitly closes to the first.
 * Used only for manual quick-shape input; does not affect upload/CAD geometry.
 */
function buildClosedFootprintFromQuickShape(
  config: QuickShapeConfig,
): { vertices: FootprintPoint[] } {
  const sides = config.sides;
  if (sides.length < 3) return { vertices: [] };

  if (config.shapeType === 'rectangle' && sides.length === 4) {
    const w = sides[0].lengthMm;
    const d = sides[1].lengthMm;
    const vertices: FootprintPoint[] = [
      { xFrac: 0, yFrac: 0 },
      { xFrac: w, yFrac: 0 },
      { xFrac: w, yFrac: d },
      { xFrac: 0, yFrac: d },
    ];
    return { vertices };
  }

  if (config.shapeType === 'l-shape' && sides.length === 6) {
    // Rectilinear L: A→B (E), B→C (N), C→D (E), D→E (S), E→F (W), F→A (N). All in mm.
    const [ab, bc, cd, de, ef] = sides.map((s) => s.lengthMm);
    const vertices: FootprintPoint[] = [
      { xFrac: 0, yFrac: 0 },
      { xFrac: ab, yFrac: 0 },
      { xFrac: ab, yFrac: bc },
      { xFrac: ab + cd, yFrac: bc },
      { xFrac: ab + cd, yFrac: bc - de },
      { xFrac: ab + cd - ef, yFrac: bc - de },
    ];
    // Closure: last edge is vertex[5] → vertex[0]. Length is derived when building walls.
    return { vertices };
  }

  // Custom (or any other) polygon: build chain with equal exterior angles for first n-1 segments,
  // then close with last edge (n-1)→0 so the footprint is guaranteed closed.
  const n = sides.length;
  const extAngle = (2 * Math.PI) / n;
  let angle = 0;
  let cx = 0;
  let cy = 0;
  const vertices: FootprintPoint[] = [{ xFrac: 0, yFrac: 0 }];
  for (let i = 0; i < n - 1; i++) {
    const len = sides[i].lengthMm;
    cx += len * Math.cos(angle);
    cy += len * Math.sin(angle);
    angle += extAngle;
    vertices.push({ xFrac: cx, yFrac: cy });
  }
  // Last edge is (n-1) → 0; we do not add a duplicate first point. Closure is explicit when deriving walls.
  return { vertices };
}

/**
 * Derive wall inputs from a closed footprint loop.
 * Each wall = one edge: vertex[i] → vertex[(i+1) % n]. Length is taken from the polygon, not from user input.
 */
function deriveWallsFromClosedFootprint(
  vertices: FootprintPoint[],
  config: QuickShapeConfig,
): WallInput[] {
  const n = vertices.length;
  if (n < 3) return [];

  const sides = config.sides;
  const buildingHeightMm = config.buildingHeightMm;
  const kaidanPerSide = config.kaidanPerSide ?? {};

  return Array.from({ length: n }, (_, i) => {
    const next = (i + 1) % n;
    const lengthMm = Math.round(distMm(vertices[i], vertices[next]));
    const label = sides[i]?.label ?? `edge-${i}`;
    const stairAccessCount = kaidanPerSide[label]?.enabled ? kaidanPerSide[label].count : 0;
    return {
      side: label,
      wallLengthMm: lengthMm,
      wallHeightMm: buildingHeightMm,
      stairAccessCount,
      kaidanCount: 0,
      kaidanOffsets: [],
    };
  });
}

// ─── Page Component ─────────────────────────────────────────

export default function ScaffoldPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>}>
      <ScaffoldPageContent />
    </Suspense>
  );
}

function ScaffoldPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useI18n();

  const wallLabel = (side: string) => {
    if (side === 'north' || side === 'south' || side === 'east' || side === 'west') {
      return t('scaffold', side as 'north' | 'south' | 'east' | 'west');
    }
    if (side.startsWith('edge-')) {
      const edgeNum = parseInt(side.replace('edge-', ''), 10) + 1;
      return locale === 'ja' ? `辺${edgeNum}` : `Edge ${edgeNum}`;
    }
    return side;
  };

  // ─── Input Mode ────────────────────────────────────────
  const [inputMode, setInputMode] = useState<'drawing' | 'quick' | 'ai_bim'>('drawing');
  const [aiBimUploading, setAiBimUploading] = useState(false);
  const [aiBimError, setAiBimError] = useState<string | null>(null);
  /** After AI extract: show for double-check before creating config. */
  const [aiBimPreview, setAiBimPreview] = useState<{
    buildingHeightMm: number;
    walls: WallInput[];
    buildingOutline: Array<{ xFrac: number; yFrac: number }>;
    scaffoldType: 'kusabi' | 'wakugumi';
    frameSizeMm?: number;
    wallLengthsFromDimText?: boolean;
    dto: CreateScaffoldConfigDto;
  } | null>(null);
  const [aiBimConfirming, setAiBimConfirming] = useState(false);
  const scaffoldManagerRef = useRef<ScaffoldManager | null>(null);
  if (!scaffoldManagerRef.current) scaffoldManagerRef.current = new ScaffoldManager();

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
  const [prefilled, setPrefilled] = useState(false);

  const editConfigId = searchParams.get('edit') ?? null;

  const { data: editConfig, isLoading: editConfigLoading } = useQuery({
    queryKey: ['scaffold-config', editConfigId!],
    queryFn: () => scaffoldConfigsApi.get(editConfigId!),
    enabled: !!editConfigId,
    staleTime: 0,
  });

  useEffect(() => {
    if (!editConfigId || !editConfig) return;
    setScaffoldType(editConfig.scaffoldType);
    setStructureType(editConfig.structureType || '改修工事');
    setScaffoldWidthMm(editConfig.scaffoldWidthMm ?? 600);
    setPreferredMainTatejiMm(editConfig.preferredMainTatejiMm ?? 1800);
    setTopGuardHeightMm(editConfig.topGuardHeightMm ?? 900);
    setFrameSizeMm(editConfig.frameSizeMm ?? 1700);
    setHabakiCountPerSpan(editConfig.habakiCountPerSpan ?? 2);
    setEndStopperType((editConfig.endStopperType as 'nuno' | 'frame') ?? 'nuno');
    setBuildingHeightMm(editConfig.buildingHeightMm ?? null);
    const wallList = editConfig.walls ?? [];
    if (wallList.length > 0) {
      const buildingH = editConfig.buildingHeightMm ?? 3000;
      const mapped: WallState[] = wallList.map((w: any) => {
        const segs = w.segments && Array.isArray(w.segments) ? w.segments : [];
        const isMulti = segs.length > 0;
        const lengthMm = isMulti ? calcTotalFromSegments(segs) : (w.wallLengthMm ?? 0);
        return {
          side: w.side,
          enabled: w.enabled !== false,
          lengthMm,
          heightMm: w.wallHeightMm ?? buildingH,
          stairAccessCount: w.stairAccessCount ?? 0,
          kaidanCount: 0,
          kaidanOffsets: [],
          isMultiSegment: isMulti,
          segments: segs.length > 0 ? segs : [{ lengthMm: w.wallLengthMm ?? 0, offsetMm: 0 }],
        };
      });
      setWalls(mapped);
      setPrefilled(true);
    }
    const poly = editConfig.calculationResult?.polygonVertices;
    if (Array.isArray(poly) && poly.length >= 3) {
      setPolygonVertices(
        poly.map((p: { x?: number; y?: number; xFrac?: number; yFrac?: number }) => ({
          x: p.x ?? p.xFrac ?? 0,
          y: p.y ?? p.yFrac ?? 0,
        })),
      );
    }
  }, [editConfigId, editConfig]);

  // ─── Fetch rules from backend ───────────────────────────
  const { data: rules } = useQuery<ScaffoldRules>({
    queryKey: ['scaffold-rules'],
    queryFn: () => scaffoldConfigsApi.getRules(),
    staleTime: 1000 * 60 * 30,
  });

  const calculateMutation = useMutation({
    mutationFn: ({
      dto,
      configId,
    }: {
      dto: CreateScaffoldConfigDto;
      configId?: string | null;
    }) =>
      configId
        ? scaffoldConfigsApi.updateAndRecalculate(configId, dto)
        : scaffoldConfigsApi.createAndCalculate(dto),
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
    if (!perimeterModel.isClosed && !prefilled) {
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

    const dto: CreateScaffoldConfigDto = {
      projectId: editConfig?.projectId ?? 'default-project',
      mode: 'manual',
      scaffoldType,
      structureType,
      walls: enabledWalls,
      scaffoldWidthMm,
      ...(scaffoldType === 'kusabi' && {
        preferredMainTatejiMm,
        topGuardHeightMm,
      }),
      ...(scaffoldType === 'wakugumi' && {
        frameSizeMm,
        habakiCountPerSpan,
        endStopperType,
      }),
      ...(polygonVertices.length >= 3 && {
        buildingOutline: polygonVertices.map((v) => ({ xFrac: v.x, yFrac: v.y })),
      }),
    };
    calculateMutation.mutate({ dto, configId: editConfigId });
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (editConfigId && editConfigLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">{t('scaffold', 'loadingConfig')}</span>
      </div>
    );
  }

  const handleQuickShapeSubmit = (qConfig: QuickShapeConfig) => {
    // 1) Build a single closed footprint from manual dimensions (manual path only; upload/CAD unchanged).
    const { vertices } = buildClosedFootprintFromQuickShape(qConfig);
    if (vertices.length < 3) return;
    // 2) Walls derived from footprint edges (each edge i → (i+1)%n); last edge explicitly closes to first.
    const wallInputs = deriveWallsFromClosedFootprint(vertices, qConfig);
    if (wallInputs.length === 0 || wallInputs.length !== vertices.length) return; // ensure closed loop

    const buildingOutline = vertices;

    const dto: CreateScaffoldConfigDto = {
      projectId: 'default-project',
      mode: 'manual',
      scaffoldType: qConfig.scaffoldType,
      structureType: qConfig.structureType,
      walls: wallInputs,
      scaffoldWidthMm: qConfig.scaffoldWidthMm,
      buildingOutline,
      ...(qConfig.scaffoldType === 'kusabi' && {
        preferredMainTatejiMm: qConfig.preferredMainTatejiMm,
        topGuardHeightMm: qConfig.topGuardHeightMm,
      }),
      ...(qConfig.scaffoldType === 'wakugumi' && {
        frameSizeMm: qConfig.frameSizeMm,
        habakiCountPerSpan: qConfig.habakiCountPerSpan,
        endStopperType: qConfig.endStopperType,
      }),
    };
    calculateMutation.mutate({ dto, configId: null });
  };

  return (
    <div className="min-h-screen bg-gray-50" suppressHydrationWarning>
        {/* Header */}
      <div className="max-w-[1600px] mx-auto px-4 pt-6 pb-4">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Calculator className="h-7 w-7 text-blue-600" />
            {t('scaffold', 'title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600">{t('scaffold', 'subtitle')}</p>

          {/* ─── Mode Selector ─── */}
          {!editConfigId && (
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setInputMode('drawing')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border-2 transition-all ${
                  inputMode === 'drawing'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <PenTool className="h-4 w-4" />
                {t('scaffoldExtra', 'drawingUpload')}
              </button>
              <button
                onClick={() => setInputMode('quick')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border-2 transition-all ${
                  inputMode === 'quick'
                    ? 'border-green-500 bg-green-50 text-green-700 shadow-sm'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <Zap className="h-4 w-4" />
                {t('scaffoldExtra', 'quickBuilder')}
              </button>
              <button
                onClick={() => setInputMode('ai_bim')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border-2 transition-all ${
                  inputMode === 'ai_bim'
                    ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <ScanLine className="h-4 w-4" />
                AI BIM Mode
              </button>
            </div>
          )}
        </div>

      {/* ═══════════════════════════════════════════════════════
          AI BIM MODE — Vision-to-BIM upload
         ═══════════════════════════════════════════════════════ */}
      {inputMode === 'ai_bim' && !editConfigId && (
        <div className="max-w-[1200px] mx-auto px-4 pb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-violet-600" />
              AI BIM Mode — 写真・図面から足場モデル
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              {aiBimPreview
                ? '抽出結果を確認し、問題なければ「確認して足場モデルを作成」を押してください。'
                : '写真・青写真・DXF/CAD図面をアップロードすると、建物の外形と高さを検出し、確認後に足場モデルとBOMを生成します。'}
            </p>
            {!aiBimPreview && (
            <>
            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-violet-300 rounded-xl cursor-pointer bg-violet-50/50 hover:bg-violet-50 transition-colors">
              <Upload className="h-10 w-10 text-violet-500 mb-2" />
              <span className="text-sm font-medium text-violet-700 mb-1">クリックまたはドラッグでファイルをアップロード</span>
              <span className="text-xs text-gray-500">PNG, JPEG, DXF, DWG, JWW, PDF (max 10MB). DWG/JWWはDXFにエクスポート推奨</span>
              <input
                type="file"
                className="hidden"
                accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.dxf,.dwg,.jww,.pdf,image/png,image/jpeg,image/gif,image/webp,image/bmp,application/dxf,application/pdf"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setAiBimError(null);
                  setAiBimUploading(true);
                  try {
                    const footprint = await visionBimApi.analyze(file);
                    const manager = scaffoldManagerRef.current!;
                    const refMm = footprint.vertices.some((v) => 'xFrac' in v)
                      ? (footprint.scaleDenominator ? 20000 : 10000)
                      : undefined;
                    const wallLengthsMm = correctWallLengthsMm(footprint.wallLengthsMm) ?? footprint.wallLengthsMm;
                    const { walls, buildingOutline } = manager.injectFootprintAndGetWalls(
                      footprint.vertices,
                      footprint.buildingHeightMm,
                      refMm,
                      { wallLengthsMm },
                    );
                    const defaults = getAiBimDefaults();
                    const scaffoldType = footprint.scaffoldTypeHint ?? 'kusabi';
                    const frameSize = scaffoldType === 'wakugumi' ? (footprint.frameSizeMm ?? 1800) : undefined;
                    const dto: CreateScaffoldConfigDto = {
                      projectId: 'default-project',
                      mode: 'manual',
                      scaffoldType,
                      structureType: '改修工事',
                      walls,
                      scaffoldWidthMm: defaults.scaffoldWidthMm,
                      preferredMainTatejiMm: defaults.preferredMainTatejiMm,
                      topGuardHeightMm: defaults.topGuardHeightMm,
                      ...(scaffoldType === 'wakugumi' && frameSize != null && { frameSizeMm: frameSize }),
                      buildingOutline,
                    };
                    setAiBimPreview({
                      buildingHeightMm: footprint.buildingHeightMm,
                      walls,
                      buildingOutline,
                      scaffoldType,
                      frameSizeMm: frameSize,
                      wallLengthsFromDimText: footprint.wallLengthsFromDimText,
                      dto,
                    });
                    setAiBimError(null);
                  } catch (err: any) {
                    setAiBimError(err?.message || 'Analysis failed. Try another image or use Drawing/Quick mode.');
                  } finally {
                    setAiBimUploading(false);
                    e.target.value = '';
                  }
                }}
                disabled={aiBimUploading}
              />
            </label>
            {aiBimUploading && (
              <div className="mt-4 flex items-center gap-2 text-violet-600">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Analyzing image and generating scaffold model…</span>
              </div>
            )}
            {aiBimError && (
              <div className="mt-4 flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                {aiBimError}
              </div>
            )}
            </>
            )}

            {aiBimPreview && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                    <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                      <Check className="h-5 w-5" />
                      抽出完了 — 右側で内容を確認してください
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setAiBimPreview(null); setAiBimError(null); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    別のファイルをアップロード
                  </button>
                </div>
                <div className="border border-gray-200 rounded-xl p-5 bg-gray-50/50 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-800">抽出結果の確認</h3>
                  <div>
                    <span className="text-xs font-medium text-gray-500">建物高さ</span>
                    <p className="text-lg font-semibold text-gray-900">
                      {aiBimPreview.buildingHeightMm.toLocaleString()} mm
                      {aiBimPreview.buildingHeightMm >= 1000 && (
                        <span className="text-sm font-normal text-gray-600 ml-1">
                          ({(aiBimPreview.buildingHeightMm / 1000).toFixed(3)} m)
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-500">壁面ごとの長さ</span>
                      {aiBimPreview.wallLengthsFromDimText
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle2 size={12} />寸法線から取得</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"><AlertTriangle size={12} />頂点から推定</span>
                      }
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-100 border-b border-gray-200">
                            <th className="text-left py-2 px-3 font-medium text-gray-700">壁面</th>
                            <th className="text-right py-2 px-3 font-medium text-gray-700">長さ (mm)</th>
                            <th className="text-right py-2 px-3 font-medium text-gray-700">長さ (m)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiBimPreview.walls.map((w, i) => (
                            <tr key={w.side} className="border-b border-gray-100 last:border-0">
                              <td className="py-2 px-3 text-gray-800">壁面 {i + 1}</td>
                              <td className="py-2 px-3 text-right font-mono text-gray-700">{w.wallLengthMm.toLocaleString()}</td>
                              <td className="py-2 px-3 text-right font-mono text-gray-500">{(w.wallLengthMm / 1000).toFixed(3)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-50 border-t border-gray-200">
                            <td className="py-2 px-3 text-xs font-semibold text-gray-600">合計 (周長)</td>
                            <td className="py-2 px-3 text-right font-mono font-semibold text-gray-800">
                              {aiBimPreview.walls.reduce((s, w) => s + w.wallLengthMm, 0).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-semibold text-gray-600">
                              {(aiBimPreview.walls.reduce((s, w) => s + w.wallLengthMm, 0) / 1000).toFixed(3)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500 block mb-2">建物平面形</span>
                    <BuildingShapeSvg
                      outline={aiBimPreview.buildingOutline}
                      wallLengthsMm={aiBimPreview.walls.map((w) => w.wallLengthMm)}
                      className="w-full max-w-sm aspect-square rounded-lg border border-gray-200 bg-white"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-xs text-gray-500">
                      {aiBimPreview.scaffoldType === 'wakugumi' ? '枠組足場' : 'くさび式足場'}
                      {aiBimPreview.frameSizeMm != null && ` · 建枠 ${aiBimPreview.frameSizeMm}mm`}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={aiBimConfirming}
                    onClick={async () => {
                      if (!aiBimPreview) return;
                      setAiBimConfirming(true);
                      try {
                        const data = await scaffoldConfigsApi.createAndCalculate(aiBimPreview.dto);
                        router.push(`/scaffold/${data.config.id}?aiBim=1`);
                      } catch (err: any) {
                        setAiBimError(err?.message ?? 'Failed to create scaffold');
                        setAiBimConfirming(false);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50"
                  >
                    {aiBimConfirming ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                    {aiBimConfirming ? '作成中…' : '確認して足場モデルを作成'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          QUICK SHAPE BUILDER MODE
         ═══════════════════════════════════════════════════════ */}
      {inputMode === 'quick' && !editConfigId && (
        <div className="max-w-[1200px] mx-auto px-4 pb-8">
          <QuickShapeBuilder
            onSubmit={handleQuickShapeSubmit}
            isCalculating={calculateMutation.isPending}
          />
          {calculateMutation.isError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mt-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div className="text-red-700 text-sm">{t('scaffold', 'calcError')}</div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          PERIMETER TRACER — Full-Width Split Screen (Drawing Mode)
         ═══════════════════════════════════════════════════════ */}
      {(inputMode === 'drawing' || editConfigId) && (<>
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
                {t('scaffoldExtra', 'scaffoldType')}
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
                  <div>{t('scaffold', 'kusabiType')}</div>
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
                  <div>{t('scaffold', 'wakugumiType')}</div>
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
                    {t('scaffoldExtra', 'frameSize')}
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
                  <p className="text-xs text-gray-500 mt-1">{t('scaffoldExtra', 'frameSizeHint')}</p>
                </div>

                {/* Habaki Count (巾木枚数) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('scaffoldExtra', 'habakiCount')}
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
                    {t('scaffoldExtra', 'endStopper')}
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
                          {t('scaffoldExtra', 'multiSegmentWall')}
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
                          {t('scaffoldExtra', 'addSegment')}
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
        {calculateMutation.isError && (() => {
          const err = calculateMutation.error as Error & { code?: string; response?: { status?: number } };
          const isNetworkError =
            err?.code === 'ERR_NETWORK' ||
            err?.message === 'Network Error' ||
            (err?.message && String(err.message).toLowerCase().includes('network'));
          return (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div className="text-red-700 text-sm">
                {isNetworkError ? (
                  <span>{t('scaffold', 'networkError')}</span>
                ) : (
                  <>
                    <span>{t('scaffold', 'calcError')}</span>
                    {err?.message && (
                      <span className="block mt-1 text-red-500">{err.message}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

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
      </>)}
    </div>
  );
}
