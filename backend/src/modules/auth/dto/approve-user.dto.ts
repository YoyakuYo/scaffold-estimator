import { IsEnum, IsOptional } from 'class-validator';

export type ApprovePaymentMode = 'standard' | 'bank_transfer';

export class ApproveUserDto {
  @IsOptional()
  @IsEnum(['standard', 'bank_transfer'])
  paymentActivation?: ApprovePaymentMode;

  /** Required when paymentActivation is bank_transfer (validated in AuthService). */
  @IsOptional()
  @IsEnum(['basic', 'medium', 'monthly', 'premium'])
  planTier?: 'basic' | 'medium' | 'monthly' | 'premium';

  /**
   * Phase 2 follow-up: which product the activation should grant. Defaults
   * to 'scaffold' so the existing approval flow is unchanged when the admin
   * doesn't pick a product.
   */
  @IsOptional()
  @IsEnum(['scaffold', 'bim', 'construction_plan'])
  productCode?: 'scaffold' | 'bim' | 'construction_plan';
}
