'use client';

import { useMemo } from 'react';
import type { CalculatedComponent } from '@/lib/api/scaffold-configs';
import {
  buildMaterialGalleryRows,
  materialGalleryThumbnailBadge,
  type ScaffoldGalleryType,
} from '@/lib/scaffold-material-gallery';
import { displaySizeSpecForUi } from '@/lib/scaffold-display-size-spec';
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

      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {rows.map((row) => {
          const specUi = displaySizeSpecForUi(row.sizeSpec);
          const thumbBadge = materialGalleryThumbnailBadge(row.sizeSpec);
          return (
            <li
              key={row.rowId}
              className="material-gallery-row flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-3.5 print:break-inside-avoid"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:gap-3">
                <div className="relative h-14 w-14 shrink-0 sm:h-16 sm:w-16">
                  {thumbBadge ? (
                    <span
                      className="absolute -left-0.5 -top-0.5 z-10 rounded bg-slate-800/90 px-1 py-0.5 text-[10px] font-bold leading-none text-white print:bg-black"
                      aria-hidden
                    >
                      {thumbBadge}
                    </span>
                  ) : null}
                  <div className="flex h-full w-full items-center justify-center overflow-hidden p-1">
                    {row.imageSrc ? (
                      <img
                        src={row.imageSrc}
                        alt=""
                        className="material-gallery-card max-h-full max-w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-0.5 text-gray-400">
                        <Package className="h-6 w-6 sm:h-7 sm:w-7 opacity-40" aria-hidden />
                        <span className="max-w-full truncate text-center font-mono text-[10px] leading-none">
                          {row.aggregationKey}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h3 className="text-sm font-semibold leading-snug text-gray-900">{row.label}</h3>
                  {specUi ? (
                    <p className="mt-1 text-xs font-medium leading-snug text-gray-600">{specUi}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-gray-400">
                    {t('resultExtra', 'materialsGalleryUnit')}: {row.unit || '—'}
                  </p>
                </div>
              </div>
              <span
                className="shrink-0 text-right text-xl font-bold tabular-nums text-blue-700 sm:text-2xl print:text-black"
                title={t('resultExtra', 'materialsGalleryQtyTitle')}
              >
                {row.quantity.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
