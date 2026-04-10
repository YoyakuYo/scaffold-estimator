import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { UserRole } from '../user.entity';
import { PASSWORD_POLICY_MIN_LENGTH } from '../password-policy';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(PASSWORD_POLICY_MIN_LENGTH)
  password: string;

  @IsEnum(['superadmin', 'estimator', 'viewer'])
  role: UserRole;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
