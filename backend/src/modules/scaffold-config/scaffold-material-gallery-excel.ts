/**
 * Maps BOM lines to gallery images — keep in sync with
 * frontend/lib/scaffold-material-gallery.ts (materialGalleryImageSrc + aggregation).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CalculatedComponent } from './scaffold-calculator.service';
import { compareCalculatedComponentsForBom } from './scaffold-bom-sort';

export type ScaffoldGalleryType = 'kusabi' | 'wakugumi';

export function materialGalleryAggregationKey(comp: CalculatedComponent): string {
  if (comp.type === 'anchi' || comp.type === 'anchi_half') return 'anchi_group';
  return comp.type;
}

function galleryRowMergeKey(c: CalculatedComponent): string {
  const agg = materialGalleryAggregationKey(c);
  return `${agg}\x1e${c.type}\x1e${c.materialCode ?? ''}\x1e${c.sizeSpec ?? ''}`;
}

/** Relative path under `images/scaffold-materials/` (no leading slash). */
export function materialGalleryImageRelativePath(
  aggregationKey: string,
  scaffoldType: ScaffoldGalleryType,
): string | null {
  switch (aggregationKey) {
    case 'jack_base':
      return 'shared/jack-base.png';
    case 'eco_plate':
      return 'shared/eco-plate.png';
    case 'post_main':
      return 'kusabi/tateji.png';
    case 'waku_frame':
      return 'wakugumi/waku.png';
    case 'brace':
      return scaffoldType === 'wakugumi' ? 'wakugumi/buresu.png' : 'kusabi/buresu.png';
    case 'nuno_bar':
      return 'kusabi/nuno-bar.png';
    case 'shitasan':
      return 'wakugumi/shita-san.png';
    case 'end_stopper_nuno':
      return 'kusabi/nuno-bar.png';
    case 'end_stopper_frame':
      return 'wakugumi/end-stopper.png';
    case 'anchi_group':
      return 'shared/anchi.png';
    case 'pattanko':
      return 'shared/pattanko.png';
    case 'habaki':
      return 'shared/habaki.png';
    case 'sokan_bracket':
      return 'shared/sokan-buragetto.png';
    case 'sokan_netto':
      return 'shared/sokan-netto.png';
    case 'mesh_shito':
      return 'shared/mesh-shito.png';
    case 'stair_set':
      return 'shared/kaidan.png';
    case 'hariwaku':
      return 'shared/hariwaku.png';
    default:
      return null;
  }
}

/** Resolve folder that contains `shared/`, `kusabi/`, `wakugumi/` subfolders. */
export function resolveScaffoldMaterialsImageRoot(): string | null {
  const candidates = [
    path.join(process.cwd(), 'frontend', 'public', 'images', 'scaffold-materials'),
    path.join(process.cwd(), '..', 'frontend', 'public', 'images', 'scaffold-materials'),
    path.join(__dirname, '..', '..', '..', '..', 'frontend', 'public', 'images', 'scaffold-materials'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'shared', 'jack-base.png'))) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function readGalleryImageBuffer(root: string, rel: string): Buffer | null {
  const rootNorm = path.normalize(path.resolve(root));
  const full = path.normalize(path.resolve(root, rel.replace(/\\/g, '/')));
  try {
    if (!full.startsWith(rootNorm + path.sep) && full !== rootNorm) return null;
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}

export interface MaterialGalleryExcelRow {
  rowId: string;
  aggregationKey: string;
  quantity: number;
  imageRelPath: string | null;
  sortOrder: number;
  sizeSpec: string;
  unit: string;
  labelJa: string;
  labelEn: string;
  bomType: string;
}

export function buildMaterialGalleryRowsForExcel(
  summary: CalculatedComponent[],
  scaffoldType: ScaffoldGalleryType,
): MaterialGalleryExcelRow[] {
  const map = new Map<string, { qty: number; comps: CalculatedComponent[] }>();
  for (const c of summary) {
    const key = galleryRowMergeKey(c);
    const cur = map.get(key) ?? { qty: 0, comps: [] };
    cur.qty += c.quantity;
    cur.comps.push(c);
    map.set(key, cur);
  }

  const rows: MaterialGalleryExcelRow[] = [];
  for (const [mergeKey, { qty, comps }] of map) {
    const sorted = [...comps].sort(compareCalculatedComponentsForBom);
    const first = sorted[0];
    const aggregationKey = materialGalleryAggregationKey(first);
    rows.push({
      rowId: mergeKey,
      aggregationKey,
      quantity: qty,
      imageRelPath: materialGalleryImageRelativePath(aggregationKey, scaffoldType),
      sortOrder: Math.min(...comps.map((c) => c.sortOrder)),
      sizeSpec: first.sizeSpec || '',
      unit: first.unit || '',
      labelJa: (first.nameJp || first.name || first.type).trim(),
      labelEn: (first.name || first.nameJp || first.type).trim(),
      bomType: first.type,
    });
  }

  rows.sort((a, b) =>
    compareCalculatedComponentsForBom(
      { type: a.bomType, sortOrder: a.sortOrder, sizeSpec: a.sizeSpec },
      { type: b.bomType, sortOrder: b.sortOrder, sizeSpec: b.sizeSpec },
    ),
  );
  return rows;
}
