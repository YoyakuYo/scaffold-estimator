import { IsOptional, IsString } from 'class-validator';

/** PATCH site/contact only — no recalculation. */
export class PatchSiteContactDto {
  @IsOptional()
  @IsString()
  siteName?: string;

  @IsOptional()
  @IsString()
  siteAddress?: string;

  @IsOptional()
  @IsString()
  siteEmail?: string;

  @IsOptional()
  @IsString()
  sitePhone?: string;

  @IsOptional()
  @IsString()
  siteFax?: string;
}
