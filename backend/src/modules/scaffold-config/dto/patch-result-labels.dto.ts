import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class EdgeHashiraAssignmentDto {
  @IsInt()
  @Min(0)
  wallIndex: number;

  @IsIn(['', 'X', 'Y'])
  axis: '' | 'X' | 'Y';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  labelCount?: number;
}

export class EdgeHashiraLabelingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeHashiraAssignmentDto)
  assignments: EdgeHashiraAssignmentDto[];
}

export class PatchResultLabelsDto {
  @ValidateNested()
  @Type(() => EdgeHashiraLabelingDto)
  edgeHashiraLabeling: EdgeHashiraLabelingDto;
}
