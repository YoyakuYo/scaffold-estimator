/**
 * Door opening deductions: for spans covered by a door, remove materials from ground
 * up to door head height (doorTopHeightMmFromGround). Double-row scaffold: jack/eco
 * and post stacks are reduced for post lines inside the opening width.
 */

import { CALC_RULES } from './scaffold-rules';
import { WAKUGUMI_CALC_RULES } from './scaffold-rules-wakugumi';

export type DoorOpeningLike = {
  positionMm: number;
  widthMm: number;
  doorTopHeightMmFromGround?: number;
};

/** Same span resolution as hariwaku (梁枠) — opening covers [startIdx, startIdx+spanCount). */
export function resolveDoorSpanRange(
  spans: number[],
  door: DoorOpeningLike,
): { startIdx: number; spanCount: number } {
  const cumulativePos: number[] = [0];
  let accum = 0;
  for (const s of spans) {
    accum += s;
    cumulativePos.push(accum);
  }
  const doorStart = door.positionMm - door.widthMm / 2;
  const doorEnd = door.positionMm + door.widthMm / 2;
  let startIdx = 0;
  let endIdx = 0;
  for (let si = 0; si < spans.length; si++) {
    if (cumulativePos[si] <= doorStart) startIdx = si;
    if (cumulativePos[si + 1] >= doorEnd) {
      endIdx = si;
      break;
    }
    endIdx = si;
  }
  const spanCount = Math.max(2, endIdx - startIdx + 1);
  return { startIdx, spanCount };
}

/**
 * Working levels (decks) and safety band rows whose brace/tesuri/habaki fall within
 * [0, doorTop) when measured in level-height steps from ground.
 */
function levelsWorkAndSafety(
  doorTopMm: number | undefined,
  fullLevels: number,
  safetyLevels: number,
  levelHeightMm: number,
): { ldWork: number; ldSafety: number } {
  if (doorTopMm == null || !Number.isFinite(doorTopMm) || doorTopMm <= 0) {
    return { ldWork: fullLevels, ldSafety: safetyLevels };
  }
  const steps = Math.ceil(doorTopMm / levelHeightMm);
  return {
    ldWork: Math.min(fullLevels, Math.max(0, steps)),
    ldSafety: Math.min(safetyLevels, Math.max(0, steps)),
  };
}

/** Per-span max Ld across all doors (overlap takes max). */
export function buildDoorSpanLevelCover(
  doors: DoorOpeningLike[] | undefined,
  spans: number[],
  fullLevels: number,
  safetyLevels: number,
  levelHeightMm: number,
): {
  ldWork: number[];
  ldSafety: number[];
  postIndices: Set<number>;
} {
  const n = spans.length;
  const ldWork = new Array<number>(n).fill(0);
  const ldSafety = new Array<number>(n).fill(0);
  const postIndices = new Set<number>();

  for (const door of doors ?? []) {
    const { startIdx, spanCount } = resolveDoorSpanRange(spans, door);
    const { ldWork: lw, ldSafety: ls } = levelsWorkAndSafety(
      door.doorTopHeightMmFromGround,
      fullLevels,
      safetyLevels,
      levelHeightMm,
    );
    for (let si = startIdx; si < startIdx + spanCount && si < n; si++) {
      ldWork[si] = Math.max(ldWork[si], lw);
      ldSafety[si] = Math.max(ldSafety[si], ls);
    }
    for (let pi = startIdx; pi <= startIdx + spanCount && pi <= n; pi++) {
      postIndices.add(pi);
    }
  }

  return { ldWork, ldSafety, postIndices };
}

export type KusabiDoorDeductionApply = {
  spans: number[];
  spanGroups: Record<string, number>;
  ldWork: number[];
  ldSafety: number[];
  jackEcoDeduct: number;
  mainPostDeduct: number;
  anchiLayout: { fullAnchiPerSpan: number; halfAnchiPerSpan: number };
  skipTesuriOnTerminalBay: boolean;
  yokojiWidthSize: number;
};

/**
 * After full-wall BOM lines are built, reduce quantities for door openings (くさび式).
 */
export function applyKusabiDoorOpeningDeductionsToComponents(
  components: Array<{ type: string; quantity: number; materialCode?: string; sizeSpec?: string }>,
  d: KusabiDoorDeductionApply,
): void {
  const { spans, ldWork, ldSafety, jackEcoDeduct, mainPostDeduct, anchiLayout, skipTesuriOnTerminalBay, yokojiWidthSize } = d;

  const sumLdWorkForSpanSize = (spanSizeMm: number): number => {
    let s = 0;
    for (let si = 0; si < spans.length; si++) {
      if (spans[si] === spanSizeMm) s += ldWork[si] ?? 0;
    }
    return s;
  };

  const sumLdSafetyForSpanSize = (spanSizeMm: number): number => {
    let s = 0;
    for (let si = 0; si < spans.length; si++) {
      if (spans[si] === spanSizeMm) s += ldSafety[si] ?? 0;
    }
    return s;
  };

  const braceDedBySize: Record<number, number> = {};
  const habakiDedBySize: Record<number, number> = {};
  for (const spanSizeMm of Object.keys(d.spanGroups).map(Number)) {
    braceDedBySize[spanSizeMm] = sumLdSafetyForSpanSize(spanSizeMm) * CALC_RULES.bracePerSpanPerLevel;
    habakiDedBySize[spanSizeMm] = sumLdSafetyForSpanSize(spanSizeMm) * CALC_RULES.habakiPerSpanPerLevel;
  }

  /** Bearer (plank support) — width-direction bucket only. */
  let bearerDed = 0;
  for (let si = 0; si < spans.length; si++) {
    bearerDed += (ldWork[si] ?? 0) * 2;
  }

  for (const c of components) {
    if (c.type === 'jack_base' && c.materialCode === 'KUSABI-JB') {
      c.quantity = Math.max(0, c.quantity - jackEcoDeduct);
    } else if (c.type === 'eco_plate' && c.materialCode === 'SHARED-ECO-PLATE') {
      c.quantity = Math.max(0, c.quantity - jackEcoDeduct);
    } else if (c.type === 'post_main') {
      c.quantity = Math.max(0, c.quantity - mainPostDeduct);
    } else if (c.type === 'brace' && c.materialCode?.startsWith('KUSABI-BRACE-')) {
      const sz = Number(c.materialCode.replace('KUSABI-BRACE-', ''));
      const ded = braceDedBySize[sz] ?? 0;
      c.quantity = Math.max(0, c.quantity - ded);
    } else if (c.type === 'nuno_bar') {
      const sz = Number(c.sizeSpec);
      if (!Number.isFinite(sz)) continue;
      let nunoDed = 0;
      for (let si = 0; si < spans.length; si++) {
        if (spans[si] !== sz) continue;
        if (skipTesuriOnTerminalBay && si === spans.length - 1) continue;
        nunoDed += (ldSafety[si] ?? 0) * CALC_RULES.tesuriPerSpanPerLevel;
      }
      for (let si = 0; si < spans.length; si++) {
        if (spans[si] === sz && (ldWork[si] ?? 0) > 0) nunoDed += 2;
      }
      if (sz === yokojiWidthSize) {
        nunoDed += bearerDed;
      }
      c.quantity = Math.max(0, c.quantity - nunoDed);
    } else if (c.type === 'anchi' && c.materialCode?.startsWith('KUSABI-ANCHI-') && !c.materialCode.includes('HALF')) {
      const parts = (c.materialCode ?? '').replace('KUSABI-ANCHI-', '').split('x');
      const spanSz = Number(parts[1]);
      const ded = anchiLayout.fullAnchiPerSpan * sumLdWorkForSpanSize(spanSz);
      c.quantity = Math.max(0, c.quantity - ded);
    } else if (c.type === 'anchi_half' && c.materialCode?.includes('ANCHI-HALF')) {
      const parts = (c.materialCode ?? '').split('x');
      const spanSz = Number(parts[parts.length - 1]);
      const ded = anchiLayout.halfAnchiPerSpan * sumLdWorkForSpanSize(spanSz);
      c.quantity = Math.max(0, c.quantity - ded);
    } else if (c.type === 'habaki' && c.materialCode?.startsWith('KUSABI-HABAKI-')) {
      const sz = Number(c.materialCode.replace('KUSABI-HABAKI-', ''));
      const ded = habakiDedBySize[sz] ?? 0;
      c.quantity = Math.max(0, c.quantity - ded);
    }
  }
}

export function computeKusabiJackAndPostDoorDeductions(
  postIndices: Set<number>,
  mainPostsPerLine: number,
): { jackEcoDeduct: number; mainPostDeduct: number } {
  const lines = postIndices.size;
  const jackEcoDeduct = 2 * lines;
  const mainPostDeduct = mainPostsPerLine * jackEcoDeduct;
  return { jackEcoDeduct, mainPostDeduct };
}

export type WakugumiDoorDeductionApply = {
  spans: number[];
  spanGroups: Record<string, number>;
  ldWork: number[];
  ldSafety: number[];
  jackEcoDeduct: number;
  frameDeduct: number;
  anchiLayout: { fullAnchiPerSpan: number; halfAnchiPerSpan: number };
  habakiCountPerSpan: number;
  omitInnerFaceOnTerminalBay: boolean;
};

/** 枠組: door opening removes jack/eco, 建枠, brace, 下桟, 踏板, 巾木 in opening spans up to door head. */
export function applyWakugumiDoorOpeningDeductionsToComponents(
  components: Array<{ type: string; quantity: number; materialCode?: string; sizeSpec?: string }>,
  d: WakugumiDoorDeductionApply,
): void {
  const {
    spans,
    ldWork,
    ldSafety,
    jackEcoDeduct,
    frameDeduct,
    anchiLayout,
    habakiCountPerSpan,
    omitInnerFaceOnTerminalBay,
  } = d;

  const sumLdWorkForSpanSize = (spanSizeMm: number): number => {
    let s = 0;
    for (let si = 0; si < spans.length; si++) {
      if (spans[si] === spanSizeMm) s += ldWork[si] ?? 0;
    }
    return s;
  };

  const sumLdSafetyForSpanSize = (spanSizeMm: number): number => {
    let s = 0;
    for (let si = 0; si < spans.length; si++) {
      if (spans[si] === spanSizeMm) s += ldSafety[si] ?? 0;
    }
    return s;
  };

  const braceOrShitasanDedForSize = (spanSizeMm: number, perSpanPerLevel: number): number => {
    let ded = 0;
    for (let si = 0; si < spans.length; si++) {
      if (spans[si] !== spanSizeMm) continue;
      const perLv =
        omitInnerFaceOnTerminalBay && si === spans.length - 1
          ? perSpanPerLevel - 1
          : perSpanPerLevel;
      ded += (ldSafety[si] ?? 0) * perLv;
    }
    return ded;
  };

  const braceDedBySize: Record<number, number> = {};
  const shitasanDedBySize: Record<number, number> = {};
  const habakiDedBySize: Record<number, number> = {};
  for (const spanSizeMm of Object.keys(d.spanGroups).map(Number)) {
    braceDedBySize[spanSizeMm] = braceOrShitasanDedForSize(
      spanSizeMm,
      WAKUGUMI_CALC_RULES.bracePerSpanPerLevel,
    );
    shitasanDedBySize[spanSizeMm] = braceOrShitasanDedForSize(
      spanSizeMm,
      WAKUGUMI_CALC_RULES.shitasanPerSpanPerLevel,
    );
    habakiDedBySize[spanSizeMm] = sumLdSafetyForSpanSize(spanSizeMm) * habakiCountPerSpan;
  }

  for (const c of components) {
    if (c.type === 'jack_base' && c.materialCode === 'SHARED-JB-400') {
      c.quantity = Math.max(0, c.quantity - jackEcoDeduct);
    } else if (c.type === 'eco_plate' && c.materialCode === 'SHARED-ECO-PLATE') {
      c.quantity = Math.max(0, c.quantity - jackEcoDeduct);
    } else if (c.type === 'waku_frame' && c.materialCode?.startsWith('WAKU-FRAME-')) {
      c.quantity = Math.max(0, c.quantity - frameDeduct);
    } else if (c.type === 'brace' && c.materialCode?.startsWith('WAKU-BRACE-')) {
      const sz = Number(c.materialCode.replace('WAKU-BRACE-', ''));
      const ded = braceDedBySize[sz] ?? 0;
      c.quantity = Math.max(0, c.quantity - ded);
    } else if (c.type === 'shitasan' && c.materialCode?.startsWith('WAKU-SHITASAN-')) {
      const sz = Number(c.materialCode.replace('WAKU-SHITASAN-', ''));
      const ded = shitasanDedBySize[sz] ?? 0;
      c.quantity = Math.max(0, c.quantity - ded);
    } else if (c.type === 'anchi' && c.materialCode?.startsWith('WAKU-ANCHI-')) {
      const parts = (c.materialCode ?? '').replace('WAKU-ANCHI-', '').split('x');
      const spanSz = Number(parts[1]);
      const ded = anchiLayout.fullAnchiPerSpan * sumLdWorkForSpanSize(spanSz);
      c.quantity = Math.max(0, c.quantity - ded);
    } else if (c.type === 'anchi_half' && c.materialCode?.startsWith('WAKU-ANCHI-')) {
      const parts = (c.materialCode ?? '').replace('WAKU-ANCHI-', '').split('x');
      const spanSz = Number(parts[1]);
      const ded = anchiLayout.halfAnchiPerSpan * sumLdWorkForSpanSize(spanSz);
      c.quantity = Math.max(0, c.quantity - ded);
    } else if (c.type === 'habaki' && c.materialCode?.startsWith('WAKU-HABAKI-')) {
      const sz = Number(c.materialCode.replace('WAKU-HABAKI-', ''));
      const ded = habakiDedBySize[sz] ?? 0;
      c.quantity = Math.max(0, c.quantity - ded);
    }
  }
}

export function computeWakugumiFrameDoorDeduction(
  postIndices: Set<number>,
  ltot: number,
): number {
  return 2 * postIndices.size * ltot;
}
