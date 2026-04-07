import { IsIn } from 'class-validator';

export type BankWirePlanTier = 'basic' | 'medium' | 'premium';

export class BankWireIntentDto {
  @IsIn(['basic', 'medium', 'premium'])
  plan!: BankWirePlanTier;
}
