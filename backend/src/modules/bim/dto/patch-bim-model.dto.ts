import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchBimModelDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;
}
