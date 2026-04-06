import { IsEnum, IsOptional } from 'class-validator';

export type ApprovePaymentMode = 'standard' | 'bank_transfer';

export class ApproveUserDto {
  @IsOptional()
  @IsEnum(['standard', 'bank_transfer'])
  paymentActivation?: ApprovePaymentMode;

  /** Required when paymentActivation is bank_transfer (validated in AuthService). */
  @IsOptional()
  @IsEnum(['basic', 'medium', 'premium'])
  planTier?: 'basic' | 'medium' | 'premium';
}
