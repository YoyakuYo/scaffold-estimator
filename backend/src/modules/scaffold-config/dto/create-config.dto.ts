import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
  IsDateString,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

/** A single straight segment of a wall face (for stepped/L-shaped walls). */
export class WallSegmentDto {
  @IsNumber()
  @Min(600)
  lengthMm: number;

  @IsNumber()
  offsetMm: number;
}

export class WallInputDto {
  @IsString()
  side: string; // Can be 'north' | 'south' | 'east' | 'west' or arbitrary edge names for complex polygons

  @IsNumber()
  @Min(600)
  wallLengthMm: number;

  @IsNumber()
  @Min(1000)
  @Max(200000)
  wallHeightMm: number;

  @IsNumber()
  @Min(0)
  @Max(10)
  stairAccessCount: number;

  /** Number of kaidan accesses (optional, replaces stairAccessCount when provided) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(4)
  kaidanCount?: number;

  /** Array of kaidan positions in mm from left end of wall (optional) */
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  kaidanOffsets?: number[];

  /** Multi-segment wall definition (optional, for stepped/L-shaped walls) */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WallSegmentDto)
  segments?: WallSegmentDto[];
}

export class CreateScaffoldConfigDto {
  @IsString()
  projectId: string;

  @IsOptional()
  @IsString()
  drawingId?: string;

  @IsEnum(['auto', 'manual'])
  mode: 'auto' | 'manual';

  /** Scaffold type: kusabi (くさび式) or wakugumi (枠組) */
  @IsOptional()
  @IsEnum(['kusabi', 'wakugumi'])
  scaffoldType?: 'kusabi' | 'wakugumi';

  /** Construction pattern: 改修工事 (most complex), S造 (medium), RC造 (simplest) */
  @IsOptional()
  @IsEnum(['改修工事', 'S造', 'RC造'])
  structureType?: '改修工事' | 'S造' | 'RC造';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WallInputDto)
  walls: WallInputDto[];

  /** Scaffold width (front↔back): 600, 900, 1200 */
  @IsNumber()
  scaffoldWidthMm: number;

  /** Preferred main tateji: 1800, 2700, 3600 (kusabi only) */
  @IsOptional()
  @IsNumber()
  preferredMainTatejiMm?: number;

  /** Top guard post height: 900, 1350, 1800 (kusabi only) */
  @IsOptional()
  @IsNumber()
  topGuardHeightMm?: number;

  /** Frame size: 1700, 1800, 1900mm (wakugumi only) */
  @IsOptional()
  @IsNumber()
  frameSizeMm?: number;

  /** Habaki count per span: 1 or 2 (wakugumi only) */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(2)
  habakiCountPerSpan?: number;

  /** End stopper type: 'nuno' or 'frame' (wakugumi only) */
  @IsOptional()
  @IsEnum(['nuno', 'frame'])
  endStopperType?: 'nuno' | 'frame';

  /** Optional: Rental period type */
  @IsOptional()
  @IsEnum(['weekly', 'monthly', 'custom'])
  rentalType?: 'weekly' | 'monthly' | 'custom';

  /** Optional: Rental start date */
  @IsOptional()
  @IsDateString()
  rentalStartDate?: string;

  /** Optional: Rental end date */
  @IsOptional()
  @IsDateString()
  rentalEndDate?: string;

  /** Optional: Building outline polygon (for reference, not used in calculation) */
  @IsOptional()
  @IsArray()
  buildingOutline?: Array<{ xFrac: number; yFrac: number }>;
}
