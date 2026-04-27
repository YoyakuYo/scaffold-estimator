'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Calendar,
  ArrowRight,
  AlertTriangle,
  Upload,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePresence } from '@/lib/page-presence-context';
import { structuralTakeoffApi } from '@/lib/api/structural-takeoff';

export default function ConstructionPlanProjectPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const projectId = (params?.projectId as string) || '';
  usePresence({
    pageKey: `construction-plan/project/${projectId}`,
    label: 'Construction Plan: project',
  });

  const [creatingSet, setCreatingSet] = useState(false);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['structural-takeoff', 'project', projectId],
    queryFn: () => structuralTakeoffApi.getProject(projectId),
    enabled: !!projectId,
  });

  const { data: sets, isLoading: setsLoading } = useQuery({
    queryKey: ['structural-takeoff', 'sets', projectId],
    queryFn: () => structuralTakeoffApi.listSets(projectId),
    enabled: !!projectId,
  });

  const createSet = useMutation({
    mutationFn: () => structuralTakeoffApi.createSet(projectId, {}),
    onSuccess: (set) => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'sets', projectId] });
      router.push(`/construction-plan/${projectId}/sets/${set.id}`);
    },
    onSettled: () => setCreatingSet(false),
  });

  if (projectLoading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div>
          <Link
            href="/construction-plan"
            className="inline-flex items-center gap-1.5 text-sm text-amber-700 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('constructionPlanProject', 'back')}
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="h-6 w-6 text-amber-600" />
            {project.name}
          </h1>
          {project.siteAddress && (
            <p className="text-sm text-gray-500 mt-1">{project.siteAddress}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {project.levels.map((lv) => (
              <span
                key={lv}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
              >
                {lv}
              </span>
            ))}
            {project.blocks.map((bk) => (
              <span
                key={bk}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
              >
                {t('constructionPlanProject', 'blockLabel')}: {bk}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('constructionPlanProject', 'setsTitle')}
            </h2>
            <button
              disabled={creatingSet || createSet.isPending}
              onClick={() => {
                setCreatingSet(true);
                createSet.mutate();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 text-sm"
            >
              {createSet.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t('constructionPlanProject', 'newSet')}
            </button>
          </div>
          {setsLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : sets && sets.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {sets.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/construction-plan/${projectId}/sets/${s.id}`}
                    className="flex items-center justify-between px-6 py-3 hover:bg-amber-50/50"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {s.name || t('constructionPlanProject', 'untitledSet')}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(s.createdAt).toLocaleString()} · {s.status}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-gray-400" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-10 text-center">
              <Upload className="h-7 w-7 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-700 font-medium">
                {t('constructionPlanProject', 'noSetsTitle')}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {t('constructionPlanProject', 'noSetsHint')}
              </p>
            </div>
          )}
          {createSet.isError && (
            <div className="m-6 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <p>{t('constructionPlanProject', 'createSetFailed')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
