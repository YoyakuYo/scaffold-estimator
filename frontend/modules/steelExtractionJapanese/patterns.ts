import { normalizeSteelDrawingText } from './textNormalize';

/** Beam / girder marks: G1, B2, 大梁, 小梁, 梁 */
export function textLooksLikeBeamLabel(text: string): boolean {
  const s = normalizeSteelDrawingText(text);
  if (/^(大梁|小梁|梁)$/.test(s)) return true;
  if (/^(G|B)\s*\d+$/i.test(s.replace(/\s+/g, ''))) return true;
  if (/^(RB|TR)\d*$/i.test(s.replace(/\s+/g, ''))) return false; // brace / truss — handled elsewhere
  return false;
}

export function textLooksLikeColumnLabel(text: string): boolean {
  const s = normalizeSteelDrawingText(text);
  if (/^柱$/.test(s)) return true;
  if (/^C\s*\d+$/i.test(s.replace(/\s+/g, ''))) return true;
  return false;
}

export function textLooksLikeBraceLabel(text: string): boolean {
  const s = normalizeSteelDrawingText(text);
  if (/ブレース|ブレ-ス/.test(s)) return true;
  const t = s.replace(/\s+/g, '');
  if (/^BR\d*$/i.test(t)) return true;
  if (/^RB\d*$/i.test(t)) return true;
  if (/^TR\d*$/i.test(t)) return true;
  return false;
}

/** Single-axis grid letter A–Z (after normalization). */
export function isGridLetterToken(text: string): boolean {
  const s = normalizeSteelDrawingText(text).replace(/\s+/g, '');
  return /^[A-Z]$/.test(s);
}

/** Grid number 1–99 (exclude 3+ digit dimensions). */
export function isGridNumberToken(text: string): boolean {
  const s = normalizeSteelDrawingText(text).replace(/\s+/g, '');
  return /^[1-9]\d?$/.test(s);
}

const FLOOR_RE =
  /\b(B?\d+\s*F|R\s*F|RF|ＲＦ|Ｂ?\d+\s*Ｆ|地下\s*\d+\s*階|基礎|PH|P\s*H)\b/i;

export function extractFloorFromText(text: string): string | null {
  const s = normalizeSteelDrawingText(text);
  const m = s.match(FLOOR_RE);
  if (!m) return null;
  let raw = m[1].replace(/\s+/g, '').replace(/Ｆ/gi, 'F').replace(/Ｒ/g, 'R');
  if (/地下/i.test(m[1])) {
    const d = m[1].match(/\d+/);
    return d ? `B${d[0]}F` : 'B1F';
  }
  if (/基礎/i.test(m[1])) return 'B1F';
  raw = raw.toUpperCase();
  if (raw === 'RF' || raw === 'R') return 'RF';
  if (raw === 'PH') return 'PH';
  if (!raw.endsWith('F') && /^\d+$/.test(raw)) return `${raw}F`;
  if (/^B\d+F$/i.test(raw)) return raw.toUpperCase();
  if (/^\d+F$/i.test(raw)) return raw.toUpperCase();
  return raw;
}

export function layerSuggestsFloor(layer: string | undefined): string | null {
  if (!layer) return null;
  return extractFloorFromText(layer);
}

export function layerSuggestsBeam(layer: string | undefined): boolean {
  if (!layer) return false;
  const l = layer.toLowerCase();
  return /(大梁|小梁|梁|beam|girder|oobari|kobari|\bG-|\bB-)/i.test(l);
}

export function layerSuggestsColumn(layer: string | undefined): boolean {
  if (!layer) return false;
  return /(柱|column|hashira)/i.test(layer || '');
}

export function layerSuggestsBrace(layer: string | undefined): boolean {
  if (!layer) return false;
  return /(ブレース|brace|筋交)/i.test(layer || '');
}
