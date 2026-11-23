import { Allow, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ViewConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsObject()
  fv?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tab?: string;

  @IsOptional()
  sort?: { key?: string; dir?: 1 | -1 } | null;

  @IsOptional()
  hiddenColumns?: string[];

  @IsOptional()
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  where?: string;

  @IsOptional()
  groupBy?: string[];
}

export class CreateViewDto {
  @IsString()
  @MaxLength(80)
  entity!: string;

  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsIn(['private', 'team'])
  visibility?: 'private' | 'team';

  @IsOptional()
  @Allow()
  config?: unknown;
}

export class UpdateViewDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(['private', 'team'])
  visibility?: 'private' | 'team';

  @IsOptional()
  @Allow()
  config?: unknown;
}
