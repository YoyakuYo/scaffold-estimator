'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { usersApi } from '@/lib/api/users';
import { useI18n } from '@/lib/i18n';
import { Lock, Loader2, Check, AlertTriangle } from 'lucide-react';

export function ChangePasswordForm() {
  const { t } = useI18n();
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const changePasswordMutation = useMutation({
    mutationFn: usersApi.changePassword,
    onSuccess: () => {
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
  });

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

  return (
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
            autoComplete="current-password"
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
            minLength={10}
            autoComplete="new-password"
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
            minLength={10}
            autoComplete="new-password"
            value={passwordForm.confirmPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
            className={`w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 ${
              passwordForm.confirmPassword && !passwordsMatch ? 'border-red-300' : 'border-gray-300'
            }`}
          />
          {passwordForm.confirmPassword && !passwordsMatch && (
            <p className="text-red-500 text-xs mt-1">{t('profile', 'passwordMismatch')}</p>
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
            {(changePasswordMutation.error as { response?: { data?: { message?: string } } })?.response?.data
              ?.message || t('profile', 'passwordChangeFailed')}
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
  );
}
