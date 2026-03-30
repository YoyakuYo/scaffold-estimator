'use client';

import { useState, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { WallCalculationResult, scaffoldConfigsApi } from '@/lib/api/scaffold-configs';
import { EdgeHashiraResultPanel } from '@/components/edge-hashira-result-panel';
import {
  edgeChordName,
  normalizeEdgeHashiraForWallCount,
  resolveEdgeHashiraXY,
} from '@/lib/edge-hashira-labels';
import { Printer, ZoomIn, ZoomOut, FileText, FileCode, ChevronLeft, ChevronRight, Layers, Camera } from 'lucide-react';

// ─── Constants ──────────────────────────────────────────────────
const LEVEL_H_KUSABI = 1800; // mm between levels (kusabi fixed)
const JACK_BASE_H = 300; // mm visual height for jack base
const SCALE_DEFAULT = 0.065; // px per mm — fits most screens
const POST_STROKE = 4;
const BRACE_STROKE = 2.8;
const TESURI_STROKE = 2.5;
const PLANK_H_PX = 8;
const HABAKI_H_PX = 6;
const DIMENSION_OFFSET = 28;
const FRAME_WIDTH_PX = 14;
const FRAME_SPLAY_PX = 5;
const FRAME_BOTTOM_RATIO = 0.194;

// ─── Colors (clean technical drawing for estimation/quotation) ────
const COL = {
  post: '#0f172a',      // 支柱 — dark, primary structure
  brace: '#b91c1c',     // ブレス — distinct red
  tesuri: '#1d4ed8',    // 手摺 — blue
  shitasan: '#0e7490',  // 下桟 — cyan (wakugumi)
  plank: '#b45309',     // 踏板 — amber
  habaki: '#44403c',    // 巾木 — dark brown
  jackBase: '#334155',  // ジャッキ — slate
  yokoji: '#15803d',    // 根がらみ — green
  stair: '#047857',     // 階段 — teal
  endStopper: '#7c3aed', // 端部 — purple (wakugumi)
  dim: '#64748b',
  dimText: '#1e293b',
  bg: '#ffffff',
  grid: '#f1f5f9',
  topGuard: '#6d28d9',  // 上部手摺 — violet
  frame: '#0f172a',     // 建枠 — same as post (remove emphasis)
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
  const { locale, t } = useI18n();
  const numberLocale = locale === 'ja' ? 'ja-JP' : locale === 'fr' ? 'fr-FR' : 'en-US';
  const params = useParams();
  const configId = params.configId as string;
  const walls: WallCalculationResult[] = result?.walls ?? [];
  const [scale, setScale] = useState(SCALE_DEFAULT);
  const [activeWallIdx, setActiveWallIdx] = useState(0);
  const [showAllWalls, setShowAllWalls] = useState(false);
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

  const MAX_2D_SPANS = 200;
  const isSimplified2D = !showAllWalls && wall.spans.length > MAX_2D_SPANS;

  // ─── Shared wall data computation ─────────────────────────
  const computeWallData = (w: WallCalculationResult) => {
    const rawSpans = w.spans;
    const spans = rawSpans.length > MAX_2D_SPANS ? rawSpans.slice(0, MAX_2D_SPANS) : rawSpans;
    const levels = w.levelCalc.fullLevels;
    const wakExtraFrame = isWakugumi;
    const levelsDraw = levels + (wakExtraFrame ? 1 : 0);
    const totalLengthMm = spans.reduce((a: number, b: number) => a + b, 0);
    const totalHeightMm = isWakugumi
      ? levelsDraw * LEVEL_H + JACK_BASE_H
      : levels * LEVEL_H + topGuardMm + JACK_BASE_H;

    const postXPositions: number[] = [0];
    let accum = 0;
    for (const span of spans) {
      accum += span;
      postXPositions.push(accum);
    }

    let stairPositions: number[] = [];
    if (w.kaidanSpanIndices && w.kaidanSpanIndices.length > 0) {
      stairPositions = w.kaidanSpanIndices;
    } else {
      const count = w.stairAccessCount || 0;
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

    const widthMm = w.scaffoldWidthMm ?? result?.scaffoldWidthMm ?? 900;
    const needsExtendedBay = w.needsExtendedBay ?? (widthMm <= 600 && (stairPositions.length > 0));

    return {
      wall: w,
      spans,
      levels,
      levelsDraw,
      totalLengthMm,
      totalHeightMm,
      postXPositions,
      stairPositions,
      needsExtendedBay,
    };
  };

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
  const postFootLabelsForWall = (wi: number, wd: ReturnType<typeof computeWallData>): string[] | null => {
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

  const wallData = useMemo(() => computeWallData(wall), [wall, topGuardMm, result]);

  const allWallsData = useMemo(() => {
    if (!showAllWalls) return [];
    return walls.map(w => computeWallData(w));
  }, [walls, showAllWalls, topGuardMm, result]);

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

  // ─── Render wall (parameterized for single and all-walls modes) ───
  const renderWallContent = (
    wd: ReturnType<typeof computeWallData>,
    xFn: (mm: number) => number,
    yFn: (mm: number) => number,
    keyPrefix = '',
    postFootLabels: string[] | null = null,
  ) => {
    const { spans, levels, levelsDraw, totalLengthMm, postXPositions, stairPositions, needsExtendedBay } = wd;
    const x = xFn;
    const y = yFn;
    const elements: JSX.Element[] = [];

    // Grid (subtle, for technical clarity)
    const gridStep = 1000;
    for (let gx = 0; gx <= totalLengthMm; gx += gridStep) {
      elements.push(
        <line key={`gv-${gx}`} x1={x(gx)} y1={y(0)} x2={x(gx)} y2={y(wd.totalHeightMm)}
          stroke={COL.grid} strokeWidth={0.5} />
      );
    }
    for (let gy = 0; gy <= wd.totalHeightMm; gy += gridStep) {
      elements.push(
        <line key={`gh-${gy}`} x1={x(0)} y1={y(gy)} x2={x(totalLengthMm)} y2={y(gy)}
          stroke={COL.grid} strokeWidth={0.5} />
      );
    }

    // Ground line
    elements.push(
      <line key="ground" x1={x(0) - 10} y1={y(0)} x2={x(totalLengthMm) + 10} y2={y(0)}
        stroke="#94a3b8" strokeWidth={2} strokeDasharray="6,3" />
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

    // Hashira station ids (X1… / Y1…) under posts, above span dimensions
    if (postFootLabels && postFootLabels.length === postXPositions.length) {
      postXPositions.forEach((px, pi) => {
        elements.push(
          <text
            key={`${keyPrefix}pfl-${pi}`}
            x={x(px)}
            y={y(0) + 12}
            textAnchor="middle"
            fontSize={9}
            fontWeight={600}
            fill={COL.dimText}
            style={{ fontFamily: 'ui-monospace, monospace' }}
          >
            {postFootLabels[pi]}
          </text>
        );
      });
    }

    // Base Yokoji
    spans.forEach((span, si) => {
      const xStart = postXPositions[si];
      elements.push(
        <line key={`by-${si}`} x1={x(xStart)} y1={y(JACK_BASE_H)} x2={x(xStart + span)} y2={y(JACK_BASE_H)}
          stroke={COL.yokoji} strokeWidth={TESURI_STROKE} strokeDasharray="6,2" />
      );
    });

    // Per-Level Content (枠組+上部: もう一段の建枠を levelsDraw で表現)
    Array.from({ length: levelsDraw }).forEach((_, lvl) => {
      const baseY = JACK_BASE_H + lvl * LEVEL_H;
      const topY = baseY + LEVEL_H;

      // Level label
      elements.push(
        <text key={`lvl-${lvl}`} x={x(0) - 15} y={y(topY) + 4}
          textAnchor="end" fontSize={10} fill={COL.dimText}>
          L{lvl + 1}
        </text>
      );

      // Posts / Frames
      postXPositions.forEach((px, pi) => {
        if (isWakugumi) {
          // Wakugumi: draw gate-shaped frame (門型) — two legs with a top crossbar
          const halfW = FRAME_WIDTH_PX / 2;
          const splay = FRAME_SPLAY_PX;
          const topLX = x(px) - halfW;
          const topRX = x(px) + halfW;
          const btmLX = x(px) - halfW - splay;
          const btmRX = x(px) + halfW + splay;
          elements.push(
            <g key={`frame-${lvl}-${pi}`}>
              {/* Left leg */}
              <line x1={topLX} y1={y(topY)} x2={btmLX} y2={y(baseY)}
                stroke={COL.frame} strokeWidth={POST_STROKE - 1} />
              {/* Right leg */}
              <line x1={topRX} y1={y(topY)} x2={btmRX} y2={y(baseY)}
                stroke={COL.frame} strokeWidth={POST_STROKE - 1} />
              {/* Top crossbar */}
              <line x1={topLX} y1={y(topY)} x2={topRX} y2={y(topY)}
                stroke={COL.frame} strokeWidth={POST_STROKE - 1} />
            </g>
          );
        } else {
          // Kusabi: single vertical post line
          elements.push(
            <line
              key={`post-${lvl}-${pi}`}
              x1={x(px)}
              y1={y(baseY)}
              x2={x(px)}
              y2={y(topY)}
              stroke={COL.post}
              strokeWidth={POST_STROKE}
            />
          );
        }
      });

      // Per span
      spans.forEach((span, si) => {
        const sx = postXPositions[si];
        const ex = postXPositions[si + 1];
        const isStairSpan = stairPositions.includes(si);

        if (isStairSpan && needsExtendedBay) {
          // 600mm extended bay: plank + brace + tesuri stay normal; stair is in a separate bay (shown as overlay indicator)
          // Normal brace
          elements.push(
            <line key={`brace-1-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY)} x2={x(ex)} y2={y(topY)}
              stroke={COL.brace} strokeWidth={BRACE_STROKE} />,
            <line key={`brace-2-${lvl}-${si}`}
              x1={x(sx)} y1={y(topY)} x2={x(ex)} y2={y(baseY)}
              stroke={COL.brace} strokeWidth={BRACE_STROKE} />
          );
          // Normal tesuri / shitasan
          if (!isWakugumi) {
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
          } else {
            elements.push(
              <line key={`shitasan-${lvl}-${si}`}
                x1={x(sx)} y1={y(baseY + 50)}
                x2={x(ex)} y2={y(baseY + 50)}
                stroke={COL.shitasan} strokeWidth={TESURI_STROKE} />
            );
          }
          // Normal plank (stays for extended bay)
          elements.push(
            <rect key={`plank-${lvl}-${si}`}
              x={x(sx) + 2} y={y(topY) - PLANK_H_PX / 2}
              width={(ex - sx) * scale - 4} height={PLANK_H_PX}
              fill={COL.plank} opacity={0.7} rx={1} />
          );
          elements.push(
            <line key={`habaki-${lvl}-${si}`}
              x1={x(sx) + 2} y1={y(topY) + PLANK_H_PX / 2 + 2}
              x2={x(ex) - 2} y2={y(topY) + PLANK_H_PX / 2 + 2}
              stroke={COL.habaki} strokeWidth={HABAKI_H_PX} opacity={0.5} />
          );
          // Extended bay stair indicator: dashed box with stair glyph overlaid
          const ebX = x(sx) + 1;
          const ebW = (ex - sx) * scale - 2;
          const ebY = y(topY) - 2;
          const ebH = (topY - baseY) * scale + 4;
          elements.push(
            <rect key={`ext-bay-${lvl}-${si}`}
              x={ebX} y={ebY}
              width={ebW} height={ebH}
              fill="none" stroke={COL.stair} strokeWidth={1.5}
              strokeDasharray="4,3" rx={2} />
          );
          // Small stair diagonal inside the dashed box
          elements.push(
            <line key={`ext-stair-${lvl}-${si}`}
              x1={ebX + ebW * 0.15} y1={ebY + ebH * 0.85}
              x2={ebX + ebW * 0.85} y2={ebY + ebH * 0.15}
              stroke={COL.stair} strokeWidth={2} opacity={0.6} />
          );
          // "EXT" label
          elements.push(
            <text key={`ext-label-${lvl}-${si}`}
              x={ebX + ebW / 2} y={ebY + ebH / 2 + 3}
              textAnchor="middle" fontSize={7} fontWeight="bold"
              fill={COL.stair} opacity={0.8}>EXT</text>
          );
          // Extra post ticks at 3 positions (O, P, Q): left, center, right
          const midXmm = (sx + ex) / 2;
          for (const epx of [sx, midXmm, ex]) {
            elements.push(
              <line key={`ext-post-${lvl}-${si}-${epx}`}
                x1={x(epx)} y1={ebY} x2={x(epx)} y2={ebY + ebH}
                stroke={COL.stair} strokeWidth={1} strokeDasharray="2,2" opacity={0.5} />
            );
          }
        } else if (isStairSpan) {
          // Normal stair (900/1200mm): stair replaces plank
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

    // Top Guard Posts / band（くさびのみ。枠組は上で +1 段の建枠として描画済み）
    if (!isWakugumi) {
      postXPositions.forEach((px, pi) => {
        const guardBase = JACK_BASE_H + levels * LEVEL_H;
        const guardTop = guardBase + topGuardMm;
        elements.push(
          <line key={`${keyPrefix}tg-${pi}`}
            x1={x(px)} y1={y(guardBase)} x2={x(px)} y2={y(guardTop)}
            stroke={COL.topGuard} strokeWidth={POST_STROKE} strokeDasharray="5,3" />
        );
      });

      spans.forEach((span, si) => {
        const guardTop = JACK_BASE_H + levels * LEVEL_H + topGuardMm;
        const sx = postXPositions[si];
        const ex = postXPositions[si + 1];
        elements.push(
          <line key={`${keyPrefix}tgr-${si}`}
            x1={x(sx)} y1={y(guardTop)} x2={x(ex)} y2={y(guardTop)}
            stroke={COL.topGuard} strokeWidth={TESURI_STROKE} />
        );
      });
    }

    // End stopper — wakugumi: vertical marker at ends; kusabi: 端部手摺 (2 rails) at each end
    if (isWakugumi) {
      Array.from({ length: levelsDraw }).forEach((_, lvl) => {
        const baseY = JACK_BASE_H + lvl * LEVEL_H;
        const topY = baseY + LEVEL_H;
        [0, totalLengthMm].forEach((px, ei) => {
          elements.push(
            <line key={`endstopper-${lvl}-${ei}`}
              x1={x(px)} y1={y(baseY)} x2={x(px)} y2={y(topY)}
              stroke={COL.endStopper} strokeWidth={TESURI_STROKE} strokeDasharray="4,3" />
          );
        });
      });
    } else {
      const tickMm = 55;
      Array.from({ length: levels }).forEach((_, lvl) => {
        const baseY = JACK_BASE_H + lvl * LEVEL_H;
        [0, totalLengthMm].forEach((px, ei) => {
          [0.45, 0.9].forEach((frac, ti) => {
            const ymm = baseY + LEVEL_H * frac;
            elements.push(
              <line key={`kusabi-endstop-${lvl}-${ei}-${ti}`}
                x1={x(Math.max(0, px - tickMm))} y1={y(ymm)}
                x2={x(px + tickMm)} y2={y(ymm)}
                stroke={COL.endStopper} strokeWidth={TESURI_STROKE} strokeDasharray="3,2" />
            );
          });
        });
      });
    }

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
            {totalLengthMm.toLocaleString(numberLocale)}mm
        </text>
      </g>
    );

    // Height dimension (left side)
    const hDx = PAD_LEFT - 45;
    elements.push(
      <g key="dim-height">
        <line x1={hDx} y1={y(0)} x2={hDx} y2={y(wd.totalHeightMm)} stroke={COL.dim} strokeWidth={1} />
        <line x1={hDx - 5} y1={y(0)} x2={hDx + 5} y2={y(0)} stroke={COL.dim} strokeWidth={1} />
        <line x1={hDx - 5} y1={y(wd.totalHeightMm)} x2={hDx + 5} y2={y(wd.totalHeightMm)} stroke={COL.dim} strokeWidth={1} />
        <text x={hDx - 6} y={(y(0) + y(wd.totalHeightMm)) / 2}
          textAnchor="middle" fontSize={10} fontWeight="bold" fill={COL.dimText}
          transform={`rotate(-90, ${hDx - 6}, ${(y(0) + y(wd.totalHeightMm)) / 2})`}>
          {wd.totalHeightMm.toLocaleString(numberLocale)}mm
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
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

      <EdgeHashiraResultPanel
        labeling={result?.edgeHashiraLabeling}
        walls={walls}
        closedFootprint={closedFootprint}
        className="mx-3 mt-2 mb-1"
      />

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
        className={`overflow-auto print:!max-h-none print:overflow-visible ${showAllWalls ? 'max-h-[900px]' : 'max-h-[700px]'}`}
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
                  { color: COL.yokoji, label: t('result', 'legendYokoji') },
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
                  { color: COL.yokoji, label: t('result', 'legendYokoji') },
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
