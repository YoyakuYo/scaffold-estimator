/**
 * Wakugumi closed-polygon span fitting for 3D/plan — mirrors
 * `backend/src/modules/scaffold-config/scaffold-rules-wakugumi.ts` (keep in sync).
 * Bundled here because Next Turbopack root is `frontend/` and cannot import `../backend`.
 */

import { SPAN_SIZES_MM, finalizeStandardSpanRowWithNominal } from './scaffold-span-merge';
import { normalizeScaffoldWidthMmToCatalog, SCAFFOLD_WIDTH_NARROW_MM } from './scaffold-width-catalog';

export const WAKUGUMI_CORNER_OVERRUN_MM = 300;
const WAKUGUMI_CORNER_START_SPAN_MM = 1829;

const WAKUGUMI_SPAN_SIZES: number[] = [...SPAN_SIZES_MM];

export function cornerTerminalSpanMmWakugumi(scaffoldWidthMm: number): number {
  return normalizeScaffoldWidthMmToCatalog(scaffoldWidthMm);
}

function exactSumWithStandardSpans(target: number, spanSizesMm: readonly number[]): number[] | null {
  if (!Number.isFinite(target) || target < 0) return null;
  if (target === 0) return [];
  const sizes = [...spanSizesMm].filter((n) => Number.isFinite(n) && n > 0);
  if (sizes.length === 0) return null;
  const sortedDesc = [...new Set(sizes)].sort((a, b) => b - a);
  const min = sortedDesc[sortedDesc.length - 1]!;
  if (target < min) return null;

  const dp: (number[] | null)[] = Array(target + 1).fill(null);
  dp[0] = [];
  for (let t = 1; t <= target; t++) {
    for (const s of sortedDesc) {
      if (s <= t && dp[t - s] !== null) {
        dp[t] = [...dp[t - s]!, s];
        break;
      }
    }
  }
  const raw = dp[target];
  if (!raw) return null;
  return raw.sort((a, b) => b - a);
}

function splitOneMiddleSpanInPlace(spans: number[], spanSizes: readonly number[]): boolean {
  const set = new Set(spanSizes);
  const positives = [...set].filter((n) => Number.isFinite(n) && n > 0);
  if (positives.length === 0) return false;
  const minSpan = Math.min(...positives);
  let bestI = -1;
  let bestA = 0;
  let bestB = 0;
  let bestSpan = -1;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s === undefined || s <= minSpan) continue;
    for (const a of spanSizes) {
      const b = s - a;
      if (b > 0 && set.has(b)) {
        if (s > bestSpan) {
          bestSpan = s;
          bestI = i;
          bestA = a;
          bestB = b;
        }
      }
    }
  }
  if (bestI < 0) return false;
  const hi = Math.max(bestA, bestB);
  const lo = Math.min(bestA, bestB);
  spans.splice(bestI, 1, hi, lo);
  return true;
}

function expandMiddleSpansToTargetCount(
  middleSpans: number[],
  middleMm: number,
  spanSizes: readonly number[],
  cornerStartMm: number,
): number[] {
  const spans = [...middleSpans];
  const sum = spans.reduce((a, b) => a + b, 0);
  if (sum !== middleMm || middleMm <= 0) return spans;
  const target = Math.ceil(middleMm / cornerStartMm) + 1;
  let guard = 0;
  while (spans.length < target && guard++ < 40) {
    if (!splitOneMiddleSpanInPlace(spans, spanSizes)) break;
  }
  return spans;
}

function fitSpansToWallLengthWithOverrun(
  wallLengthMm: number,
  spanSizesMm: number[],
  maxOverrunMm: number,
): number[] {
  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) return [];

  const sizes = [...spanSizesMm].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
  if (sizes.length === 0) return [];

  const max = sizes[0]!;
  const min = sizes[sizes.length - 1]!;

  const tailMaxCount = 10;
  const reserve = max * 4;
  const prefixCount = wallLengthMm > reserve ? Math.floor((wallLengthMm - reserve) / max) : 0;
  const prefixSum = prefixCount * max;
  const target = wallLengthMm - prefixSum;

  const tailMaxSum = target + Math.max(maxOverrunMm, max);
  const maxCountByMin = Math.ceil(tailMaxSum / min);
  const maxCount = Math.max(1, Math.min(tailMaxCount, maxCountByMin));

  type BestCandidate = { spans: number[]; sum: number; overrun: number; within: boolean };
  let best: BestCandidate | undefined;

  const betterThan = (a: BestCandidate, b: BestCandidate) => {
    if (a.within !== b.within) return a.within;
    if (a.overrun !== b.overrun) return a.overrun < b.overrun;
    if (a.spans.length !== b.spans.length) return a.spans.length < b.spans.length;
    for (let i = 0; i < Math.min(a.spans.length, b.spans.length); i++) {
      if (a.spans[i] !== b.spans[i]) return (a.spans[i] ?? 0) > (b.spans[i] ?? 0);
    }
    return false;
  };

  const dfs = (startIdx: number, chosen: number[], sum: number) => {
    if (sum >= target) {
      const overrun = sum - target;
      const within = overrun <= maxOverrunMm;
      const cand: BestCandidate = { spans: [...chosen], sum, overrun, within };
      if (!best || betterThan(cand, best)) best = cand;
      if (within && overrun === 0) return;
      return;
    }

    if (chosen.length >= maxCount) return;
    const remainingSlots = maxCount - chosen.length;
    if (sum + remainingSlots * max < target) return;

    for (let i = startIdx; i < sizes.length; i++) {
      const s = sizes[i]!;
      const nextSum = sum + s;
      if (best && best.within && nextSum - target > maxOverrunMm) continue;
      chosen.push(s);
      dfs(i, chosen, nextSum);
      chosen.pop();
    }
  };

  dfs(0, [], 0);

  const tail = best?.spans?.length ? best.spans : [min];
  const result = [...Array(prefixCount).fill(max), ...tail] as number[];
  const total = result.reduce((a, b) => a + b, 0);
  if (total < wallLengthMm) result.push(min);
  return result;
}

function fitSpansToWallLengthNoOverrun(wallLengthMm: number, spanSizesMm: number[]): number[] {
  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) return [];
  const sizes = [...spanSizesMm].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
  if (sizes.length === 0) return [];
  const max = sizes[0]!;
  const min = sizes[sizes.length - 1]!;

  const reserve = max * 6;
  const prefixCount = wallLengthMm > reserve ? Math.floor((wallLengthMm - reserve) / max) : 0;
  const prefix = Array(prefixCount).fill(max);
  const prefixSum = prefixCount * max;
  const remaining = wallLengthMm - prefixSum;
  if (remaining <= 0) return prefix;

  const maxCount = Math.min(10, Math.ceil(remaining / min) + 2);
  let best: number[] = [];
  let bestSum = 0;

  const dfs = (startIdx: number, acc: number[], sum: number) => {
    if (sum > remaining) return;
    if (sum > bestSum) {
      bestSum = sum;
      best = [...acc];
      if (bestSum === remaining) return;
    }
    if (acc.length >= maxCount) return;
    for (let i = startIdx; i < sizes.length; i++) {
      const s = sizes[i]!;
      if (sum + s > remaining) continue;
      acc.push(s);
      dfs(i, acc, sum + s);
      acc.pop();
      if (bestSum === remaining) return;
    }
  };
  dfs(0, [], 0);

  if (best.length === 0) return prefix;
  return [...prefix, ...best];
}

export function fitSpansToWallLengthWithCornerWakugumi(
  wallLengthMm: number,
  scaffoldWidthMm: number = SCAFFOLD_WIDTH_NARROW_MM,
  options?: {
    startCornerKind?: 'convex' | 'reflex';
    endCornerKind?: 'convex' | 'reflex';
  },
): number[] {
  const terminal = cornerTerminalSpanMmWakugumi(scaffoldWidthMm);
  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) {
    return [WAKUGUMI_CORNER_START_SPAN_MM, terminal];
  }

  const startKind = options?.startCornerKind ?? 'convex';
  const endKind = options?.endCornerKind ?? 'convex';
  const startIsConvex = startKind !== 'reflex';
  const endIsConvex = endKind !== 'reflex';

  if (!startIsConvex || !endIsConvex) {
    const reflexInset =
      (startIsConvex ? 0 : WAKUGUMI_CORNER_OVERRUN_MM) + (endIsConvex ? 0 : WAKUGUMI_CORNER_OVERRUN_MM);
    const effectiveFacadeMm = Math.max(0, wallLengthMm - reflexInset);
    const prefix = startIsConvex ? [WAKUGUMI_CORNER_START_SPAN_MM] : [];
    const prefixSum = prefix.reduce((a, b) => a + b, 0);

    if (!endIsConvex) {
      const middleNeed = effectiveFacadeMm - prefixSum - terminal;
      if (middleNeed >= 0) {
        const middleExact = exactSumWithStandardSpans(middleNeed, WAKUGUMI_SPAN_SIZES);
        if (middleExact !== null) {
          return [...prefix, ...middleExact, terminal];
        }
      }
      const middleTarget = effectiveFacadeMm - prefixSum;
      if (middleTarget <= 0) return [...prefix];
      const middleSpans = fitSpansToWallLengthNoOverrun(middleTarget, WAKUGUMI_SPAN_SIZES);
      return [...prefix, ...middleSpans];
    }

    const suffix = [terminal];
    const runTarget = effectiveFacadeMm + WAKUGUMI_CORNER_OVERRUN_MM + terminal;
    const middleTarget = runTarget - prefixSum - terminal;
    if (middleTarget <= 0) return [...prefix, ...suffix];
    const middleSpans = fitSpansToWallLengthNoOverrun(middleTarget, WAKUGUMI_SPAN_SIZES);
    return [...prefix, ...middleSpans, ...suffix];
  }

  const runTargetMm = wallLengthMm + WAKUGUMI_CORNER_OVERRUN_MM + terminal;
  const middleMmNew = runTargetMm - WAKUGUMI_CORNER_START_SPAN_MM - terminal;

  if (middleMmNew < 0) {
    const middleNeed = runTargetMm - 2 * terminal;
    if (middleNeed <= 0) {
      return [terminal, terminal];
    }
    const middleSpans = fitSpansToWallLengthWithOverrun(middleNeed, WAKUGUMI_SPAN_SIZES, 0);
    return [terminal, ...finalizeStandardSpanRowWithNominal(middleSpans), terminal];
  }
  if (middleMmNew === 0) {
    return [WAKUGUMI_CORNER_START_SPAN_MM, terminal];
  }
  let middleSpans = fitSpansToWallLengthWithOverrun(middleMmNew, WAKUGUMI_SPAN_SIZES, 0);
  middleSpans = expandMiddleSpansToTargetCount(
    middleSpans,
    middleMmNew,
    WAKUGUMI_SPAN_SIZES,
    WAKUGUMI_CORNER_START_SPAN_MM,
  );
  return [
    WAKUGUMI_CORNER_START_SPAN_MM,
    ...finalizeStandardSpanRowWithNominal(middleSpans),
    terminal,
  ];
}
