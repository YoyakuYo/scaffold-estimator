'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Landmark } from 'lucide-react';
import { usersApi } from '@/lib/api/users';
import { authApi } from '@/lib/api/auth';
import { useI18n } from '@/lib/i18n';

export default function ActivateBankSubscriptionPage() {
  const { t } = useI18n();
  const tierDisplay = (tier: string) =>
    tier === 'basic'
      ? t('billing', 'planTierBasic')
      : tier === 'medium'
        ? t('billing', 'planTierMedium')
        : tier === 'monthly'
          ? t('billing', 'planTierMonthly')
          : tier === 'premium'
            ? t('billing', 'planTierPremium')
            : tier;
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [done, setDone] = useState<{ plan: string } | null>(null);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: (c: string) => authApi.verifyBankActivation(c.trim()),
    onSuccess: (data) => {
      setDone({ plan: data.plan });
      setCode('');
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] });
    },
  });

  if (profileLoading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
      </div>
    );
  }

  if (profile.role === 'superadmin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-600">{t('bankActivation', 'noPending')}</p>
      </div>
    );
  }

  if (!profile.pendingBankPlan && !done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 gap-4">
        <p className="text-slate-700 text-center max-w-md">{t('bankActivation', 'noPending')}</p>
        <Link href="/dashboard" className="text-blue-600 font-medium hover:underline">
          {t('bankActivation', 'goToDashboard')}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 gap-6">
        <div className="rounded-full bg-green-100 p-4">
          <Landmark className="h-10 w-10 text-green-700" />
        </div>
        <p className="text-lg font-medium text-slate-900 text-center max-w-md">
          {t('bankActivation', 'success').replace('{plan}', tierDisplay(done.plan))}
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/billing"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            {t('bankActivation', 'goToBilling')}
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-100"
          >
            {t('bankActivation', 'goToDashboard')}
          </Link>
        </div>
      </div>
    );
  }

  const expires = profile.bankActivationCodeExpiresAt
    ? new Date(profile.bankActivationCodeExpiresAt).toLocaleString()
    : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-sm p-8">
        <div className="flex justify-center mb-4">
          <div className="rounded-full bg-amber-50 p-3">
            <Landmark className="h-8 w-8 text-amber-700" />
          </div>
        </div>
        <h1 className="text-xl font-semibold text-slate-900 text-center">{t('bankActivation', 'title')}</h1>
        <p className="mt-2 text-sm text-slate-600 text-center">{t('bankActivation', 'subtitle')}</p>
        {profile.pendingBankPlan && (
          <p className="mt-4 text-sm font-medium text-slate-800 text-center">
            {t('bankActivation', 'pendingPlan').replace('{plan}', tierDisplay(profile.pendingBankPlan))}
          </p>
        )}
        {expires && (
          <p className="mt-2 text-xs text-slate-500 text-center">
            {t('bankActivation', 'expiresHint').replace('{date}', expires)}
          </p>
        )}
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim() || verifyMutation.isPending) return;
            verifyMutation.mutate(code);
          }}
        >
          <div>
            <label htmlFor="bank-code" className="block text-sm font-medium text-slate-700 mb-1">
              {t('bankActivation', 'codeLabel')}
            </label>
            <input
              id="bank-code"
              type="text"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('bankActivation', 'codePlaceholder')}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 uppercase tracking-wider font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          {verifyMutation.isError && (
            <p className="text-sm text-red-600">{t('bankActivation', 'errorGeneric')}</p>
          )}
          <button
            type="submit"
            disabled={verifyMutation.isPending || !code.trim()}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {verifyMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('bankActivation', 'submitting')}
              </>
            ) : (
              t('bankActivation', 'submit')
            )}
          </button>
        </form>
        <button
          type="button"
          onClick={() => authApi.logout()}
          className="mt-6 w-full text-sm text-slate-500 hover:text-slate-700"
        >
          {t('bankActivation', 'logout')}
        </button>
      </div>
    </div>
  );
}
