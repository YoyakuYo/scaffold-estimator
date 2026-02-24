'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, UserProfile, UserRole } from '@/lib/api/users';
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
} from 'lucide-react';

const ROLE_CONFIG: Record<UserRole, { label: string; labelJa: string; color: string; icon: any }> = {
  superadmin: { label: 'Super Admin', labelJa: 'スーパー管理者', color: 'bg-amber-100 text-amber-700', icon: Shield },
  estimator: { label: 'Estimator', labelJa: '積算担当', color: 'bg-blue-100 text-blue-700', icon: Calculator },
  viewer: { label: 'Viewer', labelJa: '閲覧者', color: 'bg-gray-100 text-gray-700', icon: Eye },
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
  const isEstimator = currentUser?.role === 'estimator';
  const canManageUsers = isSuperAdmin || isEstimator;

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
    mutationFn: usersApi.approveUser,
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
    const msg = locale === 'ja'
      ? `${user.email} を無効化しますか？`
      : `Deactivate ${user.email}?`;
    if (window.confirm(msg)) {
      deactivateMutation.mutate(user.id);
    }
  };

  const handleApprove = (user: UserProfile) => {
    const msg = locale === 'ja'
      ? `${user.email} を承認しますか？`
      : `Approve ${user.email}?`;
    if (window.confirm(msg)) {
      approveMutation.mutate(user.id);
    }
  };

  const handleReject = (user: UserProfile) => {
    const msg = locale === 'ja'
      ? `${user.email} を拒否しますか？`
      : `Reject ${user.email}?`;
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
              {locale === 'ja' ? 'アクセス権限がありません' : 'Access Denied'}
            </h1>
            <p className="text-gray-600 mb-2">
              {locale === 'ja'
                ? 'ユーザー管理は管理者または積算担当（招待のみ）が利用できます。'
                : 'User management is available to administrators or estimators (invite only).'}
            </p>
            <p className="text-sm text-gray-500 mb-4">
              {locale === 'ja'
                ? `現在の権限: ${ROLE_CONFIG[currentUser.role]?.labelJa || currentUser.role}`
                : `Current role: ${ROLE_CONFIG[currentUser.role]?.label || currentUser.role}`}
            </p>
            <p className="text-xs text-gray-400">
              {locale === 'ja' ? 'ダッシュボードにリダイレクトします...' : 'Redirecting to dashboard...'}
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
              {locale === 'ja' ? 'ユーザー管理' : 'User Management'}
              {pendingCount && pendingCount.count > 0 && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-semibold">
                  <Clock className="h-4 w-4" />
                  {pendingCount.count} {locale === 'ja' ? '件の承認待ち' : 'pending'}
                </span>
              )}
            </h1>
            <p className="text-gray-500 mt-1">
              {isSuperAdmin
                ? (locale === 'ja' ? '会社・ユーザー一覧・承認・権限管理' : 'Companies, users, approval and permissions')
                : (locale === 'ja' ? '自社ユーザー一覧・招待' : 'Company users and invites')}
            </p>
          </div>
        </div>

        {/* Super Admin: Companies overview (user count, branches) */}
        {isSuperAdmin && companies && companies.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="px-6 py-3 border-b border-gray-200 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                {locale === 'ja' ? '会社一覧（人数・支店）' : 'Companies (user count & branches)'}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">{locale === 'ja' ? '会社名' : 'Company'}</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">{locale === 'ja' ? 'ユーザー数' : 'Users'}</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">{locale === 'ja' ? '支店' : 'Branches'}</th>
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
                                {b.name}{b.isHeadquarters ? ` (${locale === 'ja' ? '本社' : 'HQ'})` : ''}
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
              { key: 'all' as const, label: locale === 'ja' ? 'すべて' : 'All', count: users.length },
              { key: 'pending' as const, label: locale === 'ja' ? '承認待ち' : 'Pending', count: users.filter(u => u.approvalStatus === 'pending').length },
              { key: 'approved' as const, label: locale === 'ja' ? '承認済み' : 'Approved', count: users.filter(u => u.approvalStatus === 'approved').length },
              { key: 'rejected' as const, label: locale === 'ja' ? '拒否済み' : 'Rejected', count: users.filter(u => u.approvalStatus === 'rejected').length },
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
                {locale === 'ja' ? 'ユーザー一覧の取得に失敗しました。' : 'Failed to load users.'}
              </p>
              <p className="text-sm text-gray-400">
                {(error as any)?.response?.status === 403
                  ? locale === 'ja'
                    ? '管理者権限が必要です。'
                    : 'Admin access required.'
                  : locale === 'ja'
                  ? 'バックエンドサーバーに接続できません。'
                  : 'Cannot connect to backend server.'}
              </p>
            </div>
          ) : filteredUsers && filteredUsers.length > 0 ? (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {locale === 'ja' ? '会社 / ユーザー' : 'Company / User'}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {locale === 'ja' ? 'メール' : 'Email'}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {locale === 'ja' ? '権限' : 'Role'}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {locale === 'ja' ? '承認状態' : 'Approval'}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {locale === 'ja' ? 'ステータス' : 'Status'}
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {locale === 'ja' ? '登録日' : 'Created'}
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {locale === 'ja' ? '操作' : 'Actions'}
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
                              {user.companyName || (locale === 'ja' ? '（会社名なし）' : '(No company)')}
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
                          {locale === 'ja' ? roleConfig.labelJa : roleConfig.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {user.approvalStatus === 'pending' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            <Clock className="h-3 w-3" />
                            {locale === 'ja' ? '承認待ち' : 'Pending'}
                          </span>
                        ) : user.approvalStatus === 'approved' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                            <CheckCircle className="h-3 w-3" />
                            {locale === 'ja' ? '承認済み' : 'Approved'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                            <XCircle className="h-3 w-3" />
                            {locale === 'ja' ? '拒否済み' : 'Rejected'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {user.isActive ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                            <Check className="h-3 w-3" />
                            {locale === 'ja' ? '有効' : 'Active'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            <Ban className="h-3 w-3" />
                            {locale === 'ja' ? '無効' : 'Inactive'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(user.createdAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US')}
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
                                    onClick={() => { handleApprove(user); setOpenMenuId(null); }}
                                    disabled={approveMutation.isPending}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-700 hover:bg-green-50 disabled:opacity-50"
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                    {locale === 'ja' ? '承認' : 'Approve'}
                                  </button>
                                  <button
                                    onClick={() => { handleReject(user); setOpenMenuId(null); }}
                                    disabled={rejectMutation.isPending}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    <XCircle className="h-4 w-4" />
                                    {locale === 'ja' ? '拒否' : 'Reject'}
                                  </button>
                                  <div className="border-t border-gray-100 my-1" />
                                </>
                              )}
                              <button
                                onClick={() => openEdit(user)}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                <Pencil className="h-4 w-4 text-blue-500" />
                                {locale === 'ja' ? '編集' : 'Edit'}
                              </button>
                              <button
                                onClick={() => { setResetPasswordUser(user); setOpenMenuId(null); }}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                <Key className="h-4 w-4 text-amber-500" />
                                {locale === 'ja' ? 'パスワードリセット' : 'Reset Password'}
                              </button>
                              <div className="border-t border-gray-100 my-1" />
                              <button
                                onClick={() => { handleDeactivate(user); setOpenMenuId(null); }}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                              >
                                <Ban className="h-4 w-4" />
                                {locale === 'ja' ? '無効化' : 'Deactivate'}
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
                    {locale === 'ja'
                      ? `フィルター条件に一致するユーザーがいません`
                      : `No users match the filter criteria`}
                  </p>
                  <button
                    onClick={() => setFilterStatus('all')}
                    className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    {locale === 'ja' ? 'すべて表示' : 'Show all'}
                  </button>
                </div>
              ) : (
                <div className="text-center py-16">
                  <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">{locale === 'ja' ? 'ユーザーがいません' : 'No users found'}</p>
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
                {locale === 'ja' ? 'ユーザー編集' : 'Edit User'}
              </h2>
              <button onClick={() => setEditingUser(null)} className="p-1 hover:bg-gray-100 rounded-md">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {locale === 'ja' ? '姓' : 'Last Name'}
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
                    {locale === 'ja' ? '名' : 'First Name'}
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
                  {locale === 'ja' ? 'メールアドレス' : 'Email'}
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
                  {locale === 'ja' ? '権限' : 'Role'}
                </label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="estimator">{locale === 'ja' ? '積算担当' : 'Estimator'}</option>
                  <option value="viewer">{locale === 'ja' ? '閲覧者' : 'Viewer'}</option>
                </select>
              </div>
              {updateMutation.isError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                  {(updateMutation.error as any)?.response?.data?.message || (locale === 'ja' ? '更新に失敗しました' : 'Failed to update user')}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {locale === 'ja' ? 'キャンセル' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {updateMutation.isPending
                    ? (locale === 'ja' ? '保存中...' : 'Saving...')
                    : (locale === 'ja' ? '保存' : 'Save')}
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
                {locale === 'ja' ? 'パスワードリセット' : 'Reset Password'}
              </h2>
              <button onClick={() => setResetPasswordUser(null)} className="p-1 hover:bg-gray-100 rounded-md">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {locale === 'ja'
                ? `${resetPasswordUser.email} のパスワードをリセットします。`
                : `Reset password for ${resetPasswordUser.email}.`}
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {locale === 'ja' ? '新しいパスワード' : 'New Password'}
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
                  {locale === 'ja' ? 'リセットに失敗しました' : 'Failed to reset password'}
                </div>
              )}
              {resetPasswordMutation.isSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm">
                  {locale === 'ja' ? 'パスワードをリセットしました' : 'Password has been reset'}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setResetPasswordUser(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {locale === 'ja' ? '閉じる' : 'Close'}
                </button>
                <button
                  type="submit"
                  disabled={resetPasswordMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
                >
                  {resetPasswordMutation.isPending
                    ? (locale === 'ja' ? 'リセット中...' : 'Resetting...')
                    : (locale === 'ja' ? 'リセット' : 'Reset')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
