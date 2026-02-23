import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
export type PlanTier = 'free_trial' | 'starter' | 'professional' | 'enterprise';

@Entity('subscriptions')
@Index(['userId'], { unique: true })
@Index(['stripeCustomerId'])
@Index(['stripeSubscriptionId'])
@Index(['status'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ name: 'stripe_customer_id', type: 'text', nullable: true })
  stripeCustomerId: string | null;

  @Column({ name: 'stripe_subscription_id', type: 'text', nullable: true })
  stripeSubscriptionId: string | null;

  @Column({ name: 'stripe_price_id', type: 'text', nullable: true })
  stripePriceId: string | null;

  @Column({ type: 'text', default: 'free_trial' })
  plan: PlanTier;

  @Column({ type: 'text', default: 'trialing' })
  status: SubscriptionStatus;

  @Column({ name: 'trial_start', type: 'timestamptz', nullable: true })
  trialStart: Date | null;

  @Column({ name: 'trial_end', type: 'timestamptz', nullable: true })
  trialEnd: Date | null;

  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart: Date | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ name: 'cancel_at', type: 'timestamptz', nullable: true })
  cancelAt: Date | null;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
