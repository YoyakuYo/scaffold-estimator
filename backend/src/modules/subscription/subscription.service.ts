import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PlanTier, Subscription, SubscriptionStatus } from './subscription.entity';
import { User } from '../auth/user.entity';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';
import { CheckoutPlanTier, CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import {
  NO_ACCESS_CAPABILITIES,
  SUPERADMIN_CAPABILITIES,
  capabilitiesForPlan,
  capabilitiesForTrial,
  mergeCapabilitiesMax,
  type EffectivePlanCapabilities,
} from './plan-capabilities';

/** New trials: trial_end = now + TRIAL_DAYS */
export const TRIAL_DAYS = 7;
/** Max drawing file uploads via POST /drawings/upload while status = trialing */
export const TRIAL_MAX_DRAWING_UPLOADS = 2;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly stripe: Stripe | null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    const secret = this.configService.get<string>('STRIPE_SECRET_KEY')?.trim();
    const restricted = this.configService.get<string>('STRIPE_RESTRICTED_KEY')?.trim();
    const key = secret || restricted;
    if (restricted && !secret) {
      this.logger.warn(
        'Using STRIPE_RESTRICTED_KEY (no STRIPE_SECRET_KEY). Ensure Stripe key permissions include Customers, Checkout Sessions, Subscriptions, and Webhooks.',
      );
    }
    this.stripe = key ? new Stripe(key) : null;
  }

  private getFrontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
  }

  /** Public bank-transfer details for /billing (manual 銀行振込, e.g. Japan). */
  private getBankTransferInstructions(userEmail: string): {
    bankName: string;
    branch: string;
    accountType: string;
    accountNumber: string;
    accountHolder: string;
    remittanceReference: string;
    amountNote?: string;
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
  } | null {
    const flag = (this.configService.get<string>('BANK_TRANSFER_ENABLED') || '').toLowerCase();
    if (!['true', '1', 'yes'].includes(flag)) return null;
    const bankName = this.configService.get<string>('BANK_TRANSFER_BANK_NAME')?.trim();
    const branch = this.configService.get<string>('BANK_TRANSFER_BRANCH')?.trim();
    const accountType = this.configService.get<string>('BANK_TRANSFER_ACCOUNT_TYPE')?.trim();
    const accountNumber = this.configService.get<string>('BANK_TRANSFER_ACCOUNT_NUMBER')?.trim();
    const accountHolder = this.configService.get<string>('BANK_TRANSFER_ACCOUNT_HOLDER')?.trim();
    if (!bankName || !branch || !accountType || !accountNumber || !accountHolder) {
      this.logger.warn(
        'BANK_TRANSFER_ENABLED is set but one or more BANK_TRANSFER_* fields are missing; bank transfer block omitted.',
      );
      return null;
    }
    const amountNote = this.configService.get<string>('BANK_TRANSFER_AMOUNT_NOTE')?.trim();
    const bankNameEn = this.configService.get<string>('BANK_TRANSFER_BANK_NAME_EN')?.trim();
    const branchEn = this.configService.get<string>('BANK_TRANSFER_BRANCH_EN')?.trim();
    const accountTypeEn = this.configService.get<string>('BANK_TRANSFER_ACCOUNT_TYPE_EN')?.trim();
    const accountHolderEn = this.configService.get<string>('BANK_TRANSFER_ACCOUNT_HOLDER_EN')?.trim();
    const amountNoteEn = this.configService.get<string>('BANK_TRANSFER_AMOUNT_NOTE_EN')?.trim();
    const bankNameFr = this.configService.get<string>('BANK_TRANSFER_BANK_NAME_FR')?.trim();
    const branchFr = this.configService.get<string>('BANK_TRANSFER_BRANCH_FR')?.trim();
    const accountTypeFr = this.configService.get<string>('BANK_TRANSFER_ACCOUNT_TYPE_FR')?.trim();
    const accountHolderFr = this.configService.get<string>('BANK_TRANSFER_ACCOUNT_HOLDER_FR')?.trim();
    const amountNoteFr = this.configService.get<string>('BANK_TRANSFER_AMOUNT_NOTE_FR')?.trim();
    return {
      bankName,
      branch,
      accountType,
      accountNumber,
      accountHolder,
      remittanceReference: userEmail,
      ...(amountNote ? { amountNote } : {}),
      ...(bankNameEn ? { bankNameEn } : {}),
      ...(branchEn ? { branchEn } : {}),
      ...(accountTypeEn ? { accountTypeEn } : {}),
      ...(accountHolderEn ? { accountHolderEn } : {}),
      ...(amountNoteEn ? { amountNoteEn } : {}),
      ...(bankNameFr ? { bankNameFr } : {}),
      ...(branchFr ? { branchFr } : {}),
      ...(accountTypeFr ? { accountTypeFr } : {}),
      ...(accountHolderFr ? { accountHolderFr } : {}),
      ...(amountNoteFr ? { amountNoteFr } : {}),
    };
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured. Set STRIPE_SECRET_KEY or STRIPE_RESTRICTED_KEY.');
    }
    return this.stripe;
  }

  private getLegacyStripePriceId(): string | undefined {
    return this.configService.get<string>('STRIPE_PRICE_ID')?.trim() || undefined;
  }

  private getStripePriceIdForTier(tier: CheckoutPlanTier): string | undefined {
    if (tier === 'standard') return this.getLegacyStripePriceId();
    const key =
      tier === 'basic'
        ? 'STRIPE_PRICE_ID_BASIC'
        : tier === 'medium'
          ? 'STRIPE_PRICE_ID_MEDIUM'
          : 'STRIPE_PRICE_ID_PREMIUM';
    return this.configService.get<string>(key)?.trim() || undefined;
  }

  /** Optional one-time (e.g. license) charged on the first Checkout invoice alongside recurring updates. */
  private getStripeOnetimePriceIdForTier(tier: CheckoutPlanTier): string | undefined {
    if (tier === 'standard') {
      return this.configService.get<string>('STRIPE_PRICE_ID_ONETIME')?.trim() || undefined;
    }
    const key =
      tier === 'basic'
        ? 'STRIPE_PRICE_ID_BASIC_ONETIME'
        : tier === 'medium'
          ? 'STRIPE_PRICE_ID_MEDIUM_ONETIME'
          : 'STRIPE_PRICE_ID_PREMIUM_ONETIME';
    return this.configService.get<string>(key)?.trim() || undefined;
  }

  /** Tiers that have a price id configured (plus legacy `standard` if STRIPE_PRICE_ID only). */
  getAvailableCheckoutTiers(): CheckoutPlanTier[] {
    const tiers: CheckoutPlanTier[] = [];
    if (this.getStripePriceIdForTier('basic')) tiers.push('basic');
    if (this.getStripePriceIdForTier('medium')) tiers.push('medium');
    if (this.getStripePriceIdForTier('premium')) tiers.push('premium');
    if (tiers.length === 0 && this.getLegacyStripePriceId()) tiers.push('standard');
    return tiers;
  }

  private resolveCheckoutTier(dto: CreateCheckoutSessionDto): CheckoutPlanTier {
    const available = this.getAvailableCheckoutTiers();
    if (available.length === 0) {
      throw new BadRequestException(
        'No Stripe prices configured. Set STRIPE_PRICE_ID_BASIC, STRIPE_PRICE_ID_MEDIUM, STRIPE_PRICE_ID_PREMIUM, or STRIPE_PRICE_ID.',
      );
    }
    if (dto.plan) {
      if (!available.includes(dto.plan)) {
        throw new BadRequestException(
          `Plan "${dto.plan}" is not available. Configured: ${available.join(', ')}.`,
        );
      }
      return dto.plan;
    }
    if (available.length === 1) return available[0];
    throw new BadRequestException(`Select a plan: ${available.join(', ')}.`);
  }

  private planFromStripePriceId(priceId: string | null): import('./subscription.entity').PlanTier {
    if (!priceId) return 'free_trial';
    if (priceId === this.getStripePriceIdForTier('basic')) return 'basic';
    if (priceId === this.getStripePriceIdForTier('medium')) return 'medium';
    if (priceId === this.getStripePriceIdForTier('premium')) return 'premium';
    if (priceId === this.getLegacyStripePriceId()) return 'professional';
    return 'professional';
  }

  private mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
    if (status === 'active') return 'active';
    if (status === 'trialing') return 'trialing';
    if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return 'past_due';
    if (status === 'canceled' || status === 'incomplete_expired') return 'canceled';
    return 'expired';
  }

  private buildTrialEnd(fromDate: Date): Date {
    const end = new Date(fromDate);
    end.setDate(end.getDate() + TRIAL_DAYS);
    return end;
  }

  private async getUserOrFail(userId: string): Promise<User> {
    const { data: row, error } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (error || !row) throw new NotFoundException('User not found');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async ensureSubscriptionForUser(userId: string): Promise<Subscription> {
    const user = await this.getUserOrFail(userId);
    const { data: existingRow } = await this.supabase.getClient().from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
    if (existingRow) {
      return mapRowToCamel<Subscription>(existingRow as Record<string, unknown>)!;
    }

    const now = new Date();
    const ins = mapPayloadToSnake<Record<string, unknown>>({
      userId: user.id,
      companyId: user.companyId ?? null,
      plan: user.role === 'superadmin' ? 'enterprise' : 'free_trial',
      status: user.role === 'superadmin' ? 'active' : 'trialing',
      trialStart: user.role === 'superadmin' ? null : now,
      trialEnd: user.role === 'superadmin' ? null : this.buildTrialEnd(now),
      currentPeriodStart: user.role === 'superadmin' ? now : null,
      currentPeriodEnd: user.role === 'superadmin' ? null : null,
    });
    const { data: saved, error } = await this.supabase.getClient().from('subscriptions').insert(ins).select().single();
    if (error || !saved) throw new BadRequestException('Failed to create subscription.');
    return mapRowToCamel<Subscription>(saved as Record<string, unknown>)!;
  }

  private async expireTrialIfNeeded(subscription: Subscription): Promise<Subscription> {
    if (subscription.status === 'trialing' && subscription.trialEnd && new Date(subscription.trialEnd) <= new Date()) {
      await this.supabase.getClient().from('subscriptions').update(mapPayloadToSnake({ status: 'expired' })).eq('id', subscription.id);
      return { ...subscription, status: 'expired' as SubscriptionStatus };
    }
    return subscription;
  }

  /**
   * All subscription rows that belong to a company billing scope: by `company_id` on the row **or**
   * by `user_id` of anyone in the company (covers payers whose row predates company_id backfill).
   */
  async getSubscriptionsForCompany(companyId: string): Promise<Subscription[]> {
    const client = this.supabase.getClient();
    const { data: userRows } = await client.from('users').select('id').eq('company_id', companyId);
    const userIds = (userRows || []).map((r: { id: string }) => r.id);
    const byId = new Map<string, Subscription>();

    const { data: rowsCo } = await client.from('subscriptions').select('*').eq('company_id', companyId);
    for (const row of rowsCo || []) {
      const s = mapRowToCamel<Subscription>(row as Record<string, unknown>);
      if (s) byId.set(s.id, s);
    }
    if (userIds.length > 0) {
      const { data: rowsU } = await client.from('subscriptions').select('*').in('user_id', userIds);
      for (const row of rowsU || []) {
        const s = mapRowToCamel<Subscription>(row as Record<string, unknown>);
        if (s) byId.set(s.id, s);
      }
    }
    return [...byId.values()];
  }

  private planTierScore(plan: string): number {
    switch (plan) {
      case 'enterprise':
        return 5;
      case 'premium':
        return 4;
      case 'medium':
      case 'professional':
        return 3;
      case 'basic':
      case 'starter':
        return 2;
      default:
        return 0;
    }
  }

  /** Strongest paid (non–free_trial) plan among company peers — used to seat invited users without a personal trial. */
  private async bestCompanyPaidSeatSnapshot(subs: Subscription[]): Promise<{ plan: PlanTier } | null> {
    const now = new Date();
    let best: { plan: PlanTier; score: number } | null = null;
    for (const raw of subs) {
      let s = await this.expireTrialIfNeeded({ ...raw });
      if (!s.plan || s.plan === 'free_trial') continue;
      const accessOk =
        s.status === 'active' ||
        (s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd) > now);
      if (!accessOk) continue;
      const score = this.planTierScore(s.plan);
      if (score === 0) continue;
      if (!best || score > best.score) best = { plan: s.plan as PlanTier, score };
    }
    return best ? { plan: best.plan } : null;
  }

  /**
   * Team invite / company switch: one row per user — mirror the company's paid plan as a seat (no Stripe ids, no personal trial).
   * If the company has no paid (or Stripe-trial) anchor, falls back to normal free trial creation.
   */
  async syncSubscriptionRowForCompanyMember(userId: string): Promise<Subscription> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') {
      return this.ensureSubscriptionForUser(userId);
    }
    if (!user.companyId) {
      return this.ensureSubscriptionForUser(userId);
    }
    const client = this.supabase.getClient();
    const companySubs = await this.getSubscriptionsForCompany(user.companyId);
    const others = companySubs.filter((s) => s.userId !== userId);
    const snap = await this.bestCompanyPaidSeatSnapshot(others);
    const { data: existingRow } = await client.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();

    if (snap) {
      const seatPayload = {
        companyId: user.companyId,
        plan: snap.plan,
        status: 'active' as SubscriptionStatus,
        trialStart: null as Date | null,
        trialEnd: null as Date | null,
        trialDocumentsUsed: 0,
        stripeCustomerId: null as string | null,
        stripeSubscriptionId: null as string | null,
        stripePriceId: null as string | null,
        currentPeriodStart: null as Date | null,
        currentPeriodEnd: null as Date | null,
      };
      const patch = mapPayloadToSnake(seatPayload);
      if (existingRow) {
        const { error } = await client.from('subscriptions').update(patch).eq('user_id', userId);
        if (error) this.logger.warn(`syncSubscriptionRowForCompanyMember update: ${error.message}`);
      } else {
        const ins = mapPayloadToSnake({ userId, ...seatPayload });
        const { error } = await client.from('subscriptions').insert(ins);
        if (error) {
          this.logger.warn(`syncSubscriptionRowForCompanyMember insert: ${error.message}`);
          return this.ensureSubscriptionForUser(userId);
        }
      }
      const { data: out } = await client.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
      if (out) return mapRowToCamel<Subscription>(out as Record<string, unknown>)!;
      return this.ensureSubscriptionForUser(userId);
    }

    if (!existingRow) {
      return this.ensureSubscriptionForUser(userId);
    }
    await client.from('subscriptions').update(mapPayloadToSnake({ companyId: user.companyId })).eq('user_id', userId);
    const { data: refreshed } = await client.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
    if (!refreshed) return this.ensureSubscriptionForUser(userId);
    return mapRowToCamel<Subscription>(refreshed as Record<string, unknown>)!;
  }

  /** If this user still has a personal free_trial row but teammates carry a paid plan, upgrade the row in place. */
  async reconcileSeatMemberTrialShadow(userId: string): Promise<void> {
    const user = await this.getUserOrFail(userId);
    if (!user.companyId || user.role === 'superadmin' || user.subscriptionExempt) return;
    const client = this.supabase.getClient();
    const { data: row } = await client.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
    if (!row) return;
    let sub = mapRowToCamel<Subscription>(row as Record<string, unknown>)!;
    sub = await this.expireTrialIfNeeded(sub);
    if (!(sub.plan === 'free_trial' && sub.status === 'trialing')) return;
    const companySubs = await this.getSubscriptionsForCompany(user.companyId);
    const others = companySubs.filter((s) => s.userId !== userId);
    const snap = await this.bestCompanyPaidSeatSnapshot(others);
    if (!snap) return;
    await client
      .from('subscriptions')
      .update(
        mapPayloadToSnake({
          plan: snap.plan,
          status: 'active' as SubscriptionStatus,
          trialStart: null,
          trialEnd: null,
          trialDocumentsUsed: 0,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripePriceId: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
        }),
      )
      .eq('user_id', userId);
  }

  async hasActiveAccess(userId: string, role?: string): Promise<boolean> {
    if (role === 'superadmin') return true;
    const user = await this.getUserOrFail(userId);
    if (user.subscriptionExempt) return true;
    if (user.pendingBankPlan) return false;
    const companyId = user.companyId;
    const now = new Date();

    if (companyId) {
      let subs = await this.getSubscriptionsForCompany(companyId);
      if (subs.length === 0) {
        await this.ensureSubscriptionForUser(userId);
        subs = await this.getSubscriptionsForCompany(companyId);
      }
      for (const sub of subs) {
        const s = await this.expireTrialIfNeeded(sub);
        if (s.status === 'active') return true;
        if (s.status === 'trialing' && s.plan && s.plan !== 'free_trial' && s.trialEnd && new Date(s.trialEnd) > now) {
          return true;
        }
        if (s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd) > now) return true;
      }
      return false;
    }

    // No company: only this user's subscription row applies (company_id may be null on the row).
    let sub = await this.ensureSubscriptionForUser(userId);
    sub = await this.expireTrialIfNeeded(sub);
    if (sub.status === 'active') return true;
    if (sub.status === 'trialing' && sub.trialEnd && new Date(sub.trialEnd) > now) return true;
    return false;
  }

  /**
   * Company-wide entitlements: best active paid plan wins; if none, valid trial uses trial caps.
   */
  async aggregateCompanyCapabilities(subs: Subscription[]): Promise<EffectivePlanCapabilities> {
    const now = new Date();
    let paidMerge: EffectivePlanCapabilities | null = null;
    let hasValidTrial = false;
    for (const sub of subs) {
      const s = await this.expireTrialIfNeeded(sub);
      if (s.status === 'active' && s.plan && s.plan !== 'free_trial') {
        const c = capabilitiesForPlan(s.plan);
        if (c.maxSeats > 0) {
          paidMerge = paidMerge ? mergeCapabilitiesMax(paidMerge, c) : c;
        }
      }
      if (
        s.status === 'trialing' &&
        s.plan &&
        s.plan !== 'free_trial' &&
        s.trialEnd &&
        new Date(s.trialEnd) > now
      ) {
        const c = capabilitiesForPlan(s.plan);
        if (c.maxSeats > 0) {
          paidMerge = paidMerge ? mergeCapabilitiesMax(paidMerge, c) : c;
        }
      }
      if (s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd) > now) {
        if (!s.plan || s.plan === 'free_trial') hasValidTrial = true;
      }
    }
    if (paidMerge && paidMerge.maxSeats > 0) return paidMerge;
    if (hasValidTrial) return capabilitiesForTrial();
    return NO_ACCESS_CAPABILITIES;
  }

  async resolveEffectiveCapabilitiesForCompany(companyId: string): Promise<EffectivePlanCapabilities> {
    const subs = await this.getSubscriptionsForCompany(companyId);
    return this.aggregateCompanyCapabilities(subs);
  }

  async resolveEffectiveCapabilities(userId: string, role?: string): Promise<EffectivePlanCapabilities> {
    if (role === 'superadmin') return SUPERADMIN_CAPABILITIES;
    const user = await this.getUserOrFail(userId);
    if (user.subscriptionExempt) return SUPERADMIN_CAPABILITIES;
    if (user.pendingBankPlan) return NO_ACCESS_CAPABILITIES;
    const companyId = user.companyId;

    if (companyId) {
      let subs = await this.getSubscriptionsForCompany(companyId);
      if (subs.length === 0) {
        await this.ensureSubscriptionForUser(userId);
        subs = await this.getSubscriptionsForCompany(companyId);
      }
      return this.aggregateCompanyCapabilities(subs);
    }

    let sub = await this.ensureSubscriptionForUser(userId);
    sub = await this.expireTrialIfNeeded(sub);
    const now = new Date();
    if (sub.status === 'active' && sub.plan && sub.plan !== 'free_trial') {
      return capabilitiesForPlan(sub.plan);
    }
    if (sub.status === 'trialing' && sub.trialEnd && new Date(sub.trialEnd) > now) {
      return capabilitiesForTrial();
    }
    return NO_ACCESS_CAPABILITIES;
  }

  async countCompanySeats(companyId: string): Promise<number> {
    const { count, error } = await this.supabase
      .getClient()
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_active', true)
      .neq('role', 'superadmin');
    if (error) return 0;
    return count ?? 0;
  }

  /** Pending team invites reserve a seat until they expire or are revoked. */
  async countPendingTeamInvitesForCompany(companyId: string): Promise<number> {
    const now = new Date().toISOString();
    const { count, error } = await this.supabase
      .getClient()
      .from('company_invites')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .gt('expires_at', now);
    if (error) return 0;
    return count ?? 0;
  }

  /** Active users + non-expired pending invites (for seat limits). */
  async countCompanySeatPressure(companyId: string): Promise<number> {
    const [active, pending] = await Promise.all([
      this.countCompanySeats(companyId),
      this.countPendingTeamInvitesForCompany(companyId),
    ]);
    return active + pending;
  }

  /** Blocks POST /drawings/upload when trialing and upload quota exhausted. */
  async assertTrialDrawingUploadAllowed(userId: string): Promise<void> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') return;
    if (user.subscriptionExempt) return;
    const { data: row } = await this.supabase.getClient().from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
    if (!row) return;
    let sub = mapRowToCamel<Subscription>(row as Record<string, unknown>)!;
    sub = await this.expireTrialIfNeeded(sub);
    if (sub.status !== 'trialing') return;
    const used = sub.trialDocumentsUsed ?? 0;
    if (used >= TRIAL_MAX_DRAWING_UPLOADS) {
      throw new BadRequestException(
        `Free trial allows ${TRIAL_MAX_DRAWING_UPLOADS} drawing file uploads (Quick Shape is unlimited). Subscribe in Billing to upload more files.`,
      );
    }
  }

  /** Call after a drawing row is created successfully for the uploader. */
  async recordTrialDrawingUploadIfTrialing(userId: string): Promise<void> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') return;
    if (user.subscriptionExempt) return;
    const { data: row } = await this.supabase.getClient().from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
    if (!row) return;
    let sub = mapRowToCamel<Subscription>(row as Record<string, unknown>)!;
    sub = await this.expireTrialIfNeeded(sub);
    if (sub.status !== 'trialing') return;
    const used = sub.trialDocumentsUsed ?? 0;
    await this.supabase
      .getClient()
      .from('subscriptions')
      .update(mapPayloadToSnake({ trialDocumentsUsed: used + 1 }))
      .eq('id', sub.id);
  }

  async getMySubscription(userId: string): Promise<any> {
    const user = await this.getUserOrFail(userId);
    let sub = await this.ensureSubscriptionForUser(userId);
    if (user.companyId && user.role !== 'superadmin' && !user.subscriptionExempt) {
      const ownsStripe = !!(sub.stripeCustomerId || sub.stripeSubscriptionId);
      // Seat holders often have no Stripe customer; full sync aligns their row with the company plan.
      // Billing owners keep reconcile-only so we never strip their Stripe ids.
      if (!ownsStripe) {
        await this.syncSubscriptionRowForCompanyMember(userId);
      } else {
        await this.reconcileSeatMemberTrialShadow(userId);
      }
      const { data: rowAfter } = await this.supabase.getClient().from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
      if (rowAfter) sub = mapRowToCamel<Subscription>(rowAfter as Record<string, unknown>)!;
    }
    sub = await this.expireTrialIfNeeded(sub);
    const now = Date.now();
    const exempt = user.subscriptionExempt;
    const trialDaysRemaining =
      exempt || !sub.trialEnd || sub.status !== 'trialing'
        ? 0
        : Math.max(0, Math.ceil((new Date(sub.trialEnd).getTime() - now) / (1000 * 60 * 60 * 24)));
    const hasAccess = await this.hasActiveAccess(userId, user.role);
    const checkoutTiers = this.getAvailableCheckoutTiers();
    const capabilities = await this.resolveEffectiveCapabilities(userId, user.role);
    const seatUsed =
      user.companyId && user.role !== 'superadmin'
        ? await this.countCompanySeats(user.companyId)
        : 0;
    const ownsStripeAfter = !!(sub.stripeCustomerId || sub.stripeSubscriptionId);
    let peerPaidSnap: { plan: PlanTier } | null = null;
    if (user.companyId) {
      const companySubs = await this.getSubscriptionsForCompany(user.companyId);
      peerPaidSnap = await this.bestCompanyPaidSeatSnapshot(companySubs.filter((s) => s.userId !== userId));
    }
    /** False when this user inherits a paid company seat and should not use Stripe checkout/portal themselves. */
    const managesBilling =
      exempt ||
      user.role === 'superadmin' ||
      !user.companyId ||
      ownsStripeAfter ||
      !peerPaidSnap ||
      !hasAccess;

    const subPayload = exempt
      ? { ...sub, plan: 'enterprise' as const, status: 'active' as const, trialStart: null, trialEnd: null }
      : sub;
    return {
      ...subPayload,
      hasAccess,
      managesBilling,
      trialDaysRemaining,
      trialLengthDays: TRIAL_DAYS,
      trialFileUploads:
        exempt || sub.status !== 'trialing' || sub.plan !== 'free_trial'
          ? undefined
          : {
              used: sub.trialDocumentsUsed ?? 0,
              max: TRIAL_MAX_DRAWING_UPLOADS,
            },
      isStripeConfigured: !!this.stripe && checkoutTiers.length > 0,
      checkoutPlans: checkoutTiers,
      bankTransfer: this.getBankTransferInstructions(user.email),
      capabilities,
      pendingBankPlan: user.pendingBankPlan ?? null,
      bankActivationCodeExpiresAt: user.bankActivationCodeExpiresAt ?? null,
      seatUsage:
        user.role === 'superadmin' || exempt
          ? undefined
          : { used: seatUsed, limit: capabilities.maxSeats },
    };
  }

  async createCheckoutSession(userId: string, dto: CreateCheckoutSessionDto): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const user = await this.getUserOrFail(userId);
    let sub = await this.ensureSubscriptionForUser(userId);

    if (user.role === 'superadmin') {
      throw new ForbiddenException('Superadmin account does not require paid subscription checkout.');
    }
    if (user.subscriptionExempt) {
      throw new ForbiddenException('This account has full access without a paid subscription.');
    }

    let customerId = sub.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
        metadata: { userId: user.id, companyId: user.companyId || '' },
      });
      customerId = customer.id;
      await this.supabase.getClient().from('subscriptions').update(mapPayloadToSnake({ stripeCustomerId: customer.id })).eq('id', sub.id);
      sub = { ...sub, stripeCustomerId: customer.id };
    }

    const tier = this.resolveCheckoutTier(dto);
    const priceId = this.getStripePriceIdForTier(tier);
    if (!priceId) throw new BadRequestException(`No Stripe price ID configured for plan "${tier}".`);

    if (!priceId.startsWith('price_')) {
      throw new BadRequestException(
        `Invalid Stripe price ID for plan "${tier}": use a Price id (price_...), not a Product id (prod_...).`,
      );
    }

    let price: Stripe.Price;
    try {
      price = await stripe.prices.retrieve(priceId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(
        `Could not load Stripe price "${priceId}" for plan "${tier}". Check the id and that the key matches the same Stripe mode (test vs live). ${msg}`,
      );
    }
    if (price.type !== 'recurring' || !price.recurring) {
      throw new BadRequestException(
        `Stripe price "${priceId}" is not a recurring subscription price. In Stripe Dashboard → Products, edit the price and set billing to recurring (e.g. monthly), or create a new recurring price and update your STRIPE_PRICE_ID_* env var.`,
      );
    }

    const onetimePriceId = this.getStripeOnetimePriceIdForTier(tier);
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    if (onetimePriceId) {
      if (!onetimePriceId.startsWith('price_')) {
        throw new BadRequestException(
          `Invalid Stripe one-time price ID for plan "${tier}": use a Price id (price_...), not prod_....`,
        );
      }
      let oneTime: Stripe.Price;
      try {
        oneTime = await stripe.prices.retrieve(onetimePriceId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new BadRequestException(
          `Could not load Stripe one-time price "${onetimePriceId}" for plan "${tier}". ${msg}`,
        );
      }
      if (oneTime.type !== 'one_time') {
        throw new BadRequestException(
          `Stripe price "${onetimePriceId}" must be a one-time price (license/fee). Set STRIPE_PRICE_ID_*_ONETIME to a Dashboard price with type "one time".`,
        );
      }
      lineItems.push({ price: onetimePriceId, quantity: 1 });
    }
    lineItems.push({ price: priceId, quantity: 1 });

    const frontendUrl = this.getFrontendUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: lineItems,
      success_url: `${frontendUrl}/billing?checkout=success`,
      cancel_url: `${frontendUrl}/billing?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: { userId: user.id, checkoutTier: tier },
    });

    if (!session.url) throw new BadRequestException('Could not create Stripe checkout session URL.');
    return { url: session.url };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const sub = await this.ensureSubscriptionForUser(userId);
    if (!sub.stripeCustomerId) throw new BadRequestException('No Stripe customer found for this account.');
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${this.getFrontendUrl()}/billing`,
    });
    return { url: session.url };
  }

  private async upsertFromStripeSubscription(stripeSub: Stripe.Subscription): Promise<void> {
    const client = this.supabase.getClient();
    let sub: Subscription | null = null;
    if (stripeSub.id) {
      const { data } = await client.from('subscriptions').select('*').eq('stripe_subscription_id', stripeSub.id).maybeSingle();
      if (data) sub = mapRowToCamel<Subscription>(data as Record<string, unknown>);
    }
    if (!sub && typeof stripeSub.customer === 'string') {
      const { data } = await client.from('subscriptions').select('*').eq('stripe_customer_id', stripeSub.customer).maybeSingle();
      if (data) sub = mapRowToCamel<Subscription>(data as Record<string, unknown>);
    }
    if (!sub) {
      this.logger.warn(`Ignoring Stripe subscription ${stripeSub.id}: no local subscription found.`);
      return;
    }

    const priceId = stripeSub.items.data[0]?.price?.id || null;
    const periodStart = (stripeSub as any).current_period_start as number | undefined;
    const periodEnd = (stripeSub as any).current_period_end as number | undefined;
    const mappedPlan = this.planFromStripePriceId(priceId);
    const updates = mapPayloadToSnake({
      stripeSubscriptionId: stripeSub.id,
      stripePriceId: priceId,
      status: this.mapStripeStatus(stripeSub.status),
      plan: mappedPlan,
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAt: stripeSub.cancel_at ? new Date(stripeSub.cancel_at * 1000) : null,
      canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
    });
    await client.from('subscriptions').update(updates).eq('id', sub.id);
  }

  async handleWebhook(signature: string | undefined, rawBody: Buffer): Promise<{ received: true }> {
    const stripe = this.requireStripe();
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not configured.');
    if (!signature) throw new BadRequestException('Missing Stripe signature header.');
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      throw new BadRequestException(`Invalid Stripe webhook signature: ${(error as Error).message}`);
    }
    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      await this.upsertFromStripeSubscription(event.data.object as Stripe.Subscription);
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription && typeof session.subscription === 'string') {
        const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
        await this.upsertFromStripeSubscription(stripeSub);
      }
    }
    return { received: true };
  }

  async listSubscribers(): Promise<any[]> {
    const { data: subRows } = await this.supabase.getClient().from('subscriptions').select('*').order('updated_at', { ascending: false });
    const subs = mapRowsToCamel<Subscription>(subRows || []);
    if (subs.length === 0) return [];
    const ids = subs.map((s) => s.userId);
    const { data: userRows } = await this.supabase.getClient().from('users').select('*').in('id', ids);
    const users = mapRowsToCamel<User>(userRows || []);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const now = Date.now();
    return subs
      .map((sub) => {
        const user = userMap.get(sub.userId);
        if (user?.role === 'superadmin') return null;
        const trialDaysRemaining =
          sub.trialEnd && sub.status === 'trialing'
            ? Math.max(0, Math.ceil((new Date(sub.trialEnd).getTime() - now) / (1000 * 60 * 60 * 24)))
            : 0;
        return {
          ...sub,
          trialDaysRemaining,
          user: user
            ? { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, companyId: user.companyId }
            : null,
        };
      })
      .filter(Boolean);
  }

  async adminExtendTrial(userId: string, days: number): Promise<Subscription> {
    if (!Number.isFinite(days) || days <= 0) throw new BadRequestException('days must be a positive number');
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') throw new BadRequestException('Superadmin account does not use trial extension.');
    const sub = await this.ensureSubscriptionForUser(userId);
    const from = sub.trialEnd && new Date(sub.trialEnd) > new Date() ? new Date(sub.trialEnd) : new Date();
    const trialStart = sub.trialStart || new Date();
    const trialEnd = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
    const updates = mapPayloadToSnake({ trialStart, trialEnd, status: 'trialing', plan: 'free_trial' });
    const { data: saved, error } = await this.supabase.getClient().from('subscriptions').update(updates).eq('id', sub.id).select().single();
    if (error || !saved) throw new BadRequestException('Update failed.');
    return mapRowToCamel<Subscription>(saved as Record<string, unknown>)!;
  }

  /**
   * New trial window from now: TRIAL_DAYS, trialing, free_trial, upload quota reset.
   * Used by superadmin or self-service (dev / secret) when a user was blocked after expiry.
   */
  async applyFreshTrialWindow(userId: string): Promise<Subscription> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') throw new BadRequestException('Superadmin account does not use trials.');
    const sub = await this.ensureSubscriptionForUser(userId);
    const now = new Date();
    const trialEnd = this.buildTrialEnd(now);
    const updates = mapPayloadToSnake({
      trialStart: now,
      trialEnd,
      status: 'trialing',
      plan: 'free_trial',
      trialDocumentsUsed: 0,
    });
    const { data: saved, error } = await this.supabase.getClient().from('subscriptions').update(updates).eq('id', sub.id).select().single();
    if (error || !saved) throw new BadRequestException('Failed to restart trial.');
    this.logger.log(`Fresh trial applied for user ${userId} until ${trialEnd.toISOString()}`);
    return mapRowToCamel<Subscription>(saved as Record<string, unknown>)!;
  }

  /**
   * Logged-in user restarts own trial when:
   * - NODE_ENV=development and ALLOW_DEV_TRIAL_RESTART=true, or
   * - TRIAL_RESTART_SECRET is set and x-trial-restart-secret header matches.
   */
  async selfServiceRestartFreshTrial(userId: string, secretHeader?: string): Promise<Subscription> {
    const nodeEnv = (this.configService.get<string>('NODE_ENV') || '').toLowerCase();
    const devRestart = ['true', '1', 'yes'].includes(
      (this.configService.get<string>('ALLOW_DEV_TRIAL_RESTART') || '').toLowerCase(),
    );
    const devOk = nodeEnv === 'development' && devRestart;
    const expected = this.configService.get<string>('TRIAL_RESTART_SECRET')?.trim();
    if (devOk) {
      return this.applyFreshTrialWindow(userId);
    }
    if (expected && secretHeader === expected) {
      return this.applyFreshTrialWindow(userId);
    }
    throw new ForbiddenException(
      'Fresh trial restart is not enabled. For local dev set NODE_ENV=development and ALLOW_DEV_TRIAL_RESTART=true in backend .env. For scripted reset, set TRIAL_RESTART_SECRET and send header x-trial-restart-secret.',
    );
  }

  async adminSetAccess(userId: string, access: 'active' | 'canceled' | 'expired'): Promise<Subscription> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') throw new BadRequestException('Superadmin account should remain active.');
    const sub = await this.ensureSubscriptionForUser(userId);
    const updates: Record<string, unknown> = { status: access };
    if (access === 'active') {
      updates.plan = 'professional';
      updates.currentPeriodStart = new Date();
      updates.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    if (access === 'canceled') updates.canceledAt = new Date();
    const { data: saved, error } = await this.supabase.getClient().from('subscriptions').update(mapPayloadToSnake(updates)).eq('id', sub.id).select().single();
    if (error || !saved) throw new BadRequestException('Update failed.');
    return mapRowToCamel<Subscription>(saved as Record<string, unknown>)!;
  }

  /**
   * After superadmin bank-transfer approval: subscription must not grant access until code verification.
   */
  async ensureInactiveSubscriptionForPendingBank(userId: string): Promise<void> {
    const user = await this.getUserOrFail(userId);
    const client = this.supabase.getClient();
    const { data: existing } = await client.from('subscriptions').select('id').eq('user_id', userId).maybeSingle();
    const inactive = mapPayloadToSnake({
      plan: 'free_trial' as PlanTier,
      status: 'expired' as SubscriptionStatus,
      trialStart: null,
      trialEnd: null,
      trialDocumentsUsed: 0,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    });
    if (existing) {
      const { error } = await client.from('subscriptions').update(inactive).eq('user_id', userId);
      if (error) throw new BadRequestException('Failed to prepare subscription for bank activation.');
      return;
    }
    const ins = mapPayloadToSnake({
      userId,
      companyId: user.companyId ?? null,
      plan: 'free_trial' as PlanTier,
      status: 'expired' as SubscriptionStatus,
      trialStart: null,
      trialEnd: null,
      trialDocumentsUsed: 0,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    });
    const { error: insErr } = await client.from('subscriptions').insert(ins);
    if (insErr) throw new BadRequestException('Failed to create subscription for bank activation.');
  }

  /** Apply paid tier after user verifies bank-transfer code (no Stripe). */
  async activateBankVerifiedPlan(userId: string, planTier: 'basic' | 'medium' | 'premium'): Promise<void> {
    const user = await this.getUserOrFail(userId);
    const raw = this.configService.get<string>('BANK_SUBSCRIPTION_PERIOD_DAYS')?.trim() || '365';
    const periodDays = Math.max(1, parseInt(raw, 10) || 365);
    const start = new Date();
    const end = new Date(start.getTime() + periodDays * 86_400_000);
    const client = this.supabase.getClient();
    const updates = mapPayloadToSnake({
      plan: planTier as PlanTier,
      status: 'active' as SubscriptionStatus,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      trialStart: null,
      trialEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    });
    const { data: existing } = await client.from('subscriptions').select('id').eq('user_id', userId).maybeSingle();
    if (!existing) {
      const ins = mapPayloadToSnake({
        userId,
        companyId: user.companyId ?? null,
        plan: planTier as PlanTier,
        status: 'active' as SubscriptionStatus,
        trialStart: null,
        trialEnd: null,
        trialDocumentsUsed: 0,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
      });
      const { error: insErr } = await client.from('subscriptions').insert(ins);
      if (insErr) throw new BadRequestException('Failed to activate subscription.');
      return;
    }
    const { error } = await client.from('subscriptions').update(updates).eq('user_id', userId);
    if (error) throw new BadRequestException('Failed to activate subscription.');
  }
}
