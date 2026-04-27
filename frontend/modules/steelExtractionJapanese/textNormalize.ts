/** Full-width digits → ASCII */
const FW_DIGIT0 = 0xff10;
const FW_DIGIT9 = 0xff19;

/** Full-width Latin A–Z / a–z */
const FW_UPPER_A = 0xff21;
const FW_UPPER_Z = 0xff3a;
const FW_LOWER_A = 0xff41;
const FW_LOWER_Z = 0xff5a;

/**
 * Normalize drawing text for pattern matching: trim, collapse space,
 * full-width ×→x, full-width alnum→ASCII, common Ｈ→H, Ｌ→L.
 */
export function normalizeSteelDrawingText(raw: string): string {
  let s = raw.replace(/\u00a0/g, ' ').trim();
  const out: string[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '×' || ch === '＊' /* rare */) {
      out.push('x');
      continue;
    }
    if (c >= FW_DIGIT0 && c <= FW_DIGIT9) {
      out.push(String.fromCharCode(0x30 + (c - FW_DIGIT0)));
      continue;
    }
    if (c >= FW_UPPER_A && c <= FW_UPPER_Z) {
      out.push(String.fromCharCode(0x41 + (c - FW_UPPER_A)));
      continue;
    }
    if (c >= FW_LOWER_A && c <= FW_LOWER_Z) {
      out.push(String.fromCharCode(0x61 + (c - FW_LOWER_A)));
      continue;
    }
    out.push(ch);
  }
  s = out.join('');
  s = s.replace(/\s+/g, ' ');
  // Common vendor variants
  s = s.replace(/Ｈ/gi, 'H').replace(/Ｌ/gi, 'L').replace(/Ｃ/gi, 'C');
  return s;
}

/** Compact form for section keys (no spaces, ×→x already done). */
export function compactSectionKey(s: string): string {
  return normalizeSteelDrawingText(s).replace(/\s+/g, '');
}
