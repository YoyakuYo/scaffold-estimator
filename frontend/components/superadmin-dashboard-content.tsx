'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { usersApi, type UserProfile } from '@/lib/api/users';
import { presenceApi, type LivePresenceRow, type UploadEventRow } from '@/lib/api/presence';
import { useI18n } from '@/lib/i18n';
import Link from 'next/link';
import {
  Shield,
  Users,
  Building2,
  UserCheck,
  Clock,
  Loader2,
  ArrowRight,
  MessageSquare,
  CheckCircle,
  XCircle,
  CreditCard,
  ExternalLink,
  FileUp,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function SuperAdminDashboardContent() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalModeByUser, setApprovalModeByUser] = useState<Record<string, string>>({});
  // Phase 2 follow-up: which product the bank-transfer approval grants.
  // Keyed by user id; defaults to 'scaffold' so behaviour is unchanged.
  const [approvalProductByUser, setApprovalProductByUser] = useState<
    Record<string, 'scaffold' | 'bim' | 'construction_plan'>
  >({});

  const { data: currentUser } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });
  const isAdmin = currentUser?.role === 'superadmin';

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: usersApi.getPlatformStats,
    enabled: isAdmin,
    refetchInterval: 30000,
  });

  const { data: livePresence, isLoading: presenceLoading } = useQuery({
    queryKey: ['admin-live-presence'],
    queryFn: presenceApi.getLivePresence,
    enabled: isAdmin,
    refetchInterval: 15000,
  });

  const { data: recentUploads, isLoading: uploadsLoading } = useQuery({
    queryKey: ['admin-recent-uploads'],
    queryFn: () => presenceApi.getRecentUploads({ limit: 50 }),
    enabled: isAdmin,
    refetchInterval: 20000,
  });

  const { data: companies } = useQuery({
    queryKey: ['admin-companies'],
    queryFn: usersApi.listCompanies,
    enabled: isAdmin,
  });

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.listUsers,
    enabled: isAdmin,
  });
  const pendingUsers = allUsers?.filter((u) => u.approvalStatus === 'pending') ?? [];

  const onlineCount = livePresence?.length ?? 0;

  const approveMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: import('@/lib/api/users').ApproveUserPayload }) =>
      usersApi.approveUser(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['pending-count'] });
      setApprovingId(null);
    },
  });

  const runApprove = (u: UserProfile) => {
    const mode = approvalModeByUser[u.id] ?? 'trial';
    if (mode === 'trial') {
      setApprovingId(u.id);
      approveMutation.mutate({ id: u.id, payload: {} });
      return;
    }
    const tier = mode.replace('bank_', '') as 'basic' | 'medium' | 'monthly' | 'premium';
    const planWord =
      tier === 'basic'
        ? t('billing', 'planTierBasic')
        : tier === 'medium'
          ? t('billing', 'planTierMedium')
          : tier === 'monthly'
            ? t('billing', 'planTierMonthly')
            : t('billing', 'planTierPremium');
    const productCode = approvalProductByUser[u.id] ?? 'scaffold';
    const productWord =
      productCode === 'bim'
        ? t('products', 'productBim')
        : productCode === 'construction_plan'
          ? t('products', 'productConstructionPlan')
          : t('products', 'productScaffold');
    const msg = t('adminDashboard', 'confirmApproveBank')
      .replace('{email}', u.email)
      .replace('{plan}', `${productWord} / ${planWord}`);
    if (!window.confirm(msg)) return;
    setApprovingId(u.id);
    approveMutation.mutate({
      id: u.id,
      payload: { paymentActivation: 'bank_transfer', planTier: tier, productCode },
    });
  };
  const rejectMutation = useMutation({
    mutationFn: (id: string) => usersApi.rejectUser(id),
    onSuccess: (_data, rejectedUserId) => {
      queryClient.setQueryData<UserProfile[]>(['users'], (prev) =>
        prev ? prev.filter((u) => u.id !== rejectedUserId) : prev,
      );
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['platform-stats'] });
      queryClient.invalidateQueries({ queryKey: ['pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['online-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
      setApprovingId(null);
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message
          : null;
      const text = Array.isArray(msg) ? msg.join('\n') : msg;
      window.alert(text || 'Could not remove this user. The row may still exist in the database.');
      setApprovingId(null);
    },
  });

  useEffect(() => {
    if (currentUser && !isAdmin) router.replace('/dashboard');
  }, [currentUser, isAdmin, router]);

  if (!currentUser || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Shield className="h-8 w-8 text-indigo-600" />
            {t('adminDashboard', 'title')}
          </h1>
          <p className="mt-1 text-gray-500">
            {t('adminDashboard', 'subtitle')}
          </p>
        </div>

        {statsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-4" />
                <div className="h-8 bg-gray-200 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Users className="h-5 w-5" />
                {t('adminDashboard', 'totalUsers')}
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">{stats.totalUsers}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Clock className="h-5 w-5" />
                {t('adminDashboard', 'pendingApproval')}
              </div>
              <p className="mt-2 text-2xl font-bold text-amber-600">{stats.pendingUsers}</p>
              <Link
                href="/users?filter=pending"
                className="mt-2 inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
              >
                {t('adminDashboard', 'viewAll')}
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Building2 className="h-5 w-5" />
                {t('adminDashboard', 'companies')}
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">{stats.totalCompanies}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <UserCheck className="h-5 w-5" />
                {t('adminDashboard', 'onlineNow')}
              </div>
              <p className="mt-2 text-2xl font-bold text-green-600">{onlineCount}</p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden lg:col-span-2">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-green-500" />
                {t('adminDashboard', 'onlineNowLive')}
              </h2>
              <span className="text-sm text-gray-500">
                {presenceLoading ? '…' : `${onlineCount} ${t('adminDashboard', 'usersCount')}`}
              </span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {presenceLoading ? (
                <div className="p-6 flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : livePresence && livePresence.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-left text-gray-500">
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colName')}</th>
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colCompany')}</th>
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colPage')}</th>
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colLastAction')}</th>
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colIdle')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {livePresence.map((row) => (
                      <PresenceRow key={row.userId} row={row} />
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-6 text-gray-500 text-sm">{t('adminDashboard', 'noOnlineUsers')}</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FileUp className="h-5 w-5 text-blue-500" />
                {t('adminDashboard', 'recentUploadsTitle')}
              </h2>
              <span className="text-sm text-gray-500">
                {uploadsLoading ? '…' : `${recentUploads?.length ?? 0}`}
              </span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {uploadsLoading ? (
                <div className="p-6 flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : recentUploads && recentUploads.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-left text-gray-500">
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colTime')}</th>
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colUser')}</th>
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colCompany')}</th>
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colKind')}</th>
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colFilename')}</th>
                      <th className="px-4 py-2 font-medium">{t('adminDashboard', 'colSize')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recentUploads.map((row) => (
                      <UploadEventTableRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-6 text-gray-500 text-sm">{t('adminDashboard', 'noRecentUploads')}</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-indigo-500" />
                {t('adminDashboard', 'companiesTitle')}
              </h2>
              <span className="text-sm text-gray-500">{companies?.length ?? 0}</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {!companies ? (
                <div className="p-6 flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : companies.length > 0 ? (
                <ul className="divide-y divide-gray-100">
                  {companies.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/superadmin/companies/${c.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between px-6 py-3 hover:bg-indigo-50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate flex items-center gap-1.5">
                            {c.name}
                            <ExternalLink className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          </p>
                          <p className="text-xs text-gray-500">
                            {c.userCount} {t('adminDashboard', 'usersCount')}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-6 text-gray-500 text-sm">{t('adminDashboard', 'noCompanies')}</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                {t('adminDashboard', 'pendingApprovals')}
              </h2>
              <Link
                href="/users?filter=pending"
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                {t('adminDashboard', 'viewAll')}
              </Link>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {pendingUsers.length === 0 ? (
                <p className="p-6 text-gray-500 text-sm">{t('adminDashboard', 'noPendingApprovals')}</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {pendingUsers.slice(0, 10).map((u) => (
                    <li key={u.id} className="px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">
                          {u.firstName || u.lastName
                            ? [u.lastName, u.firstName].filter(Boolean).join(' ')
                            : u.email}
                        </p>
                        <p className="text-sm text-gray-500 truncate">{u.email}</p>
                        <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                          <span className="shrink-0">{t('adminDashboard', 'approvalModeLabel')}</span>
                          <select
                            value={approvalModeByUser[u.id] ?? 'trial'}
                            onChange={(e) =>
                              setApprovalModeByUser((m) => ({ ...m, [u.id]: e.target.value }))
                            }
                            className="border border-gray-200 rounded-md px-2 py-1 text-gray-800 max-w-[200px]"
                          >
                            <option value="trial">{t('adminDashboard', 'approvalModeTrial')}</option>
                            <option value="bank_basic">{t('adminDashboard', 'approvalModeBankBasic')}</option>
                            <option value="bank_medium">{t('adminDashboard', 'approvalModeBankMedium')}</option>
                            <option value="bank_monthly">{t('adminDashboard', 'approvalModeBankMonthly')}</option>
                            <option value="bank_premium">{t('adminDashboard', 'approvalModeBankPremium')}</option>
                          </select>
                        </label>
                        {(approvalModeByUser[u.id] ?? 'trial') !== 'trial' && (
                          <label className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                            <span className="shrink-0">
                              {t('adminDashboard', 'approvalProductLabel')}
                            </span>
                            <select
                              value={approvalProductByUser[u.id] ?? 'scaffold'}
                              onChange={(e) =>
                                setApprovalProductByUser((m) => ({
                                  ...m,
                                  [u.id]: e.target.value as 'scaffold' | 'bim' | 'construction_plan',
                                }))
                              }
                              className="border border-gray-200 rounded-md px-2 py-1 text-gray-800 max-w-[200px]"
                            >
                              <option value="scaffold">{t('products', 'productScaffold')}</option>
                              <option value="bim">{t('products', 'productBim')}</option>
                              <option value="construction_plan">
                                {t('products', 'productConstructionPlan')}
                              </option>
                            </select>
                          </label>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => runApprove(u)}
                          disabled={approvingId === u.id}
                          className="p-2 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-50"
                          title={t('adminDashboard', 'approve')}
                        >
                          {approvingId === u.id ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <CheckCircle className="h-5 w-5" />
                          )}
                        </button>
                        <button
                          onClick={() => {
                            const msg = t('adminDashboard', 'confirmRejectPermanent').replace('{email}', u.email);
                            if (!window.confirm(msg)) return;
                            setApprovingId(u.id);
                            rejectMutation.mutate(u.id);
                          }}
                          disabled={approvingId === u.id}
                          className="p-2 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
                          title={t('adminDashboard', 'reject')}
                        >
                          <XCircle className="h-5 w-5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/users"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            <Users className="h-5 w-5" />
            {t('adminDashboard', 'manageUsers')}
          </Link>
          <Link
            href="/admin/messages"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            <MessageSquare className="h-5 w-5" />
            {t('adminDashboard', 'supportMessages')}
          </Link>
          <Link
            href="/superadmin/subscribers"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            <CreditCard className="h-5 w-5" />
            {t('adminDashboard', 'subscribers')}
          </Link>
        </div>
      </div>
    </div>
  );
}

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

function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fullName(firstName: string | null, lastName: string | null, email: string): string {
  if (firstName || lastName) return [lastName, firstName].filter(Boolean).join(' ');
  return email;
}

function PresenceRow({ row }: { row: LivePresenceRow }) {
  const name = fullName(row.firstName, row.lastName, row.email);
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2">
        <div className="font-medium text-gray-900 truncate max-w-[180px]" title={name}>
          {name}
        </div>
        <div className="text-xs text-gray-500 truncate max-w-[180px]" title={row.email}>
          {row.email}
        </div>
      </td>
      <td className="px-4 py-2">
        {row.companyId && row.companyName ? (
          <Link
            href={`/superadmin/companies/${row.companyId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline truncate max-w-[160px] inline-block"
            title={row.companyName}
          >
            {row.companyName}
          </Link>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-4 py-2">
        <div className="text-gray-900 truncate max-w-[200px]" title={row.label || row.pageKey || ''}>
          {row.label || row.pageKey || '—'}
        </div>
        {row.label && row.pageKey && row.pageKey !== row.label ? (
          <div className="text-xs text-gray-500 font-mono truncate max-w-[200px]" title={row.pageKey}>
            {row.pageKey}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-2">
        <div className="text-gray-700 truncate max-w-[260px]" title={row.lastAction || ''}>
          {row.lastAction || '—'}
        </div>
        {row.lastActionAt ? (
          <div className="text-xs text-gray-500">{formatRelative(row.lastActionAt)} ago</div>
        ) : null}
      </td>
      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
        {formatRelative(row.updatedAt)}
      </td>
    </tr>
  );
}

function UploadEventTableRow({ row }: { row: UploadEventRow }) {
  const name = fullName(row.userFirstName, row.userLastName, row.userEmail || '');
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatRelative(row.createdAt)}</td>
      <td className="px-4 py-2">
        <div className="text-gray-900 truncate max-w-[180px]" title={name}>{name}</div>
      </td>
      <td className="px-4 py-2">
        {row.companyId && row.companyName ? (
          <Link
            href={`/superadmin/companies/${row.companyId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline truncate max-w-[140px] inline-block"
            title={row.companyName}
          >
            {row.companyName}
          </Link>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-200">
          {row.kind}
        </span>
      </td>
      <td className="px-4 py-2">
        <div className="text-gray-900 truncate max-w-[260px] font-mono text-xs" title={row.filename || ''}>
          {row.filename || '—'}
        </div>
      </td>
      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatBytes(row.sizeBytes)}</td>
    </tr>
  );
}
