import { IsString, MinLength } from 'class-validator';

export class AcceptTeamInviteSignupDto {
  @IsString()
  @MinLength(32)
  token: string;

  @IsString()
  @MinLength(8)
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
