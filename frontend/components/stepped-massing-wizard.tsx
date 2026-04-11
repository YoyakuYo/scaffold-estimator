'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { AlertCircle, Layers, Loader2, Plus, ScanLine, Trash2, Upload } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { formatMmLabel } from '@/lib/dimension-meters';
import { zoomPanViewBox } from '@/lib/svg-view-box-zoom';
import { PreviewZoomToolbar } from '@/components/scaffold/preview-zoom-toolbar';
import {
  buildRectangularSetbackMassingTiers,
  type TaperAxis,
} from '@/lib/stepped-rectangular-massing';
import { visionBimApi, type VisionMassingTier } from '@/lib/api/vision-bim';
import { normalizeMassingTiersForPreview } from '@/lib/massing-tiers-preview-normalize';
import { Building3DPreview } from '@/components/scaffold/building-massing-3d-preview';
import { MmIntegerTextInput } from '@/components/inputs/meter-text-input';

const STEPPED_AI_FILE_ACCEPT =
  'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp,.dxf,.ifc,application/dxf,model/ifc,application/octet-stream';

function applySteppedMassingAiToState(
  result: Awaited<ReturnType<typeof visionBimApi.analyzeSteppedMassing>>,
  setDepthMm: (n: number) => void,
  setTaperAxis: (a: TaperAxis) => void,
  setTierLengthsMm: (a: number[]) => void,
  setTierHeightsMm: (a: number[]) => void,
  setTierDepthsMm: (a: number[]) => void,
) {
  const depth = Math.max(600, Math.round(Number(result.depthMm) || 0));
  const axis: TaperAxis =
    result.taperAxis === 'both' ? 'both' : result.taperAxis === 'y' ? 'y' : 'x';
  const rawL = result.tierLengthsMm ?? [];
  const rawH = result.tierHeightsMm ?? [];
  const count = Math.max(1, Math.min(40, Math.max(rawL.length, rawH.length)));
  const lengths: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i < count; i++) {
    const l = rawL[i];
    const h = rawH[i];
    const prevL = i > 0 ? lengths[i - 1]! : 20_000;
    const prevH = i > 0 ? heights[i - 1]! : 3000;
    const lr = typeof l === 'number' && Number.isFinite(l) ? l : prevL;
    const hr = typeof h === 'number' && Number.isFinite(h) ? h : prevH;
    lengths.push(Math.max(600, Math.round(lr)));
    heights.push(Math.max(1000, Math.round(hr)));
  }
  setDepthMm(depth);
  setTaperAxis(axis);
  setTierLengthsMm(lengths);
  setTierHeightsMm(heights);
  if (axis === 'both' && Array.isArray(result.tierDepthsMm) && result.tierDepthsMm.length > 0) {
    const tdRaw = result.tierDepthsMm.map((x) => Math.max(600, Math.round(Number(x) || 0)));
    const td = lengths.map((_, i) => tdRaw[i] ?? tdRaw[tdRaw.length - 1] ?? depth);
    setTierDepthsMm(td);
  } else if (axis === 'both') {
    const firstL = lengths[0] ?? 20_000;
    setTierDepthsMm(
      lengths.map((L) => Math.max(600, Math.round(depth * Math.min(1, L / Math.max(firstL, 1))))),
    );
  } else {
    setTierDepthsMm(lengths.map(() => depth));
  }
}

export type SteppedMassingWizardSubmitPayload = {
  massingTiers: VisionMassingTier[];
  buildingHeightMm: number;
  /** Ground footprint vertices (mm), first tier — for wall injection. */
  groundVerticesMm: Array<{ x: number; y: number }>;
  taperAxis: TaperAxis;
};

function tierPreviewBounds(tiers: VisionMassingTier[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const pts: Array<{ x: number; y: number }> = [];
  for (const t of tiers) {
    for (const v of t.vertices as Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>) {
      const x = typeof v.xFrac === 'number' ? v.xFrac : (v.x ?? 0);
      const y = typeof v.yFrac === 'number' ? v.yFrac : (v.y ?? 0);
      pts.push({ x, y });
    }
  }
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** Exported for AI extraction confirm screen (nested tier footprints). */
export function SteppedMassingPlanSvg({
  tiers,
  className,
  viewZoom,
  viewPan,
}: {
  tiers: VisionMassingTier[];
  className?: string;
  viewZoom: number;
  viewPan: { x: number; y: number };
}) {
  if (tiers.length === 0) return <div className={className} />;
  const b = tierPreviewBounds(tiers);
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  const pad = span * 0.08;
  const nx = (x: number) => (x - b.minX + pad) / (span + pad * 2);
  const ny = (y: number) => (y - b.minY + pad) / (span + pad * 2);
  const sorted = [...tiers].sort((a, b) => (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0));
  const baseVb = { x: -0.05, y: -0.05, w: 1.1, h: 1.1 };
  const vb = zoomPanViewBox(baseVb, viewZoom, viewPan);
  const palette = ['#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5'];
  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      {sorted.map((tier, idx) => {
        const verts = tier.vertices as Array<{ x?: number; y?: number }>;
        if (verts.length < 3) return null;
        const pts = verts.map((v) => `${nx(v.x ?? 0)},${ny(v.y ?? 0)}`).join(' ');
        const fill = palette[idx % palette.length];
        return (
          <polygon
            key={`tier-${idx}-${tier.baseHeightMm}-${tier.topHeightMm}`}
            points={pts}
            fill={fill}
            fillOpacity={0.35 + idx * 0.08}
            stroke="#312e81"
            strokeWidth={0.012}
          />
        );
      })}
    </svg>
  );
}

/** Depth + taper + total height (right column in wizard, or stacked in AI review). */
export function SteppedMassingTierPlanSettings({
  depthMm,
  onDepthMmChange,
  taperAxis,
  onTaperAxisChange,
  totalHeightMm,
  radioName = 'taper-wizard',
}: {
  depthMm: number;
  onDepthMmChange: (mm: number) => void;
  taperAxis: TaperAxis;
  onTaperAxisChange: (a: TaperAxis) => void;
  totalHeightMm: number;
  /** Unique group name when multiple instances on one page */
  radioName?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {taperAxis === 'both' ? (
        <p className="text-xs text-gray-600">{t('scaffold', 'steppedMassingDualAxisDepthHint')}</p>
      ) : (
        <label className="block text-sm font-medium text-gray-700">
          {t('scaffold', 'steppedMassingDepthMm')}
          <MmIntegerTextInput
            valueMm={depthMm}
            onCommitMm={(mm) => onDepthMmChange(mm)}
            minMm={600}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      )}
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="sr-only">{t('scaffold', 'steppedMassingTaperAxis')}</legend>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={radioName}
            checked={taperAxis === 'x'}
            onChange={() => onTaperAxisChange('x')}
          />
          {t('scaffold', 'steppedMassingTaperAlongX')}
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={radioName}
            checked={taperAxis === 'y'}
            onChange={() => onTaperAxisChange('y')}
          />
          {t('scaffold', 'steppedMassingTaperAlongY')}
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={radioName}
            checked={taperAxis === 'both'}
            onChange={() => onTaperAxisChange('both')}
          />
          {t('scaffold', 'steppedMassingTaperBoth')}
        </label>
      </fieldset>
      <p className="text-xs text-gray-500">
        {t('scaffold', 'steppedMassingBuildingHeight')}: {formatMmLabel(totalHeightMm)}
      </p>
    </div>
  );
}

/** Tier length/height table + add tier (full width below wizard grid, or in AI column). */
export function SteppedMassingTierTable({
  tierLengthsMm,
  tierHeightsMm,
  onTierLengthChange,
  onTierHeightChange,
  onAddTier,
  onRemoveTier,
  compactTopMargin,
  taperAxis = 'x',
  tierDepthsMm,
  onTierDepthChange,
}: {
  tierLengthsMm: number[];
  tierHeightsMm: number[];
  onTierLengthChange: (idx: number, mm: number) => void;
  onTierHeightChange: (idx: number, mm: number) => void;
  onAddTier: () => void;
  onRemoveTier: (idx: number) => void;
  compactTopMargin?: boolean;
  taperAxis?: TaperAxis;
  tierDepthsMm?: number[];
  onTierDepthChange?: (idx: number, mm: number) => void;
}) {
  const { t } = useI18n();
  const dual = taperAxis === 'both';
  return (
    <div className={compactTopMargin ? 'mt-4 overflow-x-auto' : 'mt-6 overflow-x-auto'}>
      <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-indigo-50 text-left text-xs font-semibold text-indigo-900">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">{t('scaffold', 'steppedMassingTierLengthMm')}</th>
            {dual && (
              <th className="px-3 py-2">{t('scaffold', 'steppedMassingTierDepthMm')}</th>
            )}
            <th className="px-3 py-2">{t('scaffold', 'steppedMassingTierHeightMm')}</th>
            <th className="px-3 py-2 w-24">{t('scaffold', 'steppedMassingTierRemove')}</th>
          </tr>
        </thead>
        <tbody>
          {tierLengthsMm.map((len, idx) => (
            <tr key={idx} className="border-t border-gray-100 bg-white">
              <td className="px-3 py-2 text-gray-600">{idx + 1}</td>
              <td className="px-3 py-2">
                <MmIntegerTextInput
                  valueMm={len}
                  onCommitMm={(mm) => onTierLengthChange(idx, mm)}
                  minMm={600}
                  className="w-full max-w-[140px] rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </td>
              {dual && (
                <td className="px-3 py-2">
                  <MmIntegerTextInput
                    valueMm={tierDepthsMm?.[idx] ?? 600}
                    onCommitMm={(mm) => onTierDepthChange?.(idx, mm)}
                    minMm={600}
                    className="w-full max-w-[140px] rounded border border-gray-300 px-2 py-1 text-xs"
                  />
                </td>
              )}
              <td className="px-3 py-2">
                <MmIntegerTextInput
                  valueMm={tierHeightsMm[idx] ?? 3000}
                  onCommitMm={(mm) => onTierHeightChange(idx, mm)}
                  minMm={1000}
                  className="w-full max-w-[140px] rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onRemoveTier(idx)}
                  disabled={tierLengthsMm.length <= 1}
                  className="p-1 rounded text-red-600 hover:bg-red-50 disabled:opacity-30"
                  aria-label="remove tier"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={onAddTier}
        className="mt-2 inline-flex items-center gap-1 text-sm text-indigo-600 font-medium hover:underline"
      >
        <Plus className="h-4 w-4" />
        {t('scaffold', 'steppedMassingAddTier')}
      </button>
    </div>
  );
}

export function SteppedMassingWizard({
  onSubmit,
  isCalculating,
  canUseAi = false,
}: {
  onSubmit: (payload: SteppedMassingWizardSubmitPayload) => void;
  isCalculating?: boolean;
  /** Premium AI extraction: suggest tier table from a raster elevation / 3D render. */
  canUseAi?: boolean;
}) {
  const { t } = useI18n();
  const [depthMm, setDepthMm] = useState(14_000);
  const [taperAxis, setTaperAxis] = useState<TaperAxis>('x');
  /** Default: single rectangular tier (no wedding-cake stack); add tiers only when needed. */
  const [tierLengthsMm, setTierLengthsMm] = useState<number[]>([20_000]);
  const [tierHeightsMm, setTierHeightsMm] = useState<number[]>([9000]);
  const [tierDepthsMm, setTierDepthsMm] = useState<number[]>(() => [14_000]);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [steppedAiLoading, setSteppedAiLoading] = useState(false);
  const [steppedAiError, setSteppedAiError] = useState<string | null>(null);
  const [steppedAiWarnings, setSteppedAiWarnings] = useState<string[] | null>(null);

  useEffect(() => {
    if (taperAxis !== 'both') return;
    if (tierDepthsMm.length === tierLengthsMm.length) return;
    const firstL = tierLengthsMm[0] ?? 20_000;
    setTierDepthsMm(
      tierLengthsMm.map((L) =>
        Math.max(600, Math.round(depthMm * Math.min(1, L / Math.max(firstL, 1)))),
      ),
    );
  }, [taperAxis, tierLengthsMm, depthMm, tierDepthsMm.length]);

  const massingTiers = useMemo(() => {
    try {
      return buildRectangularSetbackMassingTiers({
        depthMm,
        tierLengthsMm,
        tierHeightsMm,
        taperAxis,
        ...(taperAxis === 'both' ? { tierDepthsMm } : {}),
      });
    } catch {
      return [];
    }
  }, [depthMm, tierLengthsMm, tierHeightsMm, taperAxis, tierDepthsMm]);

  const buildingHeightMm = useMemo(
    () => tierHeightsMm.reduce((s, h) => s + Math.max(0, h), 0),
    [tierHeightsMm],
  );

  /** Ground footprint in plan coords (mm in xFrac/yFrac fields — same as AI BIM / computeBimPreviewPlanToM). */
  const outlineFor3d = useMemo(() => {
    const t0 = massingTiers[0];
    if (!t0?.vertices?.length) return [] as Array<{ xFrac: number; yFrac: number }>;
    return (t0.vertices as Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>).map((v) => ({
      xFrac: v.xFrac ?? v.x ?? 0,
      yFrac: v.yFrac ?? v.y ?? 0,
    }));
  }, [massingTiers]);

  const massingTiersFor3d = useMemo(
    () => normalizeMassingTiersForPreview(outlineFor3d, massingTiers),
    [outlineFor3d, massingTiers],
  );

  const groundVerticesMm = useMemo(() => {
    const t0 = massingTiers[0];
    if (!t0?.vertices?.length) return [];
    return (t0.vertices as Array<{ x?: number; y?: number }>).map((v) => ({
      x: Math.round(v.x ?? 0),
      y: Math.round(v.y ?? 0),
    }));
  }, [massingTiers]);

  const addTier = useCallback(() => {
    const lastL = tierLengthsMm[tierLengthsMm.length - 1] ?? 10_000;
    const lastD = tierDepthsMm[tierDepthsMm.length - 1] ?? depthMm;
    setTierLengthsMm((prev) => [...prev, Math.max(600, Math.round(lastL * 0.95))]);
    setTierHeightsMm((prev) => [...prev, 3000]);
    setTierDepthsMm((prev) => [...prev, Math.max(600, Math.round(lastD * 0.95))]);
  }, [tierLengthsMm, tierDepthsMm, depthMm]);

  const removeTier = useCallback((idx: number) => {
    if (tierLengthsMm.length <= 1) return;
    setTierLengthsMm((prev) => prev.filter((_, i) => i !== idx));
    setTierHeightsMm((prev) => prev.filter((_, i) => i !== idx));
    setTierDepthsMm((prev) => prev.filter((_, i) => i !== idx));
  }, [tierLengthsMm.length]);

  const updateLength = (idx: number, v: number) => {
    setTierLengthsMm((prev) => {
      const next = [...prev];
      next[idx] = Math.max(600, Math.round(v));
      return next;
    });
  };

  const updateHeight = (idx: number, v: number) => {
    setTierHeightsMm((prev) => {
      const next = [...prev];
      next[idx] = Math.max(1000, Math.round(v));
      return next;
    });
  };

  const updateTierDepth = (idx: number, v: number) => {
    setTierDepthsMm((prev) => {
      const next = [...prev];
      next[idx] = Math.max(600, Math.round(v));
      return next;
    });
  };

  return (
    <div className="max-w-[1100px] mx-auto px-4 pb-8 space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
          <Layers className="h-6 w-6 text-indigo-600" />
          {t('scaffold', 'steppedMassingSectionTitle')}
        </h2>
        <p className="text-sm text-gray-600 mb-4">{t('scaffold', 'steppedMassingSectionHint')}</p>

        {canUseAi ? (
          <div className="mb-6 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
            <h3 className="text-sm font-semibold text-violet-900 flex items-center gap-2 mb-1">
              <ScanLine className="h-4 w-4" />
              {t('scaffold', 'steppedMassingAiTitle')}
            </h3>
            <p className="text-xs text-violet-800/90 mb-3">{t('scaffold', 'steppedMassingAiHint')}</p>
            <label className="flex flex-col sm:flex-row sm:items-center gap-3 cursor-pointer">
              <span className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-violet-300 bg-white text-violet-700 text-sm font-medium hover:bg-violet-50 transition-colors">
                <Upload className="h-4 w-4 shrink-0" />
                {t('scaffold', 'steppedMassingAiUpload')}
              </span>
              <input
                type="file"
                className="hidden"
                accept={STEPPED_AI_FILE_ACCEPT}
                disabled={steppedAiLoading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setSteppedAiError(null);
                  setSteppedAiWarnings(null);
                  setSteppedAiLoading(true);
                  try {
                    const data = await visionBimApi.analyzeSteppedMassing(file);
                    applySteppedMassingAiToState(
                      data,
                      setDepthMm,
                      setTaperAxis,
                      setTierLengthsMm,
                      setTierHeightsMm,
                      setTierDepthsMm,
                    );
                    setSteppedAiWarnings(
                      data.analysisWarnings?.length ? data.analysisWarnings : null,
                    );
                  } catch (err: unknown) {
                    const msg =
                      err && typeof err === 'object' && 'message' in err
                        ? String((err as { message?: string }).message)
                        : t('scaffold', 'steppedMassingAiError');
                    setSteppedAiError(msg);
                  } finally {
                    setSteppedAiLoading(false);
                    e.target.value = '';
                  }
                }}
              />
              {steppedAiLoading && (
                <span className="inline-flex items-center gap-2 text-sm text-violet-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('scaffold', 'steppedMassingAiAnalyzing')}
                </span>
              )}
            </label>
            {steppedAiError && (
              <div className="mt-2 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{steppedAiError}</span>
              </div>
            )}
            {steppedAiWarnings && steppedAiWarnings.length > 0 && (
              <div className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                <p className="font-semibold">{t('scaffold', 'steppedMassingAiWarningsTitle')}</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {steppedAiWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 max-w-2xl">
            {t('scaffold', 'steppedMassingAiPremiumHint')}
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            <span className="text-xs font-medium text-gray-700">{t('scaffold', 'steppedMassingPlanPreview')}</span>
            <div className="relative rounded-lg border border-gray-200 bg-slate-50 aspect-[4/3] max-h-[360px]">
              <SteppedMassingPlanSvg
                tiers={massingTiers}
                className="w-full h-full"
                viewZoom={viewZoom}
                viewPan={viewPan}
              />
              <div className="absolute top-2 right-2">
                <PreviewZoomToolbar
                  onZoomIn={() => setViewZoom((z) => Math.min(4, z * 1.2))}
                  onZoomOut={() => setViewZoom((z) => Math.max(0.5, z / 1.2))}
                  onReset={() => {
                    setViewZoom(1);
                    setViewPan({ x: 0, y: 0 });
                  }}
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-500">{t('scaffold', 'steppedMassingPlanPreviewHint')}</p>
          </div>

          <SteppedMassingTierPlanSettings
            depthMm={depthMm}
            onDepthMmChange={setDepthMm}
            taperAxis={taperAxis}
            onTaperAxisChange={(a) => {
              setTaperAxis(a);
              if (a === 'both') {
                const firstL = tierLengthsMm[0] ?? 20_000;
                setTierDepthsMm(
                  tierLengthsMm.map((L) =>
                    Math.max(600, Math.round(depthMm * Math.min(1, L / Math.max(firstL, 1)))),
                  ),
                );
              }
            }}
            totalHeightMm={buildingHeightMm}
          />
        </div>

        {outlineFor3d.length >= 3 && massingTiers.length > 0 && (
          <div className="mt-6 space-y-2">
            <span className="text-xs font-medium text-gray-700">{t('scaffold', 'steppedMassingPreview3d')}</span>
            <p className="text-[11px] text-gray-500">{t('scaffold', 'steppedMassingPreview3dHint')}</p>
            <Building3DPreview
              outline={outlineFor3d}
              buildingHeightMm={buildingHeightMm}
              massingTiers={massingTiersFor3d.length > 0 ? massingTiersFor3d : massingTiers}
              className="w-full rounded-lg border border-gray-200 bg-slate-50"
              style={{ minHeight: 280, height: 320 }}
            />
          </div>
        )}

        <SteppedMassingTierTable
          tierLengthsMm={tierLengthsMm}
          tierHeightsMm={tierHeightsMm}
          onTierLengthChange={updateLength}
          onTierHeightChange={updateHeight}
          onAddTier={addTier}
          onRemoveTier={removeTier}
          taperAxis={taperAxis}
          tierDepthsMm={tierDepthsMm}
          onTierDepthChange={updateTierDepth}
        />

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            disabled={isCalculating || massingTiers.length === 0 || groundVerticesMm.length < 3}
            onClick={() =>
              onSubmit({
                massingTiers,
                buildingHeightMm,
                groundVerticesMm,
                taperAxis,
              })
            }
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {t('scaffold', 'steppedMassingCalculate')}
          </button>
        </div>
      </div>
    </div>
  );
}
