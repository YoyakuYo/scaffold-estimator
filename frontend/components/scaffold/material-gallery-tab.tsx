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

      <ul className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100 print:border-gray-400">
        {rows.map((row) => (
          <li
            key={row.rowId}
            className="material-gallery-row flex items-start gap-3 sm:gap-5 px-3 py-3 sm:px-4 sm:py-3.5 print:break-inside-avoid"
          >
            <span
              className="shrink-0 w-14 sm:w-16 text-right text-lg sm:text-xl font-bold tabular-nums text-blue-700 print:text-black leading-tight pt-0.5"
              title={t('resultExtra', 'materialsGalleryQtyTitle')}
            >
              {row.quantity.toLocaleString()}
            </span>
            <div className="shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-gradient-to-b from-slate-50 to-white border border-gray-100 flex items-center justify-center p-1.5 print:bg-white print:border-gray-200">
              {row.imageSrc ? (
                <img
                  src={row.imageSrc}
                  alt=""
                  className="material-gallery-card max-h-full max-w-full object-contain drop-shadow-sm"
                  loading="lazy"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-400 gap-0.5">
                  <Package className="h-6 w-6 sm:h-7 sm:w-7 opacity-40" aria-hidden />
                  <span className="text-[10px] text-center font-mono leading-none truncate max-w-full">
                    {row.aggregationKey}
                  </span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <h3 className="text-sm font-semibold text-gray-900 leading-snug">{row.label}</h3>
              {row.sizeSpec ? (
                <p className="mt-1 text-xs text-gray-600 font-medium leading-snug">{row.sizeSpec}</p>
              ) : null}
              <p className="mt-1 text-xs text-gray-400">
                {t('resultExtra', 'materialsGalleryUnit')}: {row.unit || '—'}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
