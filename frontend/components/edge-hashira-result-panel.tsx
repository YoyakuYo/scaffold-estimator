'use client';

import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import type { EdgeHashiraLabeling } from '@/lib/api/scaffold-configs';
import { edgeHashiraSummariesFromResult, edgeHashiraLineForWallIndex } from '@/lib/edge-hashira-labels';

type WallLen = { wallLengthMm?: number };

export function EdgeHashiraResultPanel({
  labeling,
  walls,
  closedFootprint,
  className = '',
}: {
  labeling?: EdgeHashiraLabeling | null;
  walls: WallLen[];
  closedFootprint: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const lines = useMemo(
    () => edgeHashiraSummariesFromResult(labeling ?? undefined, walls, closedFootprint),
    [labeling, walls, closedFootprint],
  );
  if (lines.length === 0) return null;
  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2 text-xs ${className}`}>
      <div className="font-semibold text-slate-700 mb-1">{t('scaffold', 'edgeHashiraTitle')}</div>
      <ul className="font-mono text-slate-800 space-y-0.5 pl-4 list-disc">
        {lines.map((s) => (
          <li key={s} className="leading-snug">
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EdgeHashiraResultWallLine({
  labeling,
  wallIndex,
  walls,
  closedFootprint,
}: {
  labeling?: EdgeHashiraLabeling | null;
  wallIndex: number;
  walls: WallLen[];
  closedFootprint: boolean;
}) {
  const line = useMemo(
    () => edgeHashiraLineForWallIndex(labeling ?? undefined, wallIndex, walls, closedFootprint),
    [labeling, wallIndex, walls, closedFootprint],
  );
  if (!line) return null;
  return (
    <p className="text-xs font-mono text-slate-600 mt-2 border-t border-slate-100 pt-2">{line}</p>
  );
}
