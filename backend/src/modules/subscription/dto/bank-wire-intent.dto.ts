import { IsIn } from 'class-validator';

export type BankWirePlanTier = 'basic' | 'medium' | 'monthly' | 'premium';

export class BankWireIntentDto {
  @IsIn(['basic', 'medium', 'monthly', 'premium'])
  plan!: BankWirePlanTier;
}
