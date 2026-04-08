'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/lib/api/auth';
import { getApiBaseUrl } from '@/lib/api/client';
import { useI18n, type Locale } from '@/lib/i18n';
import { Globe, Loader2, AlertTriangle } from 'lucide-react';

const localeLabels: Record<Locale, string> = { ja: '日本語', en: 'EN', fr: 'FR' };

export default function ForgotPasswordPage() {
  const { locale, setLocale, t } = useI18n();
  const [email, setEmail] = useState('');
  const [localeMenuOpen, setLocaleMenuOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => authApi.forgotPassword(email.trim()),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow-md">
        <div className="flex justify-end">
          <div className="relative">
            <button
              type="button"
              onClick={() => setLocaleMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
            >
              <Globe className="h-4 w-4" />
              {localeLabels[locale]}
            </button>
            {localeMenuOpen && (
              <div className="absolute right-0 top-full mt-1 py-1 w-28 rounded-md bg-white border border-gray-200 shadow-lg z-50">
                {(['ja', 'en', 'fr'] as const).map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => {
                      setLocale(loc);
                      setLocaleMenuOpen(false);
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
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900 text-center">{t('passwordReset', 'forgotTitle')}</h1>
          <p className="mt-2 text-sm text-gray-600 text-center">{t('passwordReset', 'forgotSubtitle')}</p>
        </div>

        {mutation.isSuccess && (
          <div className="rounded-md bg-green-50 border border-green-200 text-green-800 px-4 py-3 text-sm">
            {t('passwordReset', 'forgotSent')}
          </div>
        )}

        {mutation.isError && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-2">
              {(() => {
                const err = mutation.error as {
                  response?: { data?: { message?: string | string[] } };
                  message?: string;
                  code?: string;
                };
                if (!err?.response) {
                  const extra =
                    err?.code === 'ECONNABORTED'
                      ? ' (timeout)'
                      : err?.message === 'Network Error'
                        ? ' (network/CORS/blocked)'
                        : '';
                  return (
                    <>
                      <p>
                        {t('passwordReset', 'forgotNetworkError')}
                        {extra}
                      </p>
                      <p className="text-xs text-red-600/90">{t('passwordReset', 'forgotNetworkErrorBuildHint')}</p>
                      <p className="text-xs font-mono break-all bg-red-100/60 rounded px-2 py-1.5 text-red-900">
                        {getApiBaseUrl()}
                        <span className="block mt-1 font-sans text-red-700">
                          → POST {getApiBaseUrl().replace(/\/$/, '')}/auth/forgot-password
                        </span>
                      </p>
                    </>
                  );
                }
                const m = err.response.data?.message;
                if (Array.isArray(m)) return <p>{m.filter(Boolean).join(' ')}</p>;
                if (typeof m === 'string' && m.trim()) return <p>{m}</p>;
                return <p>{t('passwordReset', 'forgotError')}</p>;
              })()}
            </div>
          </div>
        )}

        {!mutation.isSuccess && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                {t('login', 'email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full flex justify-center items-center gap-2 py-2 px-4 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('passwordReset', 'forgotSending')}
                </>
              ) : (
                t('passwordReset', 'forgotSubmit')
              )}
            </button>
          </form>
        )}

        <p className="text-center text-sm">
          <Link href="/login" className="text-blue-600 hover:text-blue-800 font-medium">
            {t('passwordReset', 'backToLogin')}
          </Link>
        </p>
      </div>
    </div>
  );
}
