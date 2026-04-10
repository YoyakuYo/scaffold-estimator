'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/lib/api/auth';
import { useI18n, type Locale } from '@/lib/i18n';
import { Globe, Loader2, AlertTriangle, Check } from 'lucide-react';

const localeLabels: Record<Locale, string> = { ja: '日本語', en: 'EN', fr: 'FR' };

export function ResetPasswordClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const { locale, setLocale, t } = useI18n();
  const [localeMenuOpen, setLocaleMenuOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const mutation = useMutation({
    mutationFn: () => authApi.resetPasswordWithToken({ token, newPassword }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm || newPassword.length < 6) return;
    mutation.mutate();
  };

  const mismatch = confirm.length > 0 && newPassword !== confirm;

  if (!token) {
    return (
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow-md">
        <div className="flex justify-end">
          <LocaleMenu locale={locale} setLocale={setLocale} open={localeMenuOpen} setOpen={setLocaleMenuOpen} />
        </div>
        <div className="flex items-start gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-4 py-3 text-sm">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <p>{t('passwordReset', 'resetInvalid')}</p>
        </div>
        <p className="text-center text-sm">
          <Link href="/login" className="text-blue-600 hover:text-blue-800 font-medium">
            {t('passwordReset', 'goToLogin')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow-md">
      <div className="flex justify-end">
        <LocaleMenu locale={locale} setLocale={setLocale} open={localeMenuOpen} setOpen={setLocaleMenuOpen} />
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900 text-center">{t('passwordReset', 'resetTitle')}</h1>
        <p className="mt-2 text-sm text-gray-600 text-center">{t('passwordReset', 'resetSubtitle')}</p>
      </div>

      {mutation.isSuccess && (
        <div className="flex items-start gap-2 rounded-md bg-green-50 border border-green-200 text-green-800 px-4 py-3 text-sm">
          <Check className="h-5 w-5 flex-shrink-0" />
          <div>
            <p>{t('passwordReset', 'resetSuccess')}</p>
            <Link href="/login" className="mt-2 inline-block font-semibold text-green-900 underline">
              {t('passwordReset', 'goToLogin')}
            </Link>
          </div>
        </div>
      )}

      {mutation.isError && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <span>
            {(mutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
              t('passwordReset', 'resetInvalid')}
          </span>
        </div>
      )}

      {!mutation.isSuccess && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
              {t('passwordReset', 'resetNew')}
            </label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-gray-700">
              {t('passwordReset', 'resetConfirm')}
            </label>
            <input
              id="confirm"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                mismatch ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {mismatch && <p className="text-red-500 text-xs mt-1">{t('passwordReset', 'resetMismatch')}</p>}
          </div>
          <button
            type="submit"
            disabled={mutation.isPending || mismatch || newPassword.length < 6}
            className="w-full flex justify-center items-center gap-2 py-2 px-4 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('passwordReset', 'resetSaving')}
              </>
            ) : (
              t('passwordReset', 'resetSubmit')
            )}
          </button>
        </form>
      )}

      <p className="text-center text-sm">
        <Link href="/login" className="text-gray-500 hover:text-gray-700">
          {t('passwordReset', 'backToLogin')}
        </Link>
      </p>
    </div>
  );
}

function LocaleMenu({
  locale,
  setLocale,
  open,
  setOpen,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
      >
        <Globe className="h-4 w-4" />
        {localeLabels[locale]}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 py-1 w-28 rounded-md bg-white border border-gray-200 shadow-lg z-50">
          {(['ja', 'en', 'fr'] as const).map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => {
                setLocale(loc);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm font-medium ${
                locale === loc ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {localeLabels[loc]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
