import { IsEmail, IsString, MinLength } from 'class-validator';
import { PASSWORD_POLICY_MIN_LENGTH } from '../password-policy';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordWithTokenDto {
  @IsString()
  @MinLength(20)
  token: string;

  @IsString()
  @MinLength(PASSWORD_POLICY_MIN_LENGTH)
  newPassword: string;
}
