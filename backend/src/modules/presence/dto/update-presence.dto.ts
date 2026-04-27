import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePresenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  label?: string;
}

export class RecordActionDto {
  @IsString()
  @MaxLength(300)
  action!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  label?: string;
}
