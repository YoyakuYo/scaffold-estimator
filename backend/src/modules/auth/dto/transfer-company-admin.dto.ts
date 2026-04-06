import { IsOptional, IsUUID } from 'class-validator';

export class TransferCompanyAdminDto {
  @IsUUID()
  targetUserId!: string;

  /** Required when the actor is platform superadmin. */
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
