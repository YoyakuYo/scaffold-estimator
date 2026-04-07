/**
 * Mirror of backend `scaffold-rules.ts` span compression for 3D display only.
 * When `onlyInterior` is true (multi-wall layouts), first and last bays are left unchanged;
 * only the spans **between** them are merged (914+914→1829, etc.) — corner/start/terminal bays untouched.
 * Keep logic aligned with `backend/src/modules/scaffold-config/scaffold-rules.ts`.
 */

export const SPAN_SIZES_MM = [610, 914, 1219, 1524, 1829] as const;
const SPAN_SIZE_SET: ReadonlySet<number> = new Set(SPAN_SIZES_MM);

const NOMINAL_PAIR_MERGE_MAX_DELTA_MM = 1;

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
 * @param onlyInterior — if true and length ≥ 3, merge only `spans[1..n-2]`; never merge end bays with neighbors.
 */
export function finalizeWallSpansForThreeD(
  spans: readonly number[],
  options: { onlyInterior: boolean },
): number[] {
  const s = [...spans];
  if (s.length === 0) return s;
  if (options.onlyInterior && s.length >= 3) {
    const first = s[0]!;
    const last = s[s.length - 1]!;
    const mid = s.slice(1, -1);
    return [first, ...finalizeStandardSpanRowWithNominal(mid), last];
  }
  return finalizeStandardSpanRowWithNominal(s);
}
