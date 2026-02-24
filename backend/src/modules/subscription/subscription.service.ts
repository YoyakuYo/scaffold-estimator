import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { Subscription, SubscriptionStatus } from './subscription.entity';
import { User } from '../auth/user.entity';

const TRIAL_DAYS = 14;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly stripe: Stripe | null;

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    const key = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
  }

  private getFrontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
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
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async ensureSubscriptionForUser(userId: string): Promise<Subscription> {
    const user = await this.getUserOrFail(userId);
    const existing = await this.subscriptionRepository.findOne({ where: { userId } });
    if (existing) return existing;

    const now = new Date();
    const subscription = this.subscriptionRepository.create({
      userId: user.id,
      companyId: user.companyId ?? null,
      plan: user.role === 'superadmin' ? 'enterprise' : 'free_trial',
      status: user.role === 'superadmin' ? 'active' : 'trialing',
      trialStart: user.role === 'superadmin' ? null : now,
      trialEnd: user.role === 'superadmin' ? null : this.buildTrialEnd(now),
      currentPeriodStart: user.role === 'superadmin' ? now : null,
      currentPeriodEnd: user.role === 'superadmin' ? null : null,
    });
    return this.subscriptionRepository.save(subscription);
  }

  private async expireTrialIfNeeded(subscription: Subscription): Promise<Subscription> {
    if (subscription.status === 'trialing' && subscription.trialEnd && subscription.trialEnd <= new Date()) {
      subscription.status = 'expired';
      return this.subscriptionRepository.save(subscription);
    }
    return subscription;
  }

  async hasActiveAccess(userId: string, role?: string): Promise<boolean> {
    if (role === 'superadmin') return true;
    let sub = await this.ensureSubscriptionForUser(userId);
    sub = await this.expireTrialIfNeeded(sub);
    if (sub.status === 'active') return true;
    if (sub.status === 'trialing' && sub.trialEnd && sub.trialEnd > new Date()) return true;
    return false;
  }

  async getMySubscription(userId: string): Promise<any> {
    const user = await this.getUserOrFail(userId);
    let sub = await this.ensureSubscriptionForUser(userId);
    sub = await this.expireTrialIfNeeded(sub);
    const now = Date.now();
    const trialDaysRemaining =
      sub.trialEnd && sub.status === 'trialing'
        ? Math.max(0, Math.ceil((sub.trialEnd.getTime() - now) / (1000 * 60 * 60 * 24)))
        : 0;
    const hasAccess = await this.hasActiveAccess(userId, user.role);
    return {
      ...sub,
      hasAccess,
      trialDaysRemaining,
      trialLengthDays: TRIAL_DAYS,
      isStripeConfigured: !!this.stripe,
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
      sub.stripeCustomerId = customer.id;
      sub = await this.subscriptionRepository.save(sub);
    }

    const priceId = this.configService.get<string>('STRIPE_PRICE_ID');
    if (!priceId) {
      throw new BadRequestException('STRIPE_PRICE_ID is not configured.');
    }

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

    if (!session.url) {
      throw new BadRequestException('Could not create Stripe checkout session URL.');
    }
    return { url: session.url };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const sub = await this.ensureSubscriptionForUser(userId);
    if (!sub.stripeCustomerId) {
      throw new BadRequestException('No Stripe customer found for this account.');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${this.getFrontendUrl()}/billing`,
    });
    return { url: session.url };
  }

  private async upsertFromStripeSubscription(stripeSub: Stripe.Subscription): Promise<void> {
    let sub: Subscription | null = null;
    if (stripeSub.id) {
      sub = await this.subscriptionRepository.findOne({
        where: { stripeSubscriptionId: stripeSub.id },
      });
    }
    if (!sub && typeof stripeSub.customer === 'string') {
      sub = await this.subscriptionRepository.findOne({
        where: { stripeCustomerId: stripeSub.customer },
      });
    }
    if (!sub) {
      this.logger.warn(`Ignoring Stripe subscription ${stripeSub.id}: no local subscription found.`);
      return;
    }

    const priceId = stripeSub.items.data[0]?.price?.id || null;
    sub.stripeSubscriptionId = stripeSub.id;
    sub.stripePriceId = priceId;
    sub.status = this.mapStripeStatus(stripeSub.status);
    sub.plan = sub.status === 'active' ? 'professional' : sub.plan;
    const periodStart = (stripeSub as any).current_period_start as number | undefined;
    const periodEnd = (stripeSub as any).current_period_end as number | undefined;
    sub.currentPeriodStart = periodStart
      ? new Date(periodStart * 1000)
      : null;
    sub.currentPeriodEnd = periodEnd
      ? new Date(periodEnd * 1000)
      : null;
    sub.cancelAt = stripeSub.cancel_at ? new Date(stripeSub.cancel_at * 1000) : null;
    sub.canceledAt = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null;
    await this.subscriptionRepository.save(sub);
  }

  async handleWebhook(signature: string | undefined, rawBody: Buffer): Promise<{ received: true }> {
    const stripe = this.requireStripe();
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not configured.');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature header.');
    }

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
    const subscriptions = await this.subscriptionRepository.find({
      order: { updatedAt: 'DESC' },
    });
    const users =
      subscriptions.length > 0
        ? await this.userRepository.find({
            where: subscriptions.map((s) => ({ id: s.userId })),
          })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const now = Date.now();

    return subscriptions
      .map((sub) => {
        const user = userMap.get(sub.userId);
        if (user?.role === 'superadmin') return null;
        const trialDaysRemaining =
          sub.trialEnd && sub.status === 'trialing'
            ? Math.max(0, Math.ceil((sub.trialEnd.getTime() - now) / (1000 * 60 * 60 * 24)))
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
              }
            : null,
        };
      })
      .filter(Boolean);
  }

  async adminExtendTrial(userId: string, days: number): Promise<Subscription> {
    if (!Number.isFinite(days) || days <= 0) {
      throw new BadRequestException('days must be a positive number');
    }
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') {
      throw new BadRequestException('Superadmin account does not use trial extension.');
    }

    const sub = await this.ensureSubscriptionForUser(userId);
    const from = sub.trialEnd && sub.trialEnd > new Date() ? sub.trialEnd : new Date();
    sub.trialStart = sub.trialStart || new Date();
    sub.trialEnd = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
    sub.status = 'trialing';
    sub.plan = 'free_trial';
    return this.subscriptionRepository.save(sub);
  }

  async adminSetAccess(
    userId: string,
    access: 'active' | 'canceled' | 'expired',
  ): Promise<Subscription> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin') {
      throw new BadRequestException('Superadmin account should remain active.');
    }
    const sub = await this.ensureSubscriptionForUser(userId);
    sub.status = access;
    if (access === 'active') {
      sub.plan = 'professional';
      sub.currentPeriodStart = new Date();
      sub.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    if (access === 'canceled') {
      sub.canceledAt = new Date();
    }
    return this.subscriptionRepository.save(sub);
  }
}
