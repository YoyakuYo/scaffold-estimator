'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  Loader2,
  Trash2,
  Save,
  Plus,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Calendar,
  FileSpreadsheet,
  Layers,
  Truck,
  Download,
  Sparkles,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePresence, usePresenceActions } from '@/lib/page-presence-context';
import {
  STRUCTURAL_ELEMENT_TYPES,
  DRAWING_KINDS,
  structuralTakeoffApi,
  type DrawingKind,
  type ExtractedElement,
  type SetReviewPayload,
  type StructuralElementType,
} from '@/lib/api/structural-takeoff';

const ACCEPTED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'dxf', 'dwg', 'jww', 'xlsx', 'xls', 'csv'];

interface DraftRow {
  /** Existing extracted_elements.id, undefined for new rows. */
  id?: string;
  level: string;
  block: string | null;
  elementType: StructuralElementType;
  label: string;
  section: string;
  qty: number;
  grid: string;
  notes: string;
}

function rowFromExisting(e: ExtractedElement): DraftRow {
  return {
    id: e.id,
    level: e.level,
    block: e.block,
    elementType: e.elementType,
    label: e.label ?? '',
    section: e.section ?? '',
    qty: Number.isFinite(e.qty) ? e.qty : 0,
    grid: e.grid ?? '',
    notes: e.notes ?? '',
  };
}

function blankRow(level: string, block: string | null, elementType: StructuralElementType): DraftRow {
  return { level, block, elementType, label: '', section: '', qty: 0, grid: '', notes: '' };
}

export default function ConstructionPlanSetReviewPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const projectId = (params?.projectId as string) || '';
  const setId = (params?.setId as string) || '';
  usePresence({
    pageKey: `construction-plan/set/${setId}`,
    label: 'Construction Plan: extracting takeoff',
  });
  const presenceActions = usePresenceActions();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const dxfInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<SetReviewPayload>({
    queryKey: ['structural-takeoff', 'set-review', setId],
    queryFn: () => structuralTakeoffApi.getSetReview(setId),
    enabled: !!setId,
  });

  // Lazy-init draft from server data the first time it loads.
  if (data && !draftLoaded) {
    setDraft(data.elements.map(rowFromExisting));
    setDraftLoaded(true);
  }

  const upload = useMutation({
    mutationFn: (files: File[]) => structuralTakeoffApi.uploadFiles(setId, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'set-review', setId] });
      presenceActions.recordAction(`Uploaded structural drawings to set ${setId.slice(0, 8)}`);
    },
  });

  const importExcel = useMutation({
    mutationFn: (file: File) => structuralTakeoffApi.importExcel(setId, file),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'set-review', setId] });
      setDraftLoaded(false);
      const warn = res.warnings.length > 0 ? ` (${res.warnings.length} warnings)` : '';
      setImportMessage(t('constructionPlanReview', 'excelImportedToast').replace('{count}', String(res.saved.length)) + warn);
      presenceActions.recordAction(`Imported ${res.saved.length} elements from Excel into set ${setId.slice(0, 8)}`);
    },
    onError: () => setImportMessage(t('constructionPlanReview', 'excelImportFailed')),
  });

  const importDxf = useMutation({
    mutationFn: (file: File) =>
      structuralTakeoffApi.importDxfLayers(setId, file, data?.project.levels[0] ?? '1F'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'set-review', setId] });
      setDraftLoaded(false);
      const warn = res.warnings.length > 0 ? ` (${res.warnings.length} warnings)` : '';
      setImportMessage(t('constructionPlanReview', 'dxfImportedToast').replace('{count}', String(res.saved.length)) + warn);
      presenceActions.recordAction(`Imported ${res.saved.length} elements from DXF layers into set ${setId.slice(0, 8)}`);
    },
    onError: () => setImportMessage(t('constructionPlanReview', 'dxfImportFailed')),
  });

  const patchFile = useMutation({
    mutationFn: ({
      fileId,
      patch,
    }: {
      fileId: string;
      patch: { kind?: DrawingKind; level?: string | null; block?: string | null };
    }) => structuralTakeoffApi.patchFile(setId, fileId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'set-review', setId] });
    },
  });

  const deleteFile = useMutation({
    mutationFn: (fileId: string) => structuralTakeoffApi.deleteFile(setId, fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'set-review', setId] });
    },
  });

  const reclassifyAi = useMutation({
    mutationFn: (fileId: string) => structuralTakeoffApi.reclassifyFromContent(setId, fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'set-review', setId] });
      presenceActions.recordAction(`AI re-classified file in set ${setId.slice(0, 8)}`);
    },
  });

  const extractElementsAi = useMutation({
    mutationFn: (fileId: string) => structuralTakeoffApi.extractElementsAi(setId, fileId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'set-review', setId] });
      setDraftLoaded(false);
      const warn = res.warnings.length > 0 ? ` (${res.warnings.length} warnings)` : '';
      setImportMessage(
        t('constructionPlanReview', 'aiExtractedToast').replace('{count}', String(res.saved.length)) + warn,
      );
      presenceActions.recordAction(
        `AI extracted ${res.saved.length} elements in set ${setId.slice(0, 8)}`,
      );
    },
    onError: () => setImportMessage(t('constructionPlanReview', 'aiExtractFailed')),
  });

  const saveElements = useMutation({
    mutationFn: () =>
      structuralTakeoffApi.upsertElements(setId, {
        rows: draft
          .filter((r) => r.qty > 0 || (r.label && r.label.trim().length > 0))
          .map((r) => ({
            id: r.id,
            level: r.level,
            block: r.block,
            elementType: r.elementType,
            label: r.label.trim() || null,
            section: r.section.trim() || null,
            qty: r.qty,
            grid: r.grid.trim() || null,
            notes: r.notes.trim() || null,
          })),
      }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'set-review', setId] });
      // Replace ids on rows that were newly inserted (server assigns UUIDs).
      const byKey = new Map<string, ExtractedElement>();
      for (const e of saved) {
        const k = `${e.level}|${e.block ?? ''}|${e.elementType}|${e.label ?? ''}|${e.section ?? ''}`;
        byKey.set(k, e);
      }
      setDraft((prev) =>
        prev.map((r) => {
          if (r.id) return r;
          const k = `${r.level}|${r.block ?? ''}|${r.elementType}|${r.label.trim()}|${r.section.trim()}`;
          const matched = byKey.get(k);
          return matched ? { ...r, id: matched.id } : r;
        }),
      );
      presenceActions.recordAction(`Saved structural takeoff for set ${setId.slice(0, 8)}`);
    },
  });

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const files: File[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList.item(i);
        if (!f) continue;
        const ext = f.name.split('.').pop()?.toLowerCase();
        if (!ext || !ACCEPTED_EXT.includes(ext)) continue;
        files.push(f);
      }
      if (files.length === 0) return;
      upload.mutate(files);
    },
    [upload],
  );

  const project = data?.project;
  const set = data?.set;
  const files = data?.files ?? [];

  const blocksWithFallback = useMemo(() => {
    const blocks = project?.blocks ?? [];
    if (blocks.length > 0) return blocks;
    return [null];
  }, [project?.blocks]);

  const levels = project?.levels ?? [];

  const addRow = useCallback(
    (level: string, block: string | null, type: StructuralElementType) => {
      setDraft((prev) => [...prev, blankRow(level, block, type)]);
    },
    [],
  );

  const updateRow = useCallback((index: number, patch: Partial<DraftRow>) => {
    setDraft((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  const deleteRow = useCallback(
    async (index: number) => {
      const row = draft[index];
      if (row?.id) {
        await structuralTakeoffApi.deleteElement(setId, row.id).catch(() => undefined);
      }
      setDraft((prev) => prev.filter((_, i) => i !== index));
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'set-review', setId] });
    },
    [draft, queryClient, setId],
  );

  if (isLoading || !data || !project || !set) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {error ? (
          <div className="bg-white border border-red-200 rounded-xl p-6 max-w-md">
            <div className="flex items-start gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5 mt-0.5" />
              <p>{t('constructionPlanReview', 'loadFailed')}</p>
            </div>
          </div>
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div>
          <Link
            href={`/construction-plan/${projectId}`}
            className="inline-flex items-center gap-1.5 text-sm text-amber-700 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('constructionPlanReview', 'back')}
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Calendar className="h-6 w-6 text-amber-600" />
                {project.name}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {t('constructionPlanReview', 'setLabel')}: {set.name || set.id.slice(0, 8)}
              </p>
            </div>
            <Link
              href={`/construction-plan/${projectId}/sets/${setId}/schedule`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-sm"
            >
              <Truck className="h-4 w-4" />
              {t('constructionPlanReview', 'openSchedule')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">
            {t('constructionPlanReview', 'extractModesTitle')}:
          </span>
          <button
            onClick={() => excelInputRef.current?.click()}
            disabled={importExcel.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 text-sm"
          >
            {importExcel.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4" />
            )}
            {t('constructionPlanReview', 'importExcel')}
          </button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importExcel.mutate(f);
              if (excelInputRef.current) excelInputRef.current.value = '';
            }}
          />
          <button
            onClick={() => dxfInputRef.current?.click()}
            disabled={importDxf.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 text-sm"
          >
            {importDxf.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Layers className="h-4 w-4" />
            )}
            {t('constructionPlanReview', 'importDxf')}
          </button>
          <input
            ref={dxfInputRef}
            type="file"
            accept=".dxf,application/dxf,image/vnd.dxf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importDxf.mutate(f);
              if (dxfInputRef.current) dxfInputRef.current.value = '';
            }}
          />
          <span className="text-xs text-gray-500">
            {t('constructionPlanReview', 'extractModesHint')}
          </span>
          {importMessage && (
            <p className="ml-auto text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              {importMessage}
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('constructionPlanReview', 'uploadTitle')}
            </h2>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t('constructionPlanReview', 'addFiles')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,image/*,.dxf,.dwg,.jww,.xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
          </div>

          {files.length === 0 ? (
            <div
              className="p-10 text-center border-2 border-dashed border-gray-300 m-6 rounded-xl"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
            >
              <Upload className="h-7 w-7 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-700 font-medium">
                {t('constructionPlanReview', 'dropTitle')}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {t('constructionPlanReview', 'dropHint')}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-2 font-medium">{t('constructionPlanReview', 'colFile')}</th>
                  <th className="px-4 py-2 font-medium">{t('constructionPlanReview', 'colKind')}</th>
                  <th className="px-4 py-2 font-medium">{t('constructionPlanReview', 'colLevel')}</th>
                  <th className="px-4 py-2 font-medium">{t('constructionPlanReview', 'colBlock')}</th>
                  <th className="px-4 py-2 font-medium">{t('constructionPlanReview', 'colSource')}</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {files.map((f) => {
                  const lowerName = (f.filename || '').toLowerCase();
                  const isBinaryCad = lowerName.endsWith('.dwg') || lowerName.endsWith('.jww');
                  return (
                  <tr key={f.id}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <span className="font-mono text-xs text-gray-900 truncate max-w-[280px]" title={f.filename}>
                          {f.filename}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={f.kind ?? 'unknown'}
                        onChange={(e) =>
                          patchFile.mutate({ fileId: f.id, patch: { kind: e.target.value as DrawingKind } })
                        }
                        className="px-2 py-1 border border-gray-200 rounded-md text-xs"
                      >
                        {DRAWING_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t('constructionPlanReview', `drawingKind_${k}` as never)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={f.level ?? ''}
                        onChange={(e) =>
                          patchFile.mutate({ fileId: f.id, patch: { level: e.target.value || null } })
                        }
                        className="px-2 py-1 border border-gray-200 rounded-md text-xs"
                      >
                        <option value="">—</option>
                        {levels.map((lv) => (
                          <option key={lv} value={lv}>{lv}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={f.block ?? ''}
                        onChange={(e) =>
                          patchFile.mutate({ fileId: f.id, patch: { block: e.target.value || null } })
                        }
                        className="px-2 py-1 border border-gray-200 rounded-md text-xs"
                      >
                        <option value="">—</option>
                        {(project.blocks || []).map((bk) => (
                          <option key={bk} value={bk}>{bk}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                        f.classificationSource === 'manual'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-gray-50 text-gray-700 border border-gray-200'
                      }`}>
                        {f.classificationSource === 'manual' ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : null}
                        {f.classificationSource}
                      </span>
                      {f.classificationConfidence != null && f.classificationSource === 'auto' && (
                        <span className="ml-2 text-xs text-gray-500">
                          {Math.round(f.classificationConfidence * 100)}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {f.storagePath ? (
                          <>
                            <button
                              onClick={async () => {
                                try {
                                  const link = await structuralTakeoffApi.getFileSignedUrl(setId, f.id);
                                  window.open(link.url, '_blank', 'noopener,noreferrer');
                                } catch {
                                  /* signed URL failures are silent — UI stays usable */
                                }
                              }}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                              title={t('constructionPlanReview', 'download')}
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => reclassifyAi.mutate(f.id)}
                              disabled={
                                isBinaryCad ||
                                (reclassifyAi.isPending && reclassifyAi.variables === f.id)
                              }
                              className="p-1.5 text-violet-600 hover:bg-violet-50 rounded disabled:opacity-50"
                              title={
                                isBinaryCad
                                  ? t('constructionPlanReview', 'binaryCadAiBlocked')
                                  : t('constructionPlanReview', 'aiReclassify')
                              }
                            >
                              {reclassifyAi.isPending && reclassifyAi.variables === f.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Sparkles className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => extractElementsAi.mutate(f.id)}
                              disabled={
                                isBinaryCad ||
                                (extractElementsAi.isPending && extractElementsAi.variables === f.id)
                              }
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded disabled:opacity-50"
                              title={
                                isBinaryCad
                                  ? t('constructionPlanReview', 'binaryCadAiBlocked')
                                  : t('constructionPlanReview', 'aiExtractElements')
                              }
                            >
                              {extractElementsAi.isPending && extractElementsAi.variables === f.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Plus className="h-4 w-4" />
                              )}
                            </button>
                          </>
                        ) : null}
                        <button
                          onClick={() => deleteFile.mutate(f.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                          title={t('constructionPlanReview', 'delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('constructionPlanReview', 'elementsTitle')}
            </h2>
            <button
              onClick={() => saveElements.mutate()}
              disabled={saveElements.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 text-sm"
            >
              {saveElements.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t('constructionPlanReview', 'saveAll')}
            </button>
          </div>

          <div className="p-6 space-y-6">
            {levels.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {t('constructionPlanReview', 'noLevels')}
              </div>
            ) : (
              levels.map((level) =>
                blocksWithFallback.map((block) => {
                  const sectionRows = draft
                    .map((r, idx) => ({ row: r, idx }))
                    .filter(({ row }) => row.level === level && row.block === block);
                  return (
                    <div key={`${level}-${block ?? 'all'}`} className="border border-gray-200 rounded-xl">
                      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{level}</span>
                        {block && (
                          <span className="text-sm text-gray-600">
                            · {t('constructionPlanReview', 'block')} {block}
                          </span>
                        )}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50/50">
                            <tr className="text-left text-gray-500">
                              <th className="px-3 py-2 font-medium">{t('constructionPlanReview', 'elementType')}</th>
                              <th className="px-3 py-2 font-medium">{t('constructionPlanReview', 'label')}</th>
                              <th className="px-3 py-2 font-medium">{t('constructionPlanReview', 'section')}</th>
                              <th className="px-3 py-2 font-medium">{t('constructionPlanReview', 'qty')}</th>
                              <th className="px-3 py-2 font-medium">{t('constructionPlanReview', 'grid')}</th>
                              <th className="px-3 py-2 font-medium" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {sectionRows.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="px-3 py-3 text-xs text-gray-400">
                                  {t('constructionPlanReview', 'emptyAddBelow')}
                                </td>
                              </tr>
                            ) : (
                              sectionRows.map(({ row, idx }) => (
                                <tr key={`${level}-${block ?? 'all'}-${idx}`}>
                                  <td className="px-3 py-2">
                                    <select
                                      value={row.elementType}
                                      onChange={(e) => updateRow(idx, { elementType: e.target.value as StructuralElementType })}
                                      className="px-2 py-1 border border-gray-200 rounded-md text-xs"
                                    >
                                      {STRUCTURAL_ELEMENT_TYPES.map((et) => (
                                        <option key={et} value={et}>
                                          {t('constructionPlanReview', `elementType_${et}` as never)}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      value={row.label}
                                      onChange={(e) => updateRow(idx, { label: e.target.value })}
                                      placeholder="C1"
                                      className="w-20 px-2 py-1 border border-gray-200 rounded-md text-xs"
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      value={row.section}
                                      onChange={(e) => updateRow(idx, { section: e.target.value })}
                                      placeholder="H-600x200x11x17"
                                      className="w-44 px-2 py-1 border border-gray-200 rounded-md text-xs font-mono"
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      min={0}
                                      value={row.qty}
                                      onChange={(e) => updateRow(idx, { qty: Math.max(0, Number.parseInt(e.target.value || '0', 10)) })}
                                      className="w-20 px-2 py-1 border border-gray-200 rounded-md text-xs"
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      value={row.grid}
                                      onChange={(e) => updateRow(idx, { grid: e.target.value })}
                                      placeholder="X1-Y1"
                                      className="w-24 px-2 py-1 border border-gray-200 rounded-md text-xs"
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button
                                      onClick={() => deleteRow(idx)}
                                      className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                      title={t('constructionPlanReview', 'delete')}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                        {STRUCTURAL_ELEMENT_TYPES.map((et) => (
                          <button
                            key={et}
                            onClick={() => addRow(level, block, et)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-700 hover:bg-gray-200"
                          >
                            <Plus className="h-3 w-3" />
                            {t('constructionPlanReview', `elementType_${et}` as never)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }),
              )
            )}
          </div>
          {saveElements.isError && (
            <div className="m-6 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <p>{t('constructionPlanReview', 'saveFailed')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
