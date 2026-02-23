import { IsNumber, IsOptional, IsBoolean, IsString } from 'class-validator';

export class UpdateCostLineItemDto {
  @IsOptional()
  @IsNumber()
  userEditedValue?: number;

  @IsOptional()
  @IsBoolean()
  isLocked?: boolean;

  @IsOptional()
  @IsString()
  editReason?: string;
}
