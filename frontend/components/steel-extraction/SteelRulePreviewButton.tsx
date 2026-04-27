'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Grid3x3, Loader2, X } from 'lucide-react';
import { parseDxf } from '@/cad/parseDxf';
import { useI18n } from '@/lib/i18n';
import { structuralTakeoffApi } from '@/lib/api/structural-takeoff';
import {
  buildSteelExtractionDebugSvg,
  extractSteelMembersJapaneseFromDxfDocument,
} from '@/modules/steelExtractionJapanese';

export interface SteelRulePreviewButtonProps {
  setId: string;
  fileId: string;
  filename: string;
  /** Drawing level hint (e.g. 2F) passed into the extractor. */
  defaultLevel: string | null;
}

/**
 * Client-only rule-based steel preview (beams blue, columns red, braces green).
 * Only shown for `.dxf` uploads that have a storage path.
 */
export function SteelRulePreviewButton({
  setId,
  fileId,
  filename,
  defaultLevel,
}: SteelRulePreviewButtonProps) {
  const { t } = useI18n();
  const isDxf = useMemo(() => (filename || '').toLowerCase().endsWith('.dxf'), [filename]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const svgUrlRef = useRef<string | null>(null);

  const revokeCurrent = useCallback(() => {
    if (svgUrlRef.current) {
      URL.revokeObjectURL(svgUrlRef.current);
      svgUrlRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    revokeCurrent();
    setSvgUrl(null);
    setWarnings([]);
    setError(null);
  }, [revokeCurrent]);

  const run = useCallback(async () => {
    if (!isDxf) return;
    setLoading(true);
    setError(null);
    revokeCurrent();
    setSvgUrl(null);
    try {
      const { url } = await structuralTakeoffApi.getFileSignedUrl(setId, fileId);
      const resText = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });
      const dxf = parseDxf(resText);
      const extracted = extractSteelMembersJapaneseFromDxfDocument(dxf, {
        defaultFloor: defaultLevel,
      });
      setWarnings(extracted.meta.warnings);
      const svg = buildSteelExtractionDebugSvg(extracted);
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const nextUrl = URL.createObjectURL(blob);
      svgUrlRef.current = nextUrl;
      setSvgUrl(nextUrl);
      setOpen(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }, [defaultLevel, fileId, isDxf, revokeCurrent, setId]);

  if (!isDxf) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className="p-1.5 text-teal-600 hover:bg-teal-50 rounded disabled:opacity-50"
        title={t('constructionPlanReview', 'steelRulePreviewTitle')}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Grid3x3 className="h-4 w-4" />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('constructionPlanReview', 'steelRulePreviewTitle')}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-[min(96vw,1200px)] max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Grid3x3 className="h-4 w-4 text-teal-600" />
                {t('constructionPlanReview', 'steelRulePreviewTitle')}
              </h3>
              <button
                type="button"
                onClick={close}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
                aria-label={t('constructionPlanReview', 'steelRulePreviewClose')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-4 py-2 text-xs text-gray-600 border-b border-gray-100 space-y-1">
              <p className="font-mono truncate">{filename}</p>
              {warnings.length > 0 && (
                <ul className="list-disc pl-4 text-amber-800">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {error && <p className="text-red-600">{error}</p>}
            </div>
            <div className="overflow-auto p-4 bg-gray-900">
              {svgUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob URL SVG preview
                <img src={svgUrl} alt="" className="max-w-full h-auto mx-auto" />
              ) : (
                <p className="text-gray-400 text-sm text-center py-8">{t('constructionPlanReview', 'steelRulePreviewEmpty')}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
