'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, UserProfile } from '@/lib/api/users';
import { subscriptionsApi } from '@/lib/api/subscriptions';
import { subscriptionCombinedSummary } from '@/lib/billing/subscription-labels';
import { companyApi } from '@/lib/api/company';
import { teamInvitesApi } from '@/lib/api/team-invites';
import { useI18n } from '@/lib/i18n';
import {
  User,
  Mail,
  Shield,
  Save,
  Loader2,
  Check,
  AlertTriangle,
  CreditCard,
  UserPlus,
  Copy,
} from 'lucide-react';
import { ChangePasswordForm } from '@/components/change-password-form';

export default function ProfilePage() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();

  // Profile form state
  const [profileForm, setProfileForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
  });
  const [profileLoaded, setProfileLoaded] = useState(false);

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });

  const { data: subscription, isLoading: subscriptionLoading } = useQuery({
    queryKey: ['my-subscription'],
    queryFn: subscriptionsApi.getMine,
    retry: false,
    enabled: !!profile && profile.role !== 'superadmin',
  });

  const showTeamInvites =
    !!profile &&
    profile.role !== 'superadmin' &&
    !!profile.companyId &&
    !!subscription &&
    subscription.hasAccess;

  const { data: branchOptions = [] } = useQuery({
    queryKey: ['company-branches-profile'],
    queryFn: companyApi.listBranches,
    enabled: showTeamInvites,
  });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBranchId, setInviteBranchId] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'estimator'>('viewer');
  const [lastJoinUrl, setLastJoinUrl] = useState<string | null>(null);

  const { data: teamInvites } = useQuery({
    queryKey: ['team-invites', profile?.companyId],
    queryFn: () => teamInvitesApi.list(),
    enabled: showTeamInvites,
  });

  const createInviteMutation = useMutation({
    mutationFn: () =>
      teamInvitesApi.create({
        email: inviteEmail.trim(),
        branchId: inviteBranchId,
        role: inviteRole,
      }),
    onMutate: () => setLastJoinUrl(null),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['team-invites'] });
      setInviteEmail('');
      setLastJoinUrl(data.joinUrl || null);
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => teamInvitesApi.revoke(inviteId),
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

  // Initialize form once profile loads
  if (profile && !profileLoaded) {
    setProfileForm({
      email: profile.email,
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
    });
    setProfileLoaded(true);
  }

  const updateProfileMutation = useMutation({
    mutationFn: (data: { email?: string; firstName?: string; lastName?: string }) =>
      usersApi.updateProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate(profileForm);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <User className="h-8 w-8 text-blue-600" />
            {t('profile', 'title')}
          </h1>
          <p className="text-gray-500 mt-1">
            {t('profile', 'subtitle')}
          </p>
        </div>

        {profile?.role !== 'superadmin' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-gray-400" />
              {t('profile', 'subscriptionTitle')}
            </h2>
            {subscriptionLoading ? (
              <p className="text-sm text-gray-500 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                {t('profile', 'subscriptionLoading')}
              </p>
            ) : subscription ? (
              <>
                <p className="text-sm font-medium text-gray-900 leading-snug">
                  {subscriptionCombinedSummary(subscription.plan, subscription.status, t)}
                </p>
                <p
                  className={`text-xs font-medium mt-2 ${
                    subscription.hasAccess ? 'text-green-700' : 'text-amber-800'
                  }`}
                >
                  {subscription.hasAccess ? t('billing', 'accessEnabled') : t('billing', 'accessDisabled')}
                </p>
                <Link
                  href="/billing"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-800"
                >
                  <CreditCard className="h-4 w-4" />
                  {t('dashboard', 'manageBilling')}
                </Link>
              </>
            ) : (
              <p className="text-sm text-gray-500">{t('billing', 'unavailable')}</p>
            )}
          </div>
        )}

        {showTeamInvites && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-600" />
              {t('profile', 'teamInvitesTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-3">{t('usersAdmin', 'teamInvitesHint')}</p>
            {subscription?.seatUsage && (
              <p className="text-sm font-medium text-gray-800 mb-4">
                {t('profile', 'seatUsageLine')
                  .replace('{{used}}', String(subscription.seatUsage.used))
                  .replace('{{limit}}', String(subscription.seatUsage.limit))}
              </p>
            )}
            {profile?.role === 'estimator' && (
              <div className="mb-4">
                <Link href="/users" className="text-sm font-semibold text-blue-600 hover:text-blue-800">
                  {t('profile', 'openUserManagement')} →
                </Link>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('usersAdmin', 'inviteEmail')}
                </label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('usersAdmin', 'inviteBranch')}
                </label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('usersAdmin', 'inviteRole')}
                </label>
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
              <div className="mt-4 space-y-2 text-sm">
                <p className="text-green-700">{t('usersAdmin', 'inviteSent')}</p>
                <p className="text-gray-500">{t('usersAdmin', 'emailSentNote')}</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    readOnly
                    value={lastJoinUrl}
                    className="flex-1 min-w-[200px] px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50"
                  />
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
              <p className="mt-2 text-sm text-red-600">
                {(createInviteMutation.error as any)?.response?.data?.message || 'Failed'}
              </p>
            )}
            {teamInvites && teamInvites.filter((i) => i.status === 'pending').length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
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
        )}

        {/* Profile Info Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Mail className="h-5 w-5 text-gray-400" />
            {t('profile', 'basicInfo')}
          </h2>

          {profile && (
            <div className="mb-4 space-y-1">
              {profile.companyName && (
                <p className="text-sm font-semibold text-gray-900">{profile.companyName}</p>
              )}
              <p className="text-sm text-gray-600">
                {[profile.lastName, profile.firstName].filter(Boolean).join(' ') || profile.email}
              </p>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-500" />
                <span className="text-sm text-gray-600">
                  {t('profile', 'role') + ': '}
                  <span className="font-medium">
                    {profile.role === 'superadmin'
                      ? t('profile', 'roleSuperAdmin')
                      : profile.role === 'estimator'
                      ? t('profile', 'roleEstimator')
                      : t('profile', 'roleViewer')}
                </span>
                </span>
              </div>
            </div>
          )}

          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('profile', 'lastName')}
                </label>
                <input
                  type="text"
                  value={profileForm.lastName}
                  onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('profile', 'firstName')}
                </label>
                <input
                  type="text"
                  value={profileForm.firstName}
                  onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('profile', 'email')}
              </label>
              <input
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {updateProfileMutation.isSuccess && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <Check className="h-4 w-4" />
                {t('profile', 'profileUpdated')}
              </div>
            )}
            {updateProfileMutation.isError && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertTriangle className="h-4 w-4" />
                {(updateProfileMutation.error as any)?.response?.data?.message || t('profile', 'updateFailed')}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={updateProfileMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {updateProfileMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t('common', 'save')}
              </button>
            </div>
          </form>
        </div>

        <ChangePasswordForm />
      </div>
    </div>
  );
}
