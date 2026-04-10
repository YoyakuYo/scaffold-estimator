import { IsString, MinLength } from 'class-validator';
import { PASSWORD_POLICY_MIN_LENGTH } from '../password-policy';

export class AcceptTeamInviteSignupDto {
  @IsString()
  @MinLength(32)
  token: string;

  @IsString()
  @MinLength(PASSWORD_POLICY_MIN_LENGTH)
  password: string;

  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;
}

export class AcceptTeamInviteSessionDto {
  @IsString()
  @MinLength(32)
  token: string;
}
