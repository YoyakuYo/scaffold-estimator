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
import { STRUCTURAL_ELEMENT_TYPES, type StructuralElementType, DRAWING_KINDS, type DrawingKind } from '../element-types';

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
    grid?: string | null;
    notes?: string | null;
  }>;
}

export class DeleteElementDto {
  @IsString()
  id!: string;
}

export const ELEMENT_TYPES = STRUCTURAL_ELEMENT_TYPES;
