import {
  IsEmail,
  IsString,
  IsNotEmpty,
  MinLength,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { PASSWORD_POLICY_MIN_LENGTH } from '../password-policy';

export class RegisterDto {
  // User info
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(PASSWORD_POLICY_MIN_LENGTH)
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'firstName is required.' })
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'lastName is required.' })
  lastName: string;

  // Company info — name + structured address are mandatory so the superadmin
  // can verify each registered company before approval.
  @IsString()
  @IsNotEmpty({ message: 'companyName is required.' })
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

  // Structured Japanese address fields — required for superadmin verification.
  @IsString()
  @IsNotEmpty({ message: 'companyPostalCode is required.' })
  companyPostalCode!: string;

  @IsString()
  @IsNotEmpty({ message: 'companyPrefecture is required.' })
  companyPrefecture!: string;

  @IsString()
  @IsNotEmpty({ message: 'companyCity is required.' })
  companyCity!: string;

  @IsOptional()
  @IsString()
  companyTown?: string;

  @IsString()
  @IsNotEmpty({ message: 'companyAddressLine is required.' })
  companyAddressLine!: string;

  @IsOptional()
  @IsString()
  companyBuilding?: string;
}
