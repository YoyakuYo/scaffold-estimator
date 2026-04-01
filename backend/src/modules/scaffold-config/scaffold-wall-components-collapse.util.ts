import type { CalculatedComponent } from './scaffold-calculator.service';
import { compareCalculatedComponentsForBom } from './scaffold-bom-sort';

/** Per-wall collapse: one BOM row per material (sizes joined in 規格). */
export const KUSABI_COLLAPSE_MULTI_CODES: Record<string, string> = {
  brace: 'KUSABI-BRACE-MULTI',
  nuno_bar: 'KUSABI-NUNO-MULTI',
  anchi: 'KUSABI-ANCHI-MULTI',
  anchi_half: 'KUSABI-ANCHI-HALF-MULTI',
  habaki: 'KUSABI-HABAKI-MULTI',
};

export const WAKUGUMI_COLLAPSE_MULTI_CODES: Record<string, string> = {
  brace: 'WAKU-BRACE-MULTI',
  shitasan: 'WAKU-SHITASAN-MULTI',
  anchi: 'WAKU-ANCHI-MULTI',
  anchi_half: 'WAKU-ANCHI-HALF-MULTI',
  habaki: 'WAKU-HABAKI-MULTI',
};

export function isCollapsedMultiMaterialCode(code?: string): boolean {
  return !!code && code.endsWith('-MULTI');
}

export function mergeSizeSpecParts(a: string, b: string): string {
  const parts = new Set<string>();
  for (const s of [a, b]) {
    for (const p of s.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean)) {
      parts.add(p);
    }
  }
  return [...parts].sort((x, y) => specSortKey(x) - specSortKey(y) || x.localeCompare(y, 'ja')).join(' / ');
}

function specSortKey(s: string): number {
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Merge brace / nuno / plank / habaki (same nameJp+unit) into one line with summed qty and joined sizeSpec.
 */
export function collapseMultiSpanComponents(
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

export interface WallLike {
  components: CalculatedComponent[];
}

/**
 * Global summary: sum quantities across walls; union sizeSpec for *-MULTI lines.
 */
export function aggregateComponentsFromWalls(
  walls: WallLike[],
  mergeNunoByCategoryWhenNoMultiCode: boolean,
): CalculatedComponent[] {
  const map = new Map<string, CalculatedComponent>();

  for (const wall of walls) {
    for (const comp of wall.components) {
      let key: string;
      if (isCollapsedMultiMaterialCode(comp.materialCode)) {
        key = comp.materialCode!;
      } else if (mergeNunoByCategoryWhenNoMultiCode && comp.category === '布材') {
        key = `${comp.category}-${comp.sizeSpec}`;
      } else {
        key = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
      }

      const existing = map.get(key);
      if (existing) {
        existing.quantity += comp.quantity;
        if (isCollapsedMultiMaterialCode(comp.materialCode)) {
          existing.sizeSpec = mergeSizeSpecParts(existing.sizeSpec, comp.sizeSpec);
        }
      } else {
        map.set(key, { ...comp });
      }
    }
  }

  return Array.from(map.values()).sort(compareCalculatedComponentsForBom);
}
