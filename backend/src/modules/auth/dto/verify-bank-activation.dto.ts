import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyBankActivationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;
}
