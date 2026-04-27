/**
 * Roll steel extracted elements into 鉄骨集計表–style lines (shape / grade /
 * section / length / unit weight / design & gross kg with loss).
 */
import type { ExtractedElement } from '../extracted-element.entity';
import type { StructuralElementType } from '../element-types';
import { STRUCTURAL_ELEMENT_TYPES } from '../element-types';
import { DEFAULT_PIECE_LENGTH_MM, pieceWeightKg, resolveKgPerM } from './jis-sections';

const ELEMENT_LABEL_JP: Record<StructuralElementType, string> = {
  hashira: '柱',
  oobari: '大梁',
  kobari: '小梁',
  taifubari: '耐風梁',
  brace: 'ブレース',
  kaidan: '階段',
  elevator: 'エレベーター',
  deck: 'デッキ',
};

/** Default fabrication loss (matches typical 鉄骨 5%). */
export const DEFAULT_STEEL_LOSS_RATE = 0.05;

export interface SteelFrameAggregatedLine {
  shapeNameJp: string;
  grade: string;
  section: string;
  elementType: StructuralElementType;
  /** Total member length Σ(本数 × 長さm). */
  lengthM: number;
  kgPerM: number;
  designWeightKg: number;
  grossWeightKg: number;
}

function inferGrade(section: string | null | undefined): string {
  const s = (section ?? '').trim();
  const m = s.match(
    /^(SS400|SM490A|SM490B|SN490B|SNR490B|STKR400|BCP325|S10T|SM490)\b/i,
  );
  return m ? m[1].toUpperCase() : 'SS400';
}

function inferShapeNameJp(
  elementType: StructuralElementType,
  section: string | null | undefined,
): string {
  const raw = (section ?? '').trim();
  const norm = raw.replace(/\s+/g, '').replace(/×/g, 'x');
  if (/2L|双山|２Ｌ/i.test(raw)) return '山形鋼２枚合';
  if (/^CT-|ＣＴ/i.test(norm)) return 'ＣＴ形鋼';
  if (/□|BCP|STKR|角形|箱形/i.test(norm)) return '角形鋼管';
  if (/^H-|Ｈ形|H形/i.test(norm)) return 'Ｈ形鋼';
  if (/^L-|不等辺山形|山形鋼/i.test(norm)) return '山形鋼';
  if (/PL-|鋼板/i.test(norm)) return '鋼板';
  if (/FB-|平鋼/i.test(norm)) return '平鋼';
  if (/HTB|高力|ボルト/i.test(norm)) return '高力ボルト';
  if (/アンカ|A\.B|anchor/i.test(norm)) return 'アンカーボルト';
  return ELEMENT_LABEL_JP[elementType] ?? elementType;
}

function pieceLengthMmFor(e: ExtractedElement): number {
  if (e.pieceLengthMm != null && Number.isFinite(e.pieceLengthMm) && e.pieceLengthMm > 0) {
    return Math.min(120_000, Math.max(1, Math.floor(e.pieceLengthMm)));
  }
  return DEFAULT_PIECE_LENGTH_MM[e.elementType] ?? 4000;
}

/**
 * Merge all floors/blocks: one line per (elementType + section text).
 */
export function aggregateSteelFrameLines(
  elements: ExtractedElement[],
  lossRate: number = DEFAULT_STEEL_LOSS_RATE,
): SteelFrameAggregatedLine[] {
  const loss = Number.isFinite(lossRate) && lossRate >= 0 && lossRate < 1 ? lossRate : DEFAULT_STEEL_LOSS_RATE;
  type Acc = {
    elementType: StructuralElementType;
    section: string;
    lengthM: number;
    designWeightKg: number;
  };
  const map = new Map<string, Acc>();

  for (const e of elements) {
    if (!STRUCTURAL_ELEMENT_TYPES.includes(e.elementType)) continue;
    const lk = e.lineKind ?? 'member';
    if (lk !== 'member') continue;
    const qty = Number.isFinite(e.qty) ? Math.floor(e.qty) : 0;
    if (qty <= 0) continue;
    const sec = (e.section ?? '').trim();
    const key = `${e.elementType}\t${sec}`;
    const lenMm = pieceLengthMmFor(e);
    const addLenM = (lenMm / 1000) * qty;
    const addKg = pieceWeightKg(e.section, e.elementType, lenMm) * qty;
    const prev = map.get(key);
    if (prev) {
      prev.lengthM += addLenM;
      prev.designWeightKg += addKg;
    } else {
      map.set(key, {
        elementType: e.elementType,
        section: sec || '—',
        lengthM: addLenM,
        designWeightKg: addKg,
      });
    }
  }

  const rows: SteelFrameAggregatedLine[] = [];
  for (const acc of map.values()) {
    const kgPerM = resolveKgPerM(acc.section === '—' ? null : acc.section);
    const gross = acc.designWeightKg * (1 + loss);
    rows.push({
      shapeNameJp: inferShapeNameJp(acc.elementType, acc.section === '—' ? null : acc.section),
      grade: inferGrade(acc.section === '—' ? null : acc.section),
      section: acc.section,
      elementType: acc.elementType,
      lengthM: Math.round(acc.lengthM * 1000) / 1000,
      kgPerM: Math.round(kgPerM * 1000) / 1000,
      designWeightKg: Math.round(acc.designWeightKg * 10) / 10,
      grossWeightKg: Math.round(gross * 10) / 10,
    });
  }

  rows.sort((a, b) => {
    const t = a.elementType.localeCompare(b.elementType);
    if (t !== 0) return t;
    return a.section.localeCompare(b.section, 'ja');
  });
  return rows;
}

export function totalsFromSteelLines(lines: SteelFrameAggregatedLine[]): {
  designKg: number;
  grossKg: number;
} {
  let designKg = 0;
  let grossKg = 0;
  for (const l of lines) {
    designKg += l.designWeightKg;
    grossKg += l.grossWeightKg;
  }
  return {
    designKg: Math.round(designKg * 10) / 10,
    grossKg: Math.round(grossKg * 10) / 10,
  };
}
