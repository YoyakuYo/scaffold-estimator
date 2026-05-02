'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api/auth';
import { axiosErrorToLoginFlowKey, type LoginFlowErrorKey } from '@/lib/api/safe-auth-flow-error';
import { usersApi } from '@/lib/api/users';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Shield, LogIn, Loader2, AlertCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function SuperAdminPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorKey, setErrorKey] = useState<LoginFlowErrorKey | null>(null);
  /** Logged in successfully but JWT user is not superadmin (wrong entry point). */
  const [postLoginDenied, setPostLoginDenied] = useState(false);

  const hasToken = !!authApi.getToken();
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    enabled: hasToken,
    retry: false,
  });

  const [totpCode, setTotpCode] = useState('');

  const loginMutation = useMutation({
    mutationFn: (creds: { email: string; password: string; totpCode?: string }) =>
      authApi.login({ ...creds, superadmin: true }),
    onSuccess: (res) => {
      if (res.user?.role === 'superadmin') {
        router.push('/superadmin/console');
        return;
      }
      setErrorKey(null);
      setPostLoginDenied(true);
    },
    onError: (err: unknown) => {
      setPostLoginDenied(false);
      setErrorKey(axiosErrorToLoginFlowKey(err));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorKey(null);
    setPostLoginDenied(false);
    loginMutation.mutate({ email, password, totpCode: totpCode.trim() || undefined });
  };

  const errorBody =
    postLoginDenied ? t('superadminLogin', 'deniedAccount') : errorKey ? t('login', errorKey) : null;
  const showNormalLoginCta = postLoginDenied || errorKey === 'useNormalLoginForSuper';

  useEffect(() => {
    if (profile?.role === 'superadmin') {
      router.replace('/superadmin/console');
    }
  }, [profile, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 mb-4">
              <Shield className="h-8 w-8 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{t('superadminLogin', 'title')}</h1>
            <p className="mt-1 text-sm text-gray-500">{t('superadminLogin', 'subtitle')}</p>
          </div>

          {errorBody && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start gap-2 text-sm">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">{t('superadminLogin', 'loginFailed')}</p>
                <p className="mt-1 text-red-600">{errorBody}</p>
                {showNormalLoginCta && (
                  <p className="mt-2">
                    <a href="/login" className="font-medium underline hover:text-red-800">
                      {t('superadminLogin', 'normalLogin')}
                    </a>
                  </p>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('superadminLogin', 'email')}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('superadminLogin', 'password')}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('superadminLogin', 'authenticatorCode')} <span className="text-xs text-gray-500">(optional)</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\s/g, ''))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-gray-50"
                placeholder="000000"
              />
            </div>
            <div className="text-right">
              <Link href="/forgot-password" className="text-sm font-medium text-amber-700 hover:text-amber-900">
                {t('superadminLogin', 'forgotPasswordLink')}
              </Link>
            </div>
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-amber-600 text-white rounded-lg hover:bg-amber-700 focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50 font-medium transition-colors"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('superadminLogin', 'signingIn')}
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  {t('superadminLogin', 'loginButton')}
                </>
              )}
            </button>
          </form>

          <div className="mt-6 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 text-center">
              {t('superadminLogin', 'helperPrefix')}
              <a href="/login" className="text-blue-600 hover:underline ml-1">
                {t('superadminLogin', 'helperLink')}
              </a>
              {t('superadminLogin', 'helperSuffix')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
