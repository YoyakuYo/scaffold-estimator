import { IsString, IsOptional, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  @IsEnum(['user', 'assistant', 'system'])
  role: 'user' | 'assistant' | 'system';

  @IsString()
  content: string;
}

export class ChatRequestDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @IsOptional()
  @IsString()
  currentConfigId?: string;
}

export class VisionAnalyzeDto {
  @IsString()
  image: string; // base64 encoded image

  @IsOptional()
  @IsString()
  mimeType?: string;
}

export class AnomalyDetectDto {
  @IsString()
  configId: string;
}
