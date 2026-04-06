import { IsEmail, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTeamInviteDto {
  @IsEmail()
  email: string;

  @IsUUID()
  branchId: string;

  @IsOptional()
  @IsEnum(['viewer', 'estimator'])
  role?: 'viewer' | 'estimator';

  /** Superadmin only: target company when inviting on behalf of a tenant. */
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
