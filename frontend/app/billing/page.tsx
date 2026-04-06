'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import type { Locale, TranslationKeys, TranslationSection } from '@/lib/i18n/translations';

type BillingT = <S extends TranslationSection>(section: S, key: keyof TranslationKeys[S]) => string;
import {
  subscriptionsApi,
  type SubscriptionInfo,
  type SubscriptionPlan,
  type SubscriptionStatus,
  type CheckoutPlanTier,
} from '@/lib/api/subscriptions';
import { bankTransferFromPublicEnv } from '@/lib/billing/bank-transfer-from-env';
import { subscriptionPlanForBillingCard, subscriptionStatusLabel } from '@/lib/billing/subscription-labels';
import { localizedBankField } from '@/lib/billing/bank-transfer-display';
import { effectiveSeatCap, isUnlimitedSeatCap } from '@/lib/billing/effective-seat-cap';
import { usersApi } from '@/lib/api/users';
import {
  Loader2,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  CalendarDays,
  Shield,
  Landmark,
  Check,
} from 'lucide-react';

const CHECKOUT_TIER_ORDER: CheckoutPlanTier[] = ['basic', 'medium', 'premium', 'standard'];

/** Align billing header with company capabilities when `plan`/`status` rows lag Stripe or seat sync. */
function billingDisplayPlan(sub: SubscriptionInfo): SubscriptionPlan {
  if (sub.plan !== 'free_trial' || sub.status !== 'trialing') return sub.plan;
  const c = sub.capabilities;
  if (!c) return sub.plan;
  if (c.aiExtract) return 'premium';
  if (c.cadDraw || c.view3d || c.maxSeats > 2) return 'medium';
  return sub.plan;
}

function billingDisplayStatus(sub: SubscriptionInfo): SubscriptionStatus {
  if (sub.status !== 'trialing' || sub.plan !== 'free_trial') return sub.status;
  const c = sub.capabilities;
  if (!c) return sub.status;
  if (c.maxSeats > 2 || c.cadDraw || c.aiExtract || c.view3d) return 'active';
  return sub.status;
}

function PlanTierPricingGrid({
  subscription,
  checkoutMutation,
  portalMutation,
  isActive,
  managesBilling,
  t,
}: {
  subscription: SubscriptionInfo;
  checkoutMutation: {
    mutate: (plan?: CheckoutPlanTier) => void;
    isPending: boolean;
  };
  portalMutation: { mutate: () => void; isPending: boolean };
  isActive: boolean;
  managesBilling: boolean;
  t: BillingT;
}) {
  const plans = (subscription.checkoutPlans ?? [])
    .slice()
    .sort((a, b) => CHECKOUT_TIER_ORDER.indexOf(a) - CHECKOUT_TIER_ORDER.indexOf(b));

  const bullet = (text: string) => (
    <li key={text} className="flex gap-2 text-sm text-gray-700">
      <Check className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" aria-hidden />
      <span>{text}</span>
    </li>
  );

  const cardForTier = (tier: CheckoutPlanTier) => {
    if (tier === 'standard') {
      return {
        title: t('billing', 'planTierStandard'),
        lines: [] as string[],
        bullets: [t('billing', 'planCardStandardBlurb')],
      };
    }
    if (tier === 'basic') {
      return {
        title: t('billing', 'planCardBasicTitle'),
        lines: [
          t('billing', 'planCardBasicLicense'),
          t('billing', 'planCardBasicYearly'),
          t('billing', 'planCardBasicSeats'),
        ],
        bullets: [t('billing', 'planCardBasicF1'), t('billing', 'planCardBasicF2')],
      };
    }
    if (tier === 'medium') {
      return {
        title: t('billing', 'planCardMediumTitle'),
        lines: [
          t('billing', 'planCardMediumLicense'),
          t('billing', 'planCardMediumYearly'),
          t('billing', 'planCardMediumSeats'),
        ],
        bullets: [t('billing', 'planCardMediumF1'), t('billing', 'planCardMediumF2')],
      };
    }
    return {
      title: t('billing', 'planCardPremiumTitle'),
      lines: [
        t('billing', 'planCardPremiumLicense'),
        t('billing', 'planCardPremiumYearly'),
        t('billing', 'planCardPremiumSeats'),
      ],
      bullets: [t('billing', 'planCardPremiumF1'), t('billing', 'planCardPremiumF2')],
    };
  };

  const canSelfServeStripe = managesBilling;

  return (
    <>
      {!canSelfServeStripe && subscription.hasAccess && (
        <p className="text-sm text-blue-900 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-4">
          {t('billing', 'companySeatBillingNote')}
        </p>
      )}
      {plans.length > 1 && canSelfServeStripe && (
        <p className="text-sm text-gray-600 mb-4">{t('billing', 'choosePlanStripe')}</p>
      )}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {plans.length === 0 ? (
          <div className="rounded-2xl border-2 border-blue-100 bg-gradient-to-b from-blue-50 to-white p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-4">{t('billing', 'stripeSectionTitle')}</h3>
            <button
              type="button"
              onClick={() => checkoutMutation.mutate()}
              disabled={
                checkoutMutation.isPending || !subscription.isStripeConfigured || !canSelfServeStripe
              }
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {checkoutMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              {t('billing', 'startPaidPlan')}
            </button>
          </div>
        ) : (
          plans.map((tier) => {
            const c = cardForTier(tier);
            return (
              <div
                key={tier}
                className="flex flex-col rounded-2xl border-2 border-blue-200 bg-gradient-to-b from-blue-50/90 to-white p-6 shadow-md"
              >
                <h3 className="text-xl font-bold text-blue-950 mb-3">{c.title}</h3>
                <div className="space-y-2 mb-4">
                  {c.lines.map((line) => (
                    <p key={line} className="text-sm font-medium text-gray-800">
                      {line}
                    </p>
                  ))}
                </div>
                <ul className="space-y-2 mb-6 flex-1">{c.bullets.map((b) => bullet(b))}</ul>
                <button
                  type="button"
                  onClick={() => checkoutMutation.mutate(tier)}
                  disabled={
                    checkoutMutation.isPending || !subscription.isStripeConfigured || !canSelfServeStripe
                  }
                  className="mt-auto w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {checkoutMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  {plans.length === 1 ? t('billing', 'startPaidPlan') : t('billing', 'planCardSubscribe')}
                </button>
              </div>
            );
          })
        )}
      </div>
      {isActive && canSelfServeStripe && (
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
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
        </div>
      )}
    </>
  );
}

function BankDd({
  ja,
  en,
  fr,
  locale,
  className,
}: {
  ja: string;
  en?: string;
  fr?: string;
  locale: Locale;
  className?: string;
}) {
  const { main, sub } = localizedBankField(locale, ja, en, fr);
  return (
    <dd className={className ?? 'text-gray-900'}>
      <span className="font-medium">{main}</span>
      {sub && <span className="block text-gray-500 text-xs font-normal mt-0.5">{sub}</span>}
    </dd>
  );
}

export default function BillingPage() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isLocalhost, setIsLocalhost] = useState(false);

  useEffect(() => {
    setIsLocalhost(
      typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'),
    );
  }, []);

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

  useEffect(() => {
    if (!profile || profile.role === 'superadmin') return;
    if (profile.isCompanySeat === true) {
      router.replace('/profile');
      return;
    }
    if (isLoading || !subscription) return;
    if (subscription.managesBilling === false) {
      router.replace('/profile');
    }
  }, [profile, subscription, isLoading, router]);

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

  const restartFreshTrialMutation = useMutation({
    mutationFn: () => subscriptionsApi.restartFreshTrialSelf(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] });
    },
  });

  const [payTab, setPayTab] = useState<'stripe' | 'bank'>('stripe');
  const payTabDefaultedRef = useRef(false);
  useEffect(() => {
    if (!profile || profile.role === 'superadmin') return;
    if (!subscription || payTabDefaultedRef.current) return;
    const bt =
      subscription.bankTransfer ?? bankTransferFromPublicEnv(profile.email ?? '');
    if (!subscription.isStripeConfigured && bt) setPayTab('bank');
    payTabDefaultedRef.current = true;
  }, [profile, subscription]);

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

  const managesBilling = subscription.managesBilling !== false;
  const displayPlan = billingDisplayPlan(subscription);
  const displayStatus = billingDisplayStatus(subscription);
  const isTrial = displayStatus === 'trialing' && displayPlan === 'free_trial';
  const isActive = displayStatus === 'active' || displayPlan === 'enterprise';

  const bankTransfer =
    subscription.bankTransfer ?? bankTransferFromPublicEnv(profile.email ?? '');
  const hasAnyPaymentPath = subscription.isStripeConfigured || !!bankTransfer;

  const tabBtnClass = (active: boolean) =>
    `flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-medium border border-b-0 transition-colors ${
      active
        ? 'bg-white text-blue-700 border-gray-200 relative z-10 mb-[-1px] pb-[11px]'
        : 'bg-transparent text-gray-600 border-transparent hover:text-gray-900 hover:bg-gray-100/80'
    }`;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">{t('billing', 'title')}</h1>
          <p className="text-gray-500 mt-1">
            {t('billing', 'subtitle')}
          </p>
        </div>

        {subscription.pendingBankPlan && (
          <div className="mb-6 p-4 rounded-xl border border-amber-300 bg-amber-50 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-amber-900">{t('bankActivation', 'billingBanner')}</p>
            <Link
              href="/activate-bank-subscription"
              className="text-sm font-semibold text-amber-900 underline hover:no-underline"
            >
              {t('bankActivation', 'billingBannerLink')}
            </Link>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm text-gray-500">{t('billing', 'currentStatus')}</p>
              <p className="text-xl font-semibold text-gray-900">
                {subscriptionStatusLabel(displayStatus, t)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('billing', 'currentPlan')}</p>
              <p className="text-xl font-semibold text-gray-900">
                {subscriptionPlanForBillingCard(displayPlan, displayStatus, t)}
              </p>
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

          {!subscription.hasAccess &&
            (subscription.status === 'expired' ||
              subscription.status === 'canceled' ||
              subscription.status === 'past_due') && (
              <div className="mt-5 p-4 rounded-lg border border-red-200 bg-red-50 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
                <p className="text-sm text-red-900">{t('billing', 'accessEndedHint')}</p>
              </div>
            )}

          {isLocalhost && !subscription.hasAccess && (
            <div className="mt-5 p-4 rounded-lg border border-amber-300 bg-amber-50">
              <p className="text-sm font-semibold text-amber-900">{t('billing', 'devRestartTrialTitle')}</p>
              <p className="text-xs text-amber-900/90 mt-2 leading-relaxed">{t('billing', 'devRestartTrialHint')}</p>
              <button
                type="button"
                disabled={restartFreshTrialMutation.isPending}
                onClick={() => restartFreshTrialMutation.mutate()}
                className="mt-3 px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {restartFreshTrialMutation.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('billing', 'devRestartTrialLoading')}
                  </span>
                ) : (
                  t('billing', 'devRestartTrialButton')
                )}
              </button>
              {restartFreshTrialMutation.isSuccess && (
                <p className="text-xs text-green-700 mt-2">{t('billing', 'devRestartTrialSuccess')}</p>
              )}
              {restartFreshTrialMutation.isError && (
                <p className="text-xs text-red-700 mt-2">{t('billing', 'devRestartTrialFailed')}</p>
              )}
            </div>
          )}

          {isTrial && subscription.hasAccess && (
            <div className="mt-5 p-4 rounded-lg border border-amber-200 bg-amber-50 flex items-start gap-3">
              <CalendarDays className="h-5 w-5 text-amber-700 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">
                  {t('billing', 'freeTrialInProgress')}
                </p>
                <p className="text-amber-800 text-sm">
                  {subscription.trialDaysRemaining < 1
                    ? t('billing', 'trialFinalDay').replace('{total}', String(subscription.trialLengthDays))
                    : t('billing', 'trialRemaining')
                        .replace('{remaining}', String(subscription.trialDaysRemaining))
                        .replace('{total}', String(subscription.trialLengthDays))}
                </p>
                {subscription.trialFileUploads && (
                  <p className="text-amber-900 text-sm mt-2">
                    {t('billing', 'trialFileUploadsRemaining')
                      .replace('{used}', String(subscription.trialFileUploads.used))
                      .replace('{max}', String(subscription.trialFileUploads.max))}
                  </p>
                )}
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

          {subscription.seatUsage && effectiveSeatCap(subscription) > 0 && (
              <p className="text-sm text-gray-600 mt-3">
                {t('billing', 'seatUsage')
                  .replace('{used}', String(subscription.seatUsage.used))
                  .replace(
                    '{limit}',
                    isUnlimitedSeatCap(effectiveSeatCap(subscription))
                      ? t('profile', 'seatUnlimited')
                      : String(effectiveSeatCap(subscription)),
                  )}
              </p>
            )}
        </div>

        {bankTransfer ? (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-4 pt-4 pb-0">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                {t('billing', 'payWithTitle')}
              </h2>
              <div
                className="flex flex-wrap gap-1"
                role="tablist"
                aria-label={t('billing', 'payWithTitle')}
              >
                <button
                  type="button"
                  role="tab"
                  id="billing-tab-stripe"
                  aria-controls="billing-panel-stripe"
                  aria-selected={payTab === 'stripe'}
                  className={tabBtnClass(payTab === 'stripe')}
                  onClick={() => setPayTab('stripe')}
                >
                  <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
                  {t('billing', 'tabStripe')}
                </button>
                <button
                  type="button"
                  role="tab"
                  id="billing-tab-bank"
                  aria-controls="billing-panel-bank"
                  aria-selected={payTab === 'bank'}
                  className={tabBtnClass(payTab === 'bank')}
                  onClick={() => setPayTab('bank')}
                >
                  <Landmark className="h-4 w-4 shrink-0" aria-hidden />
                  {t('billing', 'tabBankTransfer')}
                </button>
              </div>
            </div>

            {payTab === 'stripe' ? (
              <div
                id="billing-panel-stripe"
                role="tabpanel"
                aria-labelledby="billing-tab-stripe"
                className="p-6"
              >
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {t('billing', 'stripeSectionTitle')}
                </h3>
                <p className="text-sm text-gray-500 mb-4">{t('billing', 'manageSubscription')}</p>
                <PlanTierPricingGrid
                  subscription={subscription}
                  checkoutMutation={checkoutMutation}
                  portalMutation={portalMutation}
                  isActive={isActive}
                  managesBilling={managesBilling}
                  t={t}
                />
                {!subscription.isStripeConfigured && (
                  <p className="text-sm text-amber-700 mt-4 p-3 rounded-lg bg-amber-50 border border-amber-100">
                    {t('billing', 'stripeNotConfigured')}
                  </p>
                )}
                {!hasAnyPaymentPath && (
                  <p className="text-sm text-gray-600 mt-4 border-t border-gray-100 pt-4">
                    {t('billing', 'noPaymentConfigured')}
                  </p>
                )}
              </div>
            ) : (
              <div
                id="billing-panel-bank"
                role="tabpanel"
                aria-labelledby="billing-tab-bank"
                className="p-6"
              >
                <div className="flex items-start gap-3 mb-5">
                  <Landmark className="h-6 w-6 text-blue-700 shrink-0 mt-0.5" aria-hidden />
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {t('billing', 'bankTransferTitle')}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">{t('billing', 'bankTransferIntro')}</p>
                  </div>
                </div>
                <dl className="grid gap-4 sm:grid-cols-2 text-sm border-t border-gray-100 pt-5">
                  <div>
                    <dt className="text-gray-500">{t('billing', 'bankName')}</dt>
                    <BankDd
                      ja={bankTransfer.bankName}
                      en={bankTransfer.bankNameEn}
                      fr={bankTransfer.bankNameFr}
                      locale={locale}
                    />
                  </div>
                  <div>
                    <dt className="text-gray-500">{t('billing', 'bankBranch')}</dt>
                    <BankDd
                      ja={bankTransfer.branch}
                      en={bankTransfer.branchEn}
                      fr={bankTransfer.branchFr}
                      locale={locale}
                    />
                  </div>
                  <div>
                    <dt className="text-gray-500">{t('billing', 'bankAccountType')}</dt>
                    <BankDd
                      ja={bankTransfer.accountType}
                      en={bankTransfer.accountTypeEn}
                      fr={bankTransfer.accountTypeFr}
                      locale={locale}
                    />
                  </div>
                  <div>
                    <dt className="text-gray-500">{t('billing', 'bankAccountNumber')}</dt>
                    <dd className="font-medium text-gray-900 tabular-nums">
                      {bankTransfer.accountNumber}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500">{t('billing', 'bankAccountHolder')}</dt>
                    <BankDd
                      ja={bankTransfer.accountHolder}
                      en={bankTransfer.accountHolderEn}
                      fr={bankTransfer.accountHolderFr}
                      locale={locale}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500">{t('billing', 'bankRemittanceReference')}</dt>
                    <dd className="font-medium text-gray-900 break-all">{bankTransfer.remittanceReference}</dd>
                  </div>
                  {(bankTransfer.amountNote ||
                    bankTransfer.amountNoteEn ||
                    bankTransfer.amountNoteFr) && (
                    <div className="sm:col-span-2">
                      <dt className="text-gray-500">{t('billing', 'bankAmountNote')}</dt>
                      <BankDd
                        ja={bankTransfer.amountNote || ''}
                        en={bankTransfer.amountNoteEn}
                        fr={bankTransfer.amountNoteFr}
                        locale={locale}
                      />
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {t('billing', 'stripeSectionTitle')}
            </h2>
            <p className="text-sm text-gray-500 mb-4">{t('billing', 'manageSubscription')}</p>
            <PlanTierPricingGrid
              subscription={subscription}
              checkoutMutation={checkoutMutation}
              portalMutation={portalMutation}
              isActive={isActive}
              managesBilling={managesBilling}
              t={t}
            />
            {!subscription.isStripeConfigured && (
              <p className="text-sm text-amber-700 mt-4 p-3 rounded-lg bg-amber-50 border border-amber-100">
                {t('billing', 'stripeNotConfigured')}
              </p>
            )}
            {!hasAnyPaymentPath && (
              <p className="text-sm text-gray-600 mt-4 border-t border-gray-100 pt-4">
                {t('billing', 'noPaymentConfigured')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
