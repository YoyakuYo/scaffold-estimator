'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { usersApi, type UserProfile } from '@/lib/api/users';
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
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function SuperAdminDashboardContent() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalModeByUser, setApprovalModeByUser] = useState<Record<string, string>>({});

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

  const { data: onlineUsers, isLoading: onlineLoading } = useQuery({
    queryKey: ['online-users'],
    queryFn: usersApi.getOnlineUsers,
    enabled: isAdmin,
    refetchInterval: 15000,
  });

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.listUsers,
    enabled: isAdmin,
  });
  const pendingUsers = allUsers?.filter((u) => u.approvalStatus === 'pending') ?? [];

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
    const msg = t('adminDashboard', 'confirmApproveBank').replace('{email}', u.email).replace('{plan}', planWord);
    if (!window.confirm(msg)) return;
    setApprovingId(u.id);
    approveMutation.mutate({ id: u.id, payload: { paymentActivation: 'bank_transfer', planTier: tier } });
  };
  const rejectMutation = useMutation({
    mutationFn: (id: string) => usersApi.rejectUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['platform-stats'] });
      queryClient.invalidateQueries({ queryKey: ['pending-count'] });
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
              <p className="mt-2 text-2xl font-bold text-green-600">{stats.onlineCount}</p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-green-500" />
                {t('adminDashboard', 'onlineNowLive')}
              </h2>
              <span className="text-sm text-gray-500">
                {onlineLoading ? '…' : `${onlineUsers?.length ?? 0} ${t('adminDashboard', 'usersCount')}`}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {onlineLoading ? (
                <div className="p-6 flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : onlineUsers?.length ? (
                <ul className="divide-y divide-gray-100">
                  {onlineUsers.map((u) => (
                    <li key={u.id} className="px-6 py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">
                          {u.firstName || u.lastName
                            ? [u.lastName, u.firstName].filter(Boolean).join(' ')
                            : u.email}
                        </p>
                        <p className="text-sm text-gray-500">{u.email}</p>
                      </div>
                        <span className="h-2 w-2 rounded-full bg-green-500" title={t('adminDashboard', 'onlineNow')} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-6 text-gray-500 text-sm">{t('adminDashboard', 'noOnlineUsers')}</p>
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
