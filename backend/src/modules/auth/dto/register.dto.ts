import { IsEmail, IsString, MinLength, IsOptional, ValidateIf } from 'class-validator';
import { PASSWORD_POLICY_MIN_LENGTH } from '../password-policy';

export class RegisterDto {
  // User info
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(PASSWORD_POLICY_MIN_LENGTH)
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  // Company info
  @IsString()
  companyName: string;

  @IsOptional()
  @IsString()
  companyAddress?: string;

  @IsOptional()
  @IsString()
  companyPhone?: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsEmail()
  companyEmail?: string;

  // Structured Japanese address fields
  @IsOptional()
  @IsString()
  companyPostalCode?: string;

  @IsOptional()
  @IsString()
  companyPrefecture?: string;

  @IsOptional()
  @IsString()
  companyCity?: string;

  @IsOptional()
  @IsString()
  companyTown?: string;

  @IsOptional()
  @IsString()
  companyAddressLine?: string;

  @IsOptional()
  @IsString()
  companyBuilding?: string;
}
