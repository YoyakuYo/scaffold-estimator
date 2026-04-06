import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendTeamChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
