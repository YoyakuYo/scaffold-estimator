import apiClient from './client';

export type SubscriptionPlan =
  | 'free_trial'
  | 'starter'
  | 'professional'
  | 'enterprise'
  | 'basic'
  | 'medium'
  | 'premium';

/** Stripe checkout tier; `standard` = legacy STRIPE_PRICE_ID only. */
export type CheckoutPlanTier = 'basic' | 'medium' | 'premium' | 'standard';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

/** Shown on /billing when backend BANK_TRANSFER_* env is set (manual wire / 銀行振込). */
export interface BankTransferInstructions {
  bankName: string;
  branch: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  remittanceReference: string;
  amountNote?: string;
  /** Optional; set *_EN / *_FR (or NEXT_PUBLIC_*) for en/fr UI. */
  bankNameEn?: string;
  branchEn?: string;
  accountTypeEn?: string;
  accountHolderEn?: string;
  amountNoteEn?: string;
  bankNameFr?: string;
  branchFr?: string;
  accountTypeFr?: string;
  accountHolderFr?: string;
  amountNoteFr?: string;
}

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
  /** While trialing: drawing file uploads used vs max (Quick Shape does not count). */
  trialFileUploads?: { used: number; max: number };
  isStripeConfigured: boolean;
  /** Tiers with a configured Stripe price (from STRIPE_PRICE_ID_* or legacy STRIPE_PRICE_ID). */
  checkoutPlans?: CheckoutPlanTier[];
  /** Present when backend BANK_TRANSFER_* is set; may be absent on older APIs. */
  bankTransfer?: BankTransferInstructions | null;
  /** Company-wide feature gates from paid/trial plan (from API). */
  capabilities?: PlanCapabilities;
  seatUsage?: { used: number; limit: number };
}

export interface PlanCapabilities {
  maxSeats: number;
  fileUpload: boolean;
  quickShape: boolean;
  cadDraw: boolean;
  aiExtract: boolean;
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

  createCheckoutSession: async (plan?: CheckoutPlanTier): Promise<{ url: string }> => {
    const res = await apiClient.post<{ url: string }>('/subscriptions/checkout-session', plan ? { plan } : {});
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

  /** Local dev: backend ALLOW_DEV_TRIAL_RESTART=true. Staging/script: set TRIAL_RESTART_SECRET and pass { secret }. */
  restartFreshTrialSelf: async (opts?: { secret?: string }): Promise<unknown> => {
    const headers: Record<string, string> = {};
    if (opts?.secret) headers['x-trial-restart-secret'] = opts.secret;
    const res = await apiClient.post('/subscriptions/me/restart-fresh-trial', {}, { headers });
    return res.data;
  },

  restartFreshTrialAdmin: async (userId: string): Promise<unknown> => {
    const res = await apiClient.post(`/subscriptions/admin/${userId}/restart-fresh-trial`, {});
    return res.data;
  },
};
