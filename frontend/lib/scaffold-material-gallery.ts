import type { CalculatedComponent } from '@/lib/api/scaffold-configs';
import { compareCalculatedComponentsForBom } from '@/lib/scaffold-bom-sort';

const IMG_BASE = '/images/scaffold-materials';

export type ScaffoldGalleryType = 'kusabi' | 'wakugumi';

/** Group `anchi` + `anchi_half` into one image bucket (rows still split by size). */
export function materialGalleryAggregationKey(comp: CalculatedComponent): string {
  if (comp.type === 'anchi' || comp.type === 'anchi_half') return 'anchi_group';
  return comp.type;
}

/** Merge key: same gallery image + same BOM line identity (size / material). */
function galleryRowMergeKey(c: CalculatedComponent): string {
  const agg = materialGalleryAggregationKey(c);
  return `${agg}\x1e${c.type}\x1e${c.materialCode ?? ''}\x1e${c.sizeSpec ?? ''}`;
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
      // Wakugumi BOM uses this type for 端部 (bar-type); kusabi rolls stopper into `nuno_bar` rows.
      return scaffoldType === 'wakugumi'
        ? `${IMG_BASE}/wakugumi/end-stopper.png`
        : `${IMG_BASE}/kusabi/nuno-bar.png`;
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

/**
 * Short "L####" label from BOM sizeSpec for the gallery thumbnail (e.g. L610, L1829).
 * Uses the larger dimension for `W×H` plank specs so the span side wins (500×610 → L610).
 */
export function materialGalleryThumbnailBadge(spec: string): string | null {
  const s = (spec ?? '').trim();
  if (!s) return null;
  const xy = s.match(/(\d+)\s*[×xX]\s*(\d+)/);
  if (xy) {
    const a = parseInt(xy[1]!, 10);
    const b = parseInt(xy[2]!, 10);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      // Mesh / sheet: "610×3600mm" — second value is height; badge follows span width (610, 914, …).
      if (b >= 2500) return `L${a}`;
      return `L${Math.max(a, b)}`;
    }
  }
  const mm = s.match(/(\d{3,5})\s*mm/i);
  if (mm) return `L${mm[1]}`;
  const word = s.match(/\b(\d{3,5})\b/);
  if (word) return `L${word[1]}`;
  return null;
}

export interface MaterialGalleryRow {
  /** Stable key for list items */
  rowId: string;
  aggregationKey: string;
  quantity: number;
  imageSrc: string | null;
  /** Min sortOrder among merged lines */
  sortOrder: number;
  sizeSpec: string;
  unit: string;
  label: string;
  /** First merged line’s `type` — BOM sort (anchi vs anchi_half, etc.) */
  bomType: string;
}

export function buildMaterialGalleryRows(
  summary: CalculatedComponent[],
  scaffoldType: ScaffoldGalleryType,
  locale: string,
): MaterialGalleryRow[] {
  const map = new Map<string, { qty: number; comps: CalculatedComponent[] }>();
  for (const c of summary) {
    const key = galleryRowMergeKey(c);
    const cur = map.get(key) ?? { qty: 0, comps: [] };
    cur.qty += c.quantity;
    cur.comps.push(c);
    map.set(key, cur);
  }

  const rows: MaterialGalleryRow[] = [];
  for (const [mergeKey, { qty, comps }] of map) {
    const sorted = [...comps].sort(compareCalculatedComponentsForBom);
    const first = sorted[0];
    const aggregationKey = materialGalleryAggregationKey(first);

    const label =
      locale === 'ja'
        ? (first.nameJp || first.name || first.type).trim()
        : (first.name || first.nameJp || first.type).trim();

    rows.push({
      rowId: mergeKey,
      aggregationKey,
      quantity: qty,
      imageSrc: materialGalleryImageSrc(aggregationKey, scaffoldType),
      sortOrder: Math.min(...comps.map((c) => c.sortOrder)),
      sizeSpec: first.sizeSpec || '',
      unit: first.unit || '',
      label,
      bomType: first.type,
    });
  }

  const sortKey = (r: MaterialGalleryRow) => ({
    type: r.bomType,
    sortOrder: r.sortOrder,
    sizeSpec: r.sizeSpec,
  });

  rows.sort((a, b) => compareCalculatedComponentsForBom(sortKey(a), sortKey(b)));
  return rows;
}
