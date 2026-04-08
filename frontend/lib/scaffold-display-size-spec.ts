/**
 * sizeSpec values to omit in the UI only (still stored for Excel/BOM keys).
 */
const SIZE_SPEC_HIDDEN_IN_UI = new Set(['ジャッキ下敷', 'Inner post mount']);

/** Returns empty string for specs that should not appear as secondary text on scaffold pages. */
export function displaySizeSpecForUi(spec: string | undefined | null): string {
  const s = (spec ?? '').trim();
  if (!s) return '';
  if (SIZE_SPEC_HIDDEN_IN_UI.has(s)) return '';
  return s;
}
