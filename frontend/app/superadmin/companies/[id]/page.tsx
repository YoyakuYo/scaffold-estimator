'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { companyApi } from '@/lib/api/company';
import { usersApi } from '@/lib/api/users';
import { useI18n } from '@/lib/i18n';
import {
  Building2,
  ArrowLeft,
  ExternalLink,
  Loader2,
  MapPin,
  Mail,
  Phone,
  CheckCircle,
  XCircle,
  CreditCard,
  Calendar,
  Users as UsersIcon,
  FileUp,
  AlertTriangle,
} from 'lucide-react';
import { usePresence } from '@/lib/page-presence-context';

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p && String(p).trim().length > 0).join(' ');
}

export default function SuperadminCompanyVerifyPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const companyId = (params?.id as string) || '';
  usePresence({
    pageKey: `superadmin/companies/${companyId}`,
    label: 'Superadmin: company verification',
  });

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });
  const isAdmin = profile?.role === 'superadmin';

  useEffect(() => {
    if (profile && !isAdmin) router.replace('/dashboard');
  }, [profile, isAdmin, router]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-company-detail', companyId],
    queryFn: () => companyApi.getCompanyForAdmin(companyId),
    enabled: isAdmin && !!companyId,
  });

  if (!profile || (profile && !isAdmin)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="bg-white border border-red-200 rounded-xl p-6 flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-red-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-red-700">{t('companyVerify', 'loadFailed')}</p>
              <p className="text-sm text-red-600">{(error as Error)?.message || ''}</p>
              <Link
                href="/superadmin/dashboard"
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                {t('companyVerify', 'backToDashboard')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const fullAddress = joinAddress([
    data.postalCode ? `〒${data.postalCode}` : '',
    data.prefecture,
    data.city,
    data.town,
    data.addressLine,
    data.building,
  ]);
  const mapsQuery = encodeURIComponent(joinAddress([data.prefecture, data.city, data.town, data.addressLine]));
  const mapsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}` : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/superadmin/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('companyVerify', 'backToDashboard')}
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-1">
            <Building2 className="h-3.5 w-3.5" />
            {t('companyVerify', 'badge')}
          </span>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Building2 className="h-6 w-6 text-indigo-600" />
                {data.name}
              </h1>
              {data.taxId ? (
                <p className="text-sm text-gray-500 mt-1">
                  {t('companyVerify', 'taxId')}: {data.taxId}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {mapsHref ? (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                >
                  <MapPin className="h-4 w-4" />
                  {t('companyVerify', 'verifyOnMaps')}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-gray-500" />
                {t('companyVerify', 'address')}
              </h2>
              <p className="text-gray-900">{fullAddress || '—'}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <Field label={t('companyVerify', 'postalCode')} value={data.postalCode} />
                <Field label={t('companyVerify', 'prefecture')} value={data.prefecture} />
                <Field label={t('companyVerify', 'city')} value={data.city} />
                <Field label={t('companyVerify', 'town')} value={data.town} />
                <Field label={t('companyVerify', 'addressLine')} value={data.addressLine} />
                <Field label={t('companyVerify', 'building')} value={data.building} />
              </dl>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <Phone className="h-4 w-4 text-gray-500" />
                {t('companyVerify', 'contact')}
              </h2>
              <dl className="grid grid-cols-1 gap-y-1.5 text-sm">
                <ContactField icon={<Phone className="h-3.5 w-3.5" />} value={data.phone} />
                <ContactField icon={<Mail className="h-3.5 w-3.5" />} value={data.email} />
              </dl>
              <h2 className="text-sm font-semibold text-gray-700 mt-4 mb-2 flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-gray-500" />
                {t('companyVerify', 'timestamps')}
              </h2>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <Field label={t('companyVerify', 'createdAt')} value={formatDate(data.createdAt)} />
                <Field label={t('companyVerify', 'updatedAt')} value={formatDate(data.updatedAt)} />
              </dl>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <UsersIcon className="h-5 w-5 text-indigo-500" />
                {t('companyVerify', 'membersTitle')}
              </h2>
              <span className="text-sm text-gray-500">{data.membersCount}</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {data.members.length === 0 ? (
                <p className="p-6 text-gray-500 text-sm">{t('companyVerify', 'noMembers')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-left text-gray-500">
                      <th className="px-4 py-2 font-medium">{t('companyVerify', 'colName')}</th>
                      <th className="px-4 py-2 font-medium">{t('companyVerify', 'colRole')}</th>
                      <th className="px-4 py-2 font-medium">{t('companyVerify', 'colStatus')}</th>
                      <th className="px-4 py-2 font-medium">{t('companyVerify', 'colLastActive')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.members.map((m) => {
                      const name = (m.firstName || m.lastName)
                        ? [m.lastName, m.firstName].filter(Boolean).join(' ')
                        : m.email;
                      return (
                        <tr key={m.id}>
                          <td className="px-4 py-2">
                            <div className="text-gray-900 font-medium truncate max-w-[200px]" title={name}>
                              {name}
                            </div>
                            <div className="text-xs text-gray-500 truncate max-w-[200px]" title={m.email}>
                              {m.email}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-gray-700">{m.role}</td>
                          <td className="px-4 py-2">
                            <StatusPill approval={m.approvalStatus} active={m.isActive} t={t} />
                          </td>
                          <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                            {m.lastActiveAt ? `${formatRelative(m.lastActiveAt)} ago` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-emerald-500" />
                {t('companyVerify', 'subscriptionsTitle')}
              </h2>
              <span className="text-sm text-gray-500">{data.subscriptions.length}</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {data.subscriptions.length === 0 ? (
                <p className="p-6 text-gray-500 text-sm">{t('companyVerify', 'noSubscriptions')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-left text-gray-500">
                      <th className="px-4 py-2 font-medium">{t('companyVerify', 'colPlan')}</th>
                      <th className="px-4 py-2 font-medium">{t('companyVerify', 'colSubStatus')}</th>
                      <th className="px-4 py-2 font-medium">{t('companyVerify', 'colTrial')}</th>
                      <th className="px-4 py-2 font-medium">{t('companyVerify', 'colPeriod')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.subscriptions.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2 font-medium text-gray-900">{s.plan}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs border bg-gray-50 text-gray-700 border-gray-200">
                            {s.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">
                          {s.trialEnd ? formatDate(s.trialEnd) : '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">
                          {s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <FileUp className="h-5 w-5 text-blue-500" />
              {t('companyVerify', 'recentUploadsTitle')}
            </h2>
            <span className="text-sm text-gray-500">{data.recentUploads.length}</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.recentUploads.length === 0 ? (
              <p className="p-6 text-gray-500 text-sm">{t('companyVerify', 'noUploads')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-left text-gray-500">
                    <th className="px-4 py-2 font-medium">{t('companyVerify', 'colTime')}</th>
                    <th className="px-4 py-2 font-medium">{t('companyVerify', 'colUser')}</th>
                    <th className="px-4 py-2 font-medium">{t('companyVerify', 'colKind')}</th>
                    <th className="px-4 py-2 font-medium">{t('companyVerify', 'colFilename')}</th>
                    <th className="px-4 py-2 font-medium">{t('companyVerify', 'colSize')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.recentUploads.map((u) => {
                    const name = u.userFirstName || u.userLastName
                      ? [u.userLastName, u.userFirstName].filter(Boolean).join(' ')
                      : u.userEmail || '—';
                    return (
                      <tr key={u.id}>
                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                          {formatRelative(u.createdAt)}
                        </td>
                        <td className="px-4 py-2 text-gray-900 truncate max-w-[180px]" title={name}>
                          {name}
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs border bg-blue-50 text-blue-700 border-blue-200">
                            {u.kind}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-900 font-mono text-xs truncate max-w-[260px]" title={u.filename || ''}>
                          {u.filename || '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                          {formatBytes(u.sizeBytes)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 truncate" title={value || ''}>
        {value && String(value).trim().length > 0 ? value : '—'}
      </dd>
    </>
  );
}

function ContactField({ icon, value }: { icon: React.ReactNode; value: string | null | undefined }) {
  if (!value) return (
    <div className="flex items-center gap-1.5 text-gray-400">
      {icon}
      <span>—</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 text-gray-900">
      {icon}
      <span className="truncate">{value}</span>
    </div>
  );
}

type TFn = (section: any, key: any) => string;

function StatusPill({ approval, active, t }: { approval: string | null; active: boolean; t: TFn }) {
  if (!active) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border bg-gray-100 text-gray-700 border-gray-200">
        <XCircle className="h-3 w-3" />
        {t('companyVerify', 'statusInactive')}
      </span>
    );
  }
  if (approval === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border bg-green-50 text-green-700 border-green-200">
        <CheckCircle className="h-3 w-3" />
        {t('companyVerify', 'statusApproved')}
      </span>
    );
  }
  if (approval === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border bg-amber-50 text-amber-700 border-amber-200">
        {t('companyVerify', 'statusPending')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border bg-red-50 text-red-700 border-red-200">
      {approval || t('companyVerify', 'statusOther')}
    </span>
  );
}
