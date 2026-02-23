import { IsString, IsNumber, IsOptional } from 'class-validator';

export class UpdateBOMDto {
  @IsString()
  componentId: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
