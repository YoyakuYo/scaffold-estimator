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
   * Honeypot — must remain empty (current landing form).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  hp?: string;

  /**
   * Legacy key from older clients / some browsers still POST it. Autofill often fills
   * "organization" as company (e.g. "BarberSow") — not used for spam checks; ignored
   * so `forbidNonWhitelisted` does not return 400.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;
}
