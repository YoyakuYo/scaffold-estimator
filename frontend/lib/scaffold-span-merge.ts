/**
 * Mirror of backend `scaffold-rules.ts` span compression so 3D (and other UI) matches
 * merged catalog bays without requiring an immediate recalculate. Keep in sync with:
 * `backend/src/modules/scaffold-config/scaffold-rules.ts` (compress/finalize helpers).
 */

import { normalizeScaffoldWidthMmToCatalog } from '@/lib/scaffold-width-catalog';

export const SPAN_SIZES_MM = [610, 914, 1219, 1524, 1829] as const;
const SPAN_SIZE_SET: ReadonlySet<number> = new Set(SPAN_SIZES_MM);

/** @see KUSABI_NOMINAL_PAIR_MERGE_MAX_DELTA_MM */
const NOMINAL_PAIR_MERGE_MAX_DELTA_MM = 1;

/** @see CORNER_START_SPAN_MM */
const CORNER_START_SPAN_MM = 1829;

export function compressAdjacentCatalogSumMerges(spans: readonly number[]): number[] {
  const out = [...spans];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length - 1; i++) {
      const sum = out[i]! + out[i + 1]!;
      if (SPAN_SIZE_SET.has(sum)) {
        out.splice(i, 2, sum);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export function compressAdjacentNominalSameSpanMerges(
  spans: readonly number[],
  maxDeltaMm: number = NOMINAL_PAIR_MERGE_MAX_DELTA_MM,
): number[] {
  const catalog = [...SPAN_SIZE_SET].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const out = [...spans];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i]!;
      const b = out[i + 1]!;
      if (a !== b) continue;
      const sum = a + b;
      let best: number | null = null;
      let bestD = Infinity;
      for (const c of catalog) {
        const d = Math.abs(sum - c);
        if (d <= maxDeltaMm && d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best != null) {
        out.splice(i, 2, best);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export function finalizeStandardSpanRowWithNominal(spans: readonly number[]): number[] {
  let out = [...spans];
  for (let g = 0; g < 80; g++) {
    const step1 = compressAdjacentCatalogSumMerges(out);
    const step2 = compressAdjacentNominalSameSpanMerges(step1);
    if (step2.length === out.length && step2.every((v, i) => v === out[i]!)) return step2;
    out = step2;
  }
  return out;
}

/**
 * Apply catalog + nominal merges for 3D display. When the row looks like standard closed-loop
 * packing (1829 … terminal or terminal … terminal), only the **middle** is merged so we never
 * fuse the width-module terminal with the previous bay (914+610→1524).
 */
export function finalizeWallSpansForThreeD(spans: readonly number[], scaffoldWidthMm: number): number[] {
  const s = [...spans];
  if (s.length === 0) return s;
  if (s.length < 2) return finalizeStandardSpanRowWithNominal(s);

  const terminal = normalizeScaffoldWidthMmToCatalog(scaffoldWidthMm);
  const first = s[0]!;
  const last = s[s.length - 1]!;
  const middleOnly =
    s.length >= 3 &&
    ((first === CORNER_START_SPAN_MM && last === terminal) ||
      (first === terminal && last === terminal));

  if (middleOnly) {
    const mid = s.slice(1, -1);
    if (mid.length === 0) return s;
    return [first, ...finalizeStandardSpanRowWithNominal(mid), last];
  }
  return finalizeStandardSpanRowWithNominal(s);
}
