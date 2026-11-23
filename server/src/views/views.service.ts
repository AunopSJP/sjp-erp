import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/database.service.js';
import { savedViews, type SavedViewRow } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from '../common/access.service.js';
import { AuditService } from '../common/audit.service.js';
import { nowIso } from '../common/dates.js';
import { bad, forbidden, notFound } from '../common/exceptions.js';
import { findEntity, type EntityDef } from '../meta/entities.js';
import { compileWhere } from '../records/list-query.js';
import { currentWorkspaceId } from '../common/workspace-context.js';

export type ViewVisibility = 'private' | 'team';

export interface ViewConfig {
  q?: string;
  fv?: Record<string, string>;
  tab?: string;
  sort?: { key: string; dir: 1 | -1 };
  hiddenColumns?: string[];
  pageSize?: number;
  where?: string;
  groupBy?: string[];
  [key: string]: unknown;
}

export interface SavedView {
  id: string;
  entity: string;
  name: string;
  visibility: ViewVisibility;
  ownerId: string;
  ownerName: string;
  config: ViewConfig;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

const MAX_PRIVATE = 50;
const MAX_TEAM = 50;

@Injectable()
export class ViewsService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  list(user: SafeUser, entityKey: string): { items: SavedView[] } {
    const def = this.requireViewable(user, entityKey);
    const rows = this.db.select().from(savedViews)
      .where(and(
        eq(savedViews.entity, def.key),
        eq(savedViews.workspaceId, currentWorkspaceId()),
        sql`(${savedViews.visibility} = 'team' OR ${savedViews.ownerId} = ${user.id})`,
      ))
      .all();
    return { items: rows.map((row) => this.decorate(row, user)).sort((left, right) => {
      if (left.visibility !== right.visibility) return left.visibility === 'team' ? -1 : 1;
      return left.name.localeCompare(right.name, 'th');
    }) };
  }

  create(user: SafeUser, input: { entity: string; name: string; visibility?: string; config?: unknown }): SavedView {
    const def = this.requireViewable(user, input?.entity);
    const visibility = this.visibility(user, input?.visibility);
    const name = this.cleanName(input?.name);
    const config = this.cleanConfig(def, input?.config);
    this.assertUniqueName(def.key, name, visibility, user, '');
    const scope = this.db.select().from(savedViews)
      .where(and(
        eq(savedViews.entity, def.key),
        eq(savedViews.visibility, visibility),
        eq(savedViews.workspaceId, currentWorkspaceId()),
      ))
      .all()
      .filter((row) => visibility === 'team' || row.ownerId === user.id);
    if (scope.length >= (visibility === 'team' ? MAX_TEAM : MAX_PRIVATE)) {
      bad(`บันทึกมุมมองได้สูงสุด ${visibility === 'team' ? MAX_TEAM : MAX_PRIVATE} รายการในชุดข้อมูลนี้`);
    }
    const now = nowIso();
    const row: SavedViewRow = {
      id: randomUUID(),
      workspaceId: currentWorkspaceId(),
      entity: def.key,
      name,
      visibility,
      ownerId: user.id,
      ownerName: user.name,
      config,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(savedViews).values(row).run();
    this.audit.log(user, {
      action: visibility === 'team' ? 'view.share' : 'view.save',
      entity: def.key,
      recordId: row.id,
      recordCode: name,
      summary: `บันทึกมุมมอง "${name}" (${visibility === 'team' ? 'ทีม' : 'เฉพาะฉัน'}) ใน ${def.label}`,
    });
    return this.decorate(row, user);
  }

  update(
    user: SafeUser,
    id: string,
    input: { name?: string; visibility?: string; config?: unknown },
  ): SavedView {
    const row = this.db.select().from(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.workspaceId, currentWorkspaceId()))).all()[0];
    if (!row) notFound('ไม่พบมุมมองที่บันทึก');
    const def = this.requireViewable(user, row.entity);
    this.requireManage(user, row);
    const visibility = input?.visibility === undefined
      ? (row.visibility === 'team' ? 'team' : 'private')
      : this.visibility(user, input.visibility);
    if (visibility !== row.visibility && visibility === 'team') this.requireShare(user);
    const name = input?.name === undefined ? row.name : this.cleanName(input.name);
    const config = input?.config === undefined ? row.config : this.cleanConfig(def, input.config);
    this.assertUniqueName(def.key, name, visibility, user, row.id);
    const next: SavedViewRow = { ...row, name, visibility, config, updatedAt: nowIso() };
    this.db.update(savedViews).set({ name, visibility, config, updatedAt: next.updatedAt })
      .where(eq(savedViews.id, id)).run();
    this.audit.log(user, {
      action: visibility === 'team' ? 'view.share' : 'view.save',
      entity: def.key,
      recordId: id,
      recordCode: name,
      summary: `แก้ไขมุมมอง "${name}" ใน ${def.label}`,
    });
    return this.decorate(next, user);
  }

  remove(user: SafeUser, id: string): { ok: true } {
    const row = this.db.select().from(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.workspaceId, currentWorkspaceId()))).all()[0];
    if (!row) notFound('ไม่พบมุมมองที่บันทึก');
    const def = this.requireViewable(user, row.entity);
    this.requireManage(user, row);
    this.db.delete(savedViews).where(eq(savedViews.id, id)).run();
    this.audit.log(user, {
      action: 'view.delete',
      entity: def.key,
      recordId: id,
      recordCode: row.name,
      summary: `ลบมุมมอง "${row.name}" ใน ${def.label}`,
    });
    return { ok: true };
  }

  private decorate(row: SavedViewRow, user: SafeUser): SavedView {
    return {
      id: row.id,
      entity: row.entity,
      name: row.name,
      visibility: row.visibility === 'team' ? 'team' : 'private',
      ownerId: row.ownerId,
      ownerName: row.ownerName,
      config: row.config as ViewConfig,
      mine: row.ownerId === user.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private requireViewable(user: SafeUser, entityKey: unknown): EntityDef {
    return this.access.requireEntity(user, String(entityKey ?? ''), 'view');
  }

  private canShare(user: SafeUser): boolean {
    return this.access.can(user, 'settings', 'edit');
  }

  private requireShare(user: SafeUser): void {
    if (!this.canShare(user)) forbidden('การแชร์มุมมองให้ทีมต้องได้รับสิทธิ์แก้ไขการตั้งค่า');
  }

  private requireManage(user: SafeUser, row: SavedViewRow): void {
    if (row.ownerId !== user.id && !this.canShare(user)) {
      forbidden('มุมมองนี้เป็นของผู้อื่น ต้องมีสิทธิ์แก้ไขการตั้งค่าจึงจะจัดการได้');
    }
  }

  private visibility(user: SafeUser, raw: unknown): ViewVisibility {
    const value = raw === undefined || raw === null || raw === '' ? 'private' : String(raw);
    if (value !== 'private' && value !== 'team') bad('การมองเห็นของมุมมองไม่ถูกต้อง');
    if (value === 'team') this.requireShare(user);
    return value;
  }

  private cleanName(raw: unknown): string {
    const name = String(raw ?? '').trim();
    if (!name) bad('กรุณาตั้งชื่อมุมมอง');
    if (name.length > 80) bad('ชื่อมุมมองยาวเกิน 80 ตัวอักษร');
    return name;
  }

  private assertUniqueName(
    entity: string,
    name: string,
    visibility: ViewVisibility,
    user: SafeUser,
    excludeId: string,
  ): void {
    const rows = this.db.select().from(savedViews)
      .where(and(
        eq(savedViews.entity, entity),
        eq(savedViews.visibility, visibility),
        eq(savedViews.workspaceId, currentWorkspaceId()),
      ))
      .all();
    const duplicate = rows.some((row) =>
      row.id !== excludeId &&
      (visibility === 'team' || row.ownerId === user.id) &&
      row.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) bad(`ชื่อมุมมอง "${name}" มีอยู่แล้ว`);
  }

  /** Only rendering settings are stored: no record ids, no permissions, no SQL text outside `where`. */
  private cleanConfig(def: EntityDef, raw: unknown): ViewConfig {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) bad('รูปแบบการตั้งค่ามุมมองไม่ถูกต้อง');
    const input = raw as Record<string, unknown>;
    const unknownKeys = Object.keys(input).filter((key) =>
      !['q', 'fv', 'tab', 'sort', 'hiddenColumns', 'pageSize', 'where', 'groupBy'].includes(key));
    if (unknownKeys.length) bad(`การตั้งค่ามุมมองมีคีย์ที่ไม่รองรับ: ${unknownKeys.slice(0, 3).join(', ')}`);
    const allowed = this.allowedFields(def);
    const config: ViewConfig = {};
    if (input['q'] !== undefined) {
      if (typeof input['q'] !== 'string' || input['q'].length > 200) bad('คำค้นของมุมมองยาวเกิน 200 ตัวอักษร');
      config.q = input['q'];
    }
    if (input['fv'] !== undefined) {
      if (typeof input['fv'] !== 'object' || input['fv'] === null || Array.isArray(input['fv'])) bad('ตัวกรองของมุมมองไม่ถูกต้อง');
      const fv: Record<string, string> = {};
      const entries = Object.entries(input['fv'] as Record<string, unknown>);
      if (entries.length > 40) bad('ตัวกรองของมุมมองมีรายการมากเกินไป');
      for (const [key, value] of entries) {
        if (!allowed.has(key)) bad(`ตัวกรองอ้างฟิลด์ "${key}" ที่ไม่มีในชุดข้อมูลนี้`);
        if (typeof value !== 'string' || value.length > 200) bad(`ค่าตัวกรองของ "${key}" ไม่ถูกต้อง`);
        fv[key] = value;
      }
      config.fv = fv;
    }
    if (input['tab'] !== undefined) {
      if (typeof input['tab'] !== 'string' || input['tab'].length > 40) bad('แท็บของมุมมองไม่ถูกต้อง');
      config.tab = input['tab'];
    }
    if (input['sort'] !== undefined) {
      if (input['sort'] === null) {
        config.sort = { key: '', dir: 1 };
      } else {
        const sort = input['sort'] as Record<string, unknown>;
        if (typeof sort !== 'object' || Array.isArray(sort)) bad('การเรียงของมุมมองไม่ถูกต้อง');
        const key = typeof sort['key'] === 'string' ? sort['key'] : '';
        if (key && !allowed.has(key)) bad(`การเรียงอ้างฟิลด์ "${key}" ที่ไม่มีในชุดข้อมูลนี้`);
        if (sort['dir'] !== undefined && sort['dir'] !== 1 && sort['dir'] !== -1) bad('ทิศทางการเรียงไม่ถูกต้อง');
        config.sort = { key, dir: sort['dir'] === -1 ? -1 : 1 };
      }
    }
    if (input['hiddenColumns'] !== undefined) {
      if (!Array.isArray(input['hiddenColumns']) || input['hiddenColumns'].length > 60) bad('รายการคอลัมน์ที่ซ่อนไม่ถูกต้อง');
      const hidden: string[] = [];
      for (const column of input['hiddenColumns']) {
        if (typeof column !== 'string' || !allowed.has(column)) bad(`คอลัมน์ที่ซ่อน "${String(column)}" ไม่มีในชุดข้อมูลนี้`);
        if (!hidden.includes(column)) hidden.push(column);
      }
      config.hiddenColumns = hidden;
    }
    if (input['pageSize'] !== undefined) {
      const size = Number(input['pageSize']);
      if (!Number.isFinite(size) || size < 10 || size > 100 || Math.trunc(size) !== size) bad('จำนวนต่อหน้าต้องอยู่ระหว่าง 10–100');
      config.pageSize = size;
    }
    if (input['groupBy'] !== undefined) {
      if (!Array.isArray(input['groupBy']) || input['groupBy'].length > 2) bad('จัดกลุ่มได้สูงสุด 2 ระดับ');
      const groups: string[] = [];
      for (const field of input['groupBy']) {
        if (typeof field !== 'string' || !allowed.has(field)) bad(`จัดกลุ่มด้วยฟิลด์ "${String(field)}" ไม่ได้`);
        if (!groups.includes(field)) groups.push(field);
      }
      config.groupBy = groups;
    }
    if (input['where'] !== undefined) {
      if (typeof input['where'] !== 'string' || input['where'].length > 20_000) bad('เงื่อนไขตัวกรองของมุมมองไม่ถูกต้อง');
      if (input['where']) {
        try {
          compileWhere(input['where'], (key) => {
            if (!allowed.has(key)) bad(`เงื่อนไขอ้างฟิลด์ "${key}" ที่ไม่มีในชุดข้อมูลนี้`);
            return sql`1`;
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes('ไม่มีในชุดข้อมูลนี้')) throw error;
          bad('เงื่อนไขตัวกรองของมุมมองไม่ถูกต้อง');
        }
      }
      config.where = input['where'];
    }
    return config;
  }

  private allowedFields(def: EntityDef): Set<string> {
    const allowed = new Set(['code', 'status', 'stepLabel', '_createdAt', '_updatedAt']);
    for (const field of def.fields) {
      if (!field.sensitive) allowed.add(field.key);
    }
    if (def.key === 'purchaseOrders') allowed.add('amount');
    return allowed;
  }
}
