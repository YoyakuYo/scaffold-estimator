import { IsString, IsDateString, IsEnum } from 'class-validator';

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
}
