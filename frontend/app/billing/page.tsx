'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { subscriptionsApi } from '@/lib/api/subscriptions';
import { usersApi } from '@/lib/api/users';
import { Loader2, CreditCard, AlertTriangle, CheckCircle, CalendarDays, Shield } from 'lucide-react';

export default function BillingPage() {
  const { locale } = useI18n();
  const t = (en: string, ja: string) => (locale === 'ja' ? ja : en);

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
              {t('Platform owner', 'プラットフォーム管理者')}
            </h1>
            <p className="text-amber-800">
              {t(
                'You are not required to subscribe. Your role is to manage the platform and verify user subscriptions.',
                'ご自身のアカウントでサブスクリプションは不要です。ユーザーの契約・支払いを管理する役割です。',
              )}
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
          <h1 className="text-xl font-bold text-gray-900">{t('Billing unavailable', '請求情報を取得できません')}</h1>
        </div>
      </div>
    );
  }

  const isTrial = subscription.status === 'trialing';
  const isActive = subscription.status === 'active' || subscription.plan === 'enterprise';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">{t('Billing', '請求')}</h1>
          <p className="text-gray-500 mt-1">
            {t('Manage your subscription and trial access', 'サブスクリプションとトライアルの管理')}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm text-gray-500">{t('Current status', '現在のステータス')}</p>
              <p className="text-xl font-semibold text-gray-900">{subscription.status}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('Current plan', 'プラン')}</p>
              <p className="text-xl font-semibold text-gray-900">{subscription.plan}</p>
            </div>
            <div className="flex items-center gap-2">
              {subscription.hasAccess ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="text-green-700 font-medium">{t('Access enabled', '利用可能')}</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                  <span className="text-red-700 font-medium">{t('Access disabled', '利用停止')}</span>
                </>
              )}
            </div>
          </div>

          {isTrial && (
            <div className="mt-5 p-4 rounded-lg border border-amber-200 bg-amber-50 flex items-start gap-3">
              <CalendarDays className="h-5 w-5 text-amber-700 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">
                  {t('Free trial in progress', '無料トライアル中')}
                </p>
                <p className="text-amber-800 text-sm">
                  {t(
                    `${subscription.trialDaysRemaining} day(s) remaining out of ${subscription.trialLengthDays} days.`,
                    `${subscription.trialLengthDays}日中、残り${subscription.trialDaysRemaining}日です。`,
                  )}
                </p>
              </div>
            </div>
          )}

          {subscription.currentPeriodEnd && (
            <p className="text-sm text-gray-600 mt-4">
              {t('Current period ends on:', '現在の期間終了日:')}{' '}
              {new Date(subscription.currentPeriodEnd).toLocaleDateString(
                locale === 'ja' ? 'ja-JP' : 'en-US',
              )}
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('Manage subscription', 'サブスクリプション管理')}
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
              {t('Start Paid Plan', '有料プランを開始')}
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
                {t('Open Billing Portal', '請求ポータルを開く')}
              </button>
            )}
          </div>
          {!subscription.isStripeConfigured && (
            <p className="text-sm text-amber-700 mt-3">
              {t(
                'Stripe is not configured yet. Ask the platform admin to set Stripe environment variables.',
                'Stripeが未設定です。管理者に環境変数の設定を依頼してください。',
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
