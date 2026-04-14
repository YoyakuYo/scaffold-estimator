/**
 * Shared 2D elevation drawing for scaffold per-wall SVG (used by Scaffold2DView and one-page overview).
 */
import type { ReactNode } from 'react';
import type { WallCalculationResult } from '@/lib/api/scaffold-configs';
import {
  normalizeScaffoldWidthMmToCatalog,
  SCAFFOLD_WIDTH_MEDIUM_MM,
  SCAFFOLD_WIDTH_NARROW_MM,
} from '@/lib/scaffold-width-catalog';

export const LEVEL_H_KUSABI = 1800;
export const JACK_BASE_H = 300;
export const POST_STROKE = 4;
export const BRACE_STROKE = 2.8;
export const TESURI_STROKE = 2.5;
export const PLANK_H_PX = 8;
export const HABAKI_H_PX = 6;
export const DIMENSION_OFFSET = 28;
export const MAX_2D_SPANS = 200;

export const COL = {
  post: '#0f172a',
  brace: '#b91c1c',
  tesuri: '#1d4ed8',
  shitasan: '#0e7490',
  plank: '#b45309',
  habaki: '#44403c',
  jackBase: '#334155',
  yokoji: '#15803d',
  stair: '#047857',
  endStopper: '#7c3aed',
  dim: '#64748b',
  dimText: '#1e293b',
  bg: '#ffffff',
  grid: '#f1f5f9',
  topGuard: '#6d28d9',
  frame: '#0f172a',
};

export type WallElevationComputed = {
  wall: WallCalculationResult;
  spans: number[];
  levels: number;
  levelsDraw: number;
  totalLengthMm: number;
  totalHeightMm: number;
  postXPositions: number[];
  stairPositions: number[];
  needsExtendedBay: boolean;
};

export function computeWallElevationData(
  w: WallCalculationResult,
  opts: {
    isWakugumi: boolean;
    levelH: number;
    topGuardMm: number;
    resultScaffoldWidthMm: number;
  },
): WallElevationComputed {
  const { isWakugumi, levelH, topGuardMm, resultScaffoldWidthMm } = opts;
  const rawSpans = w.spans;
  const spans = rawSpans.length > MAX_2D_SPANS ? rawSpans.slice(0, MAX_2D_SPANS) : rawSpans;
  const levels = w.levelCalc.fullLevels;
  const wakExtraFrame = isWakugumi;
  const levelsDraw = levels + (wakExtraFrame ? 1 : 0);
  const totalLengthMm = spans.reduce((a: number, b: number) => a + b, 0);
  const totalHeightMm = isWakugumi
    ? levelsDraw * levelH + JACK_BASE_H
    : levels * levelH + topGuardMm + JACK_BASE_H;

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

  const widthMm = normalizeScaffoldWidthMmToCatalog(
    w.scaffoldWidthMm ?? resultScaffoldWidthMm ?? SCAFFOLD_WIDTH_MEDIUM_MM,
  );
  const needsExtendedBay =
    w.needsExtendedBay ?? (widthMm <= SCAFFOLD_WIDTH_NARROW_MM && stairPositions.length > 0);

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
}

export type WallElevationDrawOpts = {
  isWakugumi: boolean;
  levelH: number;
  topGuardMm: number;
  numberLocale: string;
  scale: number;
  keyPrefix?: string;
  postFootLabels?: string[] | null;
};

export function renderWallElevationContent(
  wd: WallElevationComputed,
  xFn: (mm: number) => number,
  yFn: (mm: number) => number,
  draw: WallElevationDrawOpts,
): ReactNode[] {
  const { isWakugumi, levelH: LEVEL_H, topGuardMm, numberLocale, scale, keyPrefix = '', postFootLabels = null } = draw;
  const { spans, levels, levelsDraw, totalLengthMm, postXPositions, stairPositions, needsExtendedBay } = wd;
  const x = xFn;
  const y = yFn;
  const elements: ReactNode[] = [];

  const gridStep = 1000;
  for (let gx = 0; gx <= totalLengthMm; gx += gridStep) {
    elements.push(
      <line key={`${keyPrefix}gv-${gx}`} x1={x(gx)} y1={y(0)} x2={x(gx)} y2={y(wd.totalHeightMm)}
        stroke={COL.grid} strokeWidth={0.5} />,
    );
  }
  for (let gy = 0; gy <= wd.totalHeightMm; gy += gridStep) {
    elements.push(
      <line key={`${keyPrefix}gh-${gy}`} x1={x(0)} y1={y(gy)} x2={x(totalLengthMm)} y2={y(gy)}
        stroke={COL.grid} strokeWidth={0.5} />,
    );
  }

  elements.push(
    <line key={`${keyPrefix}ground`} x1={x(0) - 10} y1={y(0)} x2={x(totalLengthMm) + 10} y2={y(0)}
      stroke="#94a3b8" strokeWidth={2} strokeDasharray="6,3" />,
  );

  postXPositions.forEach((px, i) => {
    elements.push(
      <g key={`${keyPrefix}jb-${i}`}>
        <polygon
          points={`${x(px)},${y(0)} ${x(px) - 8},${y(0) + 12} ${x(px) + 8},${y(0) + 12}`}
          fill={COL.jackBase} stroke={COL.jackBase} strokeWidth={1}
        />
        <line x1={x(px)} y1={y(0)} x2={x(px)} y2={y(JACK_BASE_H)}
          stroke={COL.jackBase} strokeWidth={2} strokeDasharray="4,2" />
      </g>,
    );
  });

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
        </text>,
      );
    });
  }

  if (!isWakugumi) {
    spans.forEach((span, si) => {
      const xStart = postXPositions[si];
      elements.push(
        <line key={`${keyPrefix}by-${si}`} x1={x(xStart)} y1={y(JACK_BASE_H)} x2={x(xStart + span)} y2={y(JACK_BASE_H)}
          stroke={COL.yokoji} strokeWidth={TESURI_STROKE} strokeDasharray="6,2" />,
      );
    });
  }

  Array.from({ length: levelsDraw }).forEach((_, lvl) => {
    const baseY = JACK_BASE_H + lvl * LEVEL_H;
    const topY = baseY + LEVEL_H;

    elements.push(
      <text key={`${keyPrefix}lvl-${lvl}`} x={x(0) - 15} y={y(topY) + 4}
        textAnchor="end" fontSize={10} fill={COL.dimText}>
        L{lvl + 1}
      </text>,
    );

    postXPositions.forEach((px, pi) => {
      elements.push(
        <line
          key={`${keyPrefix}post-${lvl}-${pi}`}
          x1={x(px)}
          y1={y(baseY)}
          x2={x(px)}
          y2={y(topY)}
          stroke={isWakugumi ? COL.frame : COL.post}
          strokeWidth={POST_STROKE}
        />,
      );
    });

    spans.forEach((span, si) => {
      const sx = postXPositions[si];
      const ex = postXPositions[si + 1];
      const isStairSpan = stairPositions.includes(si);

      if (isStairSpan && needsExtendedBay) {
        elements.push(
          <line key={`${keyPrefix}brace-1-${lvl}-${si}`}
            x1={x(sx)} y1={y(baseY)} x2={x(ex)} y2={y(topY)}
            stroke={COL.brace} strokeWidth={BRACE_STROKE} />,
          <line key={`${keyPrefix}brace-2-${lvl}-${si}`}
            x1={x(sx)} y1={y(topY)} x2={x(ex)} y2={y(baseY)}
            stroke={COL.brace} strokeWidth={BRACE_STROKE} />,
        );
        if (!isWakugumi) {
          elements.push(
            <line key={`${keyPrefix}tesuri-1-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY + LEVEL_H * 0.45)}
              x2={x(ex)} y2={y(baseY + LEVEL_H * 0.45)}
              stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
            <line key={`${keyPrefix}tesuri-2-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY + LEVEL_H * 0.9)}
              x2={x(ex)} y2={y(baseY + LEVEL_H * 0.9)}
              stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
          );
        } else {
          elements.push(
            <line key={`${keyPrefix}shitasan-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY + 50)}
              x2={x(ex)} y2={y(baseY + 50)}
              stroke={COL.shitasan} strokeWidth={TESURI_STROKE} />,
          );
        }
        elements.push(
          <rect key={`${keyPrefix}plank-${lvl}-${si}`}
            x={x(sx) + 2} y={y(topY) - PLANK_H_PX / 2}
            width={(ex - sx) * scale - 4} height={PLANK_H_PX}
            fill={COL.plank} opacity={0.7} rx={1} />,
        );
        elements.push(
          <line key={`${keyPrefix}habaki-${lvl}-${si}`}
            x1={x(sx) + 2} y1={y(topY) + PLANK_H_PX / 2 + 2}
            x2={x(ex) - 2} y2={y(topY) + PLANK_H_PX / 2 + 2}
            stroke={COL.habaki} strokeWidth={HABAKI_H_PX} opacity={0.5} />,
        );
        const ebX = x(sx) + 1;
        const ebW = (ex - sx) * scale - 2;
        const ebY = y(topY) - 2;
        const ebH = (topY - baseY) * scale + 4;
        elements.push(
          <rect key={`${keyPrefix}ext-bay-${lvl}-${si}`}
            x={ebX} y={ebY}
            width={ebW} height={ebH}
            fill="none" stroke={COL.stair} strokeWidth={1.5}
            strokeDasharray="4,3" rx={2} />,
        );
        elements.push(
          <line key={`${keyPrefix}ext-stair-${lvl}-${si}`}
            x1={ebX + ebW * 0.15} y1={ebY + ebH * 0.85}
            x2={ebX + ebW * 0.85} y2={ebY + ebH * 0.15}
            stroke={COL.stair} strokeWidth={2} opacity={0.6} />,
        );
        elements.push(
          <text key={`${keyPrefix}ext-label-${lvl}-${si}`}
            x={ebX + ebW / 2} y={ebY + ebH / 2 + 3}
            textAnchor="middle" fontSize={7} fontWeight="bold"
            fill={COL.stair} opacity={0.8}>EXT</text>,
        );
        const midXmm = (sx + ex) / 2;
        for (const epx of [sx, midXmm, ex]) {
          elements.push(
            <line key={`${keyPrefix}ext-post-${lvl}-${si}-${epx}`}
              x1={x(epx)} y1={ebY} x2={x(epx)} y2={ebY + ebH}
              stroke={COL.stair} strokeWidth={1} strokeDasharray="2,2" opacity={0.5} />,
          );
        }
      } else if (isStairSpan) {
        elements.push(
          <line key={`${keyPrefix}stair-${lvl}-${si}`}
            x1={x(sx + span * 0.04)} y1={y(baseY)}
            x2={x(ex - span * 0.04)} y2={y(topY)}
            stroke={COL.stair} strokeWidth={2.5} />,
        );
        Array.from({ length: 8 }).forEach((_, st) => {
          const t = (st + 1) / 9;
          const stepXmm = sx + span * 0.04 + (span * 0.92) * t;
          const stepYmm = baseY + LEVEL_H * t;
          const treadHalf = span * 0.07;
          elements.push(
            <line key={`${keyPrefix}step-${lvl}-${si}-${st}`}
              x1={x(stepXmm - treadHalf)} y1={y(stepYmm)}
              x2={x(stepXmm + treadHalf)} y2={y(stepYmm)}
              stroke={COL.stair} strokeWidth={1.8} />,
          );
        });
        if (!isWakugumi) {
          elements.push(
            <line key={`${keyPrefix}tesuri-s1-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY + LEVEL_H * 0.45)}
              x2={x(ex)} y2={y(baseY + LEVEL_H * 0.45)}
              stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
            <line key={`${keyPrefix}tesuri-s2-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY + LEVEL_H * 0.9)}
              x2={x(ex)} y2={y(baseY + LEVEL_H * 0.9)}
              stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
          );
        } else {
          elements.push(
            <line key={`${keyPrefix}shitasan-s-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY + 50)}
              x2={x(ex)} y2={y(baseY + 50)}
              stroke={COL.shitasan} strokeWidth={TESURI_STROKE} />,
          );
        }
      } else {
        elements.push(
          <line key={`${keyPrefix}brace-1-${lvl}-${si}`}
            x1={x(sx)} y1={y(baseY)} x2={x(ex)} y2={y(topY)}
            stroke={COL.brace} strokeWidth={BRACE_STROKE} />,
          <line key={`${keyPrefix}brace-2-${lvl}-${si}`}
            x1={x(sx)} y1={y(topY)} x2={x(ex)} y2={y(baseY)}
            stroke={COL.brace} strokeWidth={BRACE_STROKE} />,
        );

        if (isWakugumi) {
          elements.push(
            <line key={`${keyPrefix}shitasan-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY + 50)}
              x2={x(ex)} y2={y(baseY + 50)}
              stroke={COL.shitasan} strokeWidth={TESURI_STROKE} />,
          );
        } else {
          elements.push(
            <line key={`${keyPrefix}tesuri-1-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY + LEVEL_H * 0.45)}
              x2={x(ex)} y2={y(baseY + LEVEL_H * 0.45)}
              stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
            <line key={`${keyPrefix}tesuri-2-${lvl}-${si}`}
              x1={x(sx)} y1={y(baseY + LEVEL_H * 0.9)}
              x2={x(ex)} y2={y(baseY + LEVEL_H * 0.9)}
              stroke={COL.tesuri} strokeWidth={TESURI_STROKE} />,
          );
        }

        elements.push(
          <rect key={`${keyPrefix}plank-${lvl}-${si}`}
            x={x(sx) + 2} y={y(topY) - PLANK_H_PX / 2}
            width={(ex - sx) * scale - 4} height={PLANK_H_PX}
            fill={COL.plank} opacity={0.7} rx={1} />,
        );
        elements.push(
          <line key={`${keyPrefix}habaki-${lvl}-${si}`}
            x1={x(sx) + 2} y1={y(topY) + PLANK_H_PX / 2 + 2}
            x2={x(ex) - 2} y2={y(topY) + PLANK_H_PX / 2 + 2}
            stroke={COL.habaki} strokeWidth={HABAKI_H_PX} opacity={0.5} />,
        );
      }
    });

    if (!isWakugumi) {
      postXPositions.forEach((px, pi) => {
        elements.push(
          <line key={`${keyPrefix}wyk-${lvl}-${pi}`}
            x1={x(px) - 4} y1={y(topY)} x2={x(px) + 4} y2={y(topY)}
            stroke={COL.yokoji} strokeWidth={2.5} />,
        );
      });
    }
  });

  if (!isWakugumi) {
    postXPositions.forEach((px, pi) => {
      const guardBase = JACK_BASE_H + levels * LEVEL_H;
      const guardTop = guardBase + topGuardMm;
      elements.push(
        <line key={`${keyPrefix}tg-${pi}`}
          x1={x(px)} y1={y(guardBase)} x2={x(px)} y2={y(guardTop)}
          stroke={COL.topGuard} strokeWidth={POST_STROKE} strokeDasharray="5,3" />,
      );
    });

    spans.forEach((span, si) => {
      const guardTop = JACK_BASE_H + levels * LEVEL_H + topGuardMm;
      const sx = postXPositions[si];
      const ex = postXPositions[si + 1];
      elements.push(
        <line key={`${keyPrefix}tgr-${si}`}
          x1={x(sx)} y1={y(guardTop)} x2={x(ex)} y2={y(guardTop)}
          stroke={COL.topGuard} strokeWidth={TESURI_STROKE} />,
      );
    });
  }

  if (isWakugumi) {
    Array.from({ length: levelsDraw }).forEach((_, lvl) => {
      const baseY = JACK_BASE_H + lvl * LEVEL_H;
      const topY = baseY + LEVEL_H;
      [0, totalLengthMm].forEach((px, ei) => {
        elements.push(
          <line key={`${keyPrefix}endstopper-${lvl}-${ei}`}
            x1={x(px)} y1={y(baseY)} x2={x(px)} y2={y(topY)}
            stroke={COL.endStopper} strokeWidth={TESURI_STROKE} strokeDasharray="4,3" />,
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
            <line key={`${keyPrefix}kusabi-endstop-${lvl}-${ei}-${ti}`}
              x1={x(Math.max(0, px - tickMm))} y1={y(ymm)}
              x2={x(px + tickMm)} y2={y(ymm)}
              stroke={COL.endStopper} strokeWidth={TESURI_STROKE} strokeDasharray="3,2" />,
          );
        });
      });
    });
  }

  spans.forEach((span, si) => {
    const sx = postXPositions[si];
    const ex = postXPositions[si + 1];
    const dy = y(0) + DIMENSION_OFFSET + 12;
    elements.push(
      <g key={`${keyPrefix}dim-${si}`}>
        <line x1={x(sx)} y1={dy} x2={x(ex)} y2={dy} stroke={COL.dim} strokeWidth={0.8} />
        <line x1={x(sx)} y1={dy - 4} x2={x(sx)} y2={dy + 4} stroke={COL.dim} strokeWidth={0.8} />
        <line x1={x(ex)} y1={dy - 4} x2={x(ex)} y2={dy + 4} stroke={COL.dim} strokeWidth={0.8} />
        <text x={(x(sx) + x(ex)) / 2} y={dy - 5} textAnchor="middle" fontSize={9} fill={COL.dimText}>
          {span}
        </text>
      </g>,
    );
  });

  const dy = y(0) + DIMENSION_OFFSET + 32;
  elements.push(
    <g key={`${keyPrefix}dim-total`}>
      <line x1={x(0)} y1={dy} x2={x(totalLengthMm)} y2={dy} stroke={COL.dim} strokeWidth={1} />
      <line x1={x(0)} y1={dy - 5} x2={x(0)} y2={dy + 5} stroke={COL.dim} strokeWidth={1} />
      <line x1={x(totalLengthMm)} y1={dy - 5} x2={x(totalLengthMm)} y2={dy + 5} stroke={COL.dim} strokeWidth={1} />
      <text x={(x(0) + x(totalLengthMm)) / 2} y={dy - 6} textAnchor="middle" fontSize={11} fontWeight="bold" fill={COL.dimText}>
        {totalLengthMm.toLocaleString(numberLocale)}mm
      </text>
    </g>,
  );

  const hDx = xFn(0) - 45;
  elements.push(
    <g key={`${keyPrefix}dim-height`}>
      <line x1={hDx} y1={y(0)} x2={hDx} y2={y(wd.totalHeightMm)} stroke={COL.dim} strokeWidth={1} />
      <line x1={hDx - 5} y1={y(0)} x2={hDx + 5} y2={y(0)} stroke={COL.dim} strokeWidth={1} />
      <line x1={hDx - 5} y1={y(wd.totalHeightMm)} x2={hDx + 5} y2={y(wd.totalHeightMm)} stroke={COL.dim} strokeWidth={1} />
      <text x={hDx - 6} y={(y(0) + y(wd.totalHeightMm)) / 2}
        textAnchor="middle" fontSize={10} fontWeight="bold" fill={COL.dimText}
        transform={`rotate(-90, ${hDx - 6}, ${(y(0) + y(wd.totalHeightMm)) / 2})`}>
        {wd.totalHeightMm.toLocaleString(numberLocale)}mm
      </text>
    </g>,
  );

  return elements;
}
