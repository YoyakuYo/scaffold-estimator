import type { CalculatedComponent } from '@/lib/api/scaffold-configs';

/** Same key as backend Excel wall aggregation: materialCode or type-sizeSpec. */
export function scaffoldWallQuantityKey(comp: CalculatedComponent): string {
  return comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
}

export interface MaterialSummaryGroup {
  category: string;
  categoryEn: string;
  nameJp: string;
  unit: string;
  sortOrder: number;
  components: CalculatedComponent[];
}

function sortSummary(summary: CalculatedComponent[]): CalculatedComponent[] {
  return [...summary].sort((a, b) => {
    const ca = a.category || '';
    const cb = b.category || '';
    if (ca !== cb) return ca.localeCompare(cb, 'ja');
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return (a.sizeSpec || '').localeCompare(b.sizeSpec || '', 'ja');
  });
}

const groupKey = (c: CalculatedComponent) =>
  `${c.category || ''}\t${c.nameJp || ''}\t${c.unit || ''}`;

/**
 * Adjacent lines with same 分類 + 部材名(JP) + 単位 (after sort) — for section banners + 規格別 rows.
 */
export function groupScaffoldSummaryByMaterial(summary: CalculatedComponent[]): MaterialSummaryGroup[] {
  const sorted = sortSummary(summary);
  const out: MaterialSummaryGroup[] = [];
  for (const comp of sorted) {
    const k = groupKey(comp);
    const prev = out[out.length - 1];
    if (prev && groupKey(prev.components[0]) === k) {
      prev.components.push(comp);
      prev.sortOrder = Math.min(prev.sortOrder, comp.sortOrder);
    } else {
      out.push({
        category: comp.category || '',
        categoryEn: comp.categoryEn || '',
        nameJp: comp.nameJp,
        unit: comp.unit,
        sortOrder: comp.sortOrder,
        components: [comp],
      });
    }
  }
  return out;
}
