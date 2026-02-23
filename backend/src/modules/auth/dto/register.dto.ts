import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterDto {
  // User info
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
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
  @IsEmail()
  companyEmail?: string;
}
