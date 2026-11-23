import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class TicketCreateDto {
  @IsOptional() @IsString() @MaxLength(240) title?: string;
  @IsOptional() @IsString() @MaxLength(160) reportedBy?: string;
  @IsOptional() @IsString() @MaxLength(40) channel?: string;
  @IsOptional() @IsString() @MaxLength(40) receivedAt?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() project?: string;
  @IsOptional() @IsString() site?: string;
  @IsOptional() @IsString() @MaxLength(240) point?: string;
  @IsOptional() @IsString() @MaxLength(120) circuitNo?: string;
  @IsOptional() @IsString() item?: string;
  @IsOptional() @IsString() serial?: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MaxLength(40) priority?: string;
  @IsOptional() @IsString() @MaxLength(10000) symptom?: string;
  @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @IsOptional() @IsString() @MaxLength(10000) initialFinding?: string;
  @IsOptional() @IsString() @MaxLength(10000) cause?: string;
  @IsOptional() @IsString() @MaxLength(10000) resolution?: string;
  @IsOptional() @IsString() @MaxLength(10000) remarks?: string;
  @IsOptional() @IsString() @MaxLength(120) team?: string;
  @IsOptional() @IsString() assignee?: string | null;
  @Allow() attachments?: unknown;
}

export class ProjectCreateDto {
  @IsOptional() @IsString() @MaxLength(240) name?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() @MaxLength(80) type?: string;
  @IsOptional() @IsString() @MaxLength(60) track?: string;
  @IsOptional() @IsString() site?: string;
  @IsOptional() @IsString() manager?: string;
  @IsOptional() @IsString() @MaxLength(120) team?: string;
  @IsOptional() @IsString() @MaxLength(120) contractNo?: string;
  @IsOptional() @IsString() @MaxLength(120) poNo?: string;
  @IsOptional() @IsString() @MaxLength(40) contractStart?: string;
  @IsOptional() @IsString() @MaxLength(40) contractEnd?: string;
  @IsOptional() @Type(() => Number) @IsNumber() sharePercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber() value?: number;
  @Allow() boq?: unknown;
  @IsOptional() @IsString() @MaxLength(10000) note?: string;
}

export class TicketStatusDto {
  @IsString()
  @MaxLength(40)
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}

export class TicketAssignDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  team?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  assignee?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class TicketNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;

  @IsString()
  @MaxLength(10000)
  text!: string;
}

export class AppointmentResolveDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  result?: string;
}

export class AppointmentDto {
  @IsString()
  @MaxLength(20)
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tech?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class PoStatusDto {
  @IsString()
  @MaxLength(40)
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class PoReceiveLineDto {
  @IsString()
  item!: string;

  @Type(() => Number)
  @IsNumber()
  qty!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNos?: string[];
}

export class PoReceiveDto {
  @IsString()
  warehouse!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoReceiveLineDto)
  lines!: PoReceiveLineDto[];
}

export class StockMoveDto {
  @IsString()
  @MaxLength(20)
  type!: string;

  @IsString()
  item!: string;

  @Type(() => Number)
  @IsNumber()
  qty!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serials?: string[];

  @IsOptional()
  @IsString()
  from?: string | null;

  @IsOptional()
  @IsString()
  to?: string | null;

  @IsOptional()
  @IsString()
  project?: string | null;

  @IsOptional()
  @IsString()
  site?: string | null;

  @IsOptional()
  @IsString()
  ticket?: string | null;

  @IsOptional()
  @IsString()
  po?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipient?: string;

  @Allow()
  evidence?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  date?: string;
}

export class StockReceiveDto {
  @IsString()
  item!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  qty?: number;

  @IsString()
  to!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNos?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipient?: string;

  @Allow()
  evidence?: unknown;
}

export class PmGenerateDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  upTo?: string;
}

export class PmSaveDto {
  @Allow()
  results?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @IsOptional()
  @IsBoolean()
  finish?: boolean;
}

export class PmTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @Allow()
  items?: unknown;
}

export class ApprovalDecisionDto {
  @IsOptional()
  @IsBoolean()
  approve?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
