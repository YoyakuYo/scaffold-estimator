import { IsString, IsDateString, IsEnum, IsUUID } from 'class-validator';
import { StructureType } from '../../drawing/drawing.entity';

export class CreateEstimateDto {
  @IsUUID()
  drawingId: string;

  @IsUUID()
  projectId: string;

  @IsEnum(['改修工事', 'S造', 'RC造'])
  structureType: StructureType;

  @IsDateString()
  rentalStartDate: string;

  @IsDateString()
  rentalEndDate: string;

  @IsEnum(['weekly', 'monthly', 'custom'])
  rentalType: 'weekly' | 'monthly' | 'custom';
}
