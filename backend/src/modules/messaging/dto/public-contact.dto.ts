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

  /** Honeypot for bots — must remain empty. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;
}
