import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PublicContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsString()
  @MinLength(5)
  @MaxLength(8000)
  message: string;

  /**
   * Honeypot — must remain empty. Do not use `company`; browsers/password managers
   * autofill that and submissions were silently dropped as "bots".
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  hp?: string;
}
