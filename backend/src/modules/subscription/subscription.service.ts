import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PlanTier, Subscription, SubscriptionStatus } from './subscription.entity';
import { User } from '../auth/user.entity';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';
import type { BankWirePlanTier } from './dto/bank-wire-intent.dto';
import {
  NO_ACCESS_CAPABILITIES,
  SUPERADMIN_CAPABILITIES,
  capabilitiesForPlan,
  capabilitiesForTrial,
  mergeCapabilitiesMax,
  inferDisplayPlanFromCapabilities,
  type EffectivePlanCapabilities,
} from './plan-capabilities';

/** New trials: trial_end = now + TRIAL_DAYS */
export const TRIAL_DAYS = 7;
/** Max drawing file uploads via POST /drawings/upload while status = trialing */
export const TRIAL_MAX_DRAWING_UPLOADS = 2;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  /** True when BANK_TRANSFER_* env is complete; used for checkout plan cards on /billing. */
  isBankTransferConfigured(): boolean {
    return this.getBankTransferInstructions('') !== null;
  }

  /** Public bank-transfer details for /billing (manual 銀行振込, e.g. Japan). */
  private getBankTransferInstructions(userEmail: string, wireReference?: string | null): {
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
    const ref = wireReference?.trim();
    const remittanceReference = ref ? `${ref} (${userEmail})` : userEmail;
    return {
      bankName,
      branch,
      accountType,
      accountNumber,
      accountHolder,
      remittanceReference,
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

  /**
   * Paid plan from DB row. Legacy rows may still carry `stripe_*` ids without an updated `plan`;
   * treat active/trialing stripe-linked rows as professional so seats stay valid without Stripe API.
   */
  private effectivePaidPlanFromRow(sub: Subscription): string | null {
    const p = sub.plan;
    const now = new Date();
    if ((!p || p === 'free_trial') && (sub.stripeSubscriptionId || sub.stripeCustomerId)) {
      const st = sub.status;
      if (st === 'active' || st === 'trialing') return 'professional';
    }
    if (!p || p === 'free_trial') return null;
    if (sub.status === 'active') return p;
    if (sub.status === 'trialing' && sub.trialEnd && new Date(sub.trialEnd) > now) return p;
    return null;
  }

  /** Row represents an org billing anchor (paid access or legacy Stripe linkage). */
  private subscriptionRowLooksLikeCompanyPayer(s: Subscription): boolean {
    if (s.stripeCustomerId || s.stripeSubscriptionId) return true;
    return this.effectivePaidPlanFromRow(s) != null;
  }

  private companyHasPeerBillingAnchor(companySubs: Subscription[], userId: string): boolean {
    return companySubs.some((x) => x.userId !== userId && this.subscriptionRowLooksLikeCompanyPayer(x));
  }

  /**
   * Who may run bank checkout / manage org billing: solo users, company admin (non-seat), or legacy Stripe customer rows.
   */
  private ownsBillingContactRow(user: User, sub: Subscription): boolean {
    if (user.role === 'superadmin') return false;
    if (sub.stripeCustomerId || sub.stripeSubscriptionId) return true;
    if (!user.companyId) return true;
    return user.isCompanyAdmin === true && user.isCompanySeat !== true;
  }

  private getBankWireCheckoutTiers(): BankWirePlanTier[] {
    if (!this.isBankTransferConfigured()) return [];
    return ['basic', 'medium', 'monthly', 'premium'];
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
        return 6;
      case 'premium':
        return 5;
      case 'monthly':
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
      const paidPlan = this.effectivePaidPlanFromRow(s);
      if (!paidPlan) continue;
      const accessOk =
        s.status === 'active' ||
        (s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd) > now);
      if (!accessOk) continue;
      const score = this.planTierScore(paidPlan);
      if (score === 0) continue;
      if (!best || score > best.score) best = { plan: paidPlan as PlanTier, score };
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
      if (out) {
        await client
          .from('users')
          .update(mapPayloadToSnake({ isCompanySeat: true }))
          .eq('id', userId);
        return mapRowToCamel<Subscription>(out as Record<string, unknown>)!;
      }
      return this.ensureSubscriptionForUser(userId);
    }

    await client.from('users').update(mapPayloadToSnake({ isCompanySeat: false })).eq('id', userId);

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
    await client.from('users').update(mapPayloadToSnake({ isCompanySeat: true })).eq('id', userId);
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
        const paidPlan = this.effectivePaidPlanFromRow(s);
        if (paidPlan && s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd) > now) return true;
        if (s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd) > now) return true;
      }
      return false;
    }

    // No company: only this user's subscription row applies (company_id may be null on the row).
    let sub = await this.ensureSubscriptionForUser(userId);
    sub = await this.expireTrialIfNeeded(sub);
    if (sub.status === 'active') return true;
    const paidSolo = this.effectivePaidPlanFromRow(sub);
    if (paidSolo && sub.status === 'trialing' && sub.trialEnd && new Date(sub.trialEnd) > now) return true;
    if (sub.status === 'trialing' && sub.trialEnd && new Date(sub.trialEnd) > now) return true;
    return false;
  }

  /**
   * Company-wide entitlements: best active paid plan wins; if none, valid trial uses trial caps.
   */
  async aggregateCompanyCapabilities(subs: Subscription[]): Promise<EffectivePlanCapabilities> {
    const now = new Date();
    const companyHasBillingAnchor = subs.some((s) => this.subscriptionRowLooksLikeCompanyPayer(s));
    let paidMerge: EffectivePlanCapabilities | null = null;
    let hasValidTrial = false;
    for (const sub of subs) {
      const s = await this.expireTrialIfNeeded(sub);
      const paidPlan = this.effectivePaidPlanFromRow(s);
      if (s.status === 'active' && paidPlan) {
        const c = capabilitiesForPlan(paidPlan);
        if (c.maxSeats > 0) {
          paidMerge = paidMerge ? mergeCapabilitiesMax(paidMerge, c) : c;
        }
      }
      if (paidPlan && s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd) > now) {
        const c = capabilitiesForPlan(paidPlan);
        if (c.maxSeats > 0) {
          paidMerge = paidMerge ? mergeCapabilitiesMax(paidMerge, c) : c;
        }
      }
      if (s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd) > now && !paidPlan) {
        const orphanInviteTrial =
          companyHasBillingAnchor && !this.subscriptionRowLooksLikeCompanyPayer(s) && s.plan === 'free_trial';
        if (orphanInviteTrial) continue;
        hasValidTrial = true;
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
      let caps = await this.aggregateCompanyCapabilities(subs);
      if (await this.companyHasSubscriptionExemptMember(companyId)) {
        caps = mergeCapabilitiesMax(caps, capabilitiesForPlan('enterprise'));
      }
      return caps;
    }

    let sub = await this.ensureSubscriptionForUser(userId);
    sub = await this.expireTrialIfNeeded(sub);
    const now = new Date();
    const paidPlan = this.effectivePaidPlanFromRow(sub);
    if (sub.status === 'active' && paidPlan) {
      return capabilitiesForPlan(paidPlan);
    }
    if (paidPlan && sub.status === 'trialing' && sub.trialEnd && new Date(sub.trialEnd) > now) {
      return capabilitiesForPlan(paidPlan);
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

  /**
   * Enterprise / manual full-access orgs often set `subscription_exempt` on the billing owner only.
   * That user gets SUPERADMIN_CAPABILITIES directly; peers must still inherit the same feature tier
   * even when the exempt user's subscription row has no Stripe-backed `effectivePaidPlanFromRow`.
   */
  private async companyHasSubscriptionExemptMember(companyId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .getClient()
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_active', true)
      .eq('subscription_exempt', true);
    if (error) return false;
    return (count ?? 0) > 0;
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

  /**
   * Personal row may still be `free_trial` / trialing after join while a teammate anchors billing;
   * that must not consume "personal trial" upload quota.
   */
  private async isInvitedCompanySeatTrialShadow(userId: string, sub: Subscription): Promise<boolean> {
    const user = await this.getUserOrFail(userId);
    if (user.isCompanySeat === true) return true;
    if (!user.companyId || user.role === 'superadmin' || user.subscriptionExempt) return false;
    if (this.effectivePaidPlanFromRow(sub)) return false;
    if (!(sub.plan === 'free_trial' && sub.status === 'trialing')) return false;
    const peers = await this.getSubscriptionsForCompany(user.companyId);
    return this.companyHasPeerBillingAnchor(peers, userId);
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
    if (await this.isInvitedCompanySeatTrialShadow(userId, sub)) return;
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
    if (await this.isInvitedCompanySeatTrialShadow(userId, sub)) return;
    const used = sub.trialDocumentsUsed ?? 0;
    await this.supabase
      .getClient()
      .from('subscriptions')
      .update(mapPayloadToSnake({ trialDocumentsUsed: used + 1 }))
      .eq('id', sub.id);
  }

  async getMySubscription(userId: string): Promise<any> {
    let user = await this.getUserOrFail(userId);
    let sub = await this.ensureSubscriptionForUser(userId);
    if (user.companyId && user.role !== 'superadmin' && !user.subscriptionExempt) {
      const ownsBilling = this.ownsBillingContactRow(user, sub);
      if (!ownsBilling) {
        await this.syncSubscriptionRowForCompanyMember(userId);
      } else {
        await this.reconcileSeatMemberTrialShadow(userId);
      }
      const { data: rowAfter } = await this.supabase.getClient().from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
      if (rowAfter) sub = mapRowToCamel<Subscription>(rowAfter as Record<string, unknown>)!;
    }
    user = await this.getUserOrFail(userId);
    sub = await this.expireTrialIfNeeded(sub);
    const ownsBillingAfterReload = this.ownsBillingContactRow(user, sub);
    const fullCompanyPaidSnap =
      user.companyId && user.role !== 'superadmin' && !user.subscriptionExempt
        ? await this.bestCompanyPaidSeatSnapshot(await this.getSubscriptionsForCompany(user.companyId))
        : null;
    if (
      fullCompanyPaidSnap &&
      !ownsBillingAfterReload &&
      sub.plan === 'free_trial' &&
      sub.status === 'trialing'
    ) {
      sub = {
        ...sub,
        plan: fullCompanyPaidSnap.plan,
        status: 'active' as SubscriptionStatus,
        trialStart: null,
        trialEnd: null,
        trialDocumentsUsed: 0,
      };
      void this.syncSubscriptionRowForCompanyMember(userId);
    }
    const exempt = user.subscriptionExempt;
    const hasAccess = await this.hasActiveAccess(userId, user.role);
    const checkoutTiers = this.getBankWireCheckoutTiers();
    const capabilities = await this.resolveEffectiveCapabilities(userId, user.role);
    const seatUsed =
      user.companyId && user.role !== 'superadmin'
        ? await this.countCompanySeats(user.companyId)
        : 0;
    const ownsBillingAfter = this.ownsBillingContactRow(user, sub);
    let peerPaidSnap: { plan: PlanTier } | null = null;
    let companySubsForPeers: Subscription[] = [];
    if (user.companyId) {
      companySubsForPeers = await this.getSubscriptionsForCompany(user.companyId);
      peerPaidSnap = await this.bestCompanyPaidSeatSnapshot(
        companySubsForPeers.filter((s) => s.userId !== userId),
      );
    }
    /**
     * Another teammate must look like the payer: `bestCompanyPaidSeatSnapshot` OR any peer row with
     * a billing anchor (paid plan on row or legacy Stripe ids).
     */
    const peerAnchorsBilling =
      peerPaidSnap != null ||
      (user.companyId !== null &&
        user.companyId !== '' &&
        this.companyHasPeerBillingAnchor(companySubsForPeers, userId));
    /**
     * Org seat: invited / mirrored member with no personal billing contact row — includes `users.is_company_seat`
     * so existing invitees keep billing hidden even when peer detection regresses.
     */
    const orgSeat =
      !!user.companyId &&
      hasAccess &&
      !ownsBillingAfter &&
      !exempt &&
      user.role !== 'superadmin' &&
      (peerAnchorsBilling || user.isCompanySeat === true);
    /** False when this user inherits a paid company seat and should not use billing checkout themselves. */
    let managesBilling =
      exempt ||
      user.role === 'superadmin' ||
      !user.companyId ||
      ownsBillingAfter ||
      !hasAccess ||
      !orgSeat;

    /** Only the designated company admin may pay for the organization. */
    const companyMayUseBillingUi =
      !user.companyId || user.role === 'superadmin' || exempt || user.isCompanyAdmin === true;
    managesBilling = managesBilling && companyMayUseBillingUi;

    const isCompanySeatViewer =
      !exempt && user.role !== 'superadmin' && !!user.companyId && hasAccess && !managesBilling;

    let subPayload: Subscription = exempt
      ? { ...sub, plan: 'enterprise' as const, status: 'active' as const, trialStart: null, trialEnd: null }
      : sub;

    if (isCompanySeatViewer && capabilities.maxSeats > 0) {
      const inferred = inferDisplayPlanFromCapabilities(capabilities) as PlanTier;
      subPayload = {
        ...subPayload,
        plan: inferred,
        status: 'active',
        trialStart: null,
        trialEnd: null,
        trialDocumentsUsed: 0,
      };
    }

    const trialDaysRemainingOut =
      exempt ||
      isCompanySeatViewer ||
      !subPayload.trialEnd ||
      subPayload.status !== 'trialing'
        ? 0
        : Math.max(
            0,
            Math.ceil((new Date(subPayload.trialEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
          );

    return {
      ...subPayload,
      hasAccess,
      managesBilling,
      companySeat: isCompanySeatViewer,
      trialDaysRemaining: trialDaysRemainingOut,
      trialLengthDays: TRIAL_DAYS,
      trialFileUploads:
        exempt ||
        isCompanySeatViewer ||
        subPayload.status !== 'trialing' ||
        subPayload.plan !== 'free_trial'
          ? undefined
          : {
              used: subPayload.trialDocumentsUsed ?? 0,
              max: TRIAL_MAX_DRAWING_UPLOADS,
            },
      isStripeConfigured: false,
      isBankTransferConfigured: this.isBankTransferConfigured(),
      checkoutPlans: managesBilling && checkoutTiers.length > 0 ? checkoutTiers : [],
      bankTransfer: managesBilling ? this.getBankTransferInstructions(user.email, user.bankWireReference) : null,
      bankWireReference: managesBilling ? (user.bankWireReference ?? null) : null,
      bankWireIntentPlan: managesBilling ? (user.bankWireIntentPlan ?? null) : null,
      capabilities,
      pendingBankPlan: user.pendingBankPlan ?? null,
      bankActivationCodeExpiresAt: user.bankActivationCodeExpiresAt ?? null,
      seatUsage:
        user.role === 'superadmin' || exempt
          ? undefined
          : { used: seatUsed, limit: capabilities.maxSeats },
    };
  }

  async createBankWireIntent(
    userId: string,
    planTier: BankWirePlanTier,
  ): Promise<{ bankTransfer: Record<string, unknown>; wireReference: string; planTier: BankWirePlanTier }> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') {
      throw new ForbiddenException('Superadmin account does not require a paid subscription checkout.');
    }
    if (user.subscriptionExempt) {
      throw new ForbiddenException('This account has full access without a paid subscription.');
    }
    const billingState = await this.getMySubscription(userId);
    if (!billingState.managesBilling) {
      throw new ForbiddenException(
        'Your seat is included in your organization’s subscription. Billing changes must be made by the teammate who manages payment.',
      );
    }
    if (!this.getBankWireCheckoutTiers().includes(planTier)) {
      throw new BadRequestException(
        'Bank transfer checkout is not available. Set BANK_TRANSFER_ENABLED and BANK_TRANSFER_* on the API.',
      );
    }
    let wireRef = user.bankWireReference ?? null;
    if (!wireRef || user.bankWireIntentPlan !== planTier) {
      wireRef = await this.allocateUniqueWireReference();
    }
    const client = this.supabase.getClient();
    const { error } = await client
      .from('users')
      .update(
        mapPayloadToSnake({
          bankWireReference: wireRef,
          bankWireIntentPlan: planTier,
        }),
      )
      .eq('id', userId);
    if (error) throw new BadRequestException('Could not save payment reference.');
    const bankTransfer = this.getBankTransferInstructions(user.email, wireRef)!;
    return { bankTransfer, wireReference: wireRef, planTier };
  }

  private async allocateUniqueWireReference(): Promise<string> {
    const client = this.supabase.getClient();
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = `ZM-${randomBytes(5).toString('hex').toUpperCase()}`;
      const { data } = await client.from('users').select('id').eq('bank_wire_reference', code).maybeSingle();
      if (!data) return code;
    }
    throw new BadRequestException('Could not allocate a unique payment reference.');
  }

  async adminConfirmBankWirePayment(userId: string): Promise<{ ok: true; plan: string }> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') throw new BadRequestException('Invalid target.');
    const tier = user.bankWireIntentPlan;
    if (!tier || !user.bankWireReference) {
      throw new BadRequestException('No pending bank transfer for this user.');
    }
    await this.activateBankVerifiedPlan(userId, tier);
    const { error } = await this.supabase
      .getClient()
      .from('users')
      .update(
        mapPayloadToSnake({
          bankWireReference: null,
          bankWireIntentPlan: null,
        }),
      )
      .eq('id', userId);
    if (error) this.logger.warn(`adminConfirmBankWirePayment user cleanup: ${error.message}`);
    try {
      await this.syncSubscriptionRowForCompanyMember(userId);
    } catch (e) {
      this.logger.warn(`sync after bank confirm: ${(e as Error).message}`);
    }
    return { ok: true, plan: tier };
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
            ? {
                id: user.id,
                email: user.email,
                role: user.role,
                firstName: user.firstName,
                lastName: user.lastName,
                companyId: user.companyId,
                bankWireReference: user.bankWireReference ?? null,
                bankWireIntentPlan: user.bankWireIntentPlan ?? null,
              }
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
    const billingState = await this.getMySubscription(userId);
    if (!billingState.managesBilling) {
      throw new ForbiddenException(
        'Organization seats cannot restart a personal trial. Use features included with your company plan.',
      );
    }
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
  async activateBankVerifiedPlan(
    userId: string,
    planTier: 'basic' | 'medium' | 'premium' | 'monthly',
  ): Promise<void> {
    const user = await this.getUserOrFail(userId);
    const raw =
      planTier === 'monthly'
        ? this.configService.get<string>('BANK_PER_PROJECT_SUBSCRIPTION_PERIOD_DAYS')?.trim() ||
          this.configService.get<string>('BANK_MONTHLY_SUBSCRIPTION_PERIOD_DAYS')?.trim() ||
          '365'
        : this.configService.get<string>('BANK_SUBSCRIPTION_PERIOD_DAYS')?.trim() || '365';
    const defaultDays = 365;
    const periodDays = Math.max(1, parseInt(raw, 10) || defaultDays);
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
