/**
 * BOM display order — mirror of backend/src/modules/scaffold-config/scaffold-bom-sort.ts
 */

export type BomSortable = {
  type: string;
  sortOrder: number;
  sizeSpec: string;
};

export function bomTypePhase(type: string): number {
  switch (type) {
    case 'jack_base':
      return 1;
    case 'post_main':
    case 'post_top':
    case 'waku_frame':
      return 2;
    case 'anchi':
    case 'anchi_half':
    case 'pattanko':
      return 3;
    case 'brace':
      return 4;
    case 'nuno_bar':
    case 'shitasan':
    case 'end_stopper_nuno':
    case 'end_stopper_frame':
      return 5;
    case 'habaki':
    case 'sokan_bracket':
    case 'sokan_netto':
    case 'mesh_shito':
      return 6;
    case 'stair_set':
      return 7;
    case 'hariwaku':
      return 8;
    default:
      return 99;
  }
}

export function bomTypeSubOrder(type: string): number {
  switch (type) {
    case 'post_main':
      return 0;
    case 'post_top':
      return 1;
    case 'waku_frame':
      return 0;
    case 'anchi':
      return 0;
    case 'anchi_half':
      return 1;
    case 'pattanko':
      return 2;
    case 'nuno_bar':
      return 0;
    case 'shitasan':
      return 1;
    case 'end_stopper_nuno':
      return 2;
    case 'end_stopper_frame':
      return 3;
    case 'habaki':
      return 0;
    case 'sokan_bracket':
      return 1;
    case 'sokan_netto':
      return 2;
    case 'mesh_shito':
      return 3;
    default:
      return 0;
  }
}

function extractFirstNumberMm(spec: string): number {
  const m = spec.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function compareCalculatedComponentsForBom(a: BomSortable, b: BomSortable): number {
  const pa = bomTypePhase(a.type);
  const pb = bomTypePhase(b.type);
  if (pa !== pb) return pa - pb;
  const sa = bomTypeSubOrder(a.type);
  const sb = bomTypeSubOrder(b.type);
  if (sa !== sb) return sa - sb;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const na = extractFirstNumberMm(a.sizeSpec || '');
  const nb = extractFirstNumberMm(b.sizeSpec || '');
  if (na !== nb) return na - nb;
  return (a.sizeSpec || '').localeCompare(b.sizeSpec || '', 'ja');
}
