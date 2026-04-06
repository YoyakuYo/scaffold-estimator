import { IsString, MaxLength, MinLength, IsUUID } from 'class-validator';

export class AdminStartConversationDto {
  @IsUUID()
  userId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body: string;
}
