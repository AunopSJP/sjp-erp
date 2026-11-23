import { Allow, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { FieldDefInput } from './entities.js';

export class EntityDto {
  @IsString()
  @MaxLength(80)
  key!: string;

  @IsString()
  @MaxLength(160)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  resource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cols?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filters?: string[];

  @IsOptional()
  @IsArray()
  fields?: FieldDefInput[];

  @IsOptional()
  @IsBoolean()
  scoped?: boolean;

  @IsOptional()
  @IsBoolean()
  custom?: boolean;

  @IsOptional()
  @IsBoolean()
  system?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  navLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: 'draft' | 'published' | 'archived';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[];
}

export class CreateFieldDto {
  @IsObject()
  field!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  confirmRequired?: boolean;

  @IsOptional()
  @IsObject()
  backlink?: { entity?: string; key?: string; label?: string; multiple?: boolean };
}

export class UpdateFieldDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  type?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  /** Required when a type change would clear values that cannot be converted. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsArray()
  optionMeta?: Record<string, unknown>[];
}

export class RenameFieldDto {
  @IsString()
  @MaxLength(80)
  from!: string;

  @IsString()
  @MaxLength(80)
  to!: string;
}

export class WorkflowDto {
  @Allow()
  statuses?: unknown;

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  @Allow()
  limits?: unknown;

  @Allow()
  steps?: unknown;
}

export class ListsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  teams?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  depts?: string[];
}

export class RoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['all', 'dept', 'team', 'project', 'site', 'own'])
  scope?: string;

  @IsOptional()
  @IsObject()
  perms?: Record<string, Record<string, boolean>>;
}
