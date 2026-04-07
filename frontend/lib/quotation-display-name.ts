import type { CalculatedComponent } from '@/lib/api/scaffold-configs';

/**
 * Quotation / BOM row: show a short component name; size belongs in 規格 only.
 * Stored configs may still have legacy English `name` values with mm baked in.
 */
export function quotationComponentBaseName(comp: CalculatedComponent, locale: string): string {
  if (locale === 'ja') {
    return (comp.nameJp || '').trim();
  }
  const raw = (comp.name || comp.nameJp || '').trim();
  if (!raw) return '';

  if (/^Plank\s+\d+\s*(?:×|x)\s*\d+\s*mm$/i.test(raw)) return 'Plank';
  if (/^Half\s+Plank\s+\d+\s*(?:×|x)\s*\d+\s*mm$/i.test(raw)) return 'Half Plank';
  if (/^Brace\s+\d+\s*mm$/i.test(raw)) return 'Brace';
  if (/^Nuno\s+Bar\s+\d+\s*mm$/i.test(raw)) return 'Nuno Bar';
  if (/^Toe\s+Board\s+\d+\s*mm$/i.test(raw)) return 'Toe Board';
  if (/^Frame\s+\d+\s*mm$/i.test(raw)) return 'Frame';
  if (/^Bottom\s+Bar\s+\d+\s*mm$/i.test(raw)) return 'Bottom Bar';
  if (/^End\s+Stopper\s+\(Nuno\)\s+\d+\s*mm$/i.test(raw)) return 'End Stopper (Nuno)';
  if (/^Beam\s+Frame\s+\(Hariwaku\)\s+\d+\s*span$/i.test(raw)) return 'Beam Frame (Hariwaku)';

  return raw;
}
