import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Subscription, SubscriptionStatus } from './subscription.entity';
import { User } from '../auth/user.entity';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

const TRIAL_DAYS = 14;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly stripe: Stripe | null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    const key = this.configService.get<string>('STRIPE_SECRET_KEY');
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
    return {
      bankName,
      branch,
      accountType,
      accountNumber,
      accountHolder,
      remittanceReference: userEmail,
      ...(amountNote ? { amountNote } : {}),
    };
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured. Set STRIPE_SECRET_KEY.');
    }
    return this.stripe;
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

  async hasActiveAccess(userId: string, role?: string): Promise<boolean> {
    if (role === 'superadmin') return true;
    const user = await this.getUserOrFail(userId);
    const companyId = user.companyId;
    if (!companyId) return false;
    let { data: rows } = await this.supabase.getClient().from('subscriptions').select('*').eq('company_id', companyId);
    let subs = mapRowsToCamel<Subscription>(rows || []);
    if (subs.length === 0) {
      await this.ensureSubscriptionForUser(userId);
      const res = await this.supabase.getClient().from('subscriptions').select('*').eq('company_id', companyId);
      subs = mapRowsToCamel<Subscription>(res.data || []);
    }
    const now = new Date();
    for (const sub of subs) {
      const s = await this.expireTrialIfNeeded(sub);
      if (s.status === 'active') return true;
      if (s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd) > now) return true;
    }
    return false;
  }

  async getMySubscription(userId: string): Promise<any> {
    const user = await this.getUserOrFail(userId);
    let sub = await this.ensureSubscriptionForUser(userId);
    sub = await this.expireTrialIfNeeded(sub);
    const now = Date.now();
    const trialDaysRemaining =
      sub.trialEnd && sub.status === 'trialing'
        ? Math.max(0, Math.ceil((new Date(sub.trialEnd).getTime() - now) / (1000 * 60 * 60 * 24)))
        : 0;
    const hasAccess = await this.hasActiveAccess(userId, user.role);
    return {
      ...sub,
      hasAccess,
      trialDaysRemaining,
      trialLengthDays: TRIAL_DAYS,
      isStripeConfigured: !!this.stripe,
      bankTransfer: this.getBankTransferInstructions(user.email),
    };
  }

  async createCheckoutSession(userId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const user = await this.getUserOrFail(userId);
    let sub = await this.ensureSubscriptionForUser(userId);

    if (user.role === 'superadmin') {
      throw new ForbiddenException('Superadmin account does not require paid subscription checkout.');
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

    const priceId = this.configService.get<string>('STRIPE_PRICE_ID');
    if (!priceId) throw new BadRequestException('STRIPE_PRICE_ID is not configured.');

    const frontendUrl = this.getFrontendUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/billing?checkout=success`,
      cancel_url: `${frontendUrl}/billing?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: { userId: user.id },
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
    const updates = mapPayloadToSnake({
      stripeSubscriptionId: stripeSub.id,
      stripePriceId: priceId,
      status: this.mapStripeStatus(stripeSub.status),
      plan: (sub as any).plan === 'active' ? 'professional' : sub.plan,
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
}
