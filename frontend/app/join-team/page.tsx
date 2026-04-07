'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { teamInvitesApi } from '@/lib/api/team-invites';
import Cookies from 'js-cookie';
import { clearAccessTokenCookie } from '@/lib/api/access-token-cookie';
import { useI18n } from '@/lib/i18n';
import { Loader2, Building2, Mail } from 'lucide-react';

function JoinTeamContent() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() || '';
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => setClientReady(true), []);
  const hasSession = clientReady && !!Cookies.get('access_token');

  const previewQuery = useQuery({
    queryKey: ['team-invite-preview', token],
    queryFn: () => teamInvitesApi.preview(token),
    enabled: token.length >= 32,
    retry: false,
  });

  const acceptSessionMutation = useMutation({
    mutationFn: () => teamInvitesApi.acceptSession(token),
    onSuccess: () => {
      router.replace('/dashboard');
    },
  });

  const acceptSignupMutation = useMutation({
    mutationFn: () =>
      teamInvitesApi.acceptSignup({
        token,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      }),
    onSuccess: () => {
      router.replace('/dashboard');
    },
  });

  if (!token || token.length < 32) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-slate-600">{t('teamInvite', 'missingToken')}</p>
      </div>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  if (previewQuery.isError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md bg-white rounded-xl shadow border border-slate-200 p-8 text-center">
          <p className="text-red-600">{t('teamInvite', 'invalidOrExpired')}</p>
        </div>
      </div>
    );
  }

  const p = previewQuery.data!;

  if (hasSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-slate-200 p-8 space-y-6">
          <div className="text-center space-y-2">
            <Building2 className="h-10 w-10 text-blue-600 mx-auto" />
            <h1 className="text-xl font-bold text-slate-900">{t('teamInvite', 'titleLoggedIn')}</h1>
            <p className="text-slate-600">
              <span className="font-semibold">{p.companyName}</span>
              {p.branchName ? ` · ${p.branchName}` : ''}
            </p>
          </div>
          {acceptSessionMutation.isError && (
            <p className="text-sm text-red-600 text-center">
              {(acceptSessionMutation.error as any)?.response?.data?.message || t('teamInvite', 'acceptFailed')}
            </p>
          )}
          <button
            type="button"
            disabled={acceptSessionMutation.isPending}
            onClick={() => acceptSessionMutation.mutate()}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {acceptSessionMutation.isPending ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('teamInvite', 'joining')}
              </span>
            ) : (
              t('teamInvite', 'confirmJoin')
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              clearAccessTokenCookie();
              const next = encodeURIComponent(`/join-team?token=${token}`);
              router.push(`/login?next=${next}`);
            }}
            className="w-full py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            {t('teamInvite', 'useOtherAccount')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-slate-200 p-8 space-y-6">
        <div className="text-center space-y-2">
          <Building2 className="h-10 w-10 text-blue-600 mx-auto" />
          <h1 className="text-xl font-bold text-slate-900">{t('teamInvite', 'title')}</h1>
          <p className="text-slate-600">
            <span className="font-semibold">{p.companyName}</span>
            {p.branchName ? ` · ${p.branchName}` : ''}
          </p>
          <p className="text-sm text-slate-500 flex items-center justify-center gap-1">
            <Mail className="h-4 w-4" />
            {p.emailMasked}
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            acceptSignupMutation.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('teamInvite', 'lastName')}</label>
              <input
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('teamInvite', 'firstName')}</label>
              <input
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('teamInvite', 'password')}</label>
            <input
              type="password"
              required
              minLength={8}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {acceptSignupMutation.isError && (
            <p className="text-sm text-red-600">
              {(acceptSignupMutation.error as any)?.response?.data?.message || t('teamInvite', 'acceptFailed')}
            </p>
          )}
          <button
            type="submit"
            disabled={acceptSignupMutation.isPending}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {acceptSignupMutation.isPending ? t('teamInvite', 'submitting') : t('teamInvite', 'createAccount')}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500">
          {t('teamInvite', 'alreadyHaveAccount')}{' '}
          <button
            type="button"
            className="text-blue-600 hover:underline"
            onClick={() => {
              const next = encodeURIComponent(`/join-team?token=${token}`);
              router.push(`/login?next=${next}`);
            }}
          >
            {t('teamInvite', 'loginLink')}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function JoinTeamPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
        </div>
      }
    >
      <JoinTeamContent />
    </Suspense>
  );
}
