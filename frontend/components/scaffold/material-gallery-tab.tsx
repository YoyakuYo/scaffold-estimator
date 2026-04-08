'use client';

import { useMemo } from 'react';
import type { CalculatedComponent } from '@/lib/api/scaffold-configs';
import {
  buildMaterialGalleryRows,
  type ScaffoldGalleryType,
} from '@/lib/scaffold-material-gallery';
import { useI18n } from '@/lib/i18n';
import { Printer, Package } from 'lucide-react';

type Props = {
  summary: CalculatedComponent[];
  scaffoldType: ScaffoldGalleryType;
};

export function MaterialGalleryTab({ summary, scaffoldType }: Props) {
  const { locale, t } = useI18n();

  const rows = useMemo(
    () => buildMaterialGalleryRows(summary, scaffoldType, locale),
    [summary, scaffoldType, locale],
  );

  const handlePrint = () => {
    window.print();
  };

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
        {t('resultExtra', 'materialsGalleryEmpty')}
      </div>
    );
  }

  return (
    <div className="space-y-4 material-gallery-print-root">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <p className="text-sm text-gray-600 max-w-2xl">{t('resultExtra', 'materialsGalleryHint')}</p>
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <Printer className="h-4 w-4" aria-hidden />
          {t('resultExtra', 'materialsGalleryPrintPdf')}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {rows.map((row) => (
          <article
            key={row.aggregationKey}
            className="material-gallery-card rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden print:break-inside-avoid print:border-gray-400"
          >
            <div className="relative aspect-[4/3] bg-gradient-to-b from-slate-50 to-white border-b border-gray-100 flex items-center justify-center p-4 print:bg-white">
              {row.imageSrc ? (
                <img
                  src={row.imageSrc}
                  alt=""
                  className="max-h-full max-w-full object-contain drop-shadow-sm"
                  loading="lazy"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-400 gap-2 p-4">
                  <Package className="h-12 w-12 opacity-40" aria-hidden />
                  <span className="text-xs text-center font-mono">{row.aggregationKey}</span>
                </div>
              )}
            </div>
            <div className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900 leading-snug flex-1 min-w-0">{row.label}</h3>
                <span
                  className="shrink-0 text-lg sm:text-xl font-bold tabular-nums text-blue-700 print:text-black"
                  title={t('resultExtra', 'materialsGalleryQtyTitle')}
                >
                  {row.quantity.toLocaleString()}
                </span>
              </div>
              {row.specSummary ? (
                <p className="mt-1.5 text-xs text-gray-500 leading-snug line-clamp-3">{row.specSummary}</p>
              ) : null}
              <p className="mt-2 text-xs text-gray-400">
                {t('resultExtra', 'materialsGalleryUnit')}: {row.unit || '—'}
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
