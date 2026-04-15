'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api/auth';
import { axiosErrorToLoginFlowKey, type LoginFlowErrorKey } from '@/lib/api/safe-auth-flow-error';
import { useMutation } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { useI18n, type Locale } from '@/lib/i18n';

const localeLabels: Record<Locale, string> = { ja: '日本語', en: 'EN', fr: 'FR' };

export default function LoginPage() {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorKey, setErrorKey] = useState<LoginFlowErrorKey | null>(null);
  const [localeMenuOpen, setLocaleMenuOpen] = useState(false);
  const localeMenuRef = useRef<HTMLDivElement>(null);

  const loginMutation = useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      authApi.login(creds),
    onSuccess: () => {
      if (typeof window !== 'undefined') {
        const raw = new URLSearchParams(window.location.search).get('next');
        if (raw) {
          try {
            const path = decodeURIComponent(raw);
            if (path.startsWith('/') && !path.startsWith('//')) {
              router.push(path);
              return;
            }
          } catch {
            /* fall through */
          }
        }
      }
      router.push('/dashboard');
    },
    onError: (err: unknown) => {
      setErrorKey(axiosErrorToLoginFlowKey(err));
    },
  });

  const isSuperAdminError =
    errorKey === 'superAdminUseSuperPage' || errorKey === 'useNormalLoginForSuper';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorKey(null);
    loginMutation.mutate({ email, password });
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (localeMenuRef.current && !localeMenuRef.current.contains(e.target as Node)) setLocaleMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50" suppressHydrationWarning>
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md" suppressHydrationWarning>
        {/* Language Switcher */}
        <div className="flex justify-end">
          <div className="relative" ref={localeMenuRef}>
            <button
              type="button"
              onClick={() => setLocaleMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors border border-gray-200"
              title={t('common', 'language')}
            >
              <Globe className="h-4 w-4" />
              <span suppressHydrationWarning>{localeLabels[locale]}</span>
            </button>
            {localeMenuOpen && (
              <div className="absolute right-0 top-full mt-1 py-1 w-28 rounded-md bg-white border border-gray-200 shadow-lg z-50">
                {(['ja', 'en', 'fr'] as const).map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => { setLocale(loc); setLocaleMenuOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-sm font-medium ${locale === loc ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    {localeLabels[loc]}
                  </button>
                ))}
              </div>
            )}
          </div>
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
          {errorKey && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded space-y-2" suppressHydrationWarning>
              <p className="whitespace-pre-wrap break-words">{t('login', errorKey)}</p>
              {isSuperAdminError && (
                <p className="text-sm">
                  <a href="/superadmin" className="font-medium underline hover:text-red-800">
                    {t('loginExtra', 'superAdminLogin')}
                  </a>
                </p>
              )}
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
            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-blue-600 hover:text-blue-800"
                suppressHydrationWarning
              >
                {t('login', 'forgotPasswordLink')}
              </Link>
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

        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-gray-600">
            {t('loginExtra', 'noAccount')}{' '}
            <a
              href="/register"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              {t('loginExtra', 'signUp')}
            </a>
          </p>
          <p className="text-sm">
            <a
              href="/"
              className="text-gray-500 hover:text-gray-700"
            >
              {t('loginExtra', 'backToHome')}
            </a>
          </p>
        </div>

      </div>
    </div>
  );
}
