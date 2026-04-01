import type { CalculatedComponent, WallCalculationResult } from '@/lib/api/scaffold-configs';

/** Match backend scaffold-wall-components-collapse.util.ts */
const KUSABI_COLLAPSE_MULTI_CODES: Record<string, string> = {
  brace: 'KUSABI-BRACE-MULTI',
  nuno_bar: 'KUSABI-NUNO-MULTI',
  anchi: 'KUSABI-ANCHI-MULTI',
  anchi_half: 'KUSABI-ANCHI-HALF-MULTI',
  habaki: 'KUSABI-HABAKI-MULTI',
};

const WAKUGUMI_COLLAPSE_MULTI_CODES: Record<string, string> = {
  brace: 'WAKU-BRACE-MULTI',
  shitasan: 'WAKU-SHITASAN-MULTI',
  anchi: 'WAKU-ANCHI-MULTI',
  anchi_half: 'WAKU-ANCHI-HALF-MULTI',
  habaki: 'WAKU-HABAKI-MULTI',
};

function specSortKey(s: string): number {
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function collapseMultiSpanComponents(
  components: CalculatedComponent[],
  multiCodes: Record<string, string>,
): CalculatedComponent[] {
  const mergeTypes = new Set(Object.keys(multiCodes));
  const kept: CalculatedComponent[] = [];
  const buckets = new Map<string, CalculatedComponent[]>();

  for (const c of components) {
    if (!mergeTypes.has(c.type)) {
      kept.push(c);
      continue;
    }
    const gk = `${c.type}\t${c.nameJp}\t${c.unit}`;
    if (!buckets.has(gk)) buckets.set(gk, []);
    buckets.get(gk)!.push(c);
  }

  const merged: CalculatedComponent[] = [];
  for (const [, group] of buckets) {
    const first = group[0]!;
    const specs = [...new Set(group.map((g) => (g.sizeSpec || '').trim()).filter(Boolean))];
    specs.sort((x, y) => specSortKey(x) - specSortKey(y) || x.localeCompare(y, 'ja'));
    merged.push({
      ...first,
      quantity: group.reduce((s, g) => s + g.quantity, 0),
      sizeSpec: specs.join(' / '),
      materialCode: multiCodes[first.type],
      sortOrder: Math.min(...group.map((g) => g.sortOrder)),
    });
  }

  return [...kept, ...merged].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Add top-guard count into first main post row; drop post_top lines. */
function mergePostTopIntoMain(components: CalculatedComponent[]): CalculatedComponent[] {
  const tops = components.filter((c) => c.type === 'post_top');
  if (!tops.length) return components.map((c) => ({ ...c }));
  const topQty = tops.reduce((s, c) => s + c.quantity, 0);
  const withoutTop = components.filter((c) => c.type !== 'post_top').map((c) => ({ ...c }));
  const mainIdx = withoutTop.findIndex((c) => c.type === 'post_main');
  if (mainIdx < 0) return withoutTop;
  const m = withoutTop[mainIdx]!;
  withoutTop[mainIdx] = { ...m, quantity: m.quantity + topQty };
  return withoutTop;
}

function normalizeWallComponents(
  components: CalculatedComponent[],
  isWakugumi: boolean,
): CalculatedComponent[] {
  const merged = mergePostTopIntoMain(components);
  return collapseMultiSpanComponents(
    merged,
    isWakugumi ? WAKUGUMI_COLLAPSE_MULTI_CODES : KUSABI_COLLAPSE_MULTI_CODES,
  );
}

function normalizeSummary(components: CalculatedComponent[], isWakugumi: boolean): CalculatedComponent[] {
  return normalizeWallComponents(components, isWakugumi);
}

/**
 * Client-side BOM shape for 見積表 / breakdown: matches latest backend even when API JSON is stale.
 */
export function normalizeScaffoldResultForQuotation<T extends { scaffoldType?: string; walls?: WallCalculationResult[]; summary?: CalculatedComponent[] }>(
  result: T,
): T {
  const isWk = result.scaffoldType === 'wakugumi';
  const walls = Array.isArray(result.walls)
    ? result.walls.map((w) => ({
        ...w,
        components: normalizeWallComponents(
          (w.components ?? []).map((c) => ({ ...c })),
          isWk,
        ),
      }))
    : result.walls;

  const summary = Array.isArray(result.summary)
    ? normalizeSummary(
        result.summary.map((c) => ({ ...c })),
        isWk,
      )
    : result.summary;

  return { ...result, walls, summary };
}
