import type { CalculatedComponent } from '@/lib/api/scaffold-configs';
import { compareCalculatedComponentsForBom } from '@/lib/scaffold-bom-sort';

const IMG_BASE = '/images/scaffold-materials';

export type ScaffoldGalleryType = 'kusabi' | 'wakugumi';

/** Group `anchi` + `anchi_half` into one visual card with summed quantity. */
export function materialGalleryAggregationKey(comp: CalculatedComponent): string {
  if (comp.type === 'anchi' || comp.type === 'anchi_half') return 'anchi_group';
  return comp.type;
}

/**
 * Public URL under `frontend/public/images/scaffold-materials/`.
 * Shared parts appear for both scaffold types; kusabi/wakugumi folders match the active calculation.
 */
export function materialGalleryImageSrc(
  aggregationKey: string,
  scaffoldType: ScaffoldGalleryType,
): string | null {
  switch (aggregationKey) {
    case 'jack_base':
      return `${IMG_BASE}/shared/jack-base.png`;
    case 'eco_plate':
      return `${IMG_BASE}/shared/eco-plate.png`;
    case 'post_main':
      return `${IMG_BASE}/kusabi/tateji.png`;
    case 'waku_frame':
      return `${IMG_BASE}/wakugumi/waku.png`;
    case 'brace':
      return scaffoldType === 'wakugumi'
        ? `${IMG_BASE}/wakugumi/buresu.png`
        : `${IMG_BASE}/kusabi/buresu.png`;
    case 'nuno_bar':
      return `${IMG_BASE}/kusabi/nuno-bar.png`;
    case 'shitasan':
      return `${IMG_BASE}/wakugumi/shita-san.png`;
    case 'end_stopper_nuno':
      return `${IMG_BASE}/kusabi/nuno-bar.png`;
    case 'end_stopper_frame':
      return `${IMG_BASE}/wakugumi/end-stopper.png`;
    case 'anchi_group':
      return `${IMG_BASE}/shared/anchi.png`;
    case 'pattanko':
      return `${IMG_BASE}/shared/pattanko.png`;
    case 'habaki':
      return `${IMG_BASE}/shared/habaki.png`;
    case 'sokan_bracket':
      return `${IMG_BASE}/shared/sokan-buragetto.png`;
    case 'sokan_netto':
      return `${IMG_BASE}/shared/sokan-netto.png`;
    case 'mesh_shito':
      return `${IMG_BASE}/shared/mesh-shito.png`;
    case 'stair_set':
      return `${IMG_BASE}/shared/kaidan.png`;
    case 'hariwaku':
      return `${IMG_BASE}/shared/hariwaku.png`;
    default:
      return null;
  }
}

/** BOM `type` used only for sort order (anchi_group → treat as anchi). */
function bomTypeForSort(aggregationKey: string): string {
  if (aggregationKey === 'anchi_group') return 'anchi';
  return aggregationKey;
}

export interface MaterialGalleryRow {
  aggregationKey: string;
  quantity: number;
  imageSrc: string | null;
  /** Min sortOrder among merged lines */
  sortOrder: number;
  /** First sizeSpec after BOM sort — tie-breaker */
  sizeSpec: string;
  unit: string;
  label: string;
  specSummary: string;
}

export function buildMaterialGalleryRows(
  summary: CalculatedComponent[],
  scaffoldType: ScaffoldGalleryType,
  locale: string,
): MaterialGalleryRow[] {
  const map = new Map<string, { qty: number; comps: CalculatedComponent[] }>();
  for (const c of summary) {
    const key = materialGalleryAggregationKey(c);
    const cur = map.get(key) ?? { qty: 0, comps: [] };
    cur.qty += c.quantity;
    cur.comps.push(c);
    map.set(key, cur);
  }

  const rows: MaterialGalleryRow[] = [];
  for (const [aggregationKey, { qty, comps }] of map) {
    const sorted = [...comps].sort(compareCalculatedComponentsForBom);
    const first = sorted[0];
    const specs = [...new Set(sorted.map((c) => c.sizeSpec).filter(Boolean))];
    let specSummary = '';
    if (specs.length === 0) specSummary = '';
    else if (specs.length <= 3) specSummary = specs.join(' · ');
    else specSummary = specs.slice(0, 2).join(' · ') + ` · +${specs.length - 2}`;

    const label =
      locale === 'ja'
        ? (first.nameJp || first.name || first.type).trim()
        : (first.name || first.nameJp || first.type).trim();

    rows.push({
      aggregationKey,
      quantity: qty,
      imageSrc: materialGalleryImageSrc(aggregationKey, scaffoldType),
      sortOrder: Math.min(...comps.map((c) => c.sortOrder)),
      sizeSpec: first.sizeSpec || '',
      unit: first.unit || '',
      label,
      specSummary,
    });
  }

  const sortKey = (r: MaterialGalleryRow) => ({
    type: bomTypeForSort(r.aggregationKey),
    sortOrder: r.sortOrder,
    sizeSpec: r.sizeSpec,
  });

  rows.sort((a, b) => compareCalculatedComponentsForBom(sortKey(a), sortKey(b)));
  return rows;
}
