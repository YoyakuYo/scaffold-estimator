'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, UserProfile } from '@/lib/api/users';
import { useI18n } from '@/lib/i18n';
import {
  User,
  Mail,
  Shield,
  Lock,
  Save,
  Loader2,
  Check,
  AlertTriangle,
} from 'lucide-react';

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

  // Password form state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });

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

  const changePasswordMutation = useMutation({
    mutationFn: usersApi.changePassword,
  });

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate(profileForm);
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      return;
    }
    changePasswordMutation.mutate({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
  };

  const passwordsMatch = passwordForm.newPassword === passwordForm.confirmPassword;

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

        {/* Change Password Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Lock className="h-5 w-5 text-gray-400" />
            {t('profile', 'changePassword')}
          </h2>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('profile', 'currentPassword')}
              </label>
              <input
                type="password"
                required
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('profile', 'newPassword')}
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('profile', 'confirmPassword')}
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                className={`w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 ${
                  passwordForm.confirmPassword && !passwordsMatch
                    ? 'border-red-300'
                    : 'border-gray-300'
                }`}
              />
              {passwordForm.confirmPassword && !passwordsMatch && (
                <p className="text-red-500 text-xs mt-1">
                  {t('profile', 'passwordMismatch')}
                </p>
              )}
            </div>

            {changePasswordMutation.isSuccess && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <Check className="h-4 w-4" />
                {t('profile', 'passwordChanged')}
              </div>
            )}
            {changePasswordMutation.isError && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertTriangle className="h-4 w-4" />
                {(changePasswordMutation.error as any)?.response?.data?.message || t('profile', 'passwordChangeFailed')}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={changePasswordMutation.isPending || !passwordsMatch || !passwordForm.newPassword}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {changePasswordMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                {t('profile', 'changePassword')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
