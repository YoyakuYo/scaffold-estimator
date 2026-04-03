'use client';

import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  edgeChordName,
  defaultClosedFootprint,
  edgeHashiraSummaryLine,
} from '@/lib/edge-hashira-labels';

type Row = { axis: '' | 'X' | 'Y'; countStr: string };

export interface EdgeHashiraPlanningPanelProps {
  wallCount: number;
  /** Length (mm) per wall index — same order as calculation walls. */
  lengthsMm: number[];
  rows: Row[];
  onRowChange: (wallIndex: number, patch: Partial<Row>) => void;
  /** When false, panel still renders summaries but editors can be read-only (optional). */
  disabled?: boolean;
  /**
   * When set, overrides inferred closed/open chord naming (e.g. open trace vs closed polygon).
   * If omitted, closed = (wallCount >= 3).
   */
  closedFootprint?: boolean;
}

/**
 * Shared UI: X/Y per edge (AB, BC, …) + summary lines e.g. `AB (X1–X4) = 13,000 mm`.
 * Parent owns `rows` state and syncs with DTO / EdgeHashiraLabeling on submit.
 */
export function EdgeHashiraPlanningPanel({
  wallCount,
  lengthsMm,
  rows,
  onRowChange,
  disabled,
  closedFootprint: closedFootprintProp,
}: EdgeHashiraPlanningPanelProps) {
  const { t } = useI18n();
  const closed = closedFootprintProp ?? defaultClosedFootprint(wallCount);

  const summaries = useMemo(() => {
    const out: string[] = [];
    for (let wi = 0; wi < wallCount; wi++) {
      const row = rows[wi] ?? { axis: '' as const, countStr: '' };
      const raw = row.countStr.trim();
      const n = raw === '' ? undefined : parseInt(raw, 10);
      const cnt = n != null && Number.isFinite(n) && n > 0 ? Math.min(500, Math.floor(n)) : undefined;
      const len = lengthsMm[wi] ?? 0;
      const line = edgeHashiraSummaryLine(wi, wallCount, closed, len, row.axis, cnt);
      if (line) out.push(line);
    }
    return out;
  }, [wallCount, lengthsMm, rows, closed]);

  if (wallCount < 1) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{t('scaffold', 'edgeHashiraTitle')}</h3>
        <p className="text-xs text-slate-600 mt-0.5">{t('scaffold', 'edgeHashiraBlurb')}</p>
      </div>

      {summaries.length > 0 && (
        <ul className="text-xs font-mono text-slate-800 space-y-1 border border-slate-200 rounded-md bg-white px-3 py-2">
          {summaries.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
        {Array.from({ length: wallCount }, (_, wi) => {
          const row = rows[wi] ?? { axis: '' as const, countStr: '' };
          const chord = edgeChordName(wi, wallCount, closed);
          const len = lengthsMm[wi] ?? 0;
          return (
            <div
              key={`eh-${wi}`}
              className="flex items-center gap-1.5 text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm"
            >
              <span className="font-mono font-semibold text-slate-600 min-w-[2rem]" title={`${len} mm`}>
                {chord}
              </span>
              <select
                className="border border-slate-300 rounded px-1 py-0.5 bg-gray-50 min-w-[3rem]"
                value={row.axis}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value as '' | 'X' | 'Y';
                  onRowChange(wi, { axis: v === 'X' || v === 'Y' ? v : '' });
                }}
              >
                <option value="">{t('scaffold', 'edgeHashiraAxisNone')}</option>
                <option value="X">X</option>
                <option value="Y">Y</option>
              </select>
              <input
                type="number"
                min={1}
                max={500}
                placeholder="auto"
                title={t('scaffold', 'edgeHashiraCountHint')}
                className="w-14 border border-slate-300 rounded px-1 py-0.5"
                value={row.countStr}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, '').slice(0, 3);
                  onRowChange(wi, { countStr: v });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
