import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateQuantityDto {
  @IsNumber()
  @Min(0)
  adjustedQuantity: number;

  @IsOptional()
  @IsString()
  adjustmentReason?: string;
}
