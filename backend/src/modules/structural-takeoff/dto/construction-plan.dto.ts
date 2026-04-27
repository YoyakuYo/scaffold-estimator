import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ArrayMaxSize,
  ArrayUnique,
  MaxLength,
} from 'class-validator';
import {
  STRUCTURAL_ELEMENT_TYPES,
  type StructuralElementType,
  DRAWING_KINDS,
  type DrawingKind,
  type ElementLineKind,
} from '../element-types';

export class CreateProjectDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  siteAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Block (工区) labels in erection order. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  blocks?: string[];

  /** Floor labels in erection order. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  levels?: string[];
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  siteAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  blocks?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  levels?: string[];
}

export class CreateSetDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class PatchClassificationDto {
  @IsOptional()
  @IsIn(DRAWING_KINDS as readonly string[])
  kind?: DrawingKind;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  level?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  block?: string | null;
}

export class UpsertElementsDto {
  @IsArray()
  rows!: Array<{
    id?: string;
    level: string;
    block?: string | null;
    elementType: StructuralElementType;
    label?: string | null;
    section?: string | null;
    qty: number;
    /** Optional single-member length in mm; omit/null to use type default in rollups. */
    pieceLengthMm?: number | null;
    phase?: string | null;
    shop?: string | null;
    lineKind?: ElementLineKind | null;
    extractionConfidence?: number | null;
    needsReview?: boolean | null;
    grid?: string | null;
    notes?: string | null;
  }>;
}

export class ConfirmElementReviewDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

export class DeleteElementDto {
  @IsString()
  id!: string;
}

export const ELEMENT_TYPES = STRUCTURAL_ELEMENT_TYPES;
