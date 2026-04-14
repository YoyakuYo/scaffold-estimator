'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import type { WallCalculationResult } from '@/lib/api/scaffold-configs';
import { edgeChordName, normalizeEdgeHashiraForWallCount, resolveEdgeHashiraXY } from '@/lib/edge-hashira-labels';
import { ZoomIn, ZoomOut } from 'lucide-react';
import {
  COL,
  computeWallElevationData,
  renderWallElevationContent,
  type WallElevationComputed,
} from './scaffold-2d-elevation-draw';
import { SCAFFOLD_WIDTH_MEDIUM_MM } from '@/lib/scaffold-width-catalog';

const PAD_TOP = 44;
const PAD_BOTTOM = 72;
const PAD_LEFT = 56;
const SEPARATOR_PX = 5;
const TITLE_H = 22;

/** Single horizontal strip: all wall elevations scaled to fit one SVG “page”, separated by black rules. */
export default function Scaffold2DAllWallsOnePage({ result }: { result: any }) {
  const { locale, t } = useI18n();
  const numberLocale = locale === 'ja' ? 'ja-JP' : locale === 'fr' ? 'fr-FR' : 'en-US';
  const walls: WallCalculationResult[] = result?.walls ?? [];
  const [fitWidth, setFitWidth] = useState(1120);

  const scaffoldType: 'kusabi' | 'wakugumi' = (result.scaffoldType ??
    (result as any).scaffold_type ??
    'kusabi') as 'kusabi' | 'wakugumi';
  const isWakugumi = scaffoldType === 'wakugumi';
  const LEVEL_H = isWakugumi ? (result.frameSizeMm || 1700) : 1800;
  const topGuardMm = isWakugumi ? (result.frameSizeMm ?? 1700) : (result.topGuardHeightMm ?? 1800);
  const resultScaffoldWidthMm = result?.scaffoldWidthMm ?? SCAFFOLD_WIDTH_MEDIUM_MM;

  const closedFootprint =
    Array.isArray(result?.polygonVertices) && (result.polygonVertices as unknown[]).length >= 3;

  const primaryWallLabel = (wi: number, side: string) =>
    closedFootprint ? edgeChordName(wi, walls.length, true) : side;

  const allData = useMemo((): WallElevationComputed[] => {
    return walls.map((w) =>
      computeWallElevationData(w, {
        isWakugumi,
        levelH: LEVEL_H,
        topGuardMm,
        resultScaffoldWidthMm,
      }),
    );
  }, [walls, isWakugumi, LEVEL_H, topGuardMm, resultScaffoldWidthMm]);

  const postFootLabelsForWall = (wi: number, wd: WallElevationComputed): string[] | null => {
    const w = wd.wall;
    const n = wd.postXPositions.length;
    if (n < 1) return null;
    const xy = resolveEdgeHashiraXY(
      result?.edgeHashiraLabeling,
      wi,
      walls.length,
      w.sideJp ?? '',
      w.side ?? '',
    );
    const norm = normalizeEdgeHashiraForWallCount(result?.edgeHashiraLabeling ?? undefined, walls.length);
    const axis = norm.assignments[wi]?.axis === 'Y' ? 'Y' : 'X';
    if (xy.alongStations.length >= n) {
      return xy.alongStations.slice(0, n);
    }
    if (xy.alongStations.length > 0) {
      const m = xy.alongStations[0].match(/^([XY])/i);
      const ax = ((m ? m[1] : axis) as string).toUpperCase();
      return Array.from({ length: n }, (_, i) =>
        i < xy.alongStations.length ? xy.alongStations[i] : `${ax}${i + 1}`,
      );
    }
    return Array.from({ length: n }, (_, i) => `${axis}${i + 1}`);
  };

  const layout = useMemo(() => {
    if (walls.length === 0 || allData.length === 0) {
      return { svgW: 600, svgH: 200, scale: 0.04, maxH: 0, segments: [] as { wd: WallElevationComputed; wi: number; offsetPx: number }[] };
    }
    const maxH = Math.max(...allData.map((d) => d.totalHeightMm), 1);
    const sumLen = allData.reduce((s, d) => s + d.totalLengthMm, 0);
    const innerW = Math.max(320, fitWidth - PAD_LEFT - 24);
    const scale = innerW / (sumLen + SEPARATOR_PX * Math.max(0, walls.length - 1));
    let xCursor = PAD_LEFT;
    const segments: { wd: WallElevationComputed; wi: number; offsetPx: number }[] = [];
    allData.forEach((wd, wi) => {
      segments.push({ wd, wi, offsetPx: xCursor });
      xCursor += wd.totalLengthMm * scale + (wi < allData.length - 1 ? SEPARATOR_PX : 0);
    });
    const svgW = Math.ceil(xCursor + 24);
    const svgH = Math.ceil(maxH * scale + PAD_TOP + PAD_BOTTOM + TITLE_H);
    return { svgW, svgH, scale, maxH, segments };
  }, [allData, walls.length, fitWidth]);

  if (walls.length === 0) {
    return <div className="text-gray-500 p-4 text-sm">{t('result', 'noWallData')}</div>;
  }

  return (
    <div className="mt-8 border-t border-gray-200 pt-6 print:mt-4 print:pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{t('result', 'view2dOnePageTitle')}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t('result', 'view2dOnePageHint')}</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <span className="text-xs text-gray-500">{t('result', 'view2dOnePageWidth')}</span>
          <input
            type="range"
            min={720}
            max={1600}
            step={20}
            value={fitWidth}
            onChange={(e) => setFitWidth(Number(e.target.value))}
            className="w-36"
          />
          <button type="button" className="p-1 rounded hover:bg-gray-100" onClick={() => setFitWidth((w) => Math.max(720, w - 80))}>
            <ZoomOut className="h-4 w-4 text-gray-600" />
          </button>
          <button type="button" className="p-1 rounded hover:bg-gray-100" onClick={() => setFitWidth((w) => Math.min(1600, w + 80))}>
            <ZoomIn className="h-4 w-4 text-gray-600" />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white print:border-0">
        <svg
          width={layout.svgW}
          height={layout.svgH}
          viewBox={`0 0 ${layout.svgW} ${layout.svgH}`}
          xmlns="http://www.w3.org/2000/svg"
          className="block max-w-full h-auto"
          style={{ background: COL.bg }}
        >
          <text x={layout.svgW / 2} y={16} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#111827">
            {t('result', 'view2dOnePageSvgTitle')}
          </text>
          {layout.segments.map(({ wd, wi, offsetPx }, segIdx) => {
            const xFn = (mm: number) => offsetPx + mm * layout.scale;
            const yFn = (mm: number) => PAD_TOP + TITLE_H + (layout.maxH - mm) * layout.scale;
            const labels = postFootLabelsForWall(wi, wd);
            return (
              <g key={`seg-${wi}`}>
                {segIdx > 0 ? (
                  <line
                    x1={offsetPx - SEPARATOR_PX / 2}
                    y1={PAD_TOP + TITLE_H - 4}
                    x2={offsetPx - SEPARATOR_PX / 2}
                    y2={layout.svgH - PAD_BOTTOM + 8}
                    stroke="#000000"
                    strokeWidth={SEPARATOR_PX}
                  />
                ) : null}
                <text
                  x={offsetPx + (wd.totalLengthMm * layout.scale) / 2}
                  y={PAD_TOP + TITLE_H - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill="#334155"
                >
                  {primaryWallLabel(wi, wd.wall.side)}
                </text>
                {renderWallElevationContent(wd, xFn, yFn, {
                  isWakugumi,
                  levelH: LEVEL_H,
                  topGuardMm,
                  numberLocale,
                  scale: layout.scale,
                  keyPrefix: `op${wi}-`,
                  postFootLabels: labels,
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
