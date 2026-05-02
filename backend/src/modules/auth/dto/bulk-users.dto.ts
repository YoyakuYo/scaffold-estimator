import { IsArray, IsUUID } from 'class-validator';
import { ApproveUserDto } from './approve-user.dto';

export class BulkApproveBodyDto extends ApproveUserDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];
}

export class BulkRejectBodyDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];
}
