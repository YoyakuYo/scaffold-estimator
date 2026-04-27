import { compactSectionKey, normalizeSteelDrawingText } from './textNormalize';
import type { ParsedSectionSize } from './types';

/**
 * Parse structural section strings (Japanese drawings, mixed EN/JP).
 * Examples: H-300x150x6x9, □-200x200x9, L-75x75x6, PL-9, RHS-100x50x3.2
 */
export function parseJapaneseSectionString(input: string): ParsedSectionSize | null {
  const raw = compactSectionKey(input);
  if (!raw) return null;

  // Plate: PL-9, PL12, ＰＬ-9
  const pl = raw.match(/^PL-?(\d+(?:\.\d+)?)$/i);
  if (pl) {
    return {
      shape: 'PL',
      height: Number(pl[1]),
      raw,
    };
  }

  // H / I / CT / RHS / CHS / C / L — allow optional hyphen after letter token
  const re =
    /^([HILC]|CT|RHS|CHS|□)-?(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?(?:x(\d+(?:\.\d+)?))?$/i;
  const m = raw.match(re);
  if (!m) return null;

  let shape = m[1].toUpperCase();
  if (shape === '□') shape = 'RHS';

  const height = Number(m[2]);
  const width = Number(m[3]);
  const t3 = m[4] != null ? Number(m[4]) : undefined;
  const t4 = m[5] != null ? Number(m[5]) : undefined;

  const out: ParsedSectionSize = { shape, height, width, raw };

  if (shape === 'H' || shape === 'I' || shape === 'CT') {
    out.webThickness = t3;
    out.flangeThickness = t4;
  } else if (shape === 'RHS' || shape === 'CHS') {
    out.webThickness = t3; // wall thickness
  } else if (shape === 'L' || shape === 'C') {
    out.webThickness = t3;
  }

  return out;
}

/** Scan a longer annotation and return the first parseable section substring. */
export function extractFirstSectionFromText(text: string): ParsedSectionSize | null {
  const n = normalizeSteelDrawingText(text);
  // Tokenize on common separators but keep x chains
  const candidates = n.split(/[\s,;，、]+/).filter(Boolean);
  for (const c of candidates) {
    const p = parseJapaneseSectionString(c);
    if (p) return p;
  }
  // Fallback: substring search for H-… / □-… patterns
  const sub = n.match(/(?:H|I|L|C|CT|RHS|CHS|□)-?\d+(?:\.\d+)?x\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?){0,2}/i);
  if (sub) return parseJapaneseSectionString(sub[0]);
  const pls = n.match(/PL-?\d+(?:\.\d+)?/i);
  if (pls) return parseJapaneseSectionString(pls[0]);
  return null;
}
