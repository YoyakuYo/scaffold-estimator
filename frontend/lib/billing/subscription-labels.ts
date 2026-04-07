import type { SubscriptionPlan, SubscriptionStatus } from '@/lib/api/subscriptions';
import type { TranslationKeys, TranslationSection } from '@/lib/i18n/translations';

/** Compatible with useI18n().t */
export type BillingT = <S extends TranslationSection>(section: S, key: keyof TranslationKeys[S]) => string;

export function subscriptionPlanLabel(plan: SubscriptionPlan, t: BillingT): string {
  switch (plan) {
    case 'free_trial':
      return t('billing', 'planTierFreeTrial');
    case 'basic':
      return t('billing', 'planTierBasic');
    case 'medium':
      return t('billing', 'planTierMedium');
    case 'monthly':
      return t('billing', 'planTierMonthly');
    case 'premium':
      return t('billing', 'planTierPremium');
    case 'starter':
      return t('billing', 'planTierStarter');
    case 'professional':
      return t('billing', 'planTierProfessional');
    case 'enterprise':
      return t('billing', 'planTierEnterprise');
    default:
      return plan;
  }
}

export function subscriptionStatusLabel(status: SubscriptionStatus, t: BillingT): string {
  switch (status) {
    case 'trialing':
      return t('billing', 'statusTrialing');
    case 'active':
      return t('billing', 'statusActive');
    case 'expired':
      return t('billing', 'statusExpired');
    case 'canceled':
      return t('billing', 'statusCanceled');
    case 'past_due':
      return t('billing', 'statusPastDue');
    default:
      return status;
  }
}

/**
 * Single coherent line for dashboard/profile when DB still has plan=free_trial but status=expired|canceled.
 */
export function subscriptionCombinedSummary(
  plan: SubscriptionPlan,
  status: SubscriptionStatus,
  t: BillingT,
): string {
  if (status === 'expired' && plan === 'free_trial') {
    return t('billing', 'subscriptionLineExpiredTrial');
  }
  if (status === 'canceled' && plan === 'free_trial') {
    return t('billing', 'subscriptionLineCanceledTrial');
  }
  return `${subscriptionPlanLabel(plan, t)} · ${subscriptionStatusLabel(status, t)}`;
}

/** "Current plan" column on Billing: avoid showing "Free trial" next to expired status. */
export function subscriptionPlanForBillingCard(
  plan: SubscriptionPlan,
  status: SubscriptionStatus,
  t: BillingT,
): string {
  if ((status === 'expired' || status === 'canceled') && plan === 'free_trial') {
    return t('billing', 'planColumnAfterTrial');
  }
  return subscriptionPlanLabel(plan, t);
}
