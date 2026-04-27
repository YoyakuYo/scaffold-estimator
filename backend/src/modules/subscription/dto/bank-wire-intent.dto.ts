import { IsIn, IsOptional } from 'class-validator';

export type BankWirePlanTier = 'basic' | 'medium' | 'monthly' | 'premium';
export type BankWireProductCode = 'scaffold' | 'bim' | 'construction_plan';

export class BankWireIntentDto {
  @IsIn(['basic', 'medium', 'monthly', 'premium'])
  plan!: BankWirePlanTier;

  /**
   * Phase 2 follow-up: which product the wire targets. Defaults to 'scaffold'
   * so existing /billing flows keep working unchanged.
   */
  @IsOptional()
  @IsIn(['scaffold', 'bim', 'construction_plan'])
  productCode?: BankWireProductCode;
}
