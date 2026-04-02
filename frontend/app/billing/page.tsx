'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { subscriptionsApi } from '@/lib/api/subscriptions';
import { bankTransferFromPublicEnv } from '@/lib/billing/bank-transfer-from-env';
import { usersApi } from '@/lib/api/users';
import { Loader2, CreditCard, AlertTriangle, CheckCircle, CalendarDays, Shield, Landmark } from 'lucide-react';

export default function BillingPage() {
  const { locale, t } = useI18n();

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });

  const { data: subscription, isLoading, isError } = useQuery({
    queryKey: ['my-subscription'],
    queryFn: subscriptionsApi.getMine,
    refetchInterval: 30000,
    enabled: profile?.role !== 'superadmin',
  });

  const checkoutMutation = useMutation({
    mutationFn: subscriptionsApi.createCheckoutSession,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  const portalMutation = useMutation({
    mutationFn: subscriptionsApi.createPortalSession,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (profile.role === 'superadmin') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
            <Shield className="h-14 w-14 text-amber-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-amber-900 mb-2">
              {t('billing', 'platformOwner')}
            </h1>
            <p className="text-amber-800">
              {t('billing', 'platformOwnerDesc')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (isError || !subscription) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-3xl mx-auto bg-white rounded-xl border border-gray-200 p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900">{t('billing', 'unavailable')}</h1>
        </div>
      </div>
    );
  }

  const isTrial = subscription.status === 'trialing';
  const isActive = subscription.status === 'active' || subscription.plan === 'enterprise';

  const bankTransfer =
    subscription.bankTransfer ?? bankTransferFromPublicEnv(profile.email ?? '');
  const hasAnyPaymentPath = subscription.isStripeConfigured || !!bankTransfer;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">{t('billing', 'title')}</h1>
          <p className="text-gray-500 mt-1">
            {t('billing', 'subtitle')}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm text-gray-500">{t('billing', 'currentStatus')}</p>
              <p className="text-xl font-semibold text-gray-900">{subscription.status}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('billing', 'currentPlan')}</p>
              <p className="text-xl font-semibold text-gray-900">{subscription.plan}</p>
            </div>
            <div className="flex items-center gap-2">
              {subscription.hasAccess ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="text-green-700 font-medium">{t('billing', 'accessEnabled')}</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                  <span className="text-red-700 font-medium">{t('billing', 'accessDisabled')}</span>
                </>
              )}
            </div>
          </div>

          {isTrial && (
            <div className="mt-5 p-4 rounded-lg border border-amber-200 bg-amber-50 flex items-start gap-3">
              <CalendarDays className="h-5 w-5 text-amber-700 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">
                  {t('billing', 'freeTrialInProgress')}
                </p>
                <p className="text-amber-800 text-sm">
                  {t('billing', 'trialRemaining')
                    .replace('{remaining}', String(subscription.trialDaysRemaining))
                    .replace('{total}', String(subscription.trialLengthDays))}
                </p>
              </div>
            </div>
          )}

          {subscription.currentPeriodEnd && (
            <p className="text-sm text-gray-600 mt-4">
              {t('billing', 'currentPeriodEndsOn')}{' '}
              {new Date(subscription.currentPeriodEnd).toLocaleDateString(
                locale === 'ja' ? 'ja-JP' : locale === 'fr' ? 'fr-FR' : 'en-US',
              )}
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('billing', 'manageSubscription')}
          </h2>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending || !subscription.isStripeConfigured}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {checkoutMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              {t('billing', 'startPaidPlan')}
            </button>
            {isActive && (
              <button
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending || !subscription.isStripeConfigured}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {portalMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                {t('billing', 'openBillingPortal')}
              </button>
            )}
          </div>
          {!subscription.isStripeConfigured && (
            <p className="text-sm text-amber-700 mt-3">
              {t('billing', 'stripeNotConfigured')}
            </p>
          )}
          {!hasAnyPaymentPath && (
            <p className="text-sm text-gray-600 mt-3 border-t border-gray-100 pt-3">
              {t('billing', 'noPaymentConfigured')}
            </p>
          )}
        </div>

        {bankTransfer && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mt-6">
            <div className="flex items-start gap-3 mb-4">
              <Landmark className="h-6 w-6 text-gray-700 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('billing', 'bankTransferTitle')}
                </h2>
                <p className="text-sm text-gray-600 mt-1">{t('billing', 'bankTransferIntro')}</p>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-gray-500">{t('billing', 'bankName')}</dt>
                <dd className="font-medium text-gray-900">{bankTransfer.bankName}</dd>
              </div>
              <div>
                <dt className="text-gray-500">{t('billing', 'bankBranch')}</dt>
                <dd className="font-medium text-gray-900">{bankTransfer.branch}</dd>
              </div>
              <div>
                <dt className="text-gray-500">{t('billing', 'bankAccountType')}</dt>
                <dd className="font-medium text-gray-900">{bankTransfer.accountType}</dd>
              </div>
              <div>
                <dt className="text-gray-500">{t('billing', 'bankAccountNumber')}</dt>
                <dd className="font-medium text-gray-900 tabular-nums">
                  {bankTransfer.accountNumber}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-500">{t('billing', 'bankAccountHolder')}</dt>
                <dd className="font-medium text-gray-900">{bankTransfer.accountHolder}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-500">{t('billing', 'bankRemittanceReference')}</dt>
                <dd className="font-medium text-gray-900 break-all">{bankTransfer.remittanceReference}</dd>
              </div>
              {bankTransfer.amountNote && (
                <div className="sm:col-span-2">
                  <dt className="text-gray-500">{t('billing', 'bankAmountNote')}</dt>
                  <dd className="font-medium text-gray-900">{bankTransfer.amountNote}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
