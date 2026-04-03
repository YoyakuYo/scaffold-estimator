import { IsEmail, IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordWithTokenDto {
  @IsString()
  @MinLength(20)
  token: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}
