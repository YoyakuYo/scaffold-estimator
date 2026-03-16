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
const POST_STROKE = 4;
const BRACE_STROKE = 2.8;
const TESURI_STROKE = 2.5;
const PLANK_H_PX = 8;
const HABAKI_H_PX = 6;
const DIMENSION_OFFSET = 28;
const FRAME_WIDTH_PX = 14;
const FRAME_SPLAY_PX = 5;
const FRAME_BOTTOM_RATIO = 0.194;
const DEPTH_DX = 14;
const DEPTH_DY = -10;
const BACK_OPACITY = 0.5;

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
  ecoPallet: '#2d2d2d', // エコプレット — dark recycled plastic
  stairRail: '#065f46', // カイダンレール — dark teal
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

  const svgW = wallData.totalLengthMm * scale + PAD_LEFT + PAD_RIGHT + DEPTH_DX;
  const svgH = wallData.totalHeightMm * scale + PAD_TOP + PAD_BOTTOM;

  const x = (mm: number) => PAD_LEFT + mm * scale;
  const y = (mm: number) => PAD_TOP + (wallData.totalHeightMm - mm) * scale;

  // ─── Render wall (architectural isometric-style with front/back rows) ──
  const renderWall = () => {
    const { spans, levels, totalLengthMm, postXPositions, stairPositions } = wallData;
    const elements: JSX.Element[] = [];
    const dx = DEPTH_DX;
    const dy2 = DEPTH_DY;

    // Grid
    const gridStep = 1000;
    for (let gx = 0; gx <= totalLengthMm; gx += gridStep) {
      elements.push(
        <line key={`gv-${gx}`} x1={x(gx)} y1={y(0)} x2={x(gx)} y2={y(wallData.totalHeightMm)}
          stroke={COL.grid} strokeWidth={0.5} />
      );
    }
    for (let gy = 0; gy <= wallData.totalHeightMm; gy += gridStep) {
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

    // ── Eco pallet / アルスピーダー base beam ──
    // Back beam
    elements.push(
      <line key="eco-back" x1={x(0) + dx} y1={y(0) + dy2 + 8} x2={x(totalLengthMm) + dx} y2={y(0) + dy2 + 8}
        stroke={COL.jackBase} strokeWidth={4} opacity={BACK_OPACITY} />
    );
    // Front beam
    elements.push(
      <line key="eco-front" x1={x(0)} y1={y(0) + 8} x2={x(totalLengthMm)} y2={y(0) + 8}
        stroke={COL.jackBase} strokeWidth={4} />
    );
    // Depth connecting lines at ends of beam
    [0, totalLengthMm].forEach((px, i) => {
      elements.push(
        <line key={`eco-depth-${i}`} x1={x(px)} y1={y(0) + 8} x2={x(px) + dx} y2={y(0) + dy2 + 8}
          stroke={COL.jackBase} strokeWidth={1.5} />
      );
    });

    // ── Jack Bases — back row ──
    postXPositions.forEach((px, i) => {
      elements.push(
        <g key={`jb-back-${i}`} opacity={BACK_OPACITY}>
          <line x1={x(px) + dx} y1={y(0) + dy2} x2={x(px) + dx} y2={y(JACK_BASE_H) + dy2}
            stroke={COL.jackBase} strokeWidth={2.5} />
          <line x1={x(px) + dx - 5} y1={y(0) + dy2 + 2} x2={x(px) + dx + 5} y2={y(0) + dy2 + 2}
            stroke={COL.jackBase} strokeWidth={2} />
        </g>
      );
    });
    // ── Jack Bases — front row ──
    postXPositions.forEach((px, i) => {
      elements.push(
        <g key={`jb-${i}`}>
          <line x1={x(px)} y1={y(0)} x2={x(px)} y2={y(JACK_BASE_H)}
            stroke={COL.jackBase} strokeWidth={2.5} />
          <polygon
            points={`${x(px)},${y(0)} ${x(px) - 7},${y(0) + 10} ${x(px) + 7},${y(0) + 10}`}
            fill={COL.jackBase} stroke={COL.jackBase} strokeWidth={1} />
        </g>
      );
    });
    // Jack depth connectors at ground level
    postXPositions.forEach((px, i) => {
      elements.push(
        <line key={`jb-depth-${i}`} x1={x(px)} y1={y(0)} x2={x(px) + dx} y2={y(0) + dy2}
          stroke={COL.jackBase} strokeWidth={1} opacity={0.6} />
      );
    });

    // ── Base Yokoji (根がらみ) ──
    spans.forEach((span, si) => {
      const xStart = postXPositions[si];
      elements.push(
        <line key={`by-back-${si}`} x1={x(xStart) + dx} y1={y(JACK_BASE_H) + dy2} x2={x(xStart + span) + dx} y2={y(JACK_BASE_H) + dy2}
          stroke={COL.yokoji} strokeWidth={TESURI_STROKE} strokeDasharray="6,2" opacity={BACK_OPACITY} />,
        <line key={`by-${si}`} x1={x(xStart)} y1={y(JACK_BASE_H)} x2={x(xStart + span)} y2={y(JACK_BASE_H)}
          stroke={COL.yokoji} strokeWidth={TESURI_STROKE} strokeDasharray="6,2" />,
      );
    });

    // ════════════════════════════════════════════════════════════════
    // Per-Level: draw back row → depth connectors → front row
    // ════════════════════════════════════════════════════════════════
    Array.from({ length: levels }).forEach((_, lvl) => {
      const bY = JACK_BASE_H + lvl * LEVEL_H;
      const tY = bY + LEVEL_H;

      // Level label
      elements.push(
        <text key={`lvl-${lvl}`} x={x(0) - 18} y={y(tY) + 4}
          textAnchor="end" fontSize={10} fill={COL.dimText}>L{lvl + 1}</text>
      );

      // ── BACK ROW posts ──
      postXPositions.forEach((px, pi) => {
        elements.push(
          <line key={`post-b-${lvl}-${pi}`}
            x1={x(px) + dx} y1={y(bY) + dy2} x2={x(px) + dx} y2={y(tY) + dy2}
            stroke={COL.post} strokeWidth={POST_STROKE - 1} opacity={BACK_OPACITY} />
        );
      });

      // ── BACK ROW spans (braces, tesuri, planks) ──
      spans.forEach((span, si) => {
        const sx = postXPositions[si];
        const ex = postXPositions[si + 1];
        const isStairSpan = stairPositions.includes(si);
        if (isStairSpan) return;

        // Back brace
        elements.push(
          <line key={`br-b1-${lvl}-${si}`}
            x1={x(sx) + dx} y1={y(bY) + dy2} x2={x(ex) + dx} y2={y(tY) + dy2}
            stroke={COL.brace} strokeWidth={BRACE_STROKE - 0.8} opacity={BACK_OPACITY} />,
          <line key={`br-b2-${lvl}-${si}`}
            x1={x(sx) + dx} y1={y(tY) + dy2} x2={x(ex) + dx} y2={y(bY) + dy2}
            stroke={COL.brace} strokeWidth={BRACE_STROKE - 0.8} opacity={BACK_OPACITY} />,
        );

        // Back tesuri / shitasan
        if (isWakugumi) {
          elements.push(
            <line key={`sh-b-${lvl}-${si}`}
              x1={x(sx) + dx} y1={y(bY + 50) + dy2} x2={x(ex) + dx} y2={y(bY + 50) + dy2}
              stroke={COL.shitasan} strokeWidth={TESURI_STROKE - 0.5} opacity={BACK_OPACITY} />,
          );
        } else {
          elements.push(
            <line key={`ts-b1-${lvl}-${si}`}
              x1={x(sx) + dx} y1={y(bY + LEVEL_H * 0.45) + dy2} x2={x(ex) + dx} y2={y(bY + LEVEL_H * 0.45) + dy2}
              stroke={COL.tesuri} strokeWidth={TESURI_STROKE - 0.5} opacity={BACK_OPACITY} />,
            <line key={`ts-b2-${lvl}-${si}`}
              x1={x(sx) + dx} y1={y(bY + LEVEL_H * 0.9) + dy2} x2={x(ex) + dx} y2={y(bY + LEVEL_H * 0.9) + dy2}
              stroke={COL.tesuri} strokeWidth={TESURI_STROKE - 0.5} opacity={BACK_OPACITY} />,
          );
        }
      });

      // ── DEPTH CONNECTORS at each post position at level top ──
      postXPositions.forEach((px, pi) => {
        elements.push(
          <line key={`dc-${lvl}-${pi}`}
            x1={x(px)} y1={y(tY)} x2={x(px) + dx} y2={y(tY) + dy2}
            stroke={COL.post} strokeWidth={1.5} opacity={0.55} />,
        );
      });

      // ── PLANKS as parallelogram (front edge → depth → back edge) ──
      spans.forEach((span, si) => {
        const sx = postXPositions[si];
        const ex = postXPositions[si + 1];
        const isStairSpan = stairPositions.includes(si);
        if (isStairSpan) return;

        const pH = PLANK_H_PX;
        const fx1 = x(sx) + 2;
        const fx2 = x(ex) - 2;
        const fyt = y(tY) - pH / 2;
        const fyb = y(tY) + pH / 2;

        // Parallelogram: front-top-left, front-top-right, back-top-right, back-top-left
        elements.push(
          <polygon key={`plank-${lvl}-${si}`}
            points={`${fx1},${fyt} ${fx2},${fyt} ${fx2 + dx},${fyt + dy2} ${fx1 + dx},${fyt + dy2}`}
            fill={COL.plank} opacity={0.25} stroke={COL.plank} strokeWidth={0.5} />,
        );
        // Front edge (main plank strip)
        elements.push(
          <rect key={`plank-f-${lvl}-${si}`}
            x={fx1} y={fyt} width={fx2 - fx1} height={pH}
            fill={COL.plank} opacity={0.6} rx={1} />,
        );
        // Habaki front
        elements.push(
          <line key={`habaki-${lvl}-${si}`}
            x1={fx1} y1={fyb + 2} x2={fx2} y2={fyb + 2}
            stroke={COL.habaki} strokeWidth={HABAKI_H_PX} opacity={0.45} />,
        );
      });

      // ── FRONT ROW posts ──
      postXPositions.forEach((px, pi) => {
        elements.push(
          <line key={`post-${lvl}-${pi}`}
            x1={x(px)} y1={y(bY)} x2={x(px)} y2={y(tY)}
            stroke={COL.post} strokeWidth={POST_STROKE} />,
        );
      });

      // ── FRONT ROW spans ──
      spans.forEach((span, si) => {
        const sx = postXPositions[si];
        const ex = postXPositions[si + 1];
        const isStairSpan = stairPositions.includes(si);

        if (isStairSpan) {
          // Stair back stringer
          elements.push(
            <line key={`stair-b-${lvl}-${si}`}
              x1={x(sx + span * 0.06) + dx} y1={y(bY) + dy2}
              x2={x(ex - span * 0.06) + dx} y2={y(tY) + dy2}
              stroke={COL.stair} strokeWidth={2} opacity={BACK_OPACITY} />,
          );
          // Stair front stringer
          elements.push(
            <line key={`stair-${lvl}-${si}`}
              x1={x(sx + span * 0.06)} y1={y(bY)}
              x2={x(ex - span * 0.06)} y2={y(tY)}
              stroke={COL.stair} strokeWidth={2.5} />,
          );
          // Step treads (parallelogram from front to back)
          Array.from({ length: 7 }).forEach((_, st) => {
            const t = (st + 1) / 8;
            const stepXmm = sx + span * 0.06 + (span * 0.88) * t;
            const stepYmm = bY + LEVEL_H * t;
            const halfW = span * 0.06;
            elements.push(
              <line key={`step-b-${lvl}-${si}-${st}`}
                x1={x(stepXmm - halfW) + dx} y1={y(stepYmm) + dy2}
                x2={x(stepXmm + halfW) + dx} y2={y(stepYmm) + dy2}
                stroke={COL.stair} strokeWidth={1.2} opacity={BACK_OPACITY} />,
              <line key={`step-${lvl}-${si}-${st}`}
                x1={x(stepXmm - halfW)} y1={y(stepYmm)}
                x2={x(stepXmm + halfW)} y2={y(stepYmm)}
                stroke={COL.stair} strokeWidth={1.8} />,
            );
          });
          // Stair handrail (カイダンレール)
          elements.push(
            <line key={`stair-rail-${lvl}-${si}`}
              x1={x(ex - span * 0.06)} y1={y(bY + LEVEL_H * 0.55)}
              x2={x(ex)} y2={y(tY)}
              stroke={COL.stairRail} strokeWidth={1.8} strokeDasharray="6,3" />,
          );
          // Tesuri / shitasan on stair spans
          if (!isWakugumi) {
            elements.push(
              <line key={`ts-s1-${lvl}-${si}`}
                x1={x(sx)} y1={y(bY + LEVEL_H * 0.45)} x2={x(ex)} y2={y(bY + LEVEL_H * 0.45)}
                stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
              <line key={`ts-s2-${lvl}-${si}`}
                x1={x(sx)} y1={y(bY + LEVEL_H * 0.9)} x2={x(ex)} y2={y(bY + LEVEL_H * 0.9)}
                stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
            );
          } else {
            elements.push(
              <line key={`sh-s-${lvl}-${si}`}
                x1={x(sx)} y1={y(bY + 50)} x2={x(ex)} y2={y(bY + 50)}
                stroke={COL.shitasan} strokeWidth={TESURI_STROKE} />,
            );
          }
        } else {
          // Front brace (X)
          elements.push(
            <line key={`br-1-${lvl}-${si}`}
              x1={x(sx)} y1={y(bY)} x2={x(ex)} y2={y(tY)}
              stroke={COL.brace} strokeWidth={BRACE_STROKE} />,
            <line key={`br-2-${lvl}-${si}`}
              x1={x(sx)} y1={y(tY)} x2={x(ex)} y2={y(bY)}
              stroke={COL.brace} strokeWidth={BRACE_STROKE} />,
          );

          // Front tesuri / shitasan
          if (isWakugumi) {
            elements.push(
              <line key={`sh-${lvl}-${si}`}
                x1={x(sx)} y1={y(bY + 50)} x2={x(ex)} y2={y(bY + 50)}
                stroke={COL.shitasan} strokeWidth={TESURI_STROKE} />,
            );
          } else {
            elements.push(
              <line key={`ts-1-${lvl}-${si}`}
                x1={x(sx)} y1={y(bY + LEVEL_H * 0.45)} x2={x(ex)} y2={y(bY + LEVEL_H * 0.45)}
                stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
              <line key={`ts-2-${lvl}-${si}`}
                x1={x(sx)} y1={y(bY + LEVEL_H * 0.9)} x2={x(ex)} y2={y(bY + LEVEL_H * 0.9)}
                stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
            );
          }
        }
      });

      // Width yokoji connectors (front row tick)
      postXPositions.forEach((px, pi) => {
        elements.push(
          <line key={`wyk-${lvl}-${pi}`}
            x1={x(px) - 4} y1={y(tY)} x2={x(px) + 4} y2={y(tY)}
            stroke={COL.yokoji} strokeWidth={2.5} />,
        );
      });
    });

    // ═══════════ Top Guard ═══════════
    const gBase = JACK_BASE_H + levels * LEVEL_H;
    const gTop = gBase + topGuardMm;

    // Back row
    postXPositions.forEach((px, pi) => {
      elements.push(
        <line key={`tg-b-${pi}`}
          x1={x(px) + dx} y1={y(gBase) + dy2} x2={x(px) + dx} y2={y(gTop) + dy2}
          stroke={COL.topGuard} strokeWidth={POST_STROKE - 1} strokeDasharray="5,3" opacity={BACK_OPACITY} />,
      );
    });
    spans.forEach((_, si) => {
      const sx = postXPositions[si];
      const ex = postXPositions[si + 1];
      elements.push(
        <line key={`tgr-b-${si}`}
          x1={x(sx) + dx} y1={y(gTop) + dy2} x2={x(ex) + dx} y2={y(gTop) + dy2}
          stroke={COL.topGuard} strokeWidth={TESURI_STROKE - 0.5} opacity={BACK_OPACITY} />,
      );
    });

    // Depth connectors at top guard
    postXPositions.forEach((px, pi) => {
      elements.push(
        <line key={`tg-dc-${pi}`}
          x1={x(px)} y1={y(gTop)} x2={x(px) + dx} y2={y(gTop) + dy2}
          stroke={COL.topGuard} strokeWidth={1.2} opacity={0.5} />,
      );
    });

    // Front row
    postXPositions.forEach((px, pi) => {
      elements.push(
        <line key={`tg-${pi}`}
          x1={x(px)} y1={y(gBase)} x2={x(px)} y2={y(gTop)}
          stroke={COL.topGuard} strokeWidth={POST_STROKE} strokeDasharray="5,3" />,
      );
    });
    spans.forEach((_, si) => {
      const sx = postXPositions[si];
      const ex = postXPositions[si + 1];
      elements.push(
        <line key={`tgr-${si}`}
          x1={x(sx)} y1={y(gTop)} x2={x(ex)} y2={y(gTop)}
          stroke={COL.topGuard} strokeWidth={TESURI_STROKE} />,
      );
    });

    // End stopper (端部) — wakugumi only
    if (isWakugumi) {
      Array.from({ length: levels }).forEach((_, lvl) => {
        const bY = JACK_BASE_H + lvl * LEVEL_H;
        const tY = bY + LEVEL_H;
        [0, totalLengthMm].forEach((px, ei) => {
          elements.push(
            <line key={`es-${lvl}-${ei}`}
              x1={x(px)} y1={y(bY)} x2={x(px)} y2={y(tY)}
              stroke={COL.endStopper} strokeWidth={TESURI_STROKE} strokeDasharray="4,3" />,
          );
        });
      });
    }

    // ═══════════ Dimensions ═══════════
    // Span dimensions
    spans.forEach((span, si) => {
      const sx = postXPositions[si];
      const ex = postXPositions[si + 1];
      const dimY = y(0) + DIMENSION_OFFSET + 14;
      elements.push(
        <g key={`dim-${si}`}>
          <line x1={x(sx)} y1={dimY} x2={x(ex)} y2={dimY} stroke={COL.dim} strokeWidth={0.8} />
          <line x1={x(sx)} y1={dimY - 4} x2={x(sx)} y2={dimY + 4} stroke={COL.dim} strokeWidth={0.8} />
          <line x1={x(ex)} y1={dimY - 4} x2={x(ex)} y2={dimY + 4} stroke={COL.dim} strokeWidth={0.8} />
          <text x={(x(sx) + x(ex)) / 2} y={dimY - 5} textAnchor="middle" fontSize={9} fill={COL.dimText}>{span}</text>
        </g>,
      );
    });

    // Total length
    const totalDimY = y(0) + DIMENSION_OFFSET + 34;
    elements.push(
      <g key="dim-total">
        <line x1={x(0)} y1={totalDimY} x2={x(totalLengthMm)} y2={totalDimY} stroke={COL.dim} strokeWidth={1} />
        <line x1={x(0)} y1={totalDimY - 5} x2={x(0)} y2={totalDimY + 5} stroke={COL.dim} strokeWidth={1} />
        <line x1={x(totalLengthMm)} y1={totalDimY - 5} x2={x(totalLengthMm)} y2={totalDimY + 5} stroke={COL.dim} strokeWidth={1} />
        <text x={(x(0) + x(totalLengthMm)) / 2} y={totalDimY - 6} textAnchor="middle" fontSize={11} fontWeight="bold" fill={COL.dimText}>
          {totalLengthMm.toLocaleString()}mm
        </text>
      </g>,
    );

    // Height dimension (left)
    const hDx = PAD_LEFT - 50;
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
      </g>,
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
          <g transform={`translate(${PAD_LEFT}, ${svgH - 28})`}>
            {(isWakugumi ? [
              { color: COL.post, label: '建枠' },
              { color: COL.brace, label: 'ブレス' },
              { color: COL.shitasan, label: '下桟' },
              { color: COL.plank, label: '踏板' },
              { color: COL.habaki, label: '巾木' },
              { color: COL.endStopper, label: '端部' },
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
            ]            ).map((item, i) => (
              <g key={i} transform={`translate(${i * 78}, 0)`}>
                <rect x={0} y={-10} width={16} height={5} fill={item.color} rx={1} stroke="#e2e8f0" strokeWidth={0.5} />
                <text x={20} y={-5} fontSize={10} fill={COL.dimText} fontWeight={500}>{item.label}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}
