'use client';

import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';
import type { ProductCode } from '@/lib/api/access';
import { useI18n } from '@/lib/i18n';

const ALL: ProductCode[] = ['scaffold', 'bim', 'construction_plan'];

/**
 * When a workspace is focused: open menu (+) to jump to another product workspace
 * without scrolling through unrelated dashboards.
 */
export function ProductWorkspaceSwitcher({
  focused,
  onSelect,
  onClear,
}: {
  focused: ProductCode;
  onSelect: (p: ProductCode) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const others = ALL.filter((p) => p !== focused);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={rootRef} className="mt-6 flex flex-wrap items-center justify-center gap-3">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-gray-300 bg-white text-gray-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          aria-expanded={open}
          aria-haspopup="menu"
          title={t('products', 'switcherOpenTitle')}
        >
          <Plus className="h-6 w-6" aria-hidden />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
          >
            {others.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-50"
                onClick={() => {
                  setOpen(false);
                  onSelect(p);
                }}
              >
                {p === 'scaffold'
                  ? t('products', 'productScaffold')
                  : p === 'bim'
                    ? t('products', 'productBim')
                    : t('products', 'productConstructionPlan')}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          onClear();
        }}
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
      >
        <LayoutGrid className="h-4 w-4" aria-hidden />
        {t('products', 'switcherAllWorkspaces')}
      </button>
    </div>
  );
}
