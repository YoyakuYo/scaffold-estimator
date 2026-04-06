'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, UserProfile, UserRole } from '@/lib/api/users';
import { companyApi } from '@/lib/api/company';
import { teamInvitesApi } from '@/lib/api/team-invites';
import { useI18n } from '@/lib/i18n';
import {
  Users,
  Shield,
  Eye,
  Calculator,
  MoreHorizontal,
  Loader2,
  X,
  Check,
  AlertTriangle,
  Key,
  Ban,
  Pencil,
  CheckCircle,
  XCircle,
  Clock,
  Building2,
  MapPin,
  UserPlus,
  Copy,
} from 'lucide-react';

const ROLE_CONFIG: Record<UserRole, { label: string; labelJa: string; labelFr: string; color: string; icon: any }> = {
  superadmin: { label: 'Super Admin', labelJa: 'スーパー管理者', labelFr: 'Super Admin', color: 'bg-amber-100 text-amber-700', icon: Shield },
  estimator: { label: 'Estimator', labelJa: '積算担当', labelFr: 'Estimateur', color: 'bg-blue-100 text-blue-700', icon: Calculator },
  viewer: { label: 'Viewer', labelJa: '閲覧者', labelFr: 'Lecteur', color: 'bg-gray-100 text-gray-700', icon: Eye },
};

export default function UsersPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>}>
      <UsersPage />
    </Suspense>
  );
}

function UsersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [inviteCompanyId, setInviteCompanyId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBranchId, setInviteBranchId] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'estimator'>('viewer');
  const [lastJoinUrl, setLastJoinUrl] = useState<string | null>(null);
  
  // Get filter from URL or default to 'all'
  const filterParam = searchParams.get('filter') as 'all' | 'pending' | 'approved' | 'rejected' | null;
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    filterParam && ['all', 'pending', 'approved', 'rejected'].includes(filterParam) ? filterParam : 'all'
  );

  // Update filter when URL changes
  useEffect(() => {
    if (filterParam && ['all', 'pending', 'approved', 'rejected'].includes(filterParam)) {
      setFilterStatus(filterParam);
    }
  }, [filterParam]);

  // Form state for edit
  const [editForm, setEditForm] = useState({
    email: '',
    role: 'estimator' as UserRole,
    firstName: '',
    lastName: '',
  });

  // Check current user's role first
  const { data: currentUser } = useQuery<UserProfile>({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });

  const isSuperAdmin = currentUser?.role === 'superadmin';
  const canManageUsers = isSuperAdmin || currentUser?.isCompanyAdmin === true;

  const { data: users, isLoading, isError, error } = useQuery<UserProfile[]>({
    queryKey: ['users'],
    queryFn: usersApi.listUsers,
    retry: false,
    enabled: canManageUsers,
  });

  const { data: pendingCount } = useQuery({
    queryKey: ['pending-count'],
    queryFn: usersApi.getPendingCount,
    retry: false,
    enabled: isSuperAdmin,
    refetchInterval: 30000,
  });

  const { data: companies } = useQuery({
    queryKey: ['admin-companies'],
    queryFn: usersApi.listCompanies,
    retry: false,
    enabled: isSuperAdmin,
  });

  useEffect(() => {
    if (isSuperAdmin && companies?.length && !inviteCompanyId) {
      setInviteCompanyId(companies[0].id);
    }
  }, [isSuperAdmin, companies, inviteCompanyId]);

  const effectiveInviteCompanyId = isSuperAdmin
    ? inviteCompanyId || companies?.[0]?.id || ''
    : currentUser?.companyId || '';

  const { data: estimatorBranches } = useQuery({
    queryKey: ['company-branches'],
    queryFn: companyApi.listBranches,
    enabled: !!canManageUsers && !isSuperAdmin,
  });

  const branchOptions =
    isSuperAdmin
      ? companies?.find((c) => c.id === effectiveInviteCompanyId)?.branches ?? []
      : estimatorBranches ?? [];

  const { data: teamInvites } = useQuery({
    queryKey: ['team-invites', effectiveInviteCompanyId],
    queryFn: () => teamInvitesApi.list(isSuperAdmin ? effectiveInviteCompanyId : undefined),
    enabled: isSuperAdmin && !!effectiveInviteCompanyId,
  });

  const createInviteMutation = useMutation({
    mutationFn: () =>
      teamInvitesApi.create({
        email: inviteEmail.trim(),
        branchId: inviteBranchId,
        role: inviteRole,
        ...(isSuperAdmin ? { companyId: effectiveInviteCompanyId } : {}),
      }),
    onMutate: () => setLastJoinUrl(null),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['team-invites'] });
      setInviteEmail('');
      setLastJoinUrl(data.joinUrl || null);
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) =>
      teamInvitesApi.revoke(inviteId, isSuperAdmin ? effectiveInviteCompanyId : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-invites'] });
    },
  });

  useEffect(() => {
    if (!branchOptions.length) {
      setInviteBranchId('');
      return;
    }
    if (!inviteBranchId || !branchOptions.some((b) => b.id === inviteBranchId)) {
      const hq = branchOptions.find((b) => b.isHeadquarters);
      setInviteBranchId((hq || branchOptions[0]).id);
    }
  }, [branchOptions, inviteBranchId]);

  // Filter users by approval status
  const filteredUsers = users?.filter((user) => {
    if (filterStatus === 'all') return true;
    return user.approvalStatus === filterStatus;
  }) || [];

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => usersApi.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => usersApi.resetPassword(id, password),
    onSuccess: () => {
      setResetPasswordUser(null);
      setNewPassword('');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: usersApi.deactivateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: import('@/lib/api/users').ApproveUserPayload }) =>
      usersApi.approveUser(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: usersApi.rejectUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });


  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    updateMutation.mutate({ id: editingUser.id, data: editForm });
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordUser) return;
    resetPasswordMutation.mutate({ id: resetPasswordUser.id, password: newPassword });
  };

  const handleDeactivate = (user: UserProfile) => {
    const msg = t('usersAdmin', 'confirmDeactivate').replace('{email}', user.email);
    if (window.confirm(msg)) {
      deactivateMutation.mutate(user.id);
    }
  };

  const handleApproveTrial = (user: UserProfile) => {
    const msg = t('usersAdmin', 'confirmApprove').replace('{email}', user.email);
    if (window.confirm(msg)) {
      approveMutation.mutate({ id: user.id, payload: {} });
    }
  };

  const handleApproveBank = (user: UserProfile, tier: 'basic' | 'medium' | 'premium') => {
    const planWord =
      tier === 'basic'
        ? t('billing', 'planTierBasic')
        : tier === 'medium'
          ? t('billing', 'planTierMedium')
          : t('billing', 'planTierPremium');
    const msg = t('usersAdmin', 'confirmApproveBank').replace('{email}', user.email).replace('{plan}', planWord);
    if (window.confirm(msg)) {
      approveMutation.mutate({ id: user.id, payload: { paymentActivation: 'bank_transfer', planTier: tier } });
    }
  };

  const handleReject = (user: UserProfile) => {
    const msg = t('usersAdmin', 'confirmReject').replace('{email}', user.email);
    if (window.confirm(msg)) {
      rejectMutation.mutate(user.id);
    }
  };

  const openEdit = (user: UserProfile) => {
    setEditingUser(user);
    setEditForm({
      email: user.email,
      role: user.role,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    });
    setOpenMenuId(null);
  };

  // Redirect users who cannot manage users (viewer)
  useEffect(() => {
    if (currentUser && !canManageUsers) {
      const timer = setTimeout(() => router.push('/dashboard'), 2000);
      return () => clearTimeout(timer);
    }
  }, [currentUser, canManageUsers, router]);

  if (currentUser && !canManageUsers) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <Shield className="h-16 w-16 text-amber-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {t('usersAdmin', 'accessDenied')}
            </h1>
            <p className="text-gray-600 mb-2">
              {t('usersAdmin', 'accessDeniedDesc')}
            </p>
            <p className="text-sm text-gray-500 mb-4">
              {locale === 'ja'
                ? `${t('usersAdmin', 'currentRole')}: ${ROLE_CONFIG[currentUser.role]?.labelJa || currentUser.role}`
                : locale === 'fr'
                ? `${t('usersAdmin', 'currentRole')} : ${ROLE_CONFIG[currentUser.role]?.labelFr || currentUser.role}`
                : `${t('usersAdmin', 'currentRole')}: ${ROLE_CONFIG[currentUser.role]?.label || currentUser.role}`}
            </p>
            <p className="text-xs text-gray-400">
              {t('usersAdmin', 'redirecting')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Users className="h-8 w-8 text-blue-600" />
              {t('usersAdmin', 'title')}
              {pendingCount && pendingCount.count > 0 && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-semibold">
                  <Clock className="h-4 w-4" />
                  {pendingCount.count} {t('usersAdmin', 'pendingBadge')}
                </span>
              )}
            </h1>
            <p className="text-gray-500 mt-1">
              {isSuperAdmin
                ? t('usersAdmin', 'subtitleSuperadmin')
                : t('usersAdmin', 'subtitleCompanyAdmin')}
            </p>
          </div>
        </div>

        {/* Team invites (platform superadmin only; company admins use /team) */}
        {isSuperAdmin && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="px-6 py-3 border-b border-gray-200 flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">{t('usersAdmin', 'teamInvitesTitle')}</h2>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">{t('usersAdmin', 'teamInvitesHint')}</p>
              {isSuperAdmin && companies && companies.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('usersAdmin', 'targetCompany')}</label>
                  <select
                    value={effectiveInviteCompanyId}
                    onChange={(e) => setInviteCompanyId(e.target.value)}
                    className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <form
                className="flex flex-wrap gap-3 items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!inviteBranchId) return;
                  createInviteMutation.mutate();
                }}
              >
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('usersAdmin', 'inviteEmail')}</label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="name@company.com"
                  />
                </div>
                <div className="min-w-[160px]">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('usersAdmin', 'inviteBranch')}</label>
                  <select
                    value={inviteBranchId}
                    onChange={(e) => setInviteBranchId(e.target.value)}
                    required
                    disabled={!branchOptions.length}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    {!branchOptions.length ? (
                      <option value="">{t('usersAdmin', 'noBranches')}</option>
                    ) : (
                      branchOptions.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                          {b.isHeadquarters ? ` (${t('usersAdmin', 'headquarters')})` : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="min-w-[140px]">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('usersAdmin', 'inviteRole')}</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'viewer' | 'estimator')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="viewer">{t('usersAdmin', 'viewer')}</option>
                    <option value="estimator">{t('usersAdmin', 'estimator')}</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={createInviteMutation.isPending || !inviteBranchId}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {createInviteMutation.isPending ? '…' : t('usersAdmin', 'sendInvite')}
                </button>
              </form>
              {createInviteMutation.isSuccess && lastJoinUrl && (
                <div className="space-y-2 text-sm">
                  <p className="text-green-700">{t('usersAdmin', 'inviteSent')}</p>
                  <p className="text-gray-500">{t('usersAdmin', 'emailSentNote')}</p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input readOnly value={lastJoinUrl} className="flex-1 min-w-[200px] px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50" />
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(lastJoinUrl)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-100 rounded-lg hover:bg-gray-200"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t('usersAdmin', 'copyLink')}
                    </button>
                  </div>
                </div>
              )}
              {createInviteMutation.isError && (
                <p className="text-sm text-red-600">
                  {(createInviteMutation.error as any)?.response?.data?.message || 'Failed'}
                </p>
              )}
              {teamInvites && teamInvites.filter((i) => i.status === 'pending').length > 0 && (
                <div className="pt-2 border-t border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">{t('usersAdmin', 'pendingInvites')}</h3>
                  <ul className="space-y-2">
                    {teamInvites
                      .filter((i) => i.status === 'pending')
                      .map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="text-gray-700">
                            {i.email} · {i.role}
                          </span>
                          <button
                            type="button"
                            onClick={() => revokeInviteMutation.mutate(i.id)}
                            className="text-red-600 hover:text-red-800"
                          >
                            {t('usersAdmin', 'revokeInvite')}
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Super Admin: Companies overview (user count, branches) */}
        {isSuperAdmin && companies && companies.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="px-6 py-3 border-b border-gray-200 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                {t('usersAdmin', 'companiesTitle')}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">{t('usersAdmin', 'company')}</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">{t('usersAdmin', 'users')}</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">{t('usersAdmin', 'branches')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {companies.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{c.userCount}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {c.branches.length === 0
                          ? '—'
                          : c.branches.map((b) => (
                              <span key={b.id} className="inline-flex items-center gap-1 mr-2">
                                <MapPin className="h-3 w-3 text-gray-400" />
                                {b.name}{b.isHeadquarters ? ` (${t('usersAdmin', 'headquarters')})` : ''}
                              </span>
                            ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Filter Tabs (super admin sees all; estimator sees only their company) */}
        {isSuperAdmin && users && users.length > 0 && (
          <div className="flex gap-2 mb-6">
            {[
              { key: 'all' as const, label: t('usersAdmin', 'all'), count: users.length },
              { key: 'pending' as const, label: t('usersAdmin', 'pending'), count: users.filter(u => u.approvalStatus === 'pending').length },
              { key: 'approved' as const, label: t('usersAdmin', 'approved'), count: users.filter(u => u.approvalStatus === 'approved').length },
              { key: 'rejected' as const, label: t('usersAdmin', 'rejected'), count: users.filter(u => u.approvalStatus === 'rejected').length },
            ].map((filter) => (
              <button
                key={filter.key}
                onClick={() => setFilterStatus(filter.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === filter.key
                    ? 'bg-blue-600 text-white'
                    : filter.key === 'pending' && filter.count > 0
                    ? 'bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {filter.label} ({filter.count})
              </button>
            ))}
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : isError ? (
            <div className="text-center py-16">
              <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-3" />
              <p className="text-gray-500 mb-2">
                {t('usersAdmin', 'loadFailed')}
              </p>
              <p className="text-sm text-gray-400">
                {(error as any)?.response?.status === 403
                  ? t('usersAdmin', 'adminRequired')
                  : t('usersAdmin', 'backendUnavailable')}
              </p>
            </div>
          ) : filteredUsers && filteredUsers.length > 0 ? (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {t('usersAdmin', 'companyUser')}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {t('usersAdmin', 'email')}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {t('usersAdmin', 'role')}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {t('usersAdmin', 'approval')}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {t('usersAdmin', 'status')}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {t('usersAdmin', 'created')}
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {t('usersAdmin', 'actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredUsers.map((user) => {
                  const roleConfig = ROLE_CONFIG[user.role];
                  const RoleIcon = roleConfig.icon;
                  return (
                    <tr
                      key={user.id}
                      className={`hover:bg-gray-50 transition-colors ${
                        user.approvalStatus === 'pending' ? 'bg-amber-50/30' : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                            {(user.firstName?.[0] || user.email[0]).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">
                              {user.companyName || t('usersAdmin', 'noCompany')}
                            </p>
                            <p className="text-sm text-gray-600 mt-0.5">
                              {user.firstName || user.lastName
                                ? `${user.lastName || ''} ${user.firstName || ''}`.trim()
                                : user.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${roleConfig.color}`}>
                          <RoleIcon className="h-3 w-3" />
                          {locale === 'ja' ? roleConfig.labelJa : locale === 'fr' ? roleConfig.labelFr : roleConfig.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {user.approvalStatus === 'pending' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            <Clock className="h-3 w-3" />
                            {t('usersAdmin', 'pending')}
                          </span>
                        ) : user.approvalStatus === 'approved' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                            <CheckCircle className="h-3 w-3" />
                            {t('usersAdmin', 'approved')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                            <XCircle className="h-3 w-3" />
                            {t('usersAdmin', 'rejected')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {user.isActive ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                            <Check className="h-3 w-3" />
                            {t('usersAdmin', 'active')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            <Ban className="h-3 w-3" />
                            {t('usersAdmin', 'inactive')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(user.createdAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : locale === 'fr' ? 'fr-FR' : 'en-US')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="relative inline-block">
                          <button
                            onClick={() => setOpenMenuId(openMenuId === user.id ? null : user.id)}
                            className="p-2 rounded-md hover:bg-gray-100 transition-colors text-gray-500"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {openMenuId === user.id && (
                            <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                              {/* Approve/Reject only for super admin */}
                              {isSuperAdmin && user.approvalStatus === 'pending' && (
                                <>
                                  <button
                                    onClick={() => { handleApproveTrial(user); setOpenMenuId(null); }}
                                    disabled={approveMutation.isPending}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-700 hover:bg-green-50 disabled:opacity-50"
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                    {t('usersAdmin', 'approveTrial')}
                                  </button>
                                  <button
                                    onClick={() => { handleApproveBank(user, 'basic'); setOpenMenuId(null); }}
                                    disabled={approveMutation.isPending}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-800 hover:bg-green-50 disabled:opacity-50"
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                    {t('usersAdmin', 'approveBankBasic')}
                                  </button>
                                  <button
                                    onClick={() => { handleApproveBank(user, 'medium'); setOpenMenuId(null); }}
                                    disabled={approveMutation.isPending}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-800 hover:bg-green-50 disabled:opacity-50"
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                    {t('usersAdmin', 'approveBankMedium')}
                                  </button>
                                  <button
                                    onClick={() => { handleApproveBank(user, 'premium'); setOpenMenuId(null); }}
                                    disabled={approveMutation.isPending}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-800 hover:bg-green-50 disabled:opacity-50"
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                    {t('usersAdmin', 'approveBankPremium')}
                                  </button>
                                  <button
                                    onClick={() => { handleReject(user); setOpenMenuId(null); }}
                                    disabled={rejectMutation.isPending}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    <XCircle className="h-4 w-4" />
                                    {t('usersAdmin', 'reject')}
                                  </button>
                                  <div className="border-t border-gray-100 my-1" />
                                </>
                              )}
                              <button
                                onClick={() => openEdit(user)}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                <Pencil className="h-4 w-4 text-blue-500" />
                                {t('usersAdmin', 'edit')}
                              </button>
                              <button
                                onClick={() => { setResetPasswordUser(user); setOpenMenuId(null); }}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                <Key className="h-4 w-4 text-amber-500" />
                                {t('usersAdmin', 'resetPassword')}
                              </button>
                              <div className="border-t border-gray-100 my-1" />
                              <button
                                onClick={() => { handleDeactivate(user); setOpenMenuId(null); }}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                              >
                                <Ban className="h-4 w-4" />
                                {t('usersAdmin', 'deactivate')}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
              ) : filteredUsers.length === 0 && users && users.length > 0 ? (
                <div className="text-center py-16">
                  <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">
                    {t('usersAdmin', 'noFilterResults')}
                  </p>
                  <button
                    onClick={() => setFilterStatus('all')}
                    className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    {t('usersAdmin', 'showAll')}
                  </button>
                </div>
              ) : (
                <div className="text-center py-16">
                  <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">{t('usersAdmin', 'noUsersFound')}</p>
                </div>
              )}
        </div>
      </div>

      {/* ─── Edit User Modal ─── */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                {t('usersAdmin', 'editUser')}
              </h2>
              <button onClick={() => setEditingUser(null)} className="p-1 hover:bg-gray-100 rounded-md">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('usersAdmin', 'lastName')}
                  </label>
                  <input
                    type="text"
                    value={editForm.lastName}
                    onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('usersAdmin', 'firstName')}
                  </label>
                  <input
                    type="text"
                    value={editForm.firstName}
                    onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('usersAdmin', 'email')}
                </label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('usersAdmin', 'role')}
                </label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="estimator">{t('usersAdmin', 'estimator')}</option>
                  <option value="viewer">{t('usersAdmin', 'viewer')}</option>
                </select>
              </div>
              {updateMutation.isError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                  {(updateMutation.error as any)?.response?.data?.message || t('usersAdmin', 'updateFailed')}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {t('common', 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {updateMutation.isPending
                    ? t('usersAdmin', 'saving')
                    : t('common', 'save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Reset Password Modal ─── */}
      {resetPasswordUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                {t('usersAdmin', 'resetPassword')}
              </h2>
              <button onClick={() => setResetPasswordUser(null)} className="p-1 hover:bg-gray-100 rounded-md">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {t('usersAdmin', 'resetPasswordFor').replace('{email}', resetPasswordUser.email)}
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('usersAdmin', 'newPassword')}
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="••••••••"
                />
              </div>
              {resetPasswordMutation.isError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                  {t('usersAdmin', 'resetFailed')}
                </div>
              )}
              {resetPasswordMutation.isSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm">
                  {t('usersAdmin', 'resetSuccess')}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setResetPasswordUser(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {t('common', 'close')}
                </button>
                <button
                  type="submit"
                  disabled={resetPasswordMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
                >
                  {resetPasswordMutation.isPending
                    ? t('usersAdmin', 'resetting')
                    : t('usersAdmin', 'reset')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
