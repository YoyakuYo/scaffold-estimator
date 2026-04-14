'use client';

import { useState, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { WallCalculationResult, scaffoldConfigsApi } from '@/lib/api/scaffold-configs';
import {
  edgeChordName,
  normalizeEdgeHashiraForWallCount,
  resolveEdgeHashiraXY,
} from '@/lib/edge-hashira-labels';
import { Printer, ZoomIn, ZoomOut, FileText, FileCode, ChevronLeft, ChevronRight, Layers, Camera } from 'lucide-react';
import {
  COL,
  computeWallElevationData,
  LEVEL_H_KUSABI,
  MAX_2D_SPANS,
  renderWallElevationContent,
  type WallElevationComputed,
} from './scaffold-2d-elevation-draw';
import { SCAFFOLD_WIDTH_MEDIUM_MM } from '@/lib/scaffold-width-catalog';

const SCALE_DEFAULT = 0.065; // px per mm — fits most screens

// Per-wall accent colors (cycle for many walls)
const WALL_ACCENT = [
  '#3b82f6', '#f59e0b', '#10b981', '#ec4899',
  '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16',
  '#f97316', '#6366f1',
];

interface Props {
  result: any;
}

export default function Scaffold2DView({ result }: Props) {
  const { locale, t } = useI18n();
  const numberLocale = locale === 'ja' ? 'ja-JP' : locale === 'fr' ? 'fr-FR' : 'en-US';
  const params = useParams();
  const configId = params.configId as string;
  const walls: WallCalculationResult[] = result?.walls ?? [];
  const [scale, setScale] = useState(SCALE_DEFAULT);
  const [activeWallIdx, setActiveWallIdx] = useState(0);
  const [showAllWalls, setShowAllWalls] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (walls.length === 0) return <div className="text-gray-500 p-8">{t('result', 'noWallData')}</div>;

  const scaffoldType: 'kusabi' | 'wakugumi' = (result.scaffoldType ??
    (result as any).scaffold_type ??
    'kusabi') as 'kusabi' | 'wakugumi';
  const isWakugumi = scaffoldType === 'wakugumi';
  const LEVEL_H = isWakugumi ? (result.frameSizeMm || 1700) : LEVEL_H_KUSABI;
  const topGuardMm = isWakugumi
    ? (result.frameSizeMm ?? 1700)
    : (result.topGuardHeightMm ?? 1800);
  const wall = walls[activeWallIdx] || walls[0];

  // ─── Direction / edge label (cardinal → i18n; edge-n → X/Y grid) — before computeWallData for primaryWallLabel ───
  const formatWallSideLabel = (side: string, includeArrow = true) => {
    const tierMatch = side.match(/-T(\d+)$/);
    const withoutTier = tierMatch ? side.slice(0, -tierMatch[0].length) : side;
    const base = withoutTier.toLowerCase();
    const tierSuffix = tierMatch ? ` (T${tierMatch[1]})` : '';
    const cardinalKeys = ['north', 'south', 'east', 'west'] as const;
    type Cardinal = (typeof cardinalKeys)[number];
    const arrows: Record<Cardinal, string> = {
      north: '↑',
      south: '↓',
      east: '→',
      west: '←',
    };
    if (cardinalKeys.includes(base as Cardinal)) {
      const key = base as Cardinal;
      const name = t('sides', key);
      return includeArrow ? `${arrows[key]} ${name}${tierSuffix}` : `${name}${tierSuffix}`;
    }
    if (base.startsWith('edge-')) {
      const edgeNum = parseInt(base.replace('edge-', ''), 10);
      if (!Number.isNaN(edgeNum)) {
        const axis = edgeNum % 2 === 0 ? 'X' : 'Y';
        const gridIdx = Math.floor(edgeNum / 2) + 1;
        return `${axis}${gridIdx}${tierSuffix}`;
      }
    }
    if (/^[xy]\d+$/.test(base)) {
      return `${withoutTier}${tierSuffix}`;
    }
    return `${side}`;
  };
  const getDirectionLabel = (side: string) => formatWallSideLabel(side, true);

  const closedFootprint =
    Array.isArray(result?.polygonVertices) && (result.polygonVertices as unknown[]).length >= 3;

  /** Closed polygon plan: AB, BC, … on 2D title; otherwise direction label. */
  const primaryWallLabel = (wi: number, side: string) =>
    closedFootprint ? edgeChordName(wi, walls.length, true) : getDirectionLabel(side);

  const isSimplified2D = !showAllWalls && wall.spans.length > MAX_2D_SPANS;

  const computeWallData = (w: WallCalculationResult): WallElevationComputed =>
    computeWallElevationData(w, {
      isWakugumi,
      levelH: LEVEL_H,
      topGuardMm,
      resultScaffoldWidthMm: result?.scaffoldWidthMm ?? SCAFFOLD_WIDTH_MEDIUM_MM,
    });

  /** One-line X/Y caption for titles (cross · along range), with post-count fallback along the elevation. */
  const buildHashiraCaption = (wi: number): string | null => {
    const w = walls[wi];
    if (!w) return null;
    const postN = (Array.isArray(w.spans) ? w.spans.length : 0) + 1;
    const xy = resolveEdgeHashiraXY(
      result?.edgeHashiraLabeling,
      wi,
      walls.length,
      w.sideJp ?? '',
      w.side ?? '',
    );
    const norm = normalizeEdgeHashiraForWallCount(result?.edgeHashiraLabeling ?? undefined, walls.length);
    const axis = norm.assignments[wi]?.axis === 'Y' ? 'Y' : 'X';
    const parts: string[] = [];
    if (xy.crossLabel) parts.push(xy.crossLabel);
    let along = xy.alongRange;
    if (!along && xy.alongStations.length > 0) {
      along = `${xy.alongStations[0]}–${xy.alongStations[xy.alongStations.length - 1]}`;
    }
    if (!along && postN >= 2) {
      along = `${axis}1–${axis}${postN}`;
    }
    if (along) parts.push(along);
    return parts.length ? parts.join(' · ') : null;
  };

  /** Labels under each post (X1… or Y1…) aligned with hashira axis / saved numbering. */
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

  const wallData = useMemo(() => computeWallData(wall), [wall, topGuardMm, result, isWakugumi, LEVEL_H]);

  const allWallsData = useMemo(() => {
    if (!showAllWalls) return [];
    return walls.map(w => computeWallData(w));
  }, [walls, showAllWalls, topGuardMm, result, isWakugumi, LEVEL_H]);

  // ─── SVG dimensions ─────────────────────────────────────
  const PAD_LEFT = 100;
  const PAD_RIGHT = 40;
  const PAD_TOP = 50;
  const PAD_BOTTOM = 80;
  const ALL_WALLS_GAP = 60;
  /** Banner height per wall in “all walls” mode (title + hashira line). */
  const ALL_WALLS_HEADER = 56;

  const singleSvgW = wallData.totalLengthMm * scale + PAD_LEFT + PAD_RIGHT;
  const singleSvgH = wallData.totalHeightMm * scale + PAD_TOP + PAD_BOTTOM;

  const allWallsSvgW = showAllWalls
    ? Math.max(...allWallsData.map(wd => wd.totalLengthMm * scale + PAD_LEFT + PAD_RIGHT), 600)
    : singleSvgW;
  const allWallsSvgH = showAllWalls
    ? allWallsData.reduce((sum, wd) => sum + wd.totalHeightMm * scale + PAD_TOP + PAD_BOTTOM + ALL_WALLS_GAP + ALL_WALLS_HEADER, 0)
    : singleSvgH;

  const svgW = showAllWalls ? allWallsSvgW : singleSvgW;
  const svgH = showAllWalls ? allWallsSvgH : singleSvgH;

  const x = (mm: number) => PAD_LEFT + mm * scale;
  const y = (mm: number) => PAD_TOP + (wallData.totalHeightMm - mm) * scale;

  const drawOptsBase = {
    isWakugumi,
    levelH: LEVEL_H,
    topGuardMm,
    numberLocale,
    scale,
  };

  const renderWallContent = (
    wd: WallElevationComputed,
    xFn: (mm: number) => number,
    yFn: (mm: number) => number,
    keyPrefix = '',
    postFootLabels: string[] | null = null,
  ) =>
    renderWallElevationContent(wd, xFn, yFn, {
      ...drawOptsBase,
      keyPrefix,
      postFootLabels,
    });

  // ─── Print handler ─────────────────────────────────────
  const handlePrint = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const docTitle = t('result', 'view2dLabel');
    const title = showAllWalls
      ? t('result', 'view2dPrintAllTpl').replace('{{n}}', String(walls.length)).replace('{{doc}}', docTitle)
      : `${primaryWallLabel(activeWallIdx, wall.side)} — ${docTitle}`;
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html><head><title>${title}</title>
        <style>
          body { margin: 0; display: flex; justify-content: center; align-items: flex-start; }
          img { max-width: 100%; height: auto; }
          @media print { body { margin: 0; } }
        </style>
        </head><body>
        <img src="${url}" onload="setTimeout(()=>{window.print();},300);" />
        </body></html>
      `);
      win.document.close();
    }
  };

  const handleExportPdf = async () => {
    if (!svgRef.current) return;
    setExporting('pdf');
    try {
      const svgContent = new XMLSerializer().serializeToString(svgRef.current);
      const blob = await scaffoldConfigsApi.export2DPdf(configId, svgContent);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = showAllWalls
        ? `scaffold_2d_all_walls_${configId.slice(0, 8)}.pdf`
        : `scaffold_2d_${wall.side}_${configId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(t('result', 'exportFailed') || 'Export failed');
      console.error('PDF export error:', error);
    } finally {
      setExporting(null);
    }
  };

  const handleExportCad = async () => {
    setExporting('cad');
    try {
      const blob = await scaffoldConfigsApi.export2DCad(configId, wall.side);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scaffold_2d_${wall.side}_${configId.slice(0, 8)}.dxf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(t('result', 'exportFailed') || 'Export failed');
      console.error('CAD export error:', error);
    } finally {
      setExporting(null);
    }
  };

  const handleScreenshot = () => {
    if (!svgRef.current) return;
    setExporting('png');
    try {
      const svgData = new XMLSerializer().serializeToString(svgRef.current);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const dpr = 2;
        canvas.width = img.naturalWidth * dpr;
        canvas.height = img.naturalHeight * dpr;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = showAllWalls
              ? `scaffold_2d_all_walls_${configId.slice(0, 8)}.png`
              : `scaffold_2d_${wall.side}_${configId.slice(0, 8)}.png`;
            a.click();
            URL.revokeObjectURL(url);
          }
          setExporting(null);
        }, 'image/png');
        URL.revokeObjectURL(svgUrl);
      };
      img.onerror = () => {
        alert(t('result', 'exportFailed') || 'Export failed');
        setExporting(null);
        URL.revokeObjectURL(svgUrl);
      };
      img.src = svgUrl;
    } catch (error) {
      alert(t('result', 'exportFailed') || 'Export failed');
      console.error('Screenshot error:', error);
      setExporting(null);
    }
  };

  const accentColor = WALL_ACCENT[activeWallIdx % WALL_ACCENT.length];
  const activeHashiraCaption = buildHashiraCaption(activeWallIdx);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden print:overflow-visible">
      {/* Wall selector tabs */}
      <div className="flex items-center gap-1 px-3 py-2 bg-gray-100 border-b border-gray-200 overflow-x-auto print:hidden">
        <button
          onClick={() => { setShowAllWalls(true); }}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
            showAllWalls
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          <Layers className="h-3.5 w-3.5 inline mr-1" />
          {t('result', 'view2dAllWallsTab')}
        </button>
        <span className="text-gray-300 mx-1">|</span>
        <button
          onClick={() => setActiveWallIdx(i => Math.max(0, i - 1))}
          disabled={activeWallIdx === 0 || showAllWalls}
          className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 flex-shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {walls.map((w, i) => (
          <button
            key={w.side}
            onClick={() => { setShowAllWalls(false); setActiveWallIdx(i); }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
              !showAllWalls && i === activeWallIdx
                ? 'text-white shadow-sm'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
            style={!showAllWalls && i === activeWallIdx ? { backgroundColor: WALL_ACCENT[i % WALL_ACCENT.length] } : undefined}
          >
            {primaryWallLabel(i, w.side)} ({(w.wallLengthMm / 1000).toFixed(1)}m)
          </button>
        ))}
        <button
          onClick={() => setActiveWallIdx(i => Math.min(walls.length - 1, i + 1))}
          disabled={activeWallIdx === walls.length - 1 || showAllWalls}
          className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 flex-shrink-0"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
          {showAllWalls
            ? t('result', 'view2dAllWallsCountTpl').replace('{{n}}', String(walls.length))
            : `${activeWallIdx + 1} / ${walls.length}`}
        </span>
      </div>

      {/* Toolbar */}
      <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium text-gray-600">
            {t('result', 'view2dLabel')} — {showAllWalls
              ? <span className="text-indigo-600 font-bold">
                {t('result', 'view2dAllWallsToolbarTpl').replace('{{n}}', String(walls.length))}
              </span>
              : <span style={{ color: accentColor, fontWeight: 700 }}>{primaryWallLabel(activeWallIdx, wall.side)}</span>
            }
          </div>
          {!showAllWalls && (
            <span className="text-xs text-gray-400">
              {wall.wallLengthMm.toLocaleString(numberLocale)}mm × {wallData.levels}{t('result', 'levelsUnit')} · {wallData.spans.length} {t('result', 'spansLabel')}
              {activeHashiraCaption ? (
                <span className="ml-2 font-mono text-slate-600">{activeHashiraCaption}</span>
              ) : null}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setScale(s => Math.min(s * 1.25, 0.2))} className="p-1.5 rounded hover:bg-gray-200" title={t('viewer', 'zoomIn')}>
            <ZoomIn className="h-4 w-4 text-gray-600" />
          </button>
          <button onClick={() => setScale(s => Math.max(s / 1.25, 0.02))} className="p-1.5 rounded hover:bg-gray-200" title={t('viewer', 'zoomOut')}>
            <ZoomOut className="h-4 w-4 text-gray-600" />
          </button>
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-200 transition-colors border border-gray-300">
            <Printer className="h-4 w-4" /> {t('result', 'print')}
          </button>
          <button onClick={handleExportPdf} disabled={exporting === 'pdf'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50">
            <FileText className="h-4 w-4" /> {exporting === 'pdf' ? '...' : 'PDF'}
          </button>
          <button onClick={handleExportCad} disabled={!!exporting || showAllWalls}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
            title={showAllWalls ? t('result', 'view2dDxfSingleWallTitle') : undefined}>
            <FileCode className="h-4 w-4" /> {exporting === 'cad' ? '...' : 'DXF'}
          </button>
          <button onClick={handleScreenshot} disabled={!!exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-800 text-white transition-colors disabled:opacity-50"
            title={t('result', 'view2dScreenshotTitle')}>
            <Camera className="h-4 w-4" /> {exporting === 'png' ? '...' : 'PNG'}
          </button>
        </div>
      </div>

      {/* Simplification warning */}
      {isSimplified2D && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs flex items-center gap-2">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            {t('result', 'view2dSimplifiedNoteTpl')
              .replace('{{max}}', String(MAX_2D_SPANS))
              .replace('{{total}}', String(wall.spans.length))}
          </span>
        </div>
      )}

      {/* SVG Canvas */}
      <div
        className={`print:!max-h-none print:overflow-visible ${showAllWalls ? 'max-h-none overflow-visible' : 'max-h-[700px] overflow-auto'}`}
      >
        <svg
          ref={svgRef}
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          xmlns="http://www.w3.org/2000/svg"
          className="block"
          style={{ background: COL.bg, minWidth: svgW }}
        >
          {showAllWalls ? (
            <>
              {(() => {
                const elements: JSX.Element[] = [];
                let offsetY = 0;
                allWallsData.forEach((wd, wi) => {
                  const wallH = wd.totalHeightMm * scale + PAD_TOP + PAD_BOTTOM;
                  const color = WALL_ACCENT[wi % WALL_ACCENT.length];
                  const edgeTitle = primaryWallLabel(wi, wd.wall.side);
                  const hashiraLine = buildHashiraCaption(wi);

                  // Direction banner
                  elements.push(
                    <g key={`banner-${wi}`} transform={`translate(0, ${offsetY})`}>
                      <rect x={0} y={0} width={svgW} height={ALL_WALLS_HEADER}
                        fill={color} opacity={0.12} />
                      <rect x={0} y={0} width={6} height={ALL_WALLS_HEADER}
                        fill={color} />
                      <text x={20} y={22}
                        fontSize={16} fontWeight="bold" fill={color}>
                        {edgeTitle}
                      </text>
                      {hashiraLine ? (
                        <text x={20} y={42} fontSize={11} fill="#475569" style={{ fontFamily: 'ui-monospace, monospace' }}>
                          {hashiraLine}
                        </text>
                      ) : null}
                      <text x={300} y={22}
                        fontSize={12} fill="#6b7280">
                        {t('result', 'view2dBannerMetaTpl')
                          .replace('{{len}}', wd.wall.wallLengthMm.toLocaleString(numberLocale))
                          .replace('{{lvls}}', String(wd.levels))
                          .replace('{{lvlUnit}}', t('result', 'levelsUnit'))
                          .replace('{{n}}', String(wd.spans.length))
                          .replace('{{spansLabel}}', t('result', 'spansLabel'))}
                      </text>
                      <text x={svgW - 20} y={22}
                        textAnchor="end" fontSize={11} fill="#9ca3af">
                        {t('result', 'view2dSvgSubtitleTpl')
                          .replace('{{type}}', isWakugumi ? t('result', 'scaffoldTypeWakugumiShort') : t('result', 'scaffoldTypeKusabiShort'))
                          .replace('{{i}}', String(wi + 1))
                          .replace('{{n}}', String(walls.length))}
                      </text>
                    </g>
                  );

                  // Wall content, offset below the banner
                  const wallOffsetY = offsetY + ALL_WALLS_HEADER;
                  const xFn = (mm: number) => PAD_LEFT + mm * scale;
                  const yFn = (mm: number) => wallOffsetY + PAD_TOP + (wd.totalHeightMm - mm) * scale;

                  elements.push(
                    <g key={`wall-${wi}`}>
                      {renderWallContent(wd, xFn, yFn, `w${wi}-`, postFootLabelsForWall(wi, wd))}
                    </g>
                  );

                  // Separator line
                  const sectionBottom = wallOffsetY + wallH;
                  if (wi < allWallsData.length - 1) {
                    elements.push(
                      <line key={`sep-${wi}`}
                        x1={10} y1={sectionBottom + ALL_WALLS_GAP / 2}
                        x2={svgW - 10} y2={sectionBottom + ALL_WALLS_GAP / 2}
                        stroke="#d1d5db" strokeWidth={1} strokeDasharray="8,4" />
                    );
                  }

                  offsetY = sectionBottom + ALL_WALLS_GAP;
                });
                return elements;
              })()}

              {/* Legend at the bottom */}
              <g transform={`translate(${PAD_LEFT}, ${svgH - 28})`}>
                {(isWakugumi ? [
                  { color: COL.post, label: t('result', 'legendFrame') },
                  { color: COL.brace, label: t('result', 'legendBrace') },
                  { color: COL.shitasan, label: t('result', 'legendShitasan') },
                  { color: COL.plank, label: t('result', 'legendPlank') },
                  { color: COL.habaki, label: t('result', 'legendHabaki') },
                  { color: COL.endStopper, label: t('result', 'legendStopper') },
                  { color: COL.topGuard, label: t('result', 'legendTopGuard') },
                  { color: COL.jackBase, label: t('result', 'legendJackBase') },
                  { color: COL.stair, label: t('result', 'legendStair') },
                ] : [
                  { color: COL.post, label: t('result', 'legendPost') || '支柱' },
                  { color: COL.brace, label: t('result', 'legendBrace') || 'ブレス' },
                  { color: COL.tesuri, label: t('result', 'legendTesuri') || '手摺' },
                  { color: COL.plank, label: t('result', 'legendPlank') || '踏板' },
                  { color: COL.habaki, label: t('result', 'legendHabaki') || '巾木' },
                  { color: COL.endStopper, label: t('result', 'legendKusabiEndHandrail') },
                  { color: COL.yokoji, label: t('result', 'legendYokoji') || '幅材 / 根がらみ' },
                  { color: COL.topGuard, label: t('result', 'legendTopGuard') || '上部手摺' },
                  { color: COL.jackBase, label: t('result', 'legendJackBase') || 'ジャッキ' },
                  { color: COL.stair, label: t('result', 'legendStair') || '階段' },
                ]).map((item, i) => (
                  <g key={i} transform={`translate(${i * 78}, 0)`}>
                    <rect x={0} y={-10} width={16} height={5} fill={item.color} rx={1} stroke="#e2e8f0" strokeWidth={0.5} />
                    <text x={20} y={-5} fontSize={10} fill={COL.dimText} fontWeight={500}>{item.label}</text>
                  </g>
                ))}
              </g>
            </>
          ) : (
            <>
              {/* Title */}
              <text x={svgW / 2} y={18} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#111827">
                {`【${isWakugumi ? t('result', 'scaffoldTypeWakugumiShort') : t('result', 'scaffoldTypeKusabiShort')}】 ${primaryWallLabel(activeWallIdx, wall.side)} — ${wall.wallLengthMm.toLocaleString(numberLocale)}mm × ${wallData.levels}${t('result', 'levelsUnit')}`}
              </text>
              {activeHashiraCaption ? (
                <text
                  x={svgW / 2}
                  y={34}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="#475569"
                  style={{ fontFamily: 'ui-monospace, monospace' }}
                >
                  {activeHashiraCaption}
                </text>
              ) : null}

              {renderWallContent(wallData, x, y, '', postFootLabelsForWall(activeWallIdx, wallData))}

              {/* Legend */}
              <g transform={`translate(${PAD_LEFT}, ${svgH - 28})`}>
                {(isWakugumi ? [
                  { color: COL.post, label: t('result', 'legendFrame') },
                  { color: COL.brace, label: t('result', 'legendBrace') },
                  { color: COL.shitasan, label: t('result', 'legendShitasan') },
                  { color: COL.plank, label: t('result', 'legendPlank') },
                  { color: COL.habaki, label: t('result', 'legendHabaki') },
                  { color: COL.endStopper, label: t('result', 'legendStopper') },
                  { color: COL.topGuard, label: t('result', 'legendTopGuard') },
                  { color: COL.jackBase, label: t('result', 'legendJackBase') },
                  { color: COL.stair, label: t('result', 'legendStair') },
                ] : [
                  { color: COL.post, label: t('result', 'legendPost') || '支柱' },
                  { color: COL.brace, label: t('result', 'legendBrace') || 'ブレス' },
                  { color: COL.tesuri, label: t('result', 'legendTesuri') || '手摺' },
                  { color: COL.plank, label: t('result', 'legendPlank') || '踏板' },
                  { color: COL.habaki, label: t('result', 'legendHabaki') || '巾木' },
                  { color: COL.endStopper, label: t('result', 'legendKusabiEndHandrail') },
                  { color: COL.yokoji, label: t('result', 'legendYokoji') || '幅材 / 根がらみ' },
                  { color: COL.topGuard, label: t('result', 'legendTopGuard') || '上部手摺' },
                  { color: COL.jackBase, label: t('result', 'legendJackBase') || 'ジャッキ' },
                  { color: COL.stair, label: t('result', 'legendStair') || '階段' },
                ]).map((item, i) => (
                  <g key={i} transform={`translate(${i * 78}, 0)`}>
                    <rect x={0} y={-10} width={16} height={5} fill={item.color} rx={1} stroke="#e2e8f0" strokeWidth={0.5} />
                    <text x={20} y={-5} fontSize={10} fill={COL.dimText} fontWeight={500}>{item.label}</text>
                  </g>
                ))}
              </g>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
