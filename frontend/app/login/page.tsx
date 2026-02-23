'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api/auth';
import { useMutation } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import Cookies from 'js-cookie';
import { useI18n } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: () => {
      router.push('/dashboard');
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || t('login', 'failed'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    loginMutation.mutate({ email, password });
  };

  /** Dev mode: skip login and go straight to dashboard */
  const handleDevLogin = () => {
    Cookies.set('access_token', 'dev-mode-token', { expires: 7, path: '/' });
    router.push('/dashboard');
  };

  const toggleLocale = () => {
    setLocale(locale === 'ja' ? 'en' : 'ja');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50" suppressHydrationWarning>
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md" suppressHydrationWarning>
        {/* Language Switcher */}
        <div className="flex justify-end">
          <button
            onClick={toggleLocale}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors border border-gray-200"
            title={locale === 'ja' ? 'Switch to English' : '日本語に切り替え'}
          >
            <Globe className="h-4 w-4" />
            <span>{locale === 'ja' ? 'EN' : 'JP'}</span>
          </button>
        </div>

        <div suppressHydrationWarning>
          <h2
            className="text-center text-3xl font-bold text-gray-900"
            suppressHydrationWarning
          >
            {t('login', 'title')}
          </h2>
          <p
            className="mt-2 text-center text-sm text-gray-600"
            suppressHydrationWarning
          >
            {t('login', 'subtitle')}
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit} suppressHydrationWarning>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded" suppressHydrationWarning>
              {error}
            </div>
          )}
          <div className="space-y-4" suppressHydrationWarning>
            <div suppressHydrationWarning>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
                suppressHydrationWarning
              >
                {t('login', 'email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="admin@example.com"
                suppressHydrationWarning
              />
            </div>
            <div suppressHydrationWarning>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
                suppressHydrationWarning
              >
                {t('login', 'password')}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="••••••••"
                suppressHydrationWarning
              />
            </div>
          </div>

          <div suppressHydrationWarning>
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              suppressHydrationWarning
            >
              {loginMutation.isPending ? t('login', 'loggingIn') : t('login', 'loginButton')}
            </button>
          </div>
        </form>

        {/* Registration Link */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            {locale === 'ja' ? 'アカウントをお持ちでないですか？' : "Don't have an account?"}{' '}
            <a
              href="/register"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              {locale === 'ja' ? '新規登録' : 'Sign up'}
            </a>
          </p>
        </div>

        {/* Dev mode bypass */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={handleDevLogin}
            className="w-full flex justify-center py-2 px-4 border-2 border-dashed border-orange-300 rounded-md text-sm font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 transition-colors"
          >
            {t('login', 'devMode')}
          </button>
          <p className="mt-2 text-xs text-gray-400 text-center">
            {t('login', 'devModeHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
