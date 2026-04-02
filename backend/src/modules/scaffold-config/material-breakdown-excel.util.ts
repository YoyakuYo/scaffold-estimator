import { CalculatedComponent } from './scaffold-calculator.service';

const TYPICAL_BUILDING_STORY_MM = 3000;

export function buildingFloorCountFromHeight(buildingHeightMm: number): number {
  return Math.max(1, Math.ceil(buildingHeightMm / TYPICAL_BUILDING_STORY_MM));
}

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

export function aggregateLevelQtyToFloors(
  levelQty: number[],
  levelHeightMm: number,
  buildingFloorCount: number,
): number[] {
  const floors = Array.from({ length: buildingFloorCount }, () => 0);
  for (let l = 0; l < levelQty.length; l++) {
    const qty = levelQty[l] || 0;
    if (qty === 0) continue;
    const yMid = (l + 0.5) * levelHeightMm;
    const f = Math.min(
      buildingFloorCount - 1,
      Math.max(0, Math.floor(yMid / TYPICAL_BUILDING_STORY_MM)),
    );
    floors[f] += qty;
  }
  return floors;
}
