import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStructuralProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class PatchStructuralModelDto {
  /** Full model JSON (gridX, gridY, storeys, members). */
  @IsString()
  @MinLength(2)
  modelJson!: string;
}

export class ImportMembersCsvDto {
  @IsString()
  @MinLength(2)
  csvText!: string;
}
