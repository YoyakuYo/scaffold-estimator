'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api/auth';
import { usersApi } from '@/lib/api/users';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Shield, LogIn, Loader2, AlertCircle } from 'lucide-react';

export default function SuperAdminPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const hasToken = !!authApi.getToken();
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    enabled: hasToken,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (res) => {
      if (res.user?.role === 'admin' || res.user?.role === 'superadmin') {
        router.push('/superadmin/dashboard');
        return;
      }
      setError('This account is not allowed to access Super Admin.');
    },
    onError: (err: any) => {
      setError(
        err.response?.data?.message ||
          err.message ||
          'Login failed. Make sure the backend is running and the super admin user has been created in the database.',
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    loginMutation.mutate({ email, password });
  };

  useEffect(() => {
    if (profile?.role === 'admin' || profile?.role === 'superadmin') {
      router.replace('/superadmin/dashboard');
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
            <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
            <p className="mt-1 text-sm text-gray-500">管理者ログイン</p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start gap-2 text-sm">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">ログインに失敗しました</p>
                <p className="mt-1 text-red-600">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                メールアドレス
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
                パスワード
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-gray-50"
              />
            </div>
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-amber-600 text-white rounded-lg hover:bg-amber-700 focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50 font-medium transition-colors"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  ログイン中...
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  管理者ログイン
                </>
              )}
            </button>
          </form>

          <div className="mt-6 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 text-center">
              このページは管理者専用です。既存の管理者アカウントでログインできます。一般ユーザーは
              <a href="/login" className="text-blue-600 hover:underline ml-1">
                通常のログイン
              </a>
              をご利用ください。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
