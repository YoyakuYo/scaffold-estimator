/** Pick main + optional subtitle line for bank fields (JA passbook + optional EN for international users). */
export function bankFieldDisplay(
  japanese: string,
  english: string | undefined,
  locale: string,
): { main: string; sub?: string } {
  const en = english?.trim();
  if (!en) return { main: japanese };
  if (locale === 'ja') return { main: japanese, sub: en };
  return { main: en, sub: japanese };
}
