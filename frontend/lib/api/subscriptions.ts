import apiClient from './client';

export type SubscriptionPlan = 'free_trial' | 'starter' | 'professional' | 'enterprise';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export interface SubscriptionInfo {
  id: string;
  userId: string;
  companyId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialStart: string | null;
  trialEnd: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  canceledAt: string | null;
  hasAccess: boolean;
  trialDaysRemaining: number;
  trialLengthDays: number;
  isStripeConfigured: boolean;
}

export interface SubscriberRow {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  trialDaysRemaining: number;
  user: {
    id: string;
    email: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
    companyId: string;
  } | null;
}

export const subscriptionsApi = {
  getMine: async (): Promise<SubscriptionInfo> => {
    const res = await apiClient.get<SubscriptionInfo>('/subscriptions/me');
    return res.data;
  },

  createCheckoutSession: async (): Promise<{ url: string }> => {
    const res = await apiClient.post<{ url: string }>('/subscriptions/checkout-session', {});
    return res.data;
  },

  createPortalSession: async (): Promise<{ url: string }> => {
    const res = await apiClient.post<{ url: string }>('/subscriptions/portal-session', {});
    return res.data;
  },

  listSubscribers: async (): Promise<SubscriberRow[]> => {
    const res = await apiClient.get<SubscriberRow[]>('/subscriptions/admin/subscribers');
    return res.data;
  },

  extendTrial: async (userId: string, days: number): Promise<any> => {
    const res = await apiClient.post(`/subscriptions/admin/${userId}/extend-trial/${days}`, {});
    return res.data;
  },

  setAccess: async (
    userId: string,
    access: 'active' | 'canceled' | 'expired',
  ): Promise<any> => {
    const res = await apiClient.post(`/subscriptions/admin/${userId}/set-access`, { access });
    return res.data;
  },
};
