import { IsIn, IsOptional } from 'class-validator';

/** Tier keys for Stripe Checkout; `standard` = legacy single STRIPE_PRICE_ID. */
export type CheckoutPlanTier = 'basic' | 'medium' | 'premium' | 'standard';

export class CreateCheckoutSessionDto {
  @IsOptional()
  @IsIn(['basic', 'medium', 'premium', 'standard'])
  plan?: CheckoutPlanTier;
}
