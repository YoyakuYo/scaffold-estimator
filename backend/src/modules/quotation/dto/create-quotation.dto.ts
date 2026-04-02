import { IsString, IsDateString, IsEnum, IsOptional, IsObject, IsNumber, Min, Max } from 'class-validator';

/** Optional per-line rental cost amounts (yen) keyed by cost item code from quotation_cost_items. */
export class CreateQuotationDto {
  @IsString()
  configId: string;

  @IsString()
  projectId: string;

  @IsDateString()
  rentalStartDate: string;

  @IsDateString()
  rentalEndDate: string;

  @IsEnum(['monthly', 'weekly', 'custom'])
  rentalType: string;

  /** When set, these amounts replace formula results for each rental cost line (e.g. basic_material, transportation). */
  @IsOptional()
  @IsObject()
  rentalCostAmounts?: Record<string, number>;

  /** Consumption tax rate applied to (material + rental costs) subtotal. Default 10. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRatePercent?: number;
}
