import type { CalculatedComponent, WallCalculationResult } from '@/lib/api/scaffold-configs';

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

function normalizeWallComponents(components: CalculatedComponent[]): CalculatedComponent[] {
  return mergePostTopIntoMain(components);
}

/**
 * Client-side BOM shape for 見積表 / breakdown: merges top guard into main posts when API JSON is stale.
 */
export function normalizeScaffoldResultForQuotation<T extends { walls?: WallCalculationResult[]; summary?: CalculatedComponent[] }>(
  result: T,
): T {
  const walls = Array.isArray(result.walls)
    ? result.walls.map((w) => ({
        ...w,
        components: normalizeWallComponents((w.components ?? []).map((c) => ({ ...c }))),
      }))
    : result.walls;

  const summary = Array.isArray(result.summary)
    ? normalizeWallComponents(result.summary.map((c) => ({ ...c })))
    : result.summary;

  return { ...result, walls, summary };
}
