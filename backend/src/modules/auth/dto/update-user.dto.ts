import { IsEmail, IsString, MinLength, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { UserRole } from '../user.entity';
import { PASSWORD_POLICY_MIN_LENGTH } from '../password-policy';

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(['superadmin', 'estimator', 'viewer'])
  role?: UserRole;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_POLICY_MIN_LENGTH)
  newPassword: string;
}

export class AdminResetPasswordDto {
  @IsString()
  @MinLength(PASSWORD_POLICY_MIN_LENGTH)
  newPassword: string;
}
