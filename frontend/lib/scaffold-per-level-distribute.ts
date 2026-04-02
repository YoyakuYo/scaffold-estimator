import type { CalculatedComponent, WallCalculationResult } from '@/lib/api/scaffold-configs';
import { scaffoldWallQuantityKey } from '@/lib/merge-scaffold-summary-rows';

/**
 * Split a wall line item across scaffold lifts — same rules as
 * `backend/src/modules/scaffold-config/material-breakdown-excel.util.ts` (Excel BOM).
 */
export function distributeByScaffoldLevel(
  comp: CalculatedComponent,
  wallLevels: number,
  scaffoldLevelCount: number,
): number[] {
  const rows = Array.from({ length: scaffoldLevelCount }, () => 0);
  const levels = Math.max(1, wallLevels);
  const qty = Math.max(0, Math.round(comp.quantity || 0));
  if (qty <= 0) return rows;

  if (comp.type === 'jack_base' || comp.type === 'eco_plate') {
    rows[0] = qty;
    return rows;
  }

  if (comp.type === 'post_top') {
    rows[Math.min(levels - 1, scaffoldLevelCount - 1)] = qty;
    return rows;
  }

  const visibleLevels = Math.min(levels, scaffoldLevelCount);
  const baseQty = Math.floor(qty / levels);
  let rem = qty - baseQty * levels;
  for (let i = 0; i < visibleLevels; i++) {
    rows[i] = baseQty + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
  }
  if (levels > scaffoldLevelCount) {
    rows[scaffoldLevelCount - 1] += baseQty * (levels - scaffoldLevelCount);
    if (rem > 0) rows[scaffoldLevelCount - 1] += rem;
  }
  return rows;
}

/** Per-wall quantity maps for one scaffold lift index (0-based). */
export function buildWallMapsForScaffoldLevel(
  walls: WallCalculationResult[],
  levelIndex: number,
  scaffoldLevelCount: number,
): globalThis.Map<string, number>[] {
  return walls.map((wall) => {
    const m = new globalThis.Map<string, number>();
    const L = wall.levelCalc?.fullLevels ?? 1;
    for (const comp of wall.components ?? []) {
      const arr = distributeByScaffoldLevel(comp, L, scaffoldLevelCount);
      const q = arr[levelIndex] ?? 0;
      if (q <= 0) continue;
      const key = scaffoldWallQuantityKey(comp);
      m.set(key, (m.get(key) || 0) + q);
    }
    return m;
  });
}
