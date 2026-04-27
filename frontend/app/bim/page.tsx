'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  ArrowRight,
  Lock,
  Box,
  Upload,
  Info,
  FileText,
  FileBox,
  Layers,
  Activity,
  Sparkles,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePresence } from '@/lib/page-presence-context';
import { accessApi } from '@/lib/api/access';
import { presenceApi, type UploadEventRow } from '@/lib/api/presence';

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRelative(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const KIND_BADGE_COLOR: Record<string, string> = {
  ifc: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dxf: 'bg-violet-50 text-violet-700 border-violet-200',
  pdf: 'bg-rose-50 text-rose-700 border-rose-200',
  dwg: 'bg-amber-50 text-amber-700 border-amber-200',
  bim_other: 'bg-slate-50 text-slate-700 border-slate-200',
};

export default function BimHomePage() {
  const { t } = useI18n();
  usePresence({ pageKey: 'bim/home', label: 'BIM: dashboard' });

  const accessQuery = useQuery({
    queryKey: ['effective-access'],
    queryFn: accessApi.getEffectiveAccess,
    staleTime: 60_000,
  });

  const enabled = !!accessQuery.data?.bim?.hasAccess;

  const uploadsQuery = useQuery({
    queryKey: ['my-uploads', 'bim'],
    queryFn: () => presenceApi.getMyRecentUploads({ productCode: 'bim', limit: 50 }),
    enabled,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  if (accessQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
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
              {t('bimLanding', 'lockedTitle')}
            </h1>
            <p className="mt-2 text-gray-600">{t('bimLanding', 'lockedBody')}</p>
            <Link
              href="/billing#bim"
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

  const uploads: UploadEventRow[] = uploadsQuery.data ?? [];
  const now = Date.now();

  const counts = uploads.reduce(
    (acc, u) => {
      const k = (u.kind || 'other').toLowerCase();
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const totalBytes = uploads.reduce((s, u) => s + (u.sizeBytes ?? 0), 0);
  const lastUpload = uploads[0]?.createdAt;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Box className="h-7 w-7 text-violet-600" />
              {t('bimLanding', 'title')}
            </h1>
            <p className="text-sm text-gray-500 mt-1">{t('bimLanding', 'subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/bim/viewer"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 font-medium"
            >
              <Upload className="h-4 w-4" />
              {t('bimLanding', 'openViewerCta')}
            </Link>
            <Link
              href="/billing#bim"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-medium"
            >
              {t('bimLanding', 'manageSubscription')}
            </Link>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            icon={<Layers className="h-5 w-5 text-violet-600" />}
            label={t('bimLanding', 'kpiTotalUploads')}
            value={String(uploads.length)}
            sub={lastUpload ? `${t('bimLanding', 'kpiLastUpload')}: ${formatRelative(lastUpload, now)}` : '—'}
          />
          <KpiCard
            icon={<FileBox className="h-5 w-5 text-emerald-600" />}
            label="IFC"
            value={String(counts.ifc ?? 0)}
            sub=".ifc"
          />
          <KpiCard
            icon={<FileText className="h-5 w-5 text-rose-600" />}
            label="DXF / DWG / PDF"
            value={String((counts.dxf ?? 0) + (counts.dwg ?? 0) + (counts.pdf ?? 0))}
            sub=".dxf / .dwg / .pdf"
          />
          <KpiCard
            icon={<Activity className="h-5 w-5 text-blue-600" />}
            label={t('bimLanding', 'kpiTotalSize')}
            value={formatBytes(totalBytes)}
            sub={t('bimLanding', 'kpiTotalSizeSub')}
          />
        </div>

        {/* Supported formats */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" />
            {t('bimLanding', 'supportedFormatsTitle')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <FormatCard
              ext=".ifc"
              colorClass="bg-emerald-50 border-emerald-200 text-emerald-900"
              title="IFC"
              body={t('bimLanding', 'fmtIfc')}
            />
            <FormatCard
              ext=".dxf"
              colorClass="bg-violet-50 border-violet-200 text-violet-900"
              title="DXF"
              body={t('bimLanding', 'fmtDxf')}
            />
            <FormatCard
              ext=".pdf"
              colorClass="bg-rose-50 border-rose-200 text-rose-900"
              title="PDF"
              body={t('bimLanding', 'fmtPdf')}
            />
            <FormatCard
              ext=".dwg"
              colorClass="bg-amber-50 border-amber-200 text-amber-900"
              title="DWG"
              body={t('bimLanding', 'fmtDwg')}
            />
          </div>
        </div>

        {/* Recent uploads */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('bimLanding', 'recentTitle')}
            </h2>
            {uploadsQuery.isFetching && (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            )}
          </div>
          {uploads.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">
              <Info className="h-5 w-5 mx-auto mb-2 text-gray-400" />
              {t('bimLanding', 'recentEmpty')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50/60">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2.5 font-medium">{t('bimLanding', 'colFile')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('bimLanding', 'colKind')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('bimLanding', 'colSize')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('bimLanding', 'colWhen')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {uploads.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 max-w-[420px] truncate font-mono text-xs text-gray-800" title={u.filename ?? ''}>
                        {u.filename || '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs border font-medium ${
                            KIND_BADGE_COLOR[(u.kind || 'bim_other').toLowerCase()] ||
                            KIND_BADGE_COLOR.bim_other
                          }`}
                        >
                          {(u.kind || '').toUpperCase() || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 tabular-nums">{formatBytes(u.sizeBytes)}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs" title={u.createdAt}>
                        {formatRelative(u.createdAt, now)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-violet-50/60 border border-violet-200 rounded-xl p-4 text-sm text-violet-900 flex gap-3">
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p>{t('bimLanding', 'privacyNote')}</p>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
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

function FormatCard({
  ext,
  title,
  body,
  colorClass,
}: {
  ext: string;
  title: string;
  body: string;
  colorClass: string;
}) {
  return (
    <div className={`rounded-xl border p-3 ${colorClass}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[10px] font-mono opacity-70">{ext}</span>
      </div>
      <p className="text-xs mt-1 leading-snug opacity-90">{body}</p>
    </div>
  );
}
