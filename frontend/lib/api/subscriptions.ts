import apiClient from './client';

export type SubscriptionPlan =
  | 'free_trial'
  | 'starter'
  | 'professional'
  | 'enterprise'
  | 'basic'
  | 'medium'
  | 'monthly'
  | 'premium';

/** Bank wire checkout tier (matches backend BankWirePlanTier). */
export type BankWirePlanTier = 'basic' | 'medium' | 'monthly' | 'premium';

/** @deprecated Use BankWirePlanTier; kept for older type references. */
export type CheckoutPlanTier = BankWirePlanTier;

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
  /** False for invited seats on a paid company plan (no personal billing row). */
  managesBilling?: boolean;
  /** True when this session is an org seat (hide billing / pricing). */
  companySeat?: boolean;
  trialDaysRemaining: number;
  trialLengthDays: number;
  /** While trialing: drawing file uploads used vs max (Quick Shape does not count). */
  trialFileUploads?: { used: number; max: number };
   
  isStripeConfigured: boolean;
  /** True when BANK_TRANSFER_* is set on the API. */
  isBankTransferConfigured?: boolean;
  /** Paid tiers available for bank transfer checkout. */
  checkoutPlans?: BankWirePlanTier[];
  /** Present when backend BANK_TRANSFER_* is set; may be absent on older APIs. */
  bankTransfer?: BankTransferInstructions | null;
  /** Unique wire memo code after POST .../me/bank-wire-intent (also in remittanceReference). */
  bankWireReference?: string | null;
  bankWireIntentPlan?: BankWirePlanTier | null;
  /** Phase 2 follow-up: which product the open wire intent targets. */
  bankWireIntentProductCode?: 'scaffold' | 'bim' | 'construction_plan';
  /** Company-wide feature gates from paid/trial plan (from API). */
  capabilities?: PlanCapabilities;
  seatUsage?: { used: number; limit: number };
  /** Set while waiting for bank-transfer activation code entry. */
  pendingBankPlan?: 'basic' | 'medium' | 'monthly' | 'premium' | null;
  /** Phase 2 follow-up: which product the pending activation code targets. */
  pendingBankProductCode?: 'scaffold' | 'bim' | 'construction_plan';
  bankActivationCodeExpiresAt?: string | null;
}

export interface PlanCapabilities {
  maxSeats: number;
  fileUpload: boolean;
  quickShape: boolean;
  cadDraw: boolean;
  aiExtract: boolean;
  /** Medium / Premium / Enterprise (and legacy Professional); false on Basic, Starter, trial. */
  view3d?: boolean;
  /** True for bank wire plan `monthly` (per-project SKU). */
  perProjectWire?: boolean;
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
    bankWireReference?: string | null;
    bankWireIntentPlan?: BankWirePlanTier | null;
  } | null;
}

export const subscriptionsApi = {
  getMine: async (): Promise<SubscriptionInfo> => {
    const res = await apiClient.get<SubscriptionInfo>('/subscriptions/me');
    return res.data;
  },

  createBankWireIntent: async (
    plan: BankWirePlanTier,
    productCode: 'scaffold' | 'bim' | 'construction_plan' = 'scaffold',
  ): Promise<{
    bankTransfer: BankTransferInstructions;
    wireReference: string;
    planTier: BankWirePlanTier;
    productCode: 'scaffold' | 'bim' | 'construction_plan';
  }> => {
    const res = await apiClient.post<{
      bankTransfer: BankTransferInstructions;
      wireReference: string;
      planTier: BankWirePlanTier;
      productCode: 'scaffold' | 'bim' | 'construction_plan';
    }>('/subscriptions/me/bank-wire-intent', { plan, productCode });
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

  confirmBankWire: async (userId: string): Promise<{ ok: true; plan: string }> => {
    const res = await apiClient.post<{ ok: true; plan: string }>(
      `/subscriptions/admin/${userId}/confirm-bank-wire`,
      {},
    );
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
