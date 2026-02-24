'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface WallData {
  side: string;
  enabled: boolean;
  lengthMm: number;
  heightMm: number;
  isMultiSegment: boolean;
  segments: { lengthMm: number; offsetMm: number }[];
}

interface BuildingOutlinePreviewProps {
  walls: WallData[];
  scaffoldWidthMm: number;
  onWallUpdate?: (side: string, field: 'lengthMm' | 'heightMm', value: number) => void;
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const WALL_LABELS: Record<string, { en: string; jp: string; short: string }> = {
  north: { en: 'North', jp: '北', short: 'N' },
  south: { en: 'South', jp: '南', short: 'S' },
  east:  { en: 'East',  jp: '東', short: 'E' },
  west:  { en: 'West',  jp: '西', short: 'W' },
};

function getLabel(side: string) {
  if (WALL_LABELS[side]) return WALL_LABELS[side];
  if (side.startsWith('edge-')) {
    const n = parseInt(side.replace('edge-', ''), 10) + 1;
    return { en: `Edge ${n}`, jp: `辺${n}`, short: `E${n}` };
  }
  return { en: side, jp: side, short: side };
}

function fmtMm(mm: number): string {
  if (mm <= 0) return '—';
  if (mm >= 1000) return `${(mm / 1000).toFixed(1)}m`;
  return `${mm}mm`;
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

export function BuildingOutlinePreview({
  walls,
  scaffoldWidthMm,
  onWallUpdate,
}: BuildingOutlinePreviewProps) {
  const { t } = useI18n();
  const [editingCell, setEditingCell] = useState<string | null>(null);

  const enabledWalls = walls.filter((w) => w.enabled);
  const totalPerimeter = enabledWalls.reduce((s, w) => s + w.lengthMm, 0);
  const maxHeight = Math.max(...walls.map((w) => w.heightMm), 0);
  const hasData = walls.some((w) => w.lengthMm > 0 || w.heightMm > 0);

  const handleChange = (side: string, field: 'lengthMm' | 'heightMm', raw: string) => {
    const mm = Math.round((parseFloat(raw) || 0) * 1000);
    onWallUpdate?.(side, field, mm);
  };

  const cellKey = (side: string, field: string) => `${side}-${field}`;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Title bar ──────────────────────────────────── */}
      <div className="px-4 py-2.5 border-b border-gray-200 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-700 tracking-tight">
          {t('viewer', 'extractedDimensions')}
        </h3>
      </div>

      {/* ── Content ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Empty state */}
        {!hasData && (
          <div className="px-4 py-3 bg-amber-50/70 border-b border-amber-100">
            <p className="text-xs text-amber-700 leading-relaxed">
              ⚠ {t('viewer', 'noDimsWarning')}
            </p>
          </div>
        )}

        {/* ── Dimension table ──────────────────────────── */}
        <div className="px-3 py-2">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="text-left py-2 pl-1 font-medium w-[72px]">Wall</th>
                <th className="text-right py-2 pr-1 font-medium">Length (m)</th>
                <th className="text-right py-2 pr-1 font-medium">Height (m)</th>
              </tr>
            </thead>
            <tbody>
              {walls.map((wall) => {
                const label = getLabel(wall.side);
                const lenM = wall.lengthMm / 1000;
                const hgtM = wall.heightMm / 1000;
                const isLenEdit = editingCell === cellKey(wall.side, 'len');
                const isHgtEdit = editingCell === cellKey(wall.side, 'hgt');

                return (
                  <tr
                    key={wall.side}
                    className={`border-b border-slate-50 transition-colors ${
                      wall.enabled
                        ? 'hover:bg-blue-50/40'
                        : 'opacity-40 hover:opacity-60'
                    }`}
                  >
                    {/* Label */}
                    <td className="py-2 pl-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold leading-none ${
                            wall.enabled
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-200 text-gray-400'
                          }`}
                        >
                          {label.short}
                        </span>
                        <span className="text-xs text-slate-600 font-medium truncate">
                          {label.jp}
                        </span>
                      </div>
                    </td>

                    {/* Length */}
                    <td className="py-1.5 pr-1 text-right">
                      {isLenEdit ? (
                        <input
                          autoFocus
                          type="number"
                          step="0.1"
                          min="0"
                          defaultValue={lenM > 0 ? lenM.toFixed(1) : ''}
                          onBlur={(e) => {
                            handleChange(wall.side, 'lengthMm', e.target.value);
                            setEditingCell(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleChange(wall.side, 'lengthMm', (e.target as HTMLInputElement).value);
                              setEditingCell(null);
                            }
                            if (e.key === 'Escape') setEditingCell(null);
                          }}
                          className="w-20 px-2 py-1 text-right text-sm border border-blue-400 rounded bg-white outline-none ring-2 ring-blue-200"
                        />
                      ) : (
                        <button
                          onClick={() => setEditingCell(cellKey(wall.side, 'len'))}
                          className={`w-20 px-2 py-1 text-right text-sm rounded cursor-text transition-colors ${
                            lenM > 0
                              ? 'text-slate-800 font-medium hover:bg-blue-50 border border-transparent hover:border-blue-200'
                              : 'text-slate-300 hover:bg-slate-50 border border-dashed border-slate-200 hover:border-slate-300'
                          }`}
                          title="Click to edit"
                        >
                          {lenM > 0 ? lenM.toFixed(1) : '—'}
                        </button>
                      )}
                    </td>

                    {/* Height */}
                    <td className="py-1.5 pr-1 text-right">
                      {isHgtEdit ? (
                        <input
                          autoFocus
                          type="number"
                          step="0.1"
                          min="0"
                          defaultValue={hgtM > 0 ? hgtM.toFixed(1) : ''}
                          onBlur={(e) => {
                            handleChange(wall.side, 'heightMm', e.target.value);
                            setEditingCell(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleChange(wall.side, 'heightMm', (e.target as HTMLInputElement).value);
                              setEditingCell(null);
                            }
                            if (e.key === 'Escape') setEditingCell(null);
                          }}
                          className="w-20 px-2 py-1 text-right text-sm border border-blue-400 rounded bg-white outline-none ring-2 ring-blue-200"
                        />
                      ) : (
                        <button
                          onClick={() => setEditingCell(cellKey(wall.side, 'hgt'))}
                          className={`w-20 px-2 py-1 text-right text-sm rounded cursor-text transition-colors ${
                            hgtM > 0
                              ? 'text-slate-800 font-medium hover:bg-blue-50 border border-transparent hover:border-blue-200'
                              : 'text-slate-300 hover:bg-slate-50 border border-dashed border-slate-200 hover:border-slate-300'
                          }`}
                          title="Click to edit"
                        >
                          {hgtM > 0 ? hgtM.toFixed(1) : '—'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Summary footer ───────────────────────────── */}
        {(totalPerimeter > 0 || maxHeight > 0) && (
          <div className="mx-3 mb-3 mt-1 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {totalPerimeter > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">周長合計</span>
                  <span className="text-slate-800 font-semibold">{fmtMm(totalPerimeter)}</span>
                </div>
              )}
              {maxHeight > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">建物高さ</span>
                  <span className="text-slate-800 font-semibold">{fmtMm(maxHeight)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">足場幅</span>
                <span className="text-slate-800 font-semibold">{scaffoldWidthMm}mm</span>
              </div>
              {enabledWalls.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">有効壁数</span>
                  <span className="text-slate-800 font-semibold">
                    {enabledWalls.length} / {walls.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hint */}
        <p className="px-4 pb-3 text-[10px] text-slate-400 leading-relaxed">
          {t('viewer', 'clickCellToEdit')}
        </p>
      </div>
    </div>
  );
}
