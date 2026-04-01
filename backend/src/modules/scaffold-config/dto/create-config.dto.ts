import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MaxLength,
  IsDateString,
  ValidateIf,
  IsEmail,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EdgeHashiraLabelingDto } from './patch-result-labels.dto';

/** Per-upload façade colors sampled from BIM/render image (stored in calculationResult for 3D view). */
export class BimFacadeColorsDto {
  @IsString()
  lowerHex: string;

  @IsString()
  upperHex: string;

  @IsString()
  roofHex: string;

  @IsOptional()
  @IsString()
  windowHex?: string;

  @IsOptional()
  @IsString()
  sillHex?: string;
}

export class BuildingMassingTierDto {
  @IsArray()
  vertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>;

  @IsNumber()
  @Min(1000)
  topHeightMm: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseHeightMm?: number;
}

/** A single straight segment of a wall face (for stepped/L-shaped walls). */
export class WallSegmentDto {
  @IsNumber()
  @Min(600)
  lengthMm: number;

  @IsNumber()
  offsetMm: number;
}

/** Per-wall scaffold width (600/900/1200). When set, overrides global scaffoldWidthMm for this wall. */
export const SCAFFOLD_WIDTH_OPTIONS = [600, 900, 1200] as const;

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

  /** Per-wall scaffold width (600/900/1200). Overrides global scaffoldWidthMm for this wall. */
  @IsOptional()
  @IsNumber()
  @Min(600)
  @Max(1200)
  scaffoldWidthMm?: number;

  /** Base elevation (mm) for tier-aware scaffold on stepped/setback buildings. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseHeightMm?: number;

  /** Group identifier linking walls that belong to the same building side across tiers. */
  @IsOptional()
  @IsString()
  tierGroup?: string;

  /** Zero-based tier index within the group (0 = ground tier). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  tierIndex?: number;
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

  /** Scaffold width (front↔back): 600, 900, 1200. Used when widthBySide not set. */
  @IsNumber()
  scaffoldWidthMm: number;

  /** Distance from building wall to nearest posts (mm). 250–500 so scaffold can breathe. */
  @IsOptional()
  @IsNumber()
  @Min(250)
  @Max(500)
  wallStandoffMm?: number;

  /** Per-side scaffold width (mm). e.g. { north: 900, south: 600 }. Overrides scaffoldWidthMm for matching sides. */
  @IsOptional()
  widthBySide?: Record<string, number>;

  /** Preferred main tateji: 1800, 2700, 3600 (kusabi only) */
  @IsOptional()
  @IsNumber()
  preferredMainTatejiMm?: number;

  /** Top guard post height: 900, 1350, 1800 (kusabi only) */
  @IsOptional()
  @IsNumber()
  topGuardHeightMm?: number;

  /** Frame height: 1700mm (FT-17) for wakugumi; ignored for kusabi when omitted */
  @IsOptional()
  @IsNumber()
  frameSizeMm?: number;

  /** Wakugumi frame product line: FT-617 / FT-917 / FT-1217 (sets layout width 600/900/1200) */
  @IsOptional()
  @IsEnum(['FT617', 'FT917', 'FT1217'])
  wakugumiFrameSeries?: 'FT617' | 'FT917' | 'FT1217';

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

  /** Optional: Number of corners that need pattanko (non-L-shaped). When omitted, PATTANKO is not counted. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  pattankoCornerCount?: number;

  /** Optional: Building outline polygon (for reference, not used in calculation) */
  @IsOptional()
  @IsArray()
  buildingOutline?: Array<{ xFrac: number; yFrac: number }>;

  /** Optional: stacked building mass tiers for stepped/setback 3D preview. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildingMassingTierDto)
  massingTiers?: BuildingMassingTierDto[];

  /** Optional: Detected balconies / AC areas / pillars from vision (for Buragetto / clearance) */
  @IsOptional()
  @IsArray()
  obstacles?: Array<
    | {
        type: 'balcony' | 'ac';
        vertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>;
      }
    | {
        type: 'pillar';
        center: { x?: number; y?: number; xFrac?: number; yFrac?: number };
        radiusMm: number;
      }
    | {
        type: 'door';
        wallIndex?: number;
        positionMm?: number;
        widthMm?: number;
      }
  >;

  /** Optional: URL to stored IFC file for 3D rendering in frontend */
  @IsOptional()
  ifcFileUrl?: string;

  /** Optional: façade colors extracted client-side from uploaded render (persisted on calculationResult). */
  @IsOptional()
  @ValidateNested()
  @Type(() => BimFacadeColorsDto)
  bimFacadeColors?: BimFacadeColorsDto;

  /** Optional: plan X/Y hashira numbering from estimator (persisted on calculationResult). */
  @IsOptional()
  @ValidateNested()
  @Type(() => EdgeHashiraLabelingDto)
  edgeHashiraLabeling?: EdgeHashiraLabelingDto;

  /** Optional: job site / project name */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  siteName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  siteAddress?: string;

  @IsOptional()
  @ValidateIf((o) => o.siteEmail != null && String(o.siteEmail).trim() !== '')
  @IsEmail()
  @MaxLength(255)
  siteEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sitePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  siteFax?: string;
}
