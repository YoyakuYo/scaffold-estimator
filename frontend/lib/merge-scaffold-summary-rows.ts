import type { CalculatedComponent } from '@/lib/api/scaffold-configs';

/**
 * One BOM line after merging same 分類 + 部材名(JP) + 単位 (matches backend mergeSummaryForExcel).
 */
export interface MergedScaffoldSummaryRow {
  category: string;
  categoryEn: string;
  nameJp: string;
  unit: string;
  sizeSpecJoined: string;
  sortOrder: number;
  /** Per-wall map keys: materialCode or type-sizeSpec */
  keys: string[];
  hasPattankoOnly: boolean;
  /** Smallest sortOrder line in the group — used to derive English display name */
  representative: CalculatedComponent;
}

/** Same key as backend Excel wall aggregation: materialCode or type-sizeSpec. */
export function scaffoldWallQuantityKey(comp: CalculatedComponent): string {
  return comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
}

/** Strip trailing size tokens from English calculator labels (e.g. "Brace 600mm" → "Brace"). */
export function baseEnglishMaterialName(name: string | undefined): string {
  const n = (name || '').trim();
  if (!n) return '';
  const step1 = n.replace(/\s+\d+\s*[x×]\s*\d+mm\s*$/i, '');
  const step2 = step1.replace(/\s+\d+mm\s*$/i, '');
  return step2.trim() || n;
}

/**
 * Merge summary lines for quotation table / Excel parity: one row per category + nameJp + unit,
 * 規格 column = "600 / 1500 / …".
 */
export function mergeScaffoldSummaryForQuotation(
  summary: CalculatedComponent[],
): MergedScaffoldSummaryRow[] {
  const sorted = [...summary].sort((a, b) => {
    const ca = a.category || '';
    const cb = b.category || '';
    if (ca !== cb) return ca.localeCompare(cb, 'ja');
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return (a.sizeSpec || '').localeCompare(b.sizeSpec || '', 'ja');
  });

  type Acc = {
    category: string;
    categoryEn: string;
    nameJp: string;
    unit: string;
    sortOrder: number;
    keys: Set<string>;
    specsOrdered: string[];
    specSeen: Set<string>;
    pattankoKeys: number;
    representative: CalculatedComponent;
  };

  const groups = new Map<string, Acc>();
  const order: string[] = [];

  for (const comp of sorted) {
    const mapKey = scaffoldWallQuantityKey(comp);
    const gKey = `${comp.category || ''}\t${comp.nameJp}\t${comp.unit}`;
    let g = groups.get(gKey);
    if (!g) {
      g = {
        category: comp.category || '',
        categoryEn: comp.categoryEn || '',
        nameJp: comp.nameJp,
        unit: comp.unit,
        sortOrder: comp.sortOrder,
        keys: new Set(),
        specsOrdered: [],
        specSeen: new Set(),
        pattankoKeys: 0,
        representative: comp,
      };
      groups.set(gKey, g);
      order.push(gKey);
    }
    g.sortOrder = Math.min(g.sortOrder, comp.sortOrder);
    if (comp.sortOrder < g.representative.sortOrder) {
      g.representative = comp;
    }
    g.keys.add(mapKey);
    const sp = (comp.sizeSpec || '').trim();
    if (sp && !g.specSeen.has(sp)) {
      g.specSeen.add(sp);
      g.specsOrdered.push(sp);
    }
    if (comp.materialCode === 'PATTANKO') g.pattankoKeys += 1;
  }

  return order.map((k) => {
    const g = groups.get(k)!;
    const hasPattankoOnly = g.pattankoKeys === g.keys.size && g.pattankoKeys > 0;
    return {
      category: g.category,
      categoryEn: g.representative.categoryEn || g.categoryEn,
      nameJp: g.nameJp,
      unit: g.unit,
      sizeSpecJoined: g.specsOrdered.join(' / '),
      sortOrder: g.sortOrder,
      keys: [...g.keys],
      hasPattankoOnly,
      representative: g.representative,
    };
  });
}
