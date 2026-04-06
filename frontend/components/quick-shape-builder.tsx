'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { buildQuickShapeFootprintMm } from '@/lib/quick-shape-footprint';
import { zoomPanViewBox } from '@/lib/svg-view-box-zoom';
import { PreviewZoomToolbar } from '@/components/scaffold/preview-zoom-toolbar';
import {
  Square,
  CornerDownRight,
  Pentagon,
  Plus,
  Trash2,
  Calculator,
  Building2,
  Ruler,
  ArrowRight,
  LayoutList,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { inferEdgePlanAxisFromVertices, signedAxisRunMmFromVertices } from '@/lib/infer-edge-plan-axis';
import {
  normalizeScaffoldWallCfKey,
  SCAFFOLD_WALL_CF_KEYS,
  type ScaffoldWallCfKey,
} from '@/lib/scaffold-wall-cf-options';
import {
  normalizeScaffoldWidthMmToCatalog,
  SCAFFOLD_WIDTH_CATALOG_MM,
  SCAFFOLD_WIDTH_NARROW_MM,
} from '@/lib/scaffold-width-catalog';
import { formatMmAsMetersLabel, mToMm, mmToM } from '@/lib/dimension-meters';

const CF_LABEL_I18N_KEYS: Record<ScaffoldWallCfKey, 'wallCfReflex' | 'wallCfC'> = {
  reflex: 'wallCfReflex',
  c: 'wallCfC',
};

// ─── Types ───────────────────────────────────────────────────

type ShapeType = 'rectangle' | 'l-shape' | 'custom';

interface SideDefinition {
  label: string;
  lengthMm: number;
}

interface KaidanConfig {
  enabled: boolean;
  count: number;
}

function QuickShapeFootprintSvg({
  vertsMm,
  className = '',
  viewZoom = 1,
  viewPan = { x: 0, y: 0 },
}: {
  vertsMm: Array<{ x: number; y: number }>;
  className?: string;
  viewZoom?: number;
  viewPan?: { x: number; y: number };
}) {
  if (vertsMm.length < 3) {
    return (
      <div className={`flex items-center justify-center text-gray-400 text-sm p-8 ${className}`}>
        —
      </div>
    );
  }
  const xs = vertsMm.map((p) => p.x);
  const ys = vertsMm.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const nx = (x: number) => (x - minX) / w;
  const ny = (y: number) => (y - minY) / h;
  const points = vertsMm.map((p) => `${nx(p.x)},${ny(p.y)}`).join(' ');
  const baseVb = { x: -0.1, y: -0.1, w: 1.2, h: 1.2 };
  const vb = zoomPanViewBox(baseVb, viewZoom, viewPan);
  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <polygon points={points} fill="#dbeafe" stroke="#2563eb" strokeWidth={0.025} strokeLinejoin="round" />
    </svg>
  );
}

export interface QuickShapeConfig {
  shapeType: ShapeType;
  sides: SideDefinition[];
  buildingHeightMm: number;
  /** Level height is fixed 1800mm (kusabi) or = frame size (wakugumi, set in quick builder). Not duplicated here. */
  scaffoldType: 'kusabi' | 'wakugumi';
  scaffoldWidthMm: number;
  /** Per-side scaffold width (mm). Overrides scaffoldWidthMm when set. */
  scaffoldWidthPerSide?: Record<string, number | undefined>;
  preferredMainTatejiMm: number;
  frameSizeMm: number;
  wakugumiFrameSeries?: 'FT617' | 'FT917' | 'FT1217';
  habakiCountPerSpan: number;
  endStopperType: 'nuno' | 'frame';
  structureType: '改修工事' | 'S造' | 'RC造';
  kaidanPerSide: Record<string, KaidanConfig>;
}

/** Persisted wizard state for sessionStorage (quick builder tab). */
export interface QuickShapeBuilderDraft {
  shapeType: ShapeType;
  rectNorth: number;
  rectEast: number;
  rectSouth: number;
  rectWest: number;
  lSegments: SideDefinition[];
  customSegments: SideDefinition[];
  buildingHeightMm: number;
  scaffoldType: 'kusabi' | 'wakugumi';
  scaffoldWidthMm: number;
  preferredMainTatejiMm: number;
  frameSizeMm: number;
  wakugumiFrameSeries: 'FT617' | 'FT917' | 'FT1217';
  habakiCountPerSpan: number;
  endStopperType: 'nuno' | 'frame';
  structureType: '改修工事' | 'S造' | 'RC造';
  kaidanPerSide: Record<string, KaidanConfig>;
  scaffoldWidthPerSide: Record<string, number | undefined>;
  /** Plan axis + signed run (mm) per edge label — same role as drawing upload XY column. */
  edgePlanByLabel?: Record<string, { axis: 'X' | 'Y'; mm: number }>;
  /** Per-edge CF (R/C) — same as drawing upload CF column. */
  cfNoteByLabel?: Record<string, ScaffoldWallCfKey>;
}

function isShapeType(v: unknown): v is ShapeType {
  return v === 'rectangle' || v === 'l-shape' || v === 'custom';
}

function parseEdgePlanByLabel(
  raw: unknown,
): Record<string, { axis: 'X' | 'Y'; mm: number }> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, { axis: 'X' | 'Y'; mm: number }> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const axis = (v as { axis?: string }).axis;
    const mm = Number((v as { mm?: unknown }).mm);
    if (axis !== 'X' && axis !== 'Y') continue;
    if (!Number.isFinite(mm)) continue;
    out[k] = { axis, mm: Math.round(mm) };
  }
  return out;
}

function parseCfNoteByLabel(raw: unknown): Record<string, ScaffoldWallCfKey> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ScaffoldWallCfKey> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = normalizeScaffoldWallCfKey(String(v));
  }
  return out;
}

function draftToInitial(d: QuickShapeBuilderDraft | null | undefined): QuickShapeBuilderDraft | null {
  if (!d || !isShapeType(d.shapeType)) return null;
  const series = d.wakugumiFrameSeries;
  const wakugumiFrameSeries =
    series === 'FT617' || series === 'FT917' || series === 'FT1217' ? series : 'FT917';
  const st = d.structureType;
  const structureType = st === '改修工事' || st === 'S造' || st === 'RC造' ? st : '改修工事';
  const est = d.endStopperType;
  const endStopperType = est === 'nuno' || est === 'frame' ? est : 'nuno';
  const sct = d.scaffoldType;
  const scaffoldType = sct === 'kusabi' || sct === 'wakugumi' ? sct : 'kusabi';
  const habaki = Math.max(1, Math.min(2, Math.round(Number(d.habakiCountPerSpan) || 2)));
  return {
    shapeType: d.shapeType,
    rectNorth: Number.isFinite(d.rectNorth) ? d.rectNorth : 10000,
    rectEast: Number.isFinite(d.rectEast) ? d.rectEast : 8000,
    rectSouth: Number.isFinite(d.rectSouth) ? d.rectSouth : 10000,
    rectWest: Number.isFinite(d.rectWest) ? d.rectWest : 8000,
    lSegments: Array.isArray(d.lSegments) && d.lSegments.length > 0 ? d.lSegments : [
      { label: 'AB', lengthMm: 10000 },
      { label: 'BC', lengthMm: 5000 },
      { label: 'CD', lengthMm: 5000 },
      { label: 'DE', lengthMm: 5000 },
      { label: 'EF', lengthMm: 5000 },
      { label: 'FA', lengthMm: 10000 },
    ],
    customSegments: Array.isArray(d.customSegments) && d.customSegments.length > 2 ? d.customSegments : [
      { label: 'AB', lengthMm: 10000 },
      { label: 'BC', lengthMm: 8000 },
      { label: 'CD', lengthMm: 10000 },
      { label: 'DA', lengthMm: 8000 },
    ],
    buildingHeightMm: Number.isFinite(d.buildingHeightMm) ? d.buildingHeightMm : 9900,
    scaffoldType,
    scaffoldWidthMm: normalizeScaffoldWidthMmToCatalog(
      Number.isFinite(d.scaffoldWidthMm) ? d.scaffoldWidthMm : SCAFFOLD_WIDTH_NARROW_MM,
    ),
    preferredMainTatejiMm: [1800, 2700, 3600].includes(d.preferredMainTatejiMm)
      ? d.preferredMainTatejiMm
      : 1800,
    frameSizeMm: [1700, 1800, 1900].includes(d.frameSizeMm) ? d.frameSizeMm : 1700,
    wakugumiFrameSeries,
    habakiCountPerSpan: habaki,
    endStopperType,
    structureType,
    kaidanPerSide: d.kaidanPerSide && typeof d.kaidanPerSide === 'object' ? d.kaidanPerSide : {},
    scaffoldWidthPerSide:
      d.scaffoldWidthPerSide && typeof d.scaffoldWidthPerSide === 'object'
        ? Object.fromEntries(
            Object.entries(d.scaffoldWidthPerSide as Record<string, number>).map(([k, v]) => [
              k,
              normalizeScaffoldWidthMmToCatalog(v),
            ]),
          )
        : {},
    edgePlanByLabel: parseEdgePlanByLabel(d.edgePlanByLabel),
    cfNoteByLabel: parseCfNoteByLabel(d.cfNoteByLabel),
  };
}

interface Props {
  onSubmit: (config: QuickShapeConfig) => void;
  isCalculating?: boolean;
  /** Hydrate fields after refresh (session draft). */
  initialDraft?: QuickShapeBuilderDraft | null;
  /** Debounced snapshot for parent session draft. */
  onDraftChange?: (draft: QuickShapeBuilderDraft) => void;
}

// ─── Component ───────────────────────────────────────────────

export function QuickShapeBuilder({ onSubmit, isCalculating, initialDraft, onDraftChange }: Props) {
  const { t } = useI18n();
  const mUnit = t('common', 'metersShort') || 'm';
  const mergedInitial = useMemo(() => draftToInitial(initialDraft ?? null), [initialDraft]);

  const [shapeType, setShapeType] = useState<ShapeType>(() => mergedInitial?.shapeType ?? 'rectangle');

  // Rectangle inputs
  const [rectNorth, setRectNorth] = useState(() => mergedInitial?.rectNorth ?? 10000);
  const [rectEast, setRectEast] = useState(() => mergedInitial?.rectEast ?? 8000);
  const [rectSouth, setRectSouth] = useState(() => mergedInitial?.rectSouth ?? 10000);
  const [rectWest, setRectWest] = useState(() => mergedInitial?.rectWest ?? 8000);

  // L-shape inputs
  const [lSegments, setLSegments] = useState<SideDefinition[]>(
    () =>
      mergedInitial?.lSegments ?? [
        { label: 'AB', lengthMm: 10000 },
        { label: 'BC', lengthMm: 5000 },
        { label: 'CD', lengthMm: 5000 },
        { label: 'DE', lengthMm: 5000 },
        { label: 'EF', lengthMm: 5000 },
        { label: 'FA', lengthMm: 10000 },
      ],
  );

  // Custom polygon
  const [customSegments, setCustomSegments] = useState<SideDefinition[]>(
    () =>
      mergedInitial?.customSegments ?? [
        { label: 'AB', lengthMm: 10000 },
        { label: 'BC', lengthMm: 8000 },
        { label: 'CD', lengthMm: 10000 },
        { label: 'DA', lengthMm: 8000 },
      ],
  );

  // Building height; level height is 1800 (kusabi) or frame size (wakugumi) per scaffold type
  const [buildingHeightMm, setBuildingHeightMm] = useState(() => mergedInitial?.buildingHeightMm ?? 9900);

  // Scaffold options (same page as shape & height)
  const [scaffoldType, setScaffoldType] = useState<'kusabi' | 'wakugumi'>(
    () => mergedInitial?.scaffoldType ?? 'kusabi',
  );
  const [scaffoldWidthMm, setScaffoldWidthMm] = useState(
    () => mergedInitial?.scaffoldWidthMm ?? SCAFFOLD_WIDTH_NARROW_MM,
  );
  const [preferredMainTatejiMm, setPreferredMainTatejiMm] = useState(
    () => mergedInitial?.preferredMainTatejiMm ?? 1800,
  );
  const [frameSizeMm] = useState(() => mergedInitial?.frameSizeMm ?? 1700);
  const [wakugumiFrameSeries, setWakugumiFrameSeries] = useState<'FT617' | 'FT917' | 'FT1217'>(
    () => mergedInitial?.wakugumiFrameSeries ?? 'FT917',
  );
  const [habakiCountPerSpan, setHabakiCountPerSpan] = useState(() => mergedInitial?.habakiCountPerSpan ?? 2);
  const [endStopperType, setEndStopperType] = useState<'nuno' | 'frame'>(
    () => mergedInitial?.endStopperType ?? 'nuno',
  );
  const [structureType, setStructureType] = useState<'改修工事' | 'S造' | 'RC造'>(
    () => mergedInitial?.structureType ?? '改修工事',
  );

  // Kaidan per side
  const [kaidanPerSide, setKaidanPerSide] = useState<Record<string, KaidanConfig>>(
    () => mergedInitial?.kaidanPerSide ?? {},
  );
  // Per-side scaffold width (undefined = use global scaffoldWidthMm)
  const [scaffoldWidthPerSide, setScaffoldWidthPerSide] = useState<Record<string, number | undefined>>(
    () => mergedInitial?.scaffoldWidthPerSide ?? {},
  );
  const [edgePlanByLabel, setEdgePlanByLabel] = useState<
    Record<string, { axis: 'X' | 'Y'; mm: number }>
  >(() => mergedInitial?.edgePlanByLabel ?? {});
  const [cfNoteByLabel, setCfNoteByLabel] = useState<Record<string, ScaffoldWallCfKey>>(
    () => mergedInitial?.cfNoteByLabel ?? {},
  );

  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  useEffect(() => {
    if (!onDraftChangeRef.current) return;
    const t = window.setTimeout(() => {
      onDraftChangeRef.current?.({
        shapeType,
        rectNorth,
        rectEast,
        rectSouth,
        rectWest,
        lSegments,
        customSegments,
        buildingHeightMm,
        scaffoldType,
        scaffoldWidthMm,
        preferredMainTatejiMm,
        frameSizeMm,
        wakugumiFrameSeries,
        habakiCountPerSpan,
        endStopperType,
        structureType,
        kaidanPerSide,
        scaffoldWidthPerSide,
        edgePlanByLabel,
        cfNoteByLabel,
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    shapeType,
    rectNorth,
    rectEast,
    rectSouth,
    rectWest,
    lSegments,
    customSegments,
    buildingHeightMm,
    scaffoldType,
    scaffoldWidthMm,
    preferredMainTatejiMm,
    frameSizeMm,
    wakugumiFrameSeries,
    habakiCountPerSpan,
    endStopperType,
    structureType,
    kaidanPerSide,
    scaffoldWidthPerSide,
    edgePlanByLabel,
    cfNoteByLabel,
  ]);

  const sidesList = useMemo((): SideDefinition[] => {
    if (shapeType === 'rectangle') {
      return [
        { label: 'AB', lengthMm: rectNorth },
        { label: 'BC', lengthMm: rectEast },
        { label: 'CD', lengthMm: rectSouth },
        { label: 'DA', lengthMm: rectWest },
      ];
    }
    if (shapeType === 'l-shape') return lSegments;
    return customSegments;
  }, [shapeType, rectNorth, rectEast, rectSouth, rectWest, lSegments, customSegments]);

  const levelHeightPreviewMm = scaffoldType === 'wakugumi' ? frameSizeMm : 1800;
  const calculatedLevels = Math.max(1, Math.floor(buildingHeightMm / levelHeightPreviewMm));

  const addCustomSegment = () => {
    const nextLetter = String.fromCharCode(65 + customSegments.length);
    const firstLetter = 'A';
    setCustomSegments((prev) => [
      ...prev.slice(0, -1),
      { label: `${prev[prev.length - 1]?.label?.[0] || String.fromCharCode(64 + prev.length)}${nextLetter}`, lengthMm: 5000 },
      { label: `${nextLetter}${firstLetter}`, lengthMm: 5000 },
    ]);
  };

  const removeCustomSegment = (idx: number) => {
    if (customSegments.length <= 3) return;
    setCustomSegments((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateCustomSegment = (idx: number, lengthMm: number) => {
    setCustomSegments((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, lengthMm } : s)),
    );
  };

  const updateLSegment = (idx: number, lengthMm: number) => {
    setLSegments((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, lengthMm } : s)),
    );
  };

  const updateEdgeLengthAtIndex = (index: number, lengthMm: number) => {
    const mm = Math.max(600, Math.round(lengthMm));
    if (shapeType === 'rectangle') {
      if (index === 0) setRectNorth(mm);
      else if (index === 1) setRectEast(mm);
      else if (index === 2) setRectSouth(mm);
      else setRectWest(mm);
    } else if (shapeType === 'l-shape') updateLSegment(index, mm);
    else updateCustomSegment(index, mm);
  };

  const handleSubmit = () => {
    onSubmit({
      shapeType,
      sides: sidesList,
      buildingHeightMm,
      scaffoldType,
      scaffoldWidthMm,
      scaffoldWidthPerSide: Object.keys(scaffoldWidthPerSide).length > 0 ? scaffoldWidthPerSide : undefined,
      preferredMainTatejiMm,
      frameSizeMm,
      ...(scaffoldType === 'wakugumi' ? { wakugumiFrameSeries } : {}),
      habakiCountPerSpan,
      endStopperType,
      structureType,
      kaidanPerSide,
    });
  };

  const toggleKaidan = (label: string) => {
    setKaidanPerSide((prev) => ({
      ...prev,
      [label]: {
        enabled: !prev[label]?.enabled,
        count: prev[label]?.count || 1,
      },
    }));
  };

  const updateKaidanCount = (label: string, count: number) => {
    setKaidanPerSide((prev) => ({
      ...prev,
      [label]: { enabled: true, count: Math.max(0, Math.min(4, count)) },
    }));
  };

  const sectionTitleClass =
    'flex items-center gap-2 text-base font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-4';

  const previewFootprintMm = useMemo(
    () => buildQuickShapeFootprintMm(shapeType, sidesList),
    [shapeType, sidesList],
  );

  const updateEdgePlanAxisForRow = (label: string, edgeIndex: number, axis: 'X' | 'Y') => {
    const verts = previewFootprintMm;
    const closed = verts.length >= 3;
    const mm = signedAxisRunMmFromVertices(verts, edgeIndex, axis, closed);
    setEdgePlanByLabel((prev) => ({ ...prev, [label]: { axis, mm } }));
  };

  const updateEdgePlanMmForRow = (label: string, mm: number) => {
    setEdgePlanByLabel((prev) => {
      const cur = prev[label];
      if (!cur) return prev;
      return { ...prev, [label]: { ...cur, mm: Math.round(mm) } };
    });
  };

  const updateCfNoteForRow = (label: string, v: ScaffoldWallCfKey) => {
    setCfNoteByLabel((prev) => ({ ...prev, [label]: v }));
  };

  const previewFootprintKey = useMemo(
    () =>
      previewFootprintMm.length >= 3
        ? previewFootprintMm.map((p) => `${p.x},${p.y}`).join('|')
        : '',
    [previewFootprintMm],
  );

  useEffect(() => {
    const verts = previewFootprintMm;
    const closed = verts.length >= 3;
    if (!closed || sidesList.length === 0) return;

    setEdgePlanByLabel((prev) => {
      const next: Record<string, { axis: 'X' | 'Y'; mm: number }> = {};
      for (let i = 0; i < sidesList.length; i++) {
        const s = sidesList[i]!;
        const inf = inferEdgePlanAxisFromVertices(verts, i, closed);
        const old = prev[s.label];
        if (old) {
          next[s.label] = {
            axis: old.axis,
            mm: signedAxisRunMmFromVertices(verts, i, old.axis, closed),
          };
        } else if (inf) {
          next[s.label] = { axis: inf.axis, mm: inf.mm };
        }
      }
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });

    setCfNoteByLabel((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of sidesList) {
        if (next[s.label] == null) {
          next[s.label] = 'reflex';
          changed = true;
        }
      }
      for (const k of Object.keys(next)) {
        if (!sidesList.some((s) => s.label === k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [previewFootprintKey, previewFootprintMm, sidesList]);

  const [qbPreviewZoom, setQbPreviewZoom] = useState(1);
  const [qbPreviewPan, setQbPreviewPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!previewFootprintKey) return;
    setQbPreviewZoom(1);
    setQbPreviewPan({ x: 0, y: 0 });
  }, [previewFootprintKey]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-slate-50 border-b border-gray-200 px-6 py-4">
        <p className="text-sm text-gray-600 leading-relaxed max-w-3xl">{t('quickBuilder', 'singlePageBlurb')}</p>
      </div>

      <div className="flex flex-col lg:flex-row" style={{ minHeight: 520 }}>
        <div className="flex-1 relative bg-gray-100 min-h-[400px] flex flex-col p-4">
          <div className="absolute top-4 right-4 z-10">
            <PreviewZoomToolbar
              onZoomIn={() => setQbPreviewZoom((z) => Math.min(8, z * 1.15))}
              onZoomOut={() => setQbPreviewZoom((z) => Math.max(0.25, z / 1.15))}
              onReset={() => {
                setQbPreviewZoom(1);
                setQbPreviewPan({ x: 0, y: 0 });
              }}
            />
          </div>
          <p className="text-xs text-gray-500 mb-2 shrink-0 pr-20">
            {t('scaffoldExtra', 'wallConfigPreviewHint') || 'Footprint from current side lengths (mm).'}
          </p>
          <div
            className="flex-1 min-h-[280px] rounded-lg border border-gray-200 bg-white overflow-hidden"
            onWheel={(e) => {
              e.preventDefault();
              const factor = e.deltaY > 0 ? 0.9 : 1.1;
              setQbPreviewZoom((z) => Math.min(8, Math.max(0.25, z * factor)));
            }}
          >
            <QuickShapeFootprintSvg
              vertsMm={previewFootprintMm}
              viewZoom={qbPreviewZoom}
              viewPan={qbPreviewPan}
              className="w-full h-full min-h-[260px]"
            />
          </div>
        </div>

        <div className="w-full lg:min-w-[320px] lg:max-w-xl lg:flex-1 border-t lg:border-t-0 lg:border-l border-gray-200 overflow-y-auto max-h-[88vh]">
          <div className="p-6 space-y-10">
        {/* Footprint type */}
        <section aria-labelledby="qb-section-footprint">
          <h3 id="qb-section-footprint" className={sectionTitleClass}>
            <Square className="h-5 w-5 text-gray-500 shrink-0" aria-hidden />
            {t('quickBuilder', 'stepFootprint')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { type: 'rectangle' as ShapeType, label: t('quickBuilder', 'rectangle'), icon: Square },
              { type: 'l-shape' as ShapeType, label: t('quickBuilder', 'lShape'), icon: CornerDownRight },
              { type: 'custom' as ShapeType, label: t('quickBuilder', 'custom'), icon: Pentagon },
            ].map((s) => (
              <button
                key={s.type}
                type="button"
                onClick={() => setShapeType(s.type)}
                className={`p-4 rounded-xl border-2 text-center transition-all ${
                  shapeType === s.type
                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                <s.icon className="h-8 w-8 mx-auto mb-2" />
                <span className="text-sm font-medium">{s.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* One row per edge: length, XY, CF, width override, stairs (no duplicate length block) */}
        <section aria-labelledby="qb-section-edges">
          <h3 id="qb-section-edges" className={sectionTitleClass}>
            <LayoutList className="h-5 w-5 text-gray-500 shrink-0" aria-hidden />
            {t('quickBuilder', 'stepEdges')}
          </h3>
          {shapeType === 'l-shape' && (
            <p className="text-sm text-gray-500 mb-3">{t('quickBuilder', 'lShapeHint')}</p>
          )}
          {shapeType === 'custom' && (
            <p className="text-sm text-gray-500 mb-3">{t('quickBuilder', 'customHint')}</p>
          )}

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-600">
                  <th className="py-2 px-2 whitespace-nowrap">{t('quickBuilder', 'edgeSideColumn')}</th>
                  <th className="py-2 px-2 whitespace-nowrap">{t('quickBuilder', 'edgeLengthMm')}</th>
                  <th className="py-2 px-2 whitespace-nowrap">{t('scaffoldExtra', 'edgeXYRun') || 'XY'}</th>
                  <th className="py-2 px-2 whitespace-nowrap">{t('quickBuilder', 'planRunMm')}</th>
                  <th className="py-2 px-2 whitespace-nowrap">CF</th>
                  <th className="py-2 px-2 whitespace-nowrap">{t('quickBuilder', 'scaffoldWidth')}</th>
                  <th className="py-2 px-2 whitespace-nowrap">{t('quickBuilder', 'stairAccess')}</th>
                  {shapeType === 'custom' ? <th className="py-2 px-2 w-10" aria-label="Remove" /> : null}
                </tr>
              </thead>
              <tbody>
                {sidesList.map((side, i) => {
                  const closed = previewFootprintMm.length >= 3;
                  const inferred = inferEdgePlanAxisFromVertices(previewFootprintMm, i, closed);
                  const plan =
                    edgePlanByLabel[side.label] ??
                    inferred ?? { axis: 'X' as const, mm: 0 };
                  const cfVal = normalizeScaffoldWallCfKey(cfNoteByLabel[side.label]);
                  return (
                    <tr key={`${side.label}-${i}`} className="border-b border-gray-100 last:border-0 align-middle">
                      <td className="py-2 px-2 font-medium text-gray-800 whitespace-nowrap">{side.label}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={side.lengthMm > 0 ? Math.round(mmToM(side.lengthMm) * 10000) / 10000 : ''}
                            onChange={(e) => {
                              const m = parseFloat(e.target.value);
                              updateEdgeLengthAtIndex(i, Number.isFinite(m) ? mToMm(m) : 0);
                            }}
                            className="w-24 rounded border border-gray-300 px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500"
                            min={0.6}
                            step={0.01}
                          />
                          <span className="text-xs text-gray-500">{mUnit}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={plan.axis}
                          onChange={(e) =>
                            updateEdgePlanAxisForRow(side.label, i, e.target.value as 'X' | 'Y')
                          }
                          className="w-[4.5rem] rounded border border-gray-300 px-1.5 py-1 text-xs bg-white"
                        >
                          <option value="X">X</option>
                          <option value="Y">Y</option>
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={Math.round(mmToM(plan.mm) * 10000) / 10000}
                            onChange={(e) => {
                              const m = parseFloat(e.target.value);
                              updateEdgePlanMmForRow(side.label, Number.isFinite(m) ? mToMm(m) : 0);
                            }}
                            className="w-24 rounded border border-gray-300 px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500"
                            step={0.01}
                          />
                          <span className="text-xs text-gray-500">{mUnit}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={cfVal}
                          onChange={(e) =>
                            updateCfNoteForRow(side.label, normalizeScaffoldWallCfKey(e.target.value))
                          }
                          className="w-[5.5rem] rounded border border-gray-300 px-1.5 py-1 text-xs bg-white"
                        >
                          {SCAFFOLD_WALL_CF_KEYS.map((cfKey) => (
                            <option key={cfKey} value={cfKey}>
                              {t('scaffoldExtra', CF_LABEL_I18N_KEYS[cfKey]) || cfKey}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={scaffoldWidthPerSide[side.label] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setScaffoldWidthPerSide((prev) => ({
                              ...prev,
                              [side.label]: v ? normalizeScaffoldWidthMmToCatalog(Number(v)) : undefined,
                            }));
                          }}
                          className="w-[4.75rem] rounded border border-gray-300 px-1.5 py-1 text-xs bg-white"
                        >
                          <option value="">{formatMmAsMetersLabel(scaffoldWidthMm)}</option>
                          {[...SCAFFOLD_WIDTH_CATALOG_MM].filter((w) => w !== scaffoldWidthMm).map((w) => (
                            <option key={w} value={w}>
                              {formatMmAsMetersLabel(w)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <label
                            className="flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            title={t('quickBuilder', 'stairAccess')}
                          >
                            <input
                              type="checkbox"
                              checked={kaidanPerSide[side.label]?.enabled || false}
                              onChange={() => toggleKaidan(side.label)}
                              className="h-3.5 w-3.5 text-blue-600 rounded"
                              aria-label={t('quickBuilder', 'stairAccess')}
                            />
                          </label>
                          {kaidanPerSide[side.label]?.enabled ? (
                            <select
                              value={kaidanPerSide[side.label]?.count || 1}
                              onChange={(e) => updateKaidanCount(side.label, Number(e.target.value))}
                              className="rounded border border-gray-300 px-1 py-0.5 text-xs bg-white"
                            >
                              {[1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </td>
                      {shapeType === 'custom' ? (
                        <td className="py-2 px-2">
                          {customSegments.length > 3 ? (
                            <button
                              type="button"
                              onClick={() => removeCustomSegment(i)}
                              className="p-1 text-red-400 hover:text-red-600"
                              aria-label="Remove segment"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {shapeType === 'custom' && (
            <button
              type="button"
              onClick={addCustomSegment}
              className="mt-3 flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-2 rounded-lg border border-dashed border-blue-300 hover:bg-blue-50"
            >
              <Plus className="h-4 w-4" />
              {t('quickBuilder', 'addSegment')}
            </button>
          )}
        </section>

        {/* Building height */}
        <section aria-labelledby="qb-section-height">
          <h3 id="qb-section-height" className={sectionTitleClass}>
            <Building2 className="h-5 w-5 text-gray-500 shrink-0" aria-hidden />
            {t('quickBuilder', 'stepHeight')}
          </h3>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickBuilder', 'buildingHeight')}</label>
            <div className="flex items-center gap-2 max-w-xs">
              <input
                type="number"
                value={buildingHeightMm >= 1000 ? Math.round(mmToM(buildingHeightMm) * 10000) / 10000 : ''}
                onChange={(e) => {
                  const m = parseFloat(e.target.value);
                  setBuildingHeightMm(Number.isFinite(m) ? Math.max(1000, mToMm(m)) : 1000);
                }}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                min={1}
                step={0.01}
                placeholder={t('scaffoldExtra', 'heightPlaceholderM') || '9.9'}
              />
              <span className="text-sm text-gray-500 shrink-0">{mUnit}</span>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-xs font-medium text-blue-800 mb-2">{t('quickBuilder', 'floorPresets')}</p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '1F (3.9 m)', value: 3900 },
                { label: '2F (6.9 m)', value: 6900 },
                { label: '3F (9.9 m)', value: 9900 },
                { label: '4F (12.9 m)', value: 12900 },
                { label: '5F (15.9 m)', value: 15900 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setBuildingHeightMm(p.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    buildingHeightMm === p.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white border-blue-300 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">{t('quickBuilder', 'calculatedLevels')}:</span>
              <span className="text-lg font-bold text-gray-900">
                {calculatedLevels} {t('quickBuilder', 'levelsUnit')}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('quickBuilder', 'levelHeightNote')}</p>
          </div>
        </section>

        {/* Scaffold configuration */}
        <section aria-labelledby="qb-section-config">
          <h3 id="qb-section-config" className={sectionTitleClass}>
            <Ruler className="h-5 w-5 text-gray-500 shrink-0" aria-hidden />
            {t('quickBuilder', 'stepConfig')}
          </h3>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('quickBuilder', 'scaffoldType')}</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setScaffoldType('kusabi')}
                className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                  scaffoldType === 'kusabi'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <div>{t('quickBuilder', 'kusabiLabel')}</div>
              </button>
              <button
                type="button"
                onClick={() => setScaffoldType('wakugumi')}
                className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                  scaffoldType === 'wakugumi'
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <div>{t('quickBuilder', 'wakugumiLabel')}</div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              {/* Scaffold Width */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickBuilder', 'scaffoldWidth')}</label>
                <select
                  value={scaffoldWidthMm}
                  onChange={(e) => setScaffoldWidthMm(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value={610}>{formatMmAsMetersLabel(610)}</option>
                  <option value={914}>{formatMmAsMetersLabel(914)}</option>
                  <option value={1219}>{formatMmAsMetersLabel(1219)}</option>
                </select>
              </div>

              {/* Structure Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickBuilder', 'structurePattern')}</label>
                <select
                  value={structureType}
                  onChange={(e) => setStructureType(e.target.value as typeof structureType)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="改修工事">改修工事 (1.25x)</option>
                  <option value="S造">S造 (1.0x)</option>
                  <option value="RC造">RC造 (0.9x)</option>
                </select>
              </div>

              {/* Kusabi-specific */}
              {scaffoldType === 'kusabi' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickBuilder', 'postSize')}</label>
                    <select
                      value={preferredMainTatejiMm}
                      onChange={(e) => setPreferredMainTatejiMm(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={1800}>{formatMmAsMetersLabel(1800)}</option>
                      <option value={2700}>{formatMmAsMetersLabel(2700)}</option>
                      <option value={3600}>{formatMmAsMetersLabel(3600)}</option>
                    </select>
                  </div>
                </>
              )}

              {/* Wakugumi-specific */}
              {scaffoldType === 'wakugumi' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickBuilder', 'frameSize')}</label>
                    <p className="text-sm text-gray-800 mb-2">{formatMmAsMetersLabel(1700)} (FT-17)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickBuilder', 'wakugumiFrameSeries')}</label>
                    <select
                      value={wakugumiFrameSeries}
                      onChange={(e) => {
                        const s = e.target.value as 'FT617' | 'FT917' | 'FT1217';
                        setWakugumiFrameSeries(s);
                        const w = s === 'FT617' ? 610 : s === 'FT917' ? 914 : 1219;
                        setScaffoldWidthMm(w);
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="FT617">FT-617 — {formatMmAsMetersLabel(610)}</option>
                      <option value="FT917">FT-917 — {formatMmAsMetersLabel(914)}</option>
                      <option value="FT1217">FT-1217 — {formatMmAsMetersLabel(1219)}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickBuilder', 'habakiCount')}</label>
                    <select
                      value={habakiCountPerSpan}
                      onChange={(e) => setHabakiCountPerSpan(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={1}>{t('quickBuilder', 'habaki1')}</option>
                      <option value={2}>{t('quickBuilder', 'habaki2')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickBuilder', 'endStopperType')}</label>
                    <select
                      value={endStopperType}
                      onChange={(e) => setEndStopperType(e.target.value as 'nuno' | 'frame')}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="nuno">{t('quickBuilder', 'endStopperNuno')}</option>
                      <option value="frame">{t('quickBuilder', 'endStopperFrame')}</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            {/* Summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h4 className="text-sm font-semibold text-blue-800 mb-2">{t('quickBuilder', 'summaryTitle')}</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-blue-600">{t('quickBuilder', 'shapeLabel')}:</span>
                  <span className="ml-1 font-medium text-blue-900">
                    {shapeType === 'rectangle' ? t('quickBuilder', 'rectangle') : shapeType === 'l-shape' ? t('quickBuilder', 'lShape') : t('quickBuilder', 'custom')}
                  </span>
                </div>
                <div>
                  <span className="text-blue-600">{t('quickBuilder', 'heightLabel')}:</span>
                  <span className="ml-1 font-medium text-blue-900">{formatMmAsMetersLabel(buildingHeightMm)}</span>
                </div>
                <div>
                  <span className="text-blue-600">{t('quickBuilder', 'levelsLabel')}:</span>
                  <span className="ml-1 font-medium text-blue-900">{calculatedLevels}{t('quickBuilder', 'levelsUnit')}</span>
                </div>
                <div>
                  <span className="text-blue-600">{t('quickBuilder', 'sidesLabel')}:</span>
                  <span className="ml-1 font-medium text-blue-900">{sidesList.length}{t('quickBuilder', 'sidesUnit')}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-3 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isCalculating}
                className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-base shadow-lg disabled:opacity-50"
              >
                <Calculator className="h-5 w-5 shrink-0" />
                {t('quickBuilder', 'execute')}
                <ArrowRight className="h-5 w-5 shrink-0" />
              </button>
            </div>
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}
