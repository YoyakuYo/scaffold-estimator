'use client';

import { useState, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { WallCalculationResult, scaffoldConfigsApi } from '@/lib/api/scaffold-configs';
import { Printer, ZoomIn, ZoomOut, FileText, FileCode, ChevronLeft, ChevronRight } from 'lucide-react';

// ─── Constants ──────────────────────────────────────────────────
const LEVEL_H_KUSABI = 1800; // mm between levels (kusabi fixed)
const JACK_BASE_H = 300; // mm visual height for jack base
const SCALE_DEFAULT = 0.065; // px per mm — fits most screens
const POST_STROKE = 3.5;
const BRACE_STROKE = 2.2;
const TESURI_STROKE = 2;
const PLANK_H_PX = 7;
const HABAKI_H_PX = 5;
const DIMENSION_OFFSET = 28;

// ─── Colors ─────────────────────────────────────────────────────
const COL = {
  post: '#1f2937',
  brace: '#dc2626',
  tesuri: '#1e40af',
  shitasan: '#0891b2',  // wakugumi bottom horizontal
  plank: '#d97706',
  habaki: '#57534e',
  jackBase: '#4b5563',
  yokoji: '#15803d',
  stair: '#047857',
  dim: '#6b7280',
  dimText: '#374151',
  bg: '#ffffff',
  grid: '#f3f4f6',
  topGuard: '#6d28d9',
  frame: '#7c3aed',  // wakugumi frame color
};

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
  const { t } = useI18n();
  const params = useParams();
  const configId = params.configId as string;
  const walls: WallCalculationResult[] = result?.walls ?? [];
  const [scale, setScale] = useState(SCALE_DEFAULT);
  const [activeWallIdx, setActiveWallIdx] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (walls.length === 0) return <div className="text-gray-500 p-8">{t('result', 'noWallData')}</div>;

  const scaffoldType: 'kusabi' | 'wakugumi' = result.scaffoldType || 'kusabi';
  const isWakugumi = scaffoldType === 'wakugumi';
  const LEVEL_H = isWakugumi ? (result.frameSizeMm || 1700) : LEVEL_H_KUSABI;
  const topGuardMm = result.topGuardHeightMm ?? 900;
  const wall = walls[activeWallIdx] || walls[0];

  // ─── Performance: cap spans for very large walls ────────
  const MAX_2D_SPANS = 200; // SVG can handle more than 3D, but still cap for sanity
  const isSimplified2D = wall.spans.length > MAX_2D_SPANS;

  // ─── Calculate wall data ────────────────────────────────
  const wallData = useMemo(() => {
    const rawSpans = wall.spans;
    const spans = rawSpans.length > MAX_2D_SPANS ? rawSpans.slice(0, MAX_2D_SPANS) : rawSpans;
    const levels = wall.levelCalc.fullLevels;
    const totalLengthMm = spans.reduce((a: number, b: number) => a + b, 0);
    const totalHeightMm = levels * LEVEL_H + topGuardMm + JACK_BASE_H;

    const postXPositions: number[] = [0];
    let accum = 0;
    for (const span of spans) {
      accum += span;
      postXPositions.push(accum);
    }

    let stairPositions: number[] = [];
    if (wall.kaidanSpanIndices && wall.kaidanSpanIndices.length > 0) {
      stairPositions = wall.kaidanSpanIndices;
    } else {
      const count = wall.stairAccessCount || 0;
      if (count > 0 && spans.length > 0) {
        if (count === 1) {
          stairPositions = [Math.floor(spans.length / 2)];
        } else {
          const totalPositionsNeeded = 2 * count - 1;
          const startPos = Math.floor((spans.length - totalPositionsNeeded) / 2);
          const pos: number[] = [];
          for (let i = 0; i < count; i++) {
            const idx = startPos + i * 2;
            const clamped = Math.max(0, Math.min(spans.length - 1, idx));
            if (!pos.includes(clamped)) pos.push(clamped);
          }
          stairPositions = pos.sort((a, b) => a - b);
        }
      }
    }

    return { wall, spans, levels, totalLengthMm, totalHeightMm, postXPositions, stairPositions };
  }, [wall, topGuardMm]);

  // ─── SVG dimensions ─────────────────────────────────────
  const PAD_LEFT = 100;
  const PAD_RIGHT = 40;
  const PAD_TOP = 50;
  const PAD_BOTTOM = 80;

  const svgW = wallData.totalLengthMm * scale + PAD_LEFT + PAD_RIGHT;
  const svgH = wallData.totalHeightMm * scale + PAD_TOP + PAD_BOTTOM;

  const x = (mm: number) => PAD_LEFT + mm * scale;
  const y = (mm: number) => PAD_TOP + (wallData.totalHeightMm - mm) * scale;

  // ─── Render wall ────────────────────────────────────────
  const renderWall = () => {
    const { spans, levels, totalLengthMm, postXPositions, stairPositions } = wallData;
    const elements: JSX.Element[] = [];

    // Ground line
    elements.push(
      <line key="ground" x1={x(0) - 10} y1={y(0)} x2={x(totalLengthMm) + 10} y2={y(0)}
        stroke="#9ca3af" strokeWidth={2} strokeDasharray="6,3" />
    );

    // Jack Bases
    postXPositions.forEach((px, i) => {
      elements.push(
        <g key={`jb-${i}`}>
          <polygon
            points={`${x(px)},${y(0)} ${x(px) - 8},${y(0) + 12} ${x(px) + 8},${y(0) + 12}`}
            fill={COL.jackBase} stroke={COL.jackBase} strokeWidth={1}
          />
          <line x1={x(px)} y1={y(0)} x2={x(px)} y2={y(JACK_BASE_H)}
            stroke={COL.jackBase} strokeWidth={2} strokeDasharray="4,2" />
        </g>
      );
    });

    // Base Yokoji
    spans.forEach((span, si) => {
      const xStart = postXPositions[si];
      elements.push(
        <line key={`by-${si}`} x1={x(xStart)} y1={y(JACK_BASE_H)} x2={x(xStart + span)} y2={y(JACK_BASE_H)}
          stroke={COL.yokoji} strokeWidth={TESURI_STROKE} strokeDasharray="6,2" />
      );
    });

    // Per-Level Content
    Array.from({ length: levels }).forEach((_, lvl) => {
      const baseY = JACK_BASE_H + lvl * LEVEL_H;
      const topY = baseY + LEVEL_H;

      // Level label
      elements.push(
        <text key={`lvl-${lvl}`} x={x(0) - 15} y={y(topY) + 4}
          textAnchor="end" fontSize={10} fill={COL.dimText}>
          L{lvl + 1}
        </text>
      );

      // Posts
      postXPositions.forEach((px, pi) => {
        elements.push(
          <line key={`post-${lvl}-${pi}`} x1={x(px)} y1={y(baseY)} x2={x(px)} y2={y(topY)}
            stroke={COL.post} strokeWidth={POST_STROKE} />
        );
      });

      // Per span
      spans.forEach((span, si) => {
        const sx = postXPositions[si];
        const ex = postXPositions[si + 1];
        const isStairSpan = stairPositions.includes(si);

        if (isStairSpan) {
          // Stair
          elements.push(
            <line key={`stair-${lvl}-${si}`}
              x1={x(sx + span * 0.04)} y1={y(baseY)}
              x2={x(ex - span * 0.04)} y2={y(topY)}
              stroke={COL.stair} strokeWidth={2.5} />
          );
          Array.from({ length: 8 }).forEach((_, st) => {
            const t = (st + 1) / 9;
            const stepXmm = sx + span * 0.04 + (span * 0.92) * t;
            const stepYmm = baseY + LEVEL_H * t;
            const treadHalf = span * 0.07;
            elements.push(
              <line key={`step-${lvl}-${si}-${st}`}
                x1={x(stepXmm - treadHalf)} y1={y(stepYmm)}
                x2={x(stepXmm + treadHalf)} y2={y(stepYmm)}
                stroke={COL.stair} strokeWidth={1.8} />
            );
          });
          if (!isWakugumi) {
            // Kusabi: tesuri on stair spans
            elements.push(
              <line key={`tesuri-s1-${lvl}-${si}`}
                x1={x(sx)} y1={y(baseY + LEVEL_H * 0.45)}
                x2={x(ex)} y2={y(baseY + LEVEL_H * 0.45)}
                stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
              <line key={`tesuri-s2-${lvl}-${si}`}
                x1={x(sx)} y1={y(baseY + LEVEL_H * 0.9)}
                x2={x(ex)} y2={y(baseY + LEVEL_H * 0.9)}
                stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />
            );
          } else {
            // Wakugumi: shitasan (bottom horizontal) on stair spans
            elements.push(
              <line key={`shitasan-s-${lvl}-${si}`}
                x1={x(sx)} y1={y(baseY + 50)}
                x2={x(ex)} y2={y(baseY + 50)}
                stroke={COL.shitasan} strokeWidth={TESURI_STROKE} />
            );
          }
        } else {
          // Brace (X pattern)
          elements.push(
            <line key={`brace-1-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY)} x2={x(ex)} y2={y(topY)}
              stroke={COL.brace} strokeWidth={BRACE_STROKE} />,
            <line key={`brace-2-${lvl}-${si}`}
              x1={x(sx)} y1={y(topY)} x2={x(ex)} y2={y(baseY)}
              stroke={COL.brace} strokeWidth={BRACE_STROKE} />
          );

          if (isWakugumi) {
            // Wakugumi: 下桟 (Shitasan) — bottom horizontal only, no tesuri
            elements.push(
              <line key={`shitasan-${lvl}-${si}`}
                x1={x(sx)} y1={y(baseY + 50)}
                x2={x(ex)} y2={y(baseY + 50)}
                stroke={COL.shitasan} strokeWidth={TESURI_STROKE} />
            );
          } else {
            // Kusabi: Tesuri (inner face horizontal bars)
            elements.push(
              <line key={`tesuri-1-${lvl}-${si}`}
                x1={x(sx)} y1={y(baseY + LEVEL_H * 0.45)}
                x2={x(ex)} y2={y(baseY + LEVEL_H * 0.45)}
                stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
              <line key={`tesuri-2-${lvl}-${si}`}
                x1={x(sx)} y1={y(baseY + LEVEL_H * 0.9)}
                x2={x(ex)} y2={y(baseY + LEVEL_H * 0.9)}
                stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />
            );
          }

          // Plank
          elements.push(
            <rect key={`plank-${lvl}-${si}`}
              x={x(sx) + 2} y={y(topY) - PLANK_H_PX / 2}
              width={(ex - sx) * scale - 4} height={PLANK_H_PX}
              fill={COL.plank} opacity={0.7} rx={1} />
          );
          // Habaki
          elements.push(
            <line key={`habaki-${lvl}-${si}`}
              x1={x(sx) + 2} y1={y(topY) + PLANK_H_PX / 2 + 2}
              x2={x(ex) - 2} y2={y(topY) + PLANK_H_PX / 2 + 2}
              stroke={COL.habaki} strokeWidth={HABAKI_H_PX} opacity={0.5} />
          );
        }
      });

      // Width yokoji
      postXPositions.forEach((px, pi) => {
        elements.push(
          <line key={`wyk-${lvl}-${pi}`}
            x1={x(px) - 4} y1={y(topY)} x2={x(px) + 4} y2={y(topY)}
            stroke={COL.yokoji} strokeWidth={2.5} />
        );
      });
    });

    // Top Guard Posts
    postXPositions.forEach((px, pi) => {
      const guardBase = JACK_BASE_H + levels * LEVEL_H;
      const guardTop = guardBase + topGuardMm;
      elements.push(
        <line key={`tg-${pi}`}
          x1={x(px)} y1={y(guardBase)} x2={x(px)} y2={y(guardTop)}
          stroke={COL.topGuard} strokeWidth={POST_STROKE} strokeDasharray="5,3" />
      );
    });

    // Top guard horizontal rail
    spans.forEach((span, si) => {
      const guardTop = JACK_BASE_H + levels * LEVEL_H + topGuardMm;
      const sx = postXPositions[si];
      const ex = postXPositions[si + 1];
      elements.push(
        <line key={`tgr-${si}`}
          x1={x(sx)} y1={y(guardTop)} x2={x(ex)} y2={y(guardTop)}
          stroke={COL.topGuard} strokeWidth={TESURI_STROKE} />
      );
    });

    // Span dimension lines
    spans.forEach((span, si) => {
      const sx = postXPositions[si];
      const ex = postXPositions[si + 1];
      const dy = y(0) + DIMENSION_OFFSET + 12;
      elements.push(
        <g key={`dim-${si}`}>
          <line x1={x(sx)} y1={dy} x2={x(ex)} y2={dy} stroke={COL.dim} strokeWidth={0.8} />
          <line x1={x(sx)} y1={dy - 4} x2={x(sx)} y2={dy + 4} stroke={COL.dim} strokeWidth={0.8} />
          <line x1={x(ex)} y1={dy - 4} x2={x(ex)} y2={dy + 4} stroke={COL.dim} strokeWidth={0.8} />
          <text x={(x(sx) + x(ex)) / 2} y={dy - 5} textAnchor="middle" fontSize={9} fill={COL.dimText}>
            {span}
          </text>
        </g>
      );
    });

    // Total wall length dimension
    const dy = y(0) + DIMENSION_OFFSET + 32;
    elements.push(
      <g key="dim-total">
        <line x1={x(0)} y1={dy} x2={x(totalLengthMm)} y2={dy} stroke={COL.dim} strokeWidth={1} />
        <line x1={x(0)} y1={dy - 5} x2={x(0)} y2={dy + 5} stroke={COL.dim} strokeWidth={1} />
        <line x1={x(totalLengthMm)} y1={dy - 5} x2={x(totalLengthMm)} y2={dy + 5} stroke={COL.dim} strokeWidth={1} />
        <text x={(x(0) + x(totalLengthMm)) / 2} y={dy - 6} textAnchor="middle" fontSize={11} fontWeight="bold" fill={COL.dimText}>
          {totalLengthMm.toLocaleString()}mm
        </text>
      </g>
    );

    // Height dimension (left side)
    const hDx = PAD_LEFT - 45;
    elements.push(
      <g key="dim-height">
        <line x1={hDx} y1={y(0)} x2={hDx} y2={y(wallData.totalHeightMm)} stroke={COL.dim} strokeWidth={1} />
        <line x1={hDx - 5} y1={y(0)} x2={hDx + 5} y2={y(0)} stroke={COL.dim} strokeWidth={1} />
        <line x1={hDx - 5} y1={y(wallData.totalHeightMm)} x2={hDx + 5} y2={y(wallData.totalHeightMm)} stroke={COL.dim} strokeWidth={1} />
        <text x={hDx - 6} y={(y(0) + y(wallData.totalHeightMm)) / 2}
          textAnchor="middle" fontSize={10} fontWeight="bold" fill={COL.dimText}
          transform={`rotate(-90, ${hDx - 6}, ${(y(0) + y(wallData.totalHeightMm)) / 2})`}>
          {wallData.totalHeightMm.toLocaleString()}mm
        </text>
      </g>
    );

    return elements;
  };

  // ─── Print handler ─────────────────────────────────────
  const handlePrint = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html><head><title>${wall.sideJp} — 2D組立図</title>
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
      a.download = `scaffold_2d_${wall.side}_${configId.slice(0, 8)}.pdf`;
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

  const accentColor = WALL_ACCENT[activeWallIdx % WALL_ACCENT.length];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Wall selector tabs */}
      <div className="flex items-center gap-1 px-3 py-2 bg-gray-100 border-b border-gray-200 overflow-x-auto">
        <button
          onClick={() => setActiveWallIdx(i => Math.max(0, i - 1))}
          disabled={activeWallIdx === 0}
          className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 flex-shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {walls.map((w, i) => (
          <button
            key={w.side}
            onClick={() => setActiveWallIdx(i)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
              i === activeWallIdx
                ? 'text-white shadow-sm'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
            style={i === activeWallIdx ? { backgroundColor: WALL_ACCENT[i % WALL_ACCENT.length] } : undefined}
          >
            {w.sideJp} ({(w.wallLengthMm / 1000).toFixed(1)}m)
          </button>
        ))}
        <button
          onClick={() => setActiveWallIdx(i => Math.min(walls.length - 1, i + 1))}
          disabled={activeWallIdx === walls.length - 1}
          className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 flex-shrink-0"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
          {activeWallIdx + 1} / {walls.length}
        </span>
      </div>

      {/* Toolbar */}
      <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium text-gray-600">
            {t('result', 'view2dLabel')} — <span style={{ color: accentColor, fontWeight: 700 }}>{wall.sideJp}</span>
          </div>
          <span className="text-xs text-gray-400">
            {wall.wallLengthMm.toLocaleString()}mm × {wallData.levels}{t('result', 'levelsUnit')} · {wallData.spans.length} spans
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setScale(s => Math.min(s * 1.25, 0.2))} className="p-1.5 rounded hover:bg-gray-200" title="Zoom In">
            <ZoomIn className="h-4 w-4 text-gray-600" />
          </button>
          <button onClick={() => setScale(s => Math.max(s / 1.25, 0.02))} className="p-1.5 rounded hover:bg-gray-200" title="Zoom Out">
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
          <button onClick={handleExportCad} disabled={!!exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50">
            <FileCode className="h-4 w-4" /> {exporting === 'cad' ? '...' : 'DXF'}
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
            大規模足場のため、2D表示を簡略化しています（先頭{MAX_2D_SPANS}スパンのみ表示 / 全{wall.spans.length}スパン）。数量計算は全スパン分正確です。
          </span>
        </div>
      )}

      {/* SVG Canvas */}
      <div className="overflow-auto" style={{ maxHeight: '700px' }}>
        <svg
          ref={svgRef}
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          xmlns="http://www.w3.org/2000/svg"
          className="block"
          style={{ background: COL.bg, minWidth: svgW }}
        >
          {/* Title */}
          <text x={svgW / 2} y={20} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#111827">
            {isWakugumi ? '【枠組】' : '【くさび】'} {wall.sideJp} — {wall.wallLengthMm.toLocaleString()}mm × {wallData.levels}段
          </text>

          {renderWall()}

          {/* Legend */}
          <g transform={`translate(${PAD_LEFT}, ${svgH - 22})`}>
            {(isWakugumi ? [
              { color: COL.post, label: '建枠' },
              { color: COL.brace, label: 'ブレス' },
              { color: COL.shitasan, label: '下桟' },
              { color: COL.plank, label: '踏板' },
              { color: COL.habaki, label: '巾木' },
              { color: COL.yokoji, label: '根がらみ' },
              { color: COL.topGuard, label: '上部手摺' },
              { color: COL.jackBase, label: 'ジャッキ' },
              { color: COL.stair, label: '階段' },
            ] : [
              { color: COL.post, label: t('result', 'legendPost') || '支柱' },
              { color: COL.brace, label: t('result', 'legendBrace') || 'ブレス' },
              { color: COL.tesuri, label: t('result', 'legendTesuri') || '手摺' },
              { color: COL.plank, label: t('result', 'legendPlank') || '踏板' },
              { color: COL.habaki, label: t('result', 'legendHabaki') || '巾木' },
              { color: COL.yokoji, label: t('result', 'legendYokoji') || '根がらみ' },
              { color: COL.topGuard, label: t('result', 'legendTopGuard') || '上部手摺' },
              { color: COL.jackBase, label: t('result', 'legendJackBase') || 'ジャッキ' },
              { color: COL.stair, label: t('result', 'legendStair') || '階段' },
            ]).map((item, i) => (
              <g key={i} transform={`translate(${i * 90}, 0)`}>
                <rect x={0} y={-8} width={14} height={4} fill={item.color} rx={1} />
                <text x={18} y={-4} fontSize={9} fill={COL.dimText}>{item.label}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}
