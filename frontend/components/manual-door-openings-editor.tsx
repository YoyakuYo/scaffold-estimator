'use client';

import { Plus, Trash2, LayoutList } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export type ManualDoorOpeningRow = {
  wallIndex: number;
  positionMm: number;
  widthMm: number;
  doorTopHeightMmFromGround?: number;
};

type WallOption = { wallIndex: number; label: string };

type Props = {
  rows: ManualDoorOpeningRow[];
  onRowsChange: (rows: ManualDoorOpeningRow[]) => void;
  wallOptions: WallOption[];
  idPrefix?: string;
  addDisabled?: boolean;
  /** Position (mm) for newly added rows; default 1500. */
  defaultAddPositionMm?: number;
};

/**
 * Shared manual door grid (wall + position + width + optional top height).
 * Caller supplies `wallOptions` (e.g. edge labels + length); `row.wallIndex` matches option `wallIndex`.
 */
export function ManualDoorOpeningsEditor({
  rows,
  onRowsChange,
  wallOptions,
  idPrefix = 'door',
  addDisabled = false,
  defaultAddPositionMm = 1500,
}: Props) {
  const { t } = useI18n();
  const sectionTitleClass =
    'flex items-center gap-2 text-base font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-4';

  const defaultWallIndex = wallOptions[0]?.wallIndex ?? 0;

  return (
    <section aria-labelledby={`${idPrefix}-section-doors`}>
      <h3 id={`${idPrefix}-section-doors`} className={sectionTitleClass}>
        <LayoutList className="h-5 w-5 text-amber-600 shrink-0" aria-hidden />
        {t('scaffold', 'manualDoorSectionTitle')}
      </h3>
      <p className="text-xs text-amber-900/85 mb-3">{t('scaffold', 'manualDoorSectionHint')}</p>
      <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/90 p-3">
        <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.35fr)_5.5rem_5.5rem_6.5rem_auto] sm:gap-x-2 sm:px-2 sm:pb-1 text-[10px] font-medium text-gray-600 border-b border-amber-100/90">
          <span>{t('scaffold', 'manualDoorWall')}</span>
          <span className="text-right sm:text-left">{t('scaffold', 'manualDoorPositionMm')}</span>
          <span className="text-right sm:text-left">{t('scaffold', 'manualDoorWidthMm')}</span>
          <span className="text-right sm:text-left">{t('scaffold', 'manualDoorTopHeightMmFromGround')}</span>
          <span className="sr-only">{t('scaffold', 'manualDoorRemove')}</span>
        </div>
        {rows.map((row, idx) => (
          <div
            key={`${idPrefix}-door-${idx}`}
            className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.35fr)_5.5rem_5.5rem_6.5rem_auto] gap-2 rounded border border-amber-100 bg-white/90 p-2 sm:items-end"
          >
            <label className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[10px] text-gray-600 sm:hidden">{t('scaffold', 'manualDoorWall')}</span>
              <select
                value={(() => {
                  const allowed = new Set(wallOptions.map((o) => o.wallIndex));
                  const wi = Math.floor(row.wallIndex);
                  if (allowed.has(wi)) return wi;
                  return wallOptions[0]?.wallIndex ?? 0;
                })()}
                onChange={(e) => {
                  const wi = Number(e.target.value);
                  const next = [...rows];
                  next[idx] = { ...next[idx], wallIndex: wi };
                  onRowsChange(next);
                }}
                className="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-xs bg-white"
              >
                {wallOptions.map((o) => (
                  <option key={o.wallIndex} value={o.wallIndex}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-600 sm:hidden">{t('scaffold', 'manualDoorPositionMm')}</span>
              <input
                type="number"
                min={0}
                value={Number.isFinite(row.positionMm) ? row.positionMm : ''}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const next = [...rows];
                  next[idx] = { ...next[idx], positionMm: Number.isFinite(v) ? v : 0 };
                  onRowsChange(next);
                }}
                className="w-full sm:w-24 rounded border border-gray-300 px-2 py-1 text-xs"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-600 sm:hidden">{t('scaffold', 'manualDoorWidthMm')}</span>
              <input
                type="number"
                min={1}
                value={Number.isFinite(row.widthMm) ? row.widthMm : ''}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const next = [...rows];
                  next[idx] = { ...next[idx], widthMm: Number.isFinite(v) ? v : 1800 };
                  onRowsChange(next);
                }}
                className="w-full sm:w-24 rounded border border-gray-300 px-2 py-1 text-xs"
              />
            </label>
            <label className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[10px] text-gray-600 sm:hidden">
                {t('scaffold', 'manualDoorTopHeightMmFromGround')}
              </span>
              <input
                type="number"
                min={1}
                placeholder="2100"
                value={
                  row.doorTopHeightMmFromGround != null && Number.isFinite(row.doorTopHeightMmFromGround)
                    ? row.doorTopHeightMmFromGround
                    : ''
                }
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const next = [...rows];
                  if (raw === '') {
                    const { doorTopHeightMmFromGround: _omit, ...rest } = next[idx];
                    next[idx] = rest;
                  } else {
                    const v = Number(raw);
                    next[idx] = {
                      ...next[idx],
                      doorTopHeightMmFromGround:
                        Number.isFinite(v) && v > 0 ? Math.round(v) : undefined,
                    };
                  }
                  onRowsChange(next);
                }}
                className="w-full sm:w-28 rounded border border-gray-300 px-2 py-1 text-xs"
              />
            </label>
            <div className="flex sm:justify-end sm:pb-0.5">
              <button
                type="button"
                onClick={() => onRowsChange(rows.filter((_, j) => j !== idx))}
                className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-800 hover:bg-red-100"
              >
                <Trash2 className="h-3 w-3 shrink-0" />
                {t('scaffold', 'manualDoorRemove')}
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            onRowsChange([
              ...rows,
              {
                wallIndex: defaultWallIndex,
                positionMm: defaultAddPositionMm,
                widthMm: 1800,
                doorTopHeightMmFromGround: 2100,
              },
            ]);
          }}
          disabled={addDisabled || wallOptions.length === 0}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('scaffold', 'manualDoorAdd')}
        </button>
      </div>
    </section>
  );
}
