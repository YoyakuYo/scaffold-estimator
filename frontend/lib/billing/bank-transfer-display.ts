import type { Locale } from '@/lib/i18n/translations';

/**
 * Pick the line to show for the user's UI language (ja / en / fr).
 * Pass the main env string as `ja` (often Japanese passbook text); optional `en` / `fr` override per locale.
 * Secondary line shows other languages when useful (e.g. passbook wording under English).
 */
export function localizedBankField(
  locale: Locale,
  ja: string,
  en?: string,
  fr?: string,
): { main: string; sub?: string } {
  const J = ja.trim();
  const E = en?.trim();
  const F = fr?.trim();
  const any = J || E || F;
  if (!any) return { main: '' };

  if (locale === 'ja') {
    const main = (J || E || F) as string;
    const sub = [E, F].filter((x): x is string => Boolean(x) && x !== main).join(' · ') || undefined;
    return sub ? { main, sub } : { main };
  }
  if (locale === 'fr') {
    const main = (F || E || J) as string;
    const sub = [J, E].filter((x): x is string => Boolean(x) && x !== main).join(' · ') || undefined;
    return sub ? { main, sub } : { main };
  }
  const main = (E || J || F) as string;
  const sub = [J, F].filter((x): x is string => Boolean(x) && x !== main).join(' · ') || undefined;
  return sub ? { main, sub } : { main };
}
