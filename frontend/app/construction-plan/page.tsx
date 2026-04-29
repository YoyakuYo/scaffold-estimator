'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  Lock,
  Calendar,
  ArrowRight,
  Upload,
  Building2,
  AlertTriangle,
  Sparkles,
  Layers,
  Activity,
  FileText,
  Truck,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePresence } from '@/lib/page-presence-context';
import { accessApi } from '@/lib/api/access';
import { structuralTakeoffApi } from '@/lib/api/structural-takeoff';
import { presenceApi } from '@/lib/api/presence';

const DEFAULT_BLOCKS = ['A', 'B'];
const DEFAULT_LEVELS = ['1F', '2F', '3F', 'RF'];

export default function ConstructionPlanHomePage() {
  const router = useRouter();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  usePresence({ pageKey: 'construction-plan/home', label: 'Construction Plan: project list' });

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [blocksText, setBlocksText] = useState(DEFAULT_BLOCKS.join(','));
  const [levelsText, setLevelsText] = useState(DEFAULT_LEVELS.join(','));

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['effective-access'],
    queryFn: accessApi.getEffectiveAccess,
    staleTime: 60_000,
  });

  const enabled = !!access?.construction_plan?.hasAccess;

  const { data: projects, isLoading } = useQuery({
    queryKey: ['structural-takeoff', 'projects'],
    queryFn: structuralTakeoffApi.listProjects,
    enabled,
  });

  const firstProjectId = projects?.[0]?.id;
  const firstProjectSetsQuery = useQuery({
    queryKey: ['structural-takeoff', 'sets', firstProjectId],
    queryFn: () => structuralTakeoffApi.listSets(firstProjectId!),
    enabled: enabled && !!firstProjectId,
  });

  const recentUploadsQuery = useQuery({
    queryKey: ['my-uploads', 'construction_plan'],
    queryFn: () => presenceApi.getMyRecentUploads({ productCode: 'construction_plan', limit: 30 }),
    enabled,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const createProject = useMutation({
    mutationFn: structuralTakeoffApi.createProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'projects'] });
      router.push(`/construction-plan/${project.id}`);
    },
  });

  const loadSample = useMutation({
    mutationFn: structuralTakeoffApi.loadSampleProject,
    onSuccess: ({ project, set }) => {
      queryClient.invalidateQueries({ queryKey: ['structural-takeoff', 'projects'] });
      router.push(`/construction-plan/${project.id}/sets/${set.id}/schedule`);
    },
  });

  if (accessLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center shadow-sm">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-100 mb-4">
              <Lock className="h-7 w-7 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              {t('constructionPlanLanding', 'lockedTitle')}
            </h1>
            <p className="mt-2 text-gray-600">{t('constructionPlanLanding', 'lockedBody')}</p>
            <Link
              href="/billing#construction_plan"
              className="mt-6 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              {t('products', 'subscribeCta')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const blocks = parseCsvList(blocksText);
  const levels = parseCsvList(levelsText);
  const canSubmit = name.trim().length > 0 && levels.length > 0;

  const firstSetId = firstProjectSetsQuery.data?.[0]?.id;
  const extractHref =
    firstProjectId && firstSetId
      ? `/construction-plan/${firstProjectId}/sets/${firstSetId}`
      : firstProjectId
        ? `/construction-plan/${firstProjectId}`
        : '/construction-plan#cp-new-project';
  const scheduleBase =
    firstProjectId && firstSetId
      ? `/construction-plan/${firstProjectId}/sets/${firstSetId}/schedule`
      : null;
  const scheduleHref = scheduleBase ? `${scheduleBase}#cp-master-gantt` : '/construction-plan#cp-new-project';
  const deliveryHref = scheduleBase ? `${scheduleBase}#cp-delivery-plan` : '/construction-plan#cp-new-project';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="h-7 w-7 text-amber-600" />
              {t('constructionPlanLanding', 'title')}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {t('constructionPlanLanding', 'subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => loadSample.mutate()}
              disabled={loadSample.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50"
              title={t('constructionPlanLanding', 'loadSampleHint')}
            >
              {loadSample.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t('constructionPlanLanding', 'loadSample')}
            </button>
            <button
              onClick={() => setShowCreate((s) => !s)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-medium hover:bg-amber-700"
            >
              <Plus className="h-4 w-4" />
              {t('constructionPlanLanding', 'newProject')}
            </button>
          </div>
        </div>

        <div id="cp-new-project" className="scroll-mt-24 h-0 overflow-hidden" aria-hidden />

        {showCreate && (
          <div className="mb-6 bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">
              {t('constructionPlanLanding', 'newProjectTitle')}
            </h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('constructionPlanLanding', 'projectName')} *
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-amber-500 focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('constructionPlanLanding', 'siteAddress')}
              </label>
              <input
                value={siteAddress}
                onChange={(e) => setSiteAddress(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-amber-500 focus:border-amber-500"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('constructionPlanLanding', 'blocks')}
                </label>
                <input
                  value={blocksText}
                  onChange={(e) => setBlocksText(e.target.value)}
                  placeholder="A,B,C"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-amber-500 focus:border-amber-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('constructionPlanLanding', 'blocksHint')}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('constructionPlanLanding', 'levels')} *
                </label>
                <input
                  value={levelsText}
                  onChange={(e) => setLevelsText(e.target.value)}
                  placeholder="1F,2F,3F,RF"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-amber-500 focus:border-amber-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('constructionPlanLanding', 'levelsHint')}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                {t('constructionPlanLanding', 'cancel')}
              </button>
              <button
                disabled={!canSubmit || createProject.isPending}
                onClick={() =>
                  createProject.mutate({
                    name: name.trim(),
                    siteAddress: siteAddress.trim() || undefined,
                    blocks,
                    levels,
                  })
                }
                className="px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {createProject.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('constructionPlanLanding', 'create')
                )}
              </button>
            </div>
            {createProject.isError && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <p>{t('constructionPlanLanding', 'createFailed')}</p>
              </div>
            )}
          </div>
        )}

        {/* KPI strip — projects, drawings uploaded, levels covered, last activity. */}
        {(() => {
          const uploads = recentUploadsQuery.data ?? [];
          const dxfDwg = uploads.filter((u) =>
            ['dxf', 'dwg'].includes((u.kind || '').toLowerCase()),
          ).length;
          const pdfImg = uploads.filter((u) =>
            ['pdf', 'image', 'image_pdf', 'drawing', 'cp_drawing'].includes(
              (u.kind || '').toLowerCase(),
            ),
          ).length;
          const lastUpload = uploads[0]?.createdAt;
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <CpKpi
                icon={<Building2 className="h-5 w-5 text-amber-600" />}
                label={t('constructionPlanLanding', 'kpiProjects')}
                value={String(projects?.length ?? 0)}
              />
              <CpKpi
                icon={<Layers className="h-5 w-5 text-violet-600" />}
                label={t('constructionPlanLanding', 'kpiUploads')}
                value={String(uploads.length)}
                sub={lastUpload ? `${formatRelativeShort(lastUpload)} ago` : '—'}
              />
              <CpKpi
                icon={<FileText className="h-5 w-5 text-rose-600" />}
                label="DXF / DWG"
                value={String(dxfDwg)}
                sub={t('constructionPlanLanding', 'kpiDxfDwgSub')}
              />
              <CpKpi
                icon={<Activity className="h-5 w-5 text-blue-600" />}
                label="PDF / IMG"
                value={String(pdfImg)}
                sub={t('constructionPlanLanding', 'kpiPdfImgSub')}
              />
            </div>
          );
        })()}

        {/* Quick links to deeper product surfaces. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
          <FeatureLink
            href={extractHref}
            icon={<FileText className="h-5 w-5 text-amber-600" />}
            title={t('constructionPlanLanding', 'featureExtractTitle')}
            body={t('constructionPlanLanding', 'featureExtractBody')}
          />
          <FeatureLink
            href={scheduleHref}
            icon={<Calendar className="h-5 w-5 text-blue-600" />}
            title={t('constructionPlanLanding', 'featureScheduleTitle')}
            body={t('constructionPlanLanding', 'featureScheduleBody')}
          />
          <FeatureLink
            href={deliveryHref}
            icon={<Truck className="h-5 w-5 text-emerald-600" />}
            title={t('constructionPlanLanding', 'featureDeliveryTitle')}
            body={t('constructionPlanLanding', 'featureDeliveryBody')}
          />
        </div>
        {!firstSetId && (
          <p className="text-xs text-gray-500 mb-6">
            {t('constructionPlanLanding', 'featureLinksHint')}
          </p>
        )}

        {/* Recent activity (uploads from any of this user's projects/sets). */}
        {(recentUploadsQuery.data ?? []).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {t('constructionPlanLanding', 'recentActivityTitle')}
              </h2>
              {recentUploadsQuery.isFetching && (
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              )}
            </div>
            <ul className="divide-y divide-gray-100 text-sm">
              {(recentUploadsQuery.data ?? []).slice(0, 8).map((u) => (
                <li key={u.id} className="px-6 py-3 flex items-center gap-3">
                  <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <span className="font-mono text-xs text-gray-800 truncate flex-1" title={u.filename ?? ''}>
                    {u.filename || '—'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] border border-gray-200 bg-gray-50 uppercase text-gray-600">
                    {(u.kind || '').replace(/_/g, ' ') || '—'}
                  </span>
                  <span className="text-xs text-gray-400 tabular-nums" title={u.createdAt}>
                    {formatRelativeShort(u.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isLoading ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : projects && projects.length > 0 ? (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <li
                key={p.id}
                className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <Link href={`/construction-plan/${p.id}`} className="block">
                  <div className="flex items-center gap-2 text-gray-700 mb-2">
                    <Building2 className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-wide text-gray-500">
                      {t('constructionPlanLanding', 'project')}
                    </span>
                  </div>
                  <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                  {p.siteAddress && (
                    <p className="text-sm text-gray-500 mt-1 truncate">{p.siteAddress}</p>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
                    <span>
                      {t('constructionPlanLanding', 'levels')}: {p.levels.length || '—'}
                    </span>
                    <span>
                      {t('constructionPlanLanding', 'blocks')}: {p.blocks.length || '—'}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-10 text-center">
            <Upload className="h-7 w-7 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">
              {t('constructionPlanLanding', 'emptyTitle')}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {t('constructionPlanLanding', 'emptyHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function parseCsvList(text: string): string[] {
  return text
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formatRelativeShort(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function CpKpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function FeatureLink({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link href={href} className="block group">
      <div className="bg-white rounded-2xl border border-gray-200 p-4 h-full group-hover:shadow-md group-hover:border-gray-300 transition">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="font-semibold text-gray-900 text-sm">{title}</span>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">{body}</p>
      </div>
    </Link>
  );
}
