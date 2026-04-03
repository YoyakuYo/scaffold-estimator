'use client';

import type { VertexCornerKind } from '@/lib/corner-kinds';
import { vertexEdgeLetter } from '@/lib/edge-hashira-labels';
import { useI18n } from '@/lib/i18n';

type Props = {
  wallCount: number;
  closedFootprint: boolean;
  useManual: boolean;
  onUseManualChange: (v: boolean) => void;
  kinds: VertexCornerKind[];
  onKindChange: (vertexIndex: number, k: VertexCornerKind) => void;
  onInferFromShape: () => void;
};

export function VertexCornerKindsPanel({
  wallCount,
  closedFootprint,
  useManual,
  onUseManualChange,
  kinds,
  onKindChange,
  onInferFromShape,
}: Props) {
  const { t } = useI18n();
  if (!closedFootprint || wallCount < 3) return null;

  const showControls = useManual && kinds.length === wallCount;

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-indigo-900">
            {t('scaffold', 'cornerKindsTitle')}
          </h3>
          <p className="text-xs text-indigo-800/80 mt-0.5 max-w-2xl">
            {t('scaffold', 'cornerKindsHint')}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            checked={useManual}
            onChange={(e) => onUseManualChange(e.target.checked)}
          />
          {t('scaffold', 'cornerKindsManual')}
        </label>
      </div>
      {!useManual && (
        <p className="text-xs text-gray-600">{t('scaffold', 'cornerKindsAuto')}</p>
      )}
      {showControls && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onInferFromShape}
              className="text-xs px-3 py-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-50"
            >
              {t('scaffold', 'cornerKindsInferFromOutline')}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {kinds.map((k, i) => {
              const letter = vertexEdgeLetter(i, wallCount);
              return (
                <div
                  key={`vck-${i}`}
                  className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs"
                >
                  <span className="font-mono font-semibold text-gray-700 w-8">{letter}</span>
                  <select
                    className="flex-1 min-w-0 rounded border border-gray-200 text-xs py-0.5"
                    value={k}
                    onChange={(e) =>
                      onKindChange(i, e.target.value === 'reflex' ? 'reflex' : 'convex')
                    }
                    aria-label={`${t('scaffold', 'cornerKindsVertex')} ${letter}`}
                  >
                    <option value="convex">{t('scaffold', 'cornerConvexShort')}</option>
                    <option value="reflex">{t('scaffold', 'cornerReflexShort')}</option>
                  </select>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
