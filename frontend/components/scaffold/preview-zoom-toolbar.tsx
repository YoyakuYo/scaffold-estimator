'use client';

import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function PreviewZoomToolbar({
  onZoomIn,
  onZoomOut,
  onReset,
  className = '',
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg border border-gray-300/80 bg-white/95 shadow-sm p-0.5 backdrop-blur-sm ${className}`}
      role="toolbar"
      aria-label={t('viewer', 'zoomIn')}
    >
      <button
        type="button"
        onClick={onZoomOut}
        className="p-1.5 rounded-md text-gray-700 hover:bg-gray-100 transition-colors"
        title={t('viewer', 'zoomOut')}
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        className="p-1.5 rounded-md text-gray-700 hover:bg-gray-100 transition-colors"
        title={t('viewer', 'zoomIn')}
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          className="p-1.5 rounded-md text-gray-600 hover:bg-gray-100 transition-colors border-l border-gray-200 ml-0.5 pl-1.5"
          title={t('viewer', 'cadReset')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
