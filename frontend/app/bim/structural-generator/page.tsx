'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Play, Save, Trash2, Upload } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { authApi } from '@/lib/api/auth';
import { accessApi } from '@/lib/api/access';
import {
  structuralBimApi,
  type StructuralBimProject,
  type StructuralModelJson,
} from '@/lib/api/structural-bim';

export default function StructuralGeneratorPage() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const projectIdParam = searchParams.get('project');

  const hasSession = !!authApi.getToken();
  const accessQuery = useQuery({
    queryKey: ['effective-access'],
    queryFn: accessApi.getEffectiveAccess,
    enabled: hasSession,
    retry: false,
    staleTime: 60_000,
  });
  const enabled = !!accessQuery.data?.bim?.hasAccess;

  const [projectId, setProjectId] = useState<string | null>(projectIdParam);
  const [jsonText, setJsonText] = useState('');
  const [csvText, setCsvText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProjectId(projectIdParam);
  }, [projectIdParam]);

  const projectQuery = useQuery({
    queryKey: ['structural-bim-project', projectId],
    queryFn: () => structuralBimApi.getProject(projectId!),
    enabled: enabled && !!projectId,
  });

  useEffect(() => {
    if (projectQuery.data?.modelJson) {
      setJsonText(JSON.stringify(projectQuery.data.modelJson, null, 2));
    }
  }, [projectQuery.data?.modelJson, projectQuery.data?.updatedAt]);

  const createProject = useMutation({
    mutationFn: () => structuralBimApi.createProject(t('bimStructuralGen', 'defaultProjectName')),
    onSuccess: (p: StructuralBimProject) => {
      setProjectId(p.id);
      router.replace(`/bim/structural-generator?project=${p.id}`);
      queryClient.invalidateQueries({ queryKey: ['structural-bim-project'] });
    },
  });

  const saveModel = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(jsonText) as StructuralModelJson;
      return structuralBimApi.patchModel(projectId!, parsed);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['structural-bim-project', projectId] });
    },
    onError: (e: unknown) => {
      setError((e as Error)?.message ?? 'Save failed');
    },
  });

  const importCsv = useMutation({
    mutationFn: () => structuralBimApi.importMembersCsv(projectId!, csvText),
    onSuccess: () => {
      setError(null);
      setCsvText('');
      queryClient.invalidateQueries({ queryKey: ['structural-bim-project', projectId] });
    },
    onError: (e: unknown) => {
      setError((e as Error)?.message ?? 'CSV import failed');
    },
  });

  const generate = useMutation({
    mutationFn: () => structuralBimApi.generateIfc(projectId!),
    onSuccess: (res) => {
      setError(null);
      router.push(`/bim/viewer?model=${res.bimModel.id}`);
    },
    onError: (e: unknown) => {
      setError((e as Error)?.message ?? 'IFC generation failed');
    },
  });

  const del = useMutation({
    mutationFn: () => structuralBimApi.deleteProject(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['structural-bim-project'] });
      router.replace('/bim/structural-generator');
      setProjectId(null);
      setJsonText('');
    },
  });

  if (!hasSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Link href="/login?next=%2Fbim%2Fstructural-generator" className="text-violet-600 font-medium">
          Sign in
        </Link>
      </div>
    );
  }

  if (accessQuery.isLoading || !enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/bim"
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('bimStructuralGen', 'backBim')}
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('bimStructuralGen', 'title')}</h1>
          <p className="text-sm text-gray-600 mt-1">{t('bimStructuralGen', 'subtitle')}</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {!projectId && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
            <p className="text-sm text-gray-600">{t('bimStructuralGen', 'startHint')}</p>
            <button
              type="button"
              disabled={createProject.isPending}
              onClick={() => createProject.mutate()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-60"
            >
              {createProject.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {t('bimStructuralGen', 'createProject')}
            </button>
          </div>
        )}

        {projectId && projectQuery.isLoading && (
          <div className="flex items-center gap-2 text-gray-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        )}

        {projectId && projectQuery.data && (
          <>
            <div className="flex flex-wrap gap-2 items-center text-sm text-gray-500">
              <span>
                {t('bimStructuralGen', 'job')}: <strong>{projectQuery.data.jobStatus}</strong>
              </span>
              {projectQuery.data.jobError && (
                <span className="text-red-600 truncate max-w-md">{projectQuery.data.jobError}</span>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">{t('bimStructuralGen', 'modelJson')}</label>
              <textarea
                className="w-full min-h-[280px] font-mono text-xs border border-gray-200 rounded-xl p-3 bg-white"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saveModel.isPending}
                onClick={() => saveModel.mutate()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-sm font-medium"
              >
                <Save className="h-4 w-4" />
                {t('bimStructuralGen', 'saveModel')}
              </button>
              <button
                type="button"
                disabled={generate.isPending}
                onClick={() => generate.mutate()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white hover:bg-violet-700 text-sm font-medium"
              >
                {generate.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {t('bimStructuralGen', 'generateIfc')}
              </button>
              <button
                type="button"
                disabled={del.isPending}
                onClick={() => {
                  if (confirm(t('bimStructuralGen', 'deleteConfirm'))) del.mutate();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-sm font-medium"
              >
                <Trash2 className="h-4 w-4" />
                {t('bimStructuralGen', 'deleteProject')}
              </button>
            </div>

            <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-2">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Upload className="h-4 w-4" />
                {t('bimStructuralGen', 'csvTitle')}
              </h2>
              <p className="text-xs text-gray-500">{t('bimStructuralGen', 'csvHelp')}</p>
              <textarea
                className="w-full min-h-[100px] font-mono text-xs border border-gray-200 rounded-lg p-2"
                placeholder="mark,category,profile,storeyId,xLabel,yLabel,x2Label,y2Label"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                spellCheck={false}
              />
              <button
                type="button"
                disabled={importCsv.isPending || !csvText.trim()}
                onClick={() => importCsv.mutate()}
                className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {t('bimStructuralGen', 'importCsv')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
