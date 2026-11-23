import { InjectDrizzle } from '@nestjs/drizzle';
import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/database.service.js';
import { counters, records, users } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from '../common/access.service.js';
import { ApprovalStoreService } from '../common/approvals.service.js';
import { AuditService } from '../common/audit.service.js';
import { nowIso, isDateOnly } from '../common/dates.js';
import { FieldValidationError, bad, notFound } from '../common/exceptions.js';
import { EventsService } from '../events/events.service.js';
import { currentWorkspaceId } from '../common/workspace-context.js';
import { getEntity, findEntity, ENTITY_DEFS, LISTS, projectSteps, ENTITY_WORKFLOW_KEY, WORKFLOWS, type EntityDef, type FieldDef } from '../meta/entities.js';

import { compileWhere, type ListQuery } from './list-query.js';

export interface CreateOptions {
  system?: boolean;
  actor?: SafeUser | null;
  systemFields?: Record<string, unknown>;
  summary?: string;
}

export interface UpdateOptions {
  system?: boolean;
  actor?: SafeUser | null;
  summary?: string;
  changes?: unknown[];
  expectedUpdatedAt?: string;
}

export type RawRecord = typeof records.$inferSelect;

export interface GroupSummary {
  keys: (string | number | boolean | null)[];
  count: number;
  totals: Record<string, number>;
}
export type DecoratedRecord = Record<string, unknown> & {
  id: string;
  code: string;
  _createdAt: string;
  _updatedAt: string;
  _deleted: boolean;
  _labels: Record<string, string>;
  _rowLabels: Record<string, Array<Record<string, string>>>;
};

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/**
 * System entities keep their structure locked, but these ones are ordinary
 * business records that users still create and edit from the UI.
 */
const SYSTEM_RECORD_CRUD = new Set(['vehicles', 'vehicleBookings']);

/** Fields that represent assignment; changing them requires the resource's `assign` action. */
const ASSIGN_FIELDS: Record<string, string[]> = {
  tickets: ['assignee', 'team'],
  projects: ['manager', 'team'],
};

/** Entities whose final workflow state must not be edited through the generic record endpoints. */
const FINAL_LOCKED_ENTITIES = new Set(['tickets', 'projects', 'purchaseOrders', 'invoices', 'expenses']);

/** Purchase-order fields that are frozen once the document leaves draft. */
const PO_LOCKED_FIELDS = ['vendor', 'project', 'orderDate', 'dueDate', 'lines'];
const PO_LOCKED_STATUSES = ['ordered', 'partial', 'received', 'closed', 'cancelled'];

@Injectable()
export class RecordsService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalStoreService,
    private readonly events: EventsService,
  ) {}

  // ---------- reads ----------

  all(user: SafeUser, entityKey: string, options: { includeDeleted?: boolean } = {}): DecoratedRecord[] {
    const def = this.access.requireEntity(user, entityKey, 'view');
    return this.rawScoped(def, user, options.includeDeleted ?? false).map((row) => this.decorate(def, row, user));
  }

  rawAll(entityKey: string, includeDeleted = false): RawRecord[] {
    const def = getEntity(entityKey);
    if (!def) notFound('ไม่พบชนิดข้อมูล');
    const where = includeDeleted
      ? and(eq(records.entity, entityKey), eq(records.workspaceId, currentWorkspaceId()))
      : and(eq(records.entity, entityKey), eq(records.deleted, false), eq(records.workspaceId, currentWorkspaceId()));
    return this.db.select().from(records).where(where).all();
  }

  rawGet(entityKey: string, id: string): RawRecord | undefined {
    return this.db
      .select()
      .from(records)
      .where(and(
        eq(records.entity, entityKey),
        eq(records.id, id),
        eq(records.workspaceId, currentWorkspaceId()),
      ))
      .all()[0];
  }

  purchaseReceipts(orderIds: string[]): RawRecord[] {
    if (!orderIds.length) return [];
    return this.db.select().from(records).where(and(
      eq(records.entity, 'stockMoves'),
      eq(records.deleted, false),
      eq(records.workspaceId, currentWorkspaceId()),
      sql`json_extract(${records.data}, '$.type') = 'receive'`,
      inArray(sql`json_extract(${records.data}, '$.po')`, orderIds),
    )).all();
  }

  list(user: SafeUser, entityKey: string, query: ListQuery = {}) {
    const def = this.access.requireEntity(user, entityKey, 'view');
    return this.listFromSql(def, query, user, this.scopeCondition(def, user));
  }

  /** Translate the row-level scope rules into a SQL predicate. */
  private scopeCondition(
    def: EntityDef,
    user: SafeUser,
    table: { data: AnySQLiteColumn; id: AnySQLiteColumn; createdBy: AnySQLiteColumn } = records,
  ): SQL | undefined {
    if (user.isAdmin || user.scope === 'all' || !def.scoped) return undefined;
    const data = table.data;
    const mine = sql`(json_extract(${data}, '$.assignee') = ${user.id} OR json_extract(${data}, '$.manager') = ${user.id} OR ${table.createdBy} = ${user.id})`;
    let scope: SQL;
    switch (user.scope) {
      case 'own':
        return mine;
      case 'team':
        if (!user.team) return sql`1 = 0`;
        scope = sql`(json_extract(${data}, '$.team') = ${user.team})`;
        break;
      case 'dept':
        if (!user.dept) return sql`1 = 0`;
        scope = sql`(COALESCE(NULLIF(json_extract(${data}, '$.assignee'), ''), NULLIF(json_extract(${data}, '$.manager'), ''), ${table.createdBy}) IN (SELECT id FROM users WHERE dept = ${user.dept}))`;
        break;
      case 'project': {
        const ids = user.projectIds ?? [];
        if (!ids.length) return sql`1 = 0`;
        scope = def.key === 'projects' ? inArray(table.id, ids) : inArray(sql`json_extract(${data}, '$.project')`, ids);
        break;
      }
      case 'site': {
        const ids = user.siteIds ?? [];
        if (!ids.length) return sql`1 = 0`;
        scope = def.key === 'sites' ? inArray(table.id, ids) : inArray(sql`json_extract(${data}, '$.site')`, ids);
        break;
      }
      default:
        return sql`1 = 0`;
    }
    return sql`(${mine} OR ${scope})`;
  }

  private listFromSql(def: EntityDef, query: ListQuery, user: SafeUser, scope?: SQL) {
    const allowed = new Set(['code', 'status', 'stepLabel', '_createdAt', '_updatedAt', ...def.filters, ...def.cols, ...def.fields.map((field) => field.key)]);
    for (const field of def.fields) if (field.sensitive) allowed.delete(field.key);
    const field = (key: string): SQL => {
      if (key === 'amount' && def.key === 'purchaseOrders') {
        return sql`COALESCE((SELECT sum(json_extract(value, '$.qty') * json_extract(value, '$.unitPrice'))
          FROM json_each(${records.data}, '$.lines')), 0)`;
      }
      if (!allowed.has(key)) bad('ฟิลด์กรองหรือเรียงไม่พร้อมใช้งาน กรุณาปรับมุมมอง');
      switch (key) {
        case 'code': return sql`${records.code}`;
        case '_createdAt': return sql`${records.createdAt}`;
        case '_updatedAt': return sql`${records.updatedAt}`;
        default: return sql`json_extract(${records.data}, ${'$.' + key})`;
      }
    };
    const conditions: SQL[] = [
      eq(records.entity, def.key),
      eq(records.deleted, false),
      eq(records.workspaceId, currentWorkspaceId()),
    ];
    if (scope) conditions.push(scope);
    const specOf = (key: string): FieldDef | undefined => def.fields.find((item) => item.key === key);
    const multipleFields = new Set(def.fields.filter((item) => item.type === 'ref' && item.multiple).map((item) => item.key));
    for (const [key, value] of Object.entries(query.filters ?? {})) {
      const column = field(key);
      if (value === undefined || value === '') continue;
      if (multipleFields.has(key)) {
        conditions.push(sql`EXISTS (SELECT 1 FROM json_each(${records.data}, ${'$.' + key}) WHERE value = ${String(value)})`);
      } else {
        conditions.push(sql`CAST(${column} AS TEXT) = ${String(value)}`);
      }
    }
    if (query.where) conditions.push(compileWhere(query.where, field, (key) => multipleFields.has(key)));
    const search = (query.search ?? '').trim().slice(0, 250);
    if (search) {
      const includes = (column: SQL) => sql`instr(lower(CAST(${column} AS TEXT)), lower(${search})) > 0`;
      const parts: SQL[] = [includes(sql`${records.code}`)];
      for (const spec of def.fields) {
        if (!allowed.has(spec.key) || spec.hidden || ['section', 'formula', 'rows', 'file'].includes(spec.type)) continue;
        const value = field(spec.key);
        if (spec.type !== 'ref' || !spec.ref) {
          parts.push(includes(value));
          continue;
        }
        if (spec.ref === 'users') {
          if (this.access.canPickUsers(user)) parts.push(sql`EXISTS (SELECT 1 FROM users u WHERE u.active = 1 AND u.id = ${value} AND ${includes(sql`u.name`)})`);
        } else {
          const refDef = findEntity(spec.ref);
          if (!refDef || (def.custom && !this.access.canEntity(user, refDef.key, 'view'))) continue;
          const target = alias(records, 'related_record');
          const title = refDef.fields.find((candidate) => candidate.key === (spec.displayField ?? refDef.title));
          const matchCode = includes(sql`${target.code}`);
          const matchTitle = title && !title.sensitive
            ? includes(sql`json_extract(${target.data}, ${'$.' + title.key})`) : sql`0 = 1`;
          const relatedIds = this.db.select({ id: target.id }).from(target).where(and(
            eq(target.entity, refDef.key), eq(target.deleted, false),
            eq(target.workspaceId, currentWorkspaceId()),
            this.scopeCondition(refDef, user, target), sql`(${matchCode} OR ${matchTitle})`,
          ));
          if (spec.multiple) {
            parts.push(sql`EXISTS (SELECT 1 FROM json_each(${records.data}, ${'$.' + spec.key}) je
              WHERE je.value IN (${relatedIds.getSQL()}))`);
          } else {
            parts.push(sql`${value} IN (${relatedIds.getSQL()})`);
          }
        }
      }
      conditions.push(sql`(${sql.join(parts, sql` OR `)})`);
    }
    const where = and(...conditions);
    const total = Number(this.db.select({ value: sql<number>`count(*)` }).from(records).where(where).all()[0]?.value ?? 0);
    const pageSize = Math.min(Math.max(Math.trunc(Number(query.pageSize)) || 50, 1), 500);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(Math.trunc(Number(query.page)) || 1, 1), pages);
    const sort = (query.sort || '-_createdAt').split(',');
    if (sort.length > 8) bad('เรียงได้สูงสุด 8 ฟิลด์');
    const order = sort.map((entry) => {
      const expression = sql`NULLIF(${field(entry.replace(/^-/, ''))}, '')`;
      return entry.startsWith('-') ? sql`${expression} DESC NULLS LAST` : sql`${expression} ASC NULLS LAST`;
    });
    const rows = this.db
      .select()
      .from(records)
      .where(where)
      .orderBy(...order, records.id)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();
    const aggregate = this.aggregate(def, where, field, query);
    return {
      total,
      page,
      pageSize,
      items: rows.map((row) => this.decorate(def, row as RawRecord, user)),
      ...aggregate,
    };
  }

  /**
   * Totals and group counts are computed over the whole filtered set, never the
   * current page, so the grid never shows a page subtotal as the dataset total.
   */
  private aggregate(
    def: EntityDef,
    where: SQL | undefined,
    field: (key: string) => SQL,
    query: ListQuery,
  ): { totals: Record<string, number>; groups: GroupSummary[]; groupsTruncated: boolean } {
    const list = (raw: string | undefined): string[] =>
      [...new Set(String(raw ?? '').split(',').map((item) => item.trim()).filter(Boolean))];
    const totalsFields = list(query.totals);
    const groupFields = list(query.groupBy);
    if (totalsFields.length > 5) bad('ยอดรวมได้สูงสุด 5 ฟิลด์');
    if (groupFields.length > 2) bad('จัดกลุ่มได้สูงสุด 2 ระดับ');
    const numeric = (key: string): boolean =>
      (key === 'amount' && def.key === 'purchaseOrders') ||
      def.fields.some((item) => item.key === key && item.type === 'number');
    for (const key of totalsFields) {
      if (!numeric(key)) bad(`ยอดรวมใช้ได้กับฟิลด์ตัวเลขเท่านั้น ("${key}")`);
    }
    for (const key of groupFields) field(key);
    const sums = (keys: string[], aliased: boolean): Record<string, SQL.Aliased<number>> => {
      const out: Record<string, SQL.Aliased<number>> = {};
      for (const key of keys) {
        const name = `sum_${key}`;
        const expression = sql<number>`COALESCE(SUM(CAST(${field(key)} AS REAL)), 0)`;
        out[name] = aliased ? expression.as(name) : expression.as(name);
      }
      return out;
    };
    let totals: Record<string, number> = {};
    if (totalsFields.length) {
      const selected = sums(totalsFields, true);
      const row: unknown = this.db.select(selected).from(records).where(where).all()[0];
      const record = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      totals = Object.fromEntries(totalsFields.map((key) => [key, Number(record[`sum_${key}`] ?? 0)]));
    }
    if (!groupFields.length) return { totals, groups: [], groupsTruncated: false };
    const selected: Record<string, SQL.Aliased<number> | SQL.Aliased<string | null>> = {
      count: sql<number>`count(*)`.as('count'),
      ...sums(totalsFields, true),
    };
    groupFields.forEach((key, index) => {
      selected[`g${index}`] = sql<string | null>`${field(key)}`.as(`g${index}`);
    });
    const grouped = this.db.select(selected).from(records).where(where)
      .groupBy(...groupFields.map((key) => field(key)))
      .orderBy(sql`count(*) DESC`, ...groupFields.map((key) => field(key)))
      .limit(201)
      .all();
    const groups: GroupSummary[] = grouped.slice(0, 200).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        keys: groupFields.map((key, index) => {
          const value = record[`g${index}`];
          if (value === null || value === undefined) return null;
          const type = def.fields.find((item) => item.key === key)?.type;
          if (type === 'boolean') return value === true || value === 1 || value === '1';
          if (type === 'number') return Number(value);
          return String(value);
        }),
        count: Number(record['count'] ?? 0),
        totals: Object.fromEntries(totalsFields.map((key) => [key, Number(record[`sum_${key}`] ?? 0)])),
      };
    });
    return { totals, groups, groupsTruncated: grouped.length > 200 };
  }

  get(user: SafeUser, entityKey: string, id: string): DecoratedRecord {
    const def = this.access.requireEntity(user, entityKey, 'view');
    const row = this.rawGet(entityKey, id);
    if (!row) notFound('ไม่พบรายการ');
    this.access.requireSee(user, def, row);
    return this.decorate(def, row, user);
  }

  rawScoped(def: EntityDef, user: SafeUser, includeDeleted = false): RawRecord[] {
    return this.rawAll(def.key, includeDeleted).filter((row) =>
      includeDeleted ? true : this.access.canSee(user, def, row),
    );
  }

  // ---------- writes ----------

  create(user: SafeUser, entityKey: string, values: Record<string, unknown>, options: CreateOptions = {}): DecoratedRecord {
    const def = getEntity(entityKey);
    if (!def) notFound('ไม่พบชนิดข้อมูล');
    if (!options.system) this.access.requireEntity(user, entityKey, 'create');
    if (def.system && !options.system && !SYSTEM_RECORD_CRUD.has(def.key)) {
      bad('ข้อมูลชนิดนี้สร้างได้จากขั้นตอนของระบบเท่านั้น');
    }

    const data = this.sanitize(def, values);
    this.guardCreate(def, data, options);
    this.guardArchivedOptions(def, {}, data);
    this.guardOptionAccess(def, {}, data, user, !!options.system);
    for (const [key, value] of Object.entries(this.defaultsFor(def))) {
      if (data[key] === undefined || data[key] === '') data[key] = value;
    }
    Object.assign(data, options.systemFields ?? {});
    this.validate(def, data, user, null);
    this.validateBusiness(def, data, null);

    const now = nowIso();
    const code = this.nextCode(def);
    return this.db.transaction(() => {
      const row: typeof records.$inferInsert = {
        id: crypto.randomUUID(),
        workspaceId: currentWorkspaceId(),
        entity: def.key,
        code,
        data,
        deleted: false,
        createdBy: options.actor?.id ?? user?.id ?? null,
        createdAt: now,
        updatedBy: options.actor?.id ?? user?.id ?? null,
        updatedAt: now,
      };
      this.db.insert(records).values(row).run();
      this.syncMirrors(def, row.id, {}, data);
      const decorated = this.decorate(def, row as RawRecord, user);
      this.audit.log(options.actor ?? user, {
        action: 'create',
        entity: def.key,
        recordId: row.id,
        recordCode: code,
        summary: options.summary ?? `สร้าง${def.label} ${code}`,
      });
      this.events.publish({
        type: 'record.created',
        entity: def.key,
        recordId: row.id,
        code,
        actor: options.actor ?? user,
        summary: options.summary ?? `สร้าง${def.label} ${code}`,
        payload: { title: def.title === 'code' ? code : String(decorated[def.title] ?? '') },
      });
      return decorated;
    });
  }

  decideVehicleBooking(user: SafeUser, entityKey: string, id: string, decision: string, note = ''): DecoratedRecord {
    if (entityKey !== 'vehicleBookings') notFound('ไม่พบชนิดข้อมูล');
    const def = this.access.requireEntity(user, 'vehicleBookings', 'approve');
    const row = this.rawGet('vehicleBookings', id);
    if (!row) notFound('ไม่พบรายการ');
    if (row.deleted) bad('รายการนี้ถูกยกเลิก/ซ่อนแล้ว');
    this.access.requireSee(user, def, row);
    const status = decision === 'approve' ? 'อนุมัติแล้ว' : decision === 'reject' ? 'ไม่อนุมัติ' : '';
    if (!status) bad('ผลการพิจารณาไม่ถูกต้อง');
    if (String(row.data['status'] ?? '') !== 'รออนุมัติ') bad('รายการนี้ถูกพิจารณาแล้ว');
    const changes: Record<string, unknown> = { status };
    const reason = note.trim();
    if (reason) {
      const current = String(row.data['note'] ?? '').trim();
      changes['note'] = [current, `[${status}] ${reason}`].filter(Boolean).join('\n');
    }
    return this.update(user, 'vehicleBookings', id, changes, {
      system: true,
      summary: `${status === 'อนุมัติแล้ว' ? 'อนุมัติ' : 'ไม่อนุมัติ'}การจองรถ ${row.code}`,
    });
  }

  update(
    user: SafeUser,
    entityKey: string,
    id: string,
    changes: Record<string, unknown>,
    options: UpdateOptions = {},
  ): DecoratedRecord {
    const def = getEntity(entityKey);
    if (!def) notFound('ไม่พบชนิดข้อมูล');
    if (!options.system) this.access.requireEntity(user, entityKey, 'edit');
    if (def.system && !options.system && !SYSTEM_RECORD_CRUD.has(def.key)) {
      bad('ข้อมูลชนิดนี้แก้ไขได้จากขั้นตอนของระบบเท่านั้น');
    }
    const row = this.rawGet(entityKey, id);
    if (!row) notFound('ไม่พบรายการ');
    if (row.deleted) bad('รายการนี้ถูกยกเลิก/ซ่อนแล้ว');
    if (!options.system) this.access.requireSee(user, def, row);
    const conflict = () => new ConflictException('รายการถูกแก้ไขแล้ว กรุณาตรวจค่าล่าสุดก่อนบันทึกอีกครั้ง');
    if (options.expectedUpdatedAt !== undefined && row.updatedAt !== options.expectedUpdatedAt) throw conflict();

    const before = { ...row.data };
    const patch = this.sanitize(def, changes);
    this.guardUpdate(def, row, patch, user, options);
    this.guardArchivedOptions(def, row.data, patch);
    this.guardOptionAccess(def, row.data, patch, user, !!options.system);
    const next = { ...row.data, ...patch };
    this.validate(def, next, user, id);
    this.validateBusiness(def, next, id);
    const now = new Date(Math.max(Date.now(), (Date.parse(row.updatedAt) || 0) + 1)).toISOString();
    return this.db.transaction(() => {
      const result = this.db
        .update(records)
        .set({ data: next, updatedAt: now, updatedBy: options.actor?.id ?? user.id })
        .where(and(eq(records.id, id), eq(records.updatedAt, row.updatedAt)))
        .run();
      if (!result.changes) throw conflict();
      this.syncMirrors(def, id, before, next);

      const after = this.decorate(def, { ...row, data: next, updatedAt: now } as RawRecord, user);
      const diff = options.changes ?? this.diff(def, before, next);
      if (diff.length) {
        this.audit.log(options.actor ?? user, {
          action: 'update',
          entity: def.key,
          recordId: id,
          recordCode: row.code,
          summary: options.summary ?? `แก้ไข${def.label} ${row.code}`,
          changes: diff,
        });
        this.events.publish({
          type: 'record.updated',
          entity: def.key,
          recordId: id,
          code: row.code,
          actor: options.actor ?? user,
          summary: options.summary ?? `แก้ไข${def.label} ${row.code}`,
          payload: { changes: diff.slice(0, 20) },
        });
      }
      return after;
    });
  }

  private sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }

  private finalStatus(entityKey: string, status: string): boolean {
    const workflowKey = ENTITY_WORKFLOW_KEY[entityKey] ?? entityKey;
    const workflow = (WORKFLOWS as Record<string, { statuses?: { key: string; final?: boolean }[] }>)[workflowKey];
    return !!workflow?.statuses?.find((item) => item.key === status)?.final;
  }

  /** Reject status changes that are only allowed through approve/decision endpoints. */
  /** Archived options stay readable on existing records but cannot be newly selected. */
  private guardArchivedOptions(def: EntityDef, previous: Record<string, unknown>, patch: Record<string, unknown>): void {
    for (const field of def.fields) {
      if (field.type !== 'select' && field.type !== 'multiselect') continue;
      if (!field.optionMeta?.length) continue;
      if (!Object.prototype.hasOwnProperty.call(patch, field.key)) continue;
      const archived = new Set(field.optionMeta.filter((option) => option.archived).map((option) => option.id));
      if (!archived.size) continue;
      const asList = (value: unknown): string[] => Array.isArray(value)
        ? value.map(String)
        : value === undefined || value === null || value === '' ? [] : [String(value)];
      const next = asList(patch[field.key]);
      const before = new Set(asList(previous[field.key]));
      const added = next.filter((value) => !before.has(value));
      if (added.some((value) => archived.has(value))) {
        bad(`"${field.label}" มีตัวเลือกที่ถูกเก็บถาวรแล้ว จึงเลือกใหม่ไม่ได้`);
      }
    }
  }

  /** Options can be limited to roles; only newly selected values are checked. */
  private guardOptionAccess(
    def: EntityDef,
    previous: Record<string, unknown>,
    patch: Record<string, unknown>,
    user: SafeUser,
    system: boolean,
  ): void {
    if (system || user.isAdmin) return;
    const asList = (value: unknown): string[] => Array.isArray(value)
      ? value.map(String)
      : value === undefined || value === null || value === '' ? [] : [String(value)];
    for (const field of def.fields) {
      if (field.type !== 'select' && field.type !== 'multiselect') continue;
      if (!field.optionMeta?.some((option) => option.roles?.length)) continue;
      if (!Object.prototype.hasOwnProperty.call(patch, field.key)) continue;
      const before = new Set(asList(previous[field.key]));
      const blocked = asList(patch[field.key])
        .filter((value) => !before.has(value))
        .map((value) => field.optionMeta?.find((option) => option.id === value))
        .filter((option): option is NonNullable<typeof option> => !!option?.roles?.length && !option.roles.includes(user.roleId));
      if (blocked.length) bad(`"${field.label}": ไม่มีสิทธิ์เลือกตัวเลือก "${blocked[0].label}"`);
    }
  }

  private guardCreate(def: EntityDef, data: Record<string, unknown>, options: CreateOptions): void {
    if (options.system || def.key !== 'vehicleBookings') return;
    const status = String(data['status'] ?? '');
    if (status && status !== 'รออนุมัติ') {
      bad('ไม่สามารถกำหนดสถานะการจองรถได้โดยตรง กรุณาส่งคำขออนุมัติ');
    }
  }

  private guardUpdate(
    def: EntityDef,
    row: RawRecord,
    patch: Record<string, unknown>,
    user: SafeUser,
    options: UpdateOptions,
  ): void {
    if (options.system) return;
    const currentStatus = String(row.data['status'] ?? '');
    const changed = (key: string) => Object.prototype.hasOwnProperty.call(patch, key) && !this.sameValue(patch[key], row.data[key]);

    if (def.key === 'projects' && row.data['closed'] === true) {
      bad('โครงการนี้ปิดแล้ว กรุณาเปิดโครงการใหม่ก่อนแก้ไข');
    }
    if (FINAL_LOCKED_ENTITIES.has(def.key) && this.finalStatus(def.key, currentStatus)) {
      bad('รายการนี้อยู่ในสถานะปิด/จบแล้ว ไม่สามารถแก้ไขได้');
    }
    if (def.key === 'purchaseOrders' && PO_LOCKED_STATUSES.includes(currentStatus)) {
      const locked = PO_LOCKED_FIELDS.find((key) => changed(key));
      if (locked) bad('ใบสั่งซื้อนี้ถูกสั่งซื้อ/รับของแล้ว ไม่สามารถแก้ไขรายการหลักได้');
    }
    if (def.key === 'serials') {
      if (changed('status') || changed('warehouse')) {
        bad('สถานะ/คลังของ Serial ต้องเปลี่ยนผ่านรายการรับเข้า-เบิกออกเท่านั้น');
      }
    }
    const assignFields = ASSIGN_FIELDS[def.key];
    if (assignFields?.some((key) => changed(key))) {
      this.access.require(user, def.resource, 'assign');
    }
    if (def.key === 'vehicleBookings') {
      if (changed('status')) {
        const nextStatus = String(patch['status'] ?? '');
        if (nextStatus !== currentStatus && !['ยกเลิก', 'เสร็จสิ้น'].includes(nextStatus)) {
          bad('ไม่สามารถเปลี่ยนสถานะการจองรถได้โดยตรง กรุณาใช้ขั้นตอนอนุมัติ');
        }
      }
      if (currentStatus === 'อนุมัติแล้ว' && ['vehicle', 'startAt', 'endAt'].some((key) => changed(key))) {
        const requestedStatus = String(patch['status'] ?? currentStatus);
        if (!['ยกเลิก', 'เสร็จสิ้น'].includes(requestedStatus)) {
          patch['status'] = 'รออนุมัติ';
        }
      }
      if (['เสร็จสิ้น', 'ยกเลิก', 'ไม่อนุมัติ'].includes(currentStatus) && ['vehicle', 'startAt', 'endAt'].some((key) => changed(key))) {
        bad('รายการจองที่ปิด/ยกเลิกแล้วไม่สามารถเปลี่ยนรถหรือช่วงเวลาได้');
      }
    }
  }

  /** Internal write for workflow/system fields (status, timeline, steps) — skips field whitelist. */
  patchSystem(
    actor: SafeUser | null,
    entityKey: string,
    id: string,
    patch: Record<string, unknown>,
    summary: string,
    changes: unknown[] = [],
  ): DecoratedRecord {
    const def = getEntity(entityKey);
    if (!def) notFound('ไม่พบชนิดข้อมูล');
    const row = this.rawGet(entityKey, id);
    if (!row) notFound('ไม่พบรายการ');
    const next = { ...row.data, ...patch };
    const now = nowIso();
    return this.db.transaction(() => {
      this.db
        .update(records)
        .set({ data: next, updatedAt: now, updatedBy: actor?.id ?? null })
        .where(eq(records.id, id))
        .run();
      this.audit.log(actor, {
        action: 'update',
        entity: def.key,
        recordId: id,
        recordCode: row.code,
        summary,
        changes,
      });
      this.events.publish({
        type: 'record.updated',
        entity: def.key,
        recordId: id,
        code: row.code,
        actor,
        summary,
        payload: { changes: changes.slice(0, 20) },
      });
      return this.decorate(def, { ...row, data: next, updatedAt: now } as RawRecord, actor ?? undefined);
    });
  }

  transition(
    user: SafeUser,
    entityKey: string,
    id: string,
    to: string,
    opts: { comment?: string; fields?: Record<string, unknown> } = {},
  ): DecoratedRecord {
    const def = this.access.requireEntity(user, entityKey, 'edit');
    const row = this.rawGet(entityKey, id);
    if (!row) notFound('ไม่พบรายการ');
    this.access.requireSee(user, def, row);
    if (row.deleted) bad('รายการนี้ถูกยกเลิก/ซ่อนแล้ว');
    const workflowKey = ENTITY_WORKFLOW_KEY[entityKey] ?? entityKey;
    const workflow = (WORKFLOWS as Record<string, { statuses?: { key: string; label: string; next?: string[]; requiredFields?: string[]; final?: boolean; enabled?: boolean; needClosePerm?: boolean; approverRole?: string; approverUser?: string }[] }>)[workflowKey];
    if (!workflow?.statuses?.length) bad('รายการนี้ไม่มี workflow สถานะ');
    const from = workflow.statuses.find((status) => status.key === String(row.data['status'] ?? ''));
    const target = workflow.statuses.find((status) => status.key === to);
    if (!target || target.enabled === false) bad('สถานะปลายทางไม่ถูกต้อง');
    if (from?.key === target.key) bad('อยู่ในสถานะนี้แล้ว');
    const allowed = !from || !!from.next?.includes(target.key);
    const reopen = !!from?.final && !target.final;
    if (from && !allowed && !reopen) bad(`ไม่สามารถเปลี่ยนจาก "${from.label ?? '–'}" เป็น "${target.label}"`);
    if (reopen && !String(opts.comment ?? '').trim()) bad('การเปิดรายการที่จบแล้วต้องระบุเหตุผล');
    if (reopen) this.access.require(user, def.resource, 'close');
    if (target.needClosePerm) this.access.require(user, def.resource, 'close');
    const fields = this.sanitize(def, opts.fields ?? {});
    const merged = { ...row.data, ...fields };
    for (const key of target.requiredFields ?? []) {
      if (isEmpty(merged[key])) {
        const label = def.fields.find((field) => field.key === key)?.label ?? key;
        bad(`ต้องกรอก "${label}" ก่อนเปลี่ยนเป็น "${target.label}"`);
      }
    }
    if ((target.approverRole || target.approverUser) && !this.access.isApprover(user, target)) {
      const request = this.approvals.create(user, {
        entity: entityKey,
        recordId: id,
        kind: 'transition',
        key: target.key,
        title: `${def.label} ${row.code}: ${from?.label ?? '–'} → ${target.label}`,
        payload: { to: target.key, fields, comment: opts.comment ?? '' },
        approverRole: target.approverRole,
        approverUser: target.approverUser,
      });
      return { ...this.get(user, entityKey, id), _pendingApproval: request };
    }
    const now = nowIso();
    const timeline = [...((row.data['timeline'] as Record<string, unknown>[] | undefined) ?? [])];
    timeline.push({ id: crypto.randomUUID(), at: now, by: user.id, type: 'status', text: `${from?.label ?? '–'} → ${target.label}${opts.comment ? ` — ${opts.comment}` : ''}` });
    return this.patchSystem(
      user,
      entityKey,
      id,
      { ...fields, status: target.key, timeline },
      `เปลี่ยนสถานะ ${row.code}: ${from?.label ?? '–'} → ${target.label}`,
      [{ field: 'สถานะ', from: from?.key, to: target.key }],
    );
  }

  related(user: SafeUser, entityKey: string, id: string) {
    const def = this.access.requireEntity(user, entityKey, 'view');
    const record = this.rawGet(entityKey, id);
    if (!record) notFound('ไม่พบรายการ');
    this.access.requireSee(user, def, record);
    const groups: Array<{
      entity: string;
      label: string;
      field: string;
      records: Array<{ id: string; code: string; title: string }>;
    }> = [];
    for (const other of Object.values(ENTITY_DEFS)) {
      if (other.key === entityKey) continue;
      if (!this.access.canEntity(user, other.key, 'view')) continue;
      const fields = other.fields.filter((field) => field.type === 'ref' && field.ref === entityKey && !field.hidden);
      if (!fields.length) continue;
      let rows;
      try {
        rows = this.rawScoped(other, user);
      } catch {
        continue;
      }
      for (const field of fields) {
        const linked = rows
          .filter((row) => {
            if (row.deleted) return false;
            const value = row.data[field.key];
            return Array.isArray(value) ? value.map(String).includes(id) : String(value ?? '') === id;
          })
          .slice(0, 20)
          .map((row) => {
            const refField = other.fields.find((item) => item.type === 'ref' && item.ref && row.data[item.key]);
            const refTitle = refField ? this.labelOf(refField.ref ?? '', String(row.data[refField.key] ?? ''), user) : '';
            const rawTitle =
              other.title === 'code'
                ? refTitle && !refTitle.startsWith('(') ? refTitle : row.code
                : row.data[other.title] ?? row.data[other.fields.find((item) => item.type === 'text')?.key ?? ''] ?? row.code;
            return { id: row.id, code: row.code, title: String(rawTitle) };
          });
        if (linked.length) groups.push({ entity: other.key, label: other.label, field: field.label, records: linked });
      }
    }
    return { entity: entityKey, id, groups };
  }

  approvalsForRecord(user: SafeUser, entityKey: string, id: string) {    const def = this.access.requireEntity(user, entityKey, 'view');
    const row = this.rawGet(entityKey, id);
    if (!row) notFound('ไม่พบรายการ');
    this.access.requireSee(user, def, row);
    return this.approvals.pendingForRecord(entityKey, id);
  }

  archive(user: SafeUser, entityKey: string, id: string, reason: string): DecoratedRecord {
    const def = this.access.requireEntity(user, entityKey, 'delete');
    const row = this.rawGet(entityKey, id);
    if (!row) notFound('ไม่พบรายการ');
    this.access.requireSee(user, def, row);
    if (!reason?.trim()) bad('ต้องระบุเหตุผล');
    const now = nowIso();
    this.db
      .update(records)
      .set({ deleted: true, deletedAt: now, deletedBy: user.id, deletedReason: reason.trim(), updatedAt: now, updatedBy: user.id })
      .where(eq(records.id, id))
      .run();
    this.syncMirrors(def, id, row.data, null);
    const decorated = this.decorate(def, { ...row, deleted: true, deletedAt: now, deletedReason: reason.trim() } as RawRecord, user);
    this.audit.log(user, {
      action: 'archive',
      entity: def.key,
      recordId: id,
      recordCode: row.code,
      summary: `ยกเลิก/ซ่อน ${def.label} — ${reason.trim()}`,
    });
    this.events.publish({
      type: 'record.deleted',
      entity: def.key,
      recordId: id,
      code: row.code,
      actor: user,
      summary: `ยกเลิก/ซ่อน ${def.label} ${row.code}`,
      payload: { reason: reason.trim() },
    });
    return decorated;
  }

  restore(user: SafeUser, entityKey: string, id: string): DecoratedRecord {
    const def = this.access.requireEntity(user, entityKey, 'delete');
    const row = this.rawGet(entityKey, id);
    if (!row) notFound('ไม่พบรายการ');
    this.access.requireSee(user, def, row);
    const now = nowIso();
    this.db
      .update(records)
      .set({ deleted: false, deletedAt: null, deletedBy: null, deletedReason: null, updatedAt: now, updatedBy: user.id })
      .where(eq(records.id, id))
      .run();
    this.syncMirrors(def, id, {}, row.data);
    const decorated = this.decorate(def, { ...row, deleted: false, deletedAt: null, deletedReason: null } as RawRecord, user);
    this.audit.log(user, {
      action: 'restore',
      entity: def.key,
      recordId: id,
      recordCode: row.code,
      summary: `กู้คืน ${def.label}`,
    });
    this.events.publish({
      type: 'record.restored',
      entity: def.key,
      recordId: id,
      code: row.code,
      actor: user,
      summary: `กู้คืน ${def.label} ${row.code}`,
    });
    return decorated;
  }

  /** Existence check used by references; respects scope when a user is supplied. */
  refExists(entityKey: string, id: string, user?: SafeUser | null): boolean {
    if (entityKey === 'users') {
      const row = this.db.select().from(users).where(eq(users.id, id)).all()[0];
      return !!row && row.active;
    }
    const def = findEntity(entityKey);
    if (!def) return false;
    const row = this.rawGet(entityKey, id);
    if (!row || row.deleted) return false;
    return !user || this.access.canSee(user, def, row);
  }

  labelOf(entityKey: string, id: string, user?: SafeUser): string {
    if (entityKey === 'users') {
      const userRow = this.db.select().from(users).where(eq(users.id, id)).all()[0];
      return userRow?.name ?? '(ไม่พบ)';
    }
    const def = findEntity(entityKey);
    if (!def) return '(ไม่พบ)';
    const row = this.rawGet(entityKey, id);
    if (!row) return '(ไม่พบ)';
    if (user && !this.access.canSee(user, def, row)) return '(ไม่มีสิทธิ์)';
    if (def.title === 'code' || !row.data[def.title]) return row.code;
    return String(row.data[def.title]);
  }

  // ---------- decoration / defaults ----------

  private decorate(def: EntityDef, row: RawRecord, user?: SafeUser): DecoratedRecord {
    const data = { ...row.data };
    for (const field of def.fields) {
      if (field.sensitive) delete data[field.key];
    }
    const labels: Record<string, string> = {};
    const rowLabels: Record<string, Array<Record<string, string>>> = {};
    for (const field of def.fields) {
      if (field.type === 'ref') {
        const raw = data[field.key];
        if (field.multiple) {
          const ids = Array.isArray(raw) ? raw.map(String) : [];
          const labelsOf = ids
            .map((id) => this.labelOf(field.ref ?? '', id, user))
            .filter((label) => !!label && !label.startsWith('(ไม่'));
          labels[field.key] = labelsOf.join(', ');
        } else if (typeof raw === 'string' && raw) {
          labels[field.key] = this.labelOf(field.ref ?? '', raw, user);
        }
      }
      if (field.type === 'rows' && Array.isArray(data[field.key])) {
        rowLabels[field.key] = (data[field.key] as Record<string, unknown>[]).map((line) => {
          const map: Record<string, string> = {};
          for (const col of field.cols ?? []) {
            if (col.type === 'ref' && typeof line[col.key] === 'string' && line[col.key]) {
              map[col.key] = this.labelOf(col.ref ?? '', line[col.key] as string, user);
            }
          }
          return map;
        });
      }
    }
    return {
      ...data,
      id: row.id,
      code: row.code,
      _createdAt: row.createdAt,
      _updatedAt: row.updatedAt,
      _createdBy: row.createdBy,
      _updatedBy: row.updatedBy,
      _createdByName: row.createdBy ? this.labelOf('users', row.createdBy) : 'ระบบ',
      _updatedByName: row.updatedBy ? this.labelOf('users', row.updatedBy) : 'ระบบ',
      _deleted: row.deleted,
      _deleteReason: row.deletedReason,
      _labels: labels,
      _rowLabels: rowLabels,
    };
  }

  private defaultsFor(def: EntityDef): Record<string, unknown> {
    if (def.key === 'tickets') {
      return { status: 'received', timeline: [], appointments: [], parts: [] };
    }
    if (def.key === 'purchaseOrders') return { status: 'draft' };
    if (def.key === 'projects') {
      const steps: Record<string, unknown> = {};
      for (const step of projectSteps()) steps[step.key] = { status: 'pending', values: {}, docs: {}, log: [] };
      return { steps, closed: false };
    }
    if (def.key === 'items') return { trackSerial: false };
    if (def.key === 'pmPlans') return { active: true };
    if (def.key === 'serials') return { status: 'ในคลัง' };
    if (def.key === 'vehicles') return { status: 'พร้อมใช้' };
    if (def.key === 'vehicleBookings') return { status: 'รออนุมัติ' };
    const workflowKey = ENTITY_WORKFLOW_KEY[def.key] ?? def.key;
    const workflow = (WORKFLOWS as Record<string, { statuses?: { key: string; enabled?: boolean }[] }>)[workflowKey];
    if (workflow?.statuses?.length) {
      return { status: workflow.statuses.find((status) => status.enabled !== false)?.key ?? workflow.statuses[0].key };
    }
    return {};
  }

  private nextCode(def: EntityDef): string {
    // Atomic upsert: SQLite increments the counter inside one statement, so two
    // concurrent creates cannot read the same previous value.
    const row = this.db
      .insert(counters)
      .values({ workspaceId: currentWorkspaceId(), entity: def.key, value: 1 })
      .onConflictDoUpdate({
        target: [counters.workspaceId, counters.entity],
        set: { value: sql`${counters.value} + 1` },
      })
      .returning({ value: counters.value })
      .get();
    const value = row?.value ?? 1;
    return `${def.prefix}-${String(value).padStart(4, '0')}`;
  }

  /** Relation ids from a stored value: single refs are one id, multi-links are arrays. */
  private mirrorIds(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === 'string' && value) return [value];
    return [];
  }

  /**
   * A relation is edited on one side only; the reverse field (created with
   * `mirror`) is kept in step here so both datasets show the same links.
   */
  private syncMirrors(def: EntityDef, recordId: string, before: Record<string, unknown>, after: Record<string, unknown> | null): void {
    for (const field of def.fields) {
      if (field.type !== 'ref' || !field.ref || field.ref === 'users') continue;
      const previous = this.mirrorIds(before[field.key]);
      const next = this.mirrorIds(after?.[field.key]);
      if (previous.length === next.length && previous.every((id) => next.includes(id))) continue;
      const added = next.filter((id) => !previous.includes(id));
      const removed = previous.filter((id) => !next.includes(id));
      if (!added.length && !removed.length) continue;
      for (const targetDef of Object.values(ENTITY_DEFS)) {
        if (targetDef.key !== field.ref) continue;
        const mirrors = targetDef.fields.filter((item) => item.mirror?.entity === def.key && item.mirror.field === field.key);
        if (!mirrors.length) continue;
        for (const mirror of mirrors) {
          for (const targetId of [...new Set([...added, ...removed])]) {
            const target = this.rawGet(targetDef.key, targetId);
            if (!target) continue;
            const current = this.mirrorIds(target.data[mirror.key]);
            const wanted = added.includes(targetId)
              ? (current.includes(recordId) ? current : [...current, recordId])
              : current.filter((id) => id !== recordId);
            if (wanted.length === current.length && wanted.every((id, index) => id === current[index])) continue;
            const updatedAt = new Date(Math.max(Date.now(), (Date.parse(target.updatedAt) || 0) + 1)).toISOString();
            this.db.update(records)
              .set({ data: { ...target.data, [mirror.key]: wanted }, updatedAt })
              .where(and(eq(records.id, target.id), eq(records.workspaceId, currentWorkspaceId())))
              .run();
          }
        }
      }
    }
  }

  private sanitize(def: EntityDef, values: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of def.fields) {
      if (field.readOnly || field.archived || field.type === 'section' || field.type === 'formula') continue;
      if (!Object.prototype.hasOwnProperty.call(values, field.key)) continue;
      out[field.key] = this.coerce(field, values[field.key]);
    }
    return out;
  }

  private coerce(field: FieldDef, value: unknown): unknown {
    if (value === undefined) return undefined;
    if (value === null || value === '') return '';
    switch (field.type) {
      case 'number': {
        const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
        return Number.isFinite(n) ? n : value;
      }
      case 'boolean':
        return value === true || value === 'true' || value === 1 || value === '1';
      case 'multiselect':
        return Array.isArray(value) ? value.map(String) : [String(value)];
      case 'rows':
        return Array.isArray(value)
          ? value.map((line) => this.coerceRow(field, (line ?? {}) as Record<string, unknown>))
          : value;
      case 'file':
        return Array.isArray(value) ? value : [value];
      case 'text':
      case 'email':
      case 'phone':
      case 'url':
        return typeof value === 'string' ? value.trim() : String(value);
      case 'textarea':
      case 'select':
      case 'date':
      case 'datetime':
        return typeof value === 'string' ? value : String(value);
      case 'ref':
        if (!field.multiple) return typeof value === 'string' ? value : String(value);
        return Array.isArray(value)
          ? [...new Set(value.map(String).filter(Boolean))]
          : [String(value)];
      default:
        return value;
    }
  }

  private coerceRow(field: FieldDef, line: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const col of field.cols ?? []) {
      if (!Object.prototype.hasOwnProperty.call(line, col.key)) continue;
      out[col.key] = this.coerce(col as FieldDef, line[col.key]);
    }
    return out;
  }

  // ---------- validation ----------

  private optionsOf(field: FieldDef): string[] {
    if (field.optionsFrom === 'teams') return LISTS.teams;
    if (field.optionsFrom === 'depts') return LISTS.depts;
    return field.options ?? [];
  }

  private visible(field: FieldDef, data: Record<string, unknown>): boolean {
    if (field.hidden || field.type === 'section' || field.type === 'formula') return false;
    return !field.showIf || data[field.showIf.field] === field.showIf.value;
  }

  private validateBusiness(def: EntityDef, data: Record<string, unknown>, selfId: string | null): void {
    const number = (value: unknown): number => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    if (def.key === 'vehicleBookings') {
      const vehicleId = String(data['vehicle'] ?? '');
      const start = Date.parse(String(data['startAt'] ?? ''));
      const end = Date.parse(String(data['endAt'] ?? ''));
      const status = String(data['status'] ?? '');
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
        bad('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
      }
      if (vehicleId && Number.isFinite(start) && Number.isFinite(end) && !['ยกเลิก', 'ไม่อนุมัติ', 'เสร็จสิ้น'].includes(status)) {
        const vehicle = this.rawGet('vehicles', vehicleId);
        if (vehicle && String(vehicle.data['status'] ?? '') && String(vehicle.data['status']) !== 'พร้อมใช้') {
          bad('รถคันนี้ไม่พร้อมใช้งาน');
        }
        const conflict = this.db
          .select()
          .from(records)
          .where(and(eq(records.entity, 'vehicleBookings'), eq(records.workspaceId, currentWorkspaceId())))
          .all()
          .find((row) => {
            if (row.deleted || row.id === selfId) return false;
            if (String(row.data['vehicle'] ?? '') !== vehicleId) return false;
            if (['ยกเลิก', 'ไม่อนุมัติ'].includes(String(row.data['status'] ?? ''))) return false;
            const otherStart = Date.parse(String(row.data['startAt'] ?? ''));
            const otherEnd = Date.parse(String(row.data['endAt'] ?? ''));
            return Number.isFinite(otherStart) && Number.isFinite(otherEnd) && otherStart < end && otherEnd > start;
          });
        if (conflict) bad(`ช่วงเวลานี้รถถูกจองแล้ว (${conflict.code})`);
      }
    }
    if (def.key === 'invoices') {
      const subtotal = number(data['subtotal']);
      const vat = number(data['vat']);
      const total = number(data['total']);
      if (subtotal < 0 || vat < 0 || total < 0) bad('จำนวนเงินในใบแจ้งหนี้ต้องไม่ติดลบ');
      if (Math.abs(total - (subtotal + vat)) > 0.01) {
        bad(`ยอดรวมสุทธิ (${total}) ต้องเท่ากับยอดก่อน VAT + VAT (${subtotal + vat})`);
      }
      const issue = String(data['issueDate'] ?? '');
      const due = String(data['dueDate'] ?? '');
      if (issue && due && due < issue) bad('วันครบกำหนดชำระต้องไม่ก่อนวันที่ออกเอกสาร');
    }
    if (def.key === 'receipts') {
      const amount = number(data['amount']);
      if (amount <= 0) bad('จำนวนเงินรับชำระต้องมากกว่า 0');
      const invoiceId = String(data['invoice'] ?? '');
      const invoice = invoiceId ? this.rawGet('invoices', invoiceId) : undefined;
      if (!invoice || invoice.deleted) bad('ไม่พบใบแจ้งหนี้ที่อ้างอิง');
      const invoiceTotal = number(invoice.data['total']);
      const paid = this.rawAll('receipts')
        .filter((row) => !row.deleted && row.id !== selfId && String(row.data['invoice'] ?? '') === invoiceId)
        .reduce((sum, row) => sum + number(row.data['amount']), 0);
      if (paid + amount - invoiceTotal > 0.01) {
        bad(`รับชำระเกินยอดใบแจ้งหนี้ (คงเหลือ ${Math.max(0, invoiceTotal - paid)})`);
      }
    }
    if (def.key === 'expenses' && number(data['amount']) < 0) {
      bad('จำนวนเงินค่าใช้จ่ายต้องไม่ติดลบ');
    }
  }

  private validate(def: EntityDef, data: Record<string, unknown>, user: SafeUser, selfId: string | null): void {    const errors: Record<string, string> = {};
    for (const field of def.fields) {
      if (field.archived) continue;
      if (!this.visible(field, data)) continue;
      const value = data[field.key];
      const label = field.label;
      if (
        field.required &&
        (isEmpty(value) ||
          (field.type === 'rows' &&
            (!Array.isArray(value) ||
              !value.some((line) => Object.values(line as Record<string, unknown>).some((x) => !isEmpty(x))))))
      ) {
        errors[field.key] = `กรุณากรอก "${label}"`;
        continue;
      }
      if (value === '' || value === undefined || value === null) continue;
      switch (field.type) {
        case 'number': {
          const n = Number(value);
          if (!Number.isFinite(n)) errors[field.key] = `"${label}" ต้องเป็นตัวเลข`;
          else if (field.min !== undefined && n < field.min) errors[field.key] = `"${label}" ต้องไม่น้อยกว่า ${field.min}`;
          else if (field.max !== undefined && n > field.max) errors[field.key] = `"${label}" ต้องไม่เกิน ${field.max}`;
          else if (field.decimals !== undefined && Math.abs(n * 10 ** field.decimals - Math.round(n * 10 ** field.decimals)) > 1e-6) {
            errors[field.key] = `"${label}" ทศนิยมได้ไม่เกิน ${field.decimals} ตำแหน่ง`;
          } else if (field.min === undefined && n < 0 && field.key !== 'lat' && field.key !== 'lng') errors[field.key] = `"${label}" ต้องไม่ติดลบ`;
          break;
        }
        case 'text':
        case 'textarea':
          if (field.maxLength !== undefined && String(value).length > field.maxLength) errors[field.key] = `"${label}" ยาวได้ไม่เกิน ${field.maxLength} ตัวอักษร`;
          break;
        case 'date':
          if (!isDateOnly(value)) errors[field.key] = `"${label}" ไม่ใช่วันที่ที่ถูกต้อง (YYYY-MM-DD)`;
          break;
        case 'datetime':
          if (Number.isNaN(new Date(String(value)).getTime())) errors[field.key] = `"${label}" ไม่ใช่วันเวลาที่ถูกต้อง`;
          break;
        case 'email':
          if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors[field.key] = `"${label}" ไม่ใช่อีเมลที่ถูกต้อง`;
          break;
        case 'select': {
          const options = this.optionsOf(field);
          if (options.length && !options.includes(String(value))) errors[field.key] = `"${label}" เลือกค่าที่ไม่อยู่ในรายการ`;
          break;
        }
        case 'multiselect': {
          const options = this.optionsOf(field);
          const list = Array.isArray(value) ? value : [];
          if (options.length && list.some((v) => !options.includes(String(v)))) errors[field.key] = `"${label}" มีค่าที่ไม่อยู่ในรายการ`;
          break;
        }
        case 'ref':
          if (field.multiple) {
            const items = Array.isArray(value) ? value : null;
            if (!items) {
              errors[field.key] = `"${label}" ต้องเป็นรายการที่เชื่อมโยง`;
            } else if (items.length > 50) {
              errors[field.key] = `"${label}" เชื่อมได้สูงสุด 50 รายการ`;
            } else if (items.some((item) => typeof item !== 'string' || !item)) {
              errors[field.key] = `"${label}" มีรหัสรายการที่ไม่ถูกต้อง`;
            } else if (new Set(items).size !== items.length) {
              errors[field.key] = `"${label}" มีรายการซ้ำ`;
            } else if (items.some((item) => !this.refExists(field.ref ?? '', item, user))) {
              errors[field.key] = `"${label}" ไม่พบรายการที่เลือก`;
            }
          } else if (!this.refExists(field.ref ?? '', String(value), user)) {
            errors[field.key] = `"${label}" ไม่พบรายการที่เลือก`;
          }
          break;
        case 'rows': {
          const lines = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
          for (let i = 0; i < lines.length; i++) {
            for (const col of field.cols ?? []) {
              const line = lines[i];
              const raw = line[col.key];
              if (col.required && isEmpty(raw)) {
                errors[field.key] = `"${label}" แถวที่ ${i + 1}: กรุณากรอก "${col.label}"`;
                break;
              }
              if (raw === '' || raw === undefined || raw === null) continue;
              if (col.type === 'number') {
                const n = Number(raw);
                if (!Number.isFinite(n) || n < 0) {
                  errors[field.key] = `"${label}" แถวที่ ${i + 1}: "${col.label}" ต้องเป็นตัวเลขไม่ติดลบ`;
                  break;
                }
              }
              if (col.type === 'select' && col.options?.length && !col.options.includes(String(raw))) {
                errors[field.key] = `"${label}" แถวที่ ${i + 1}: "${col.label}" เลือกค่าที่ไม่อยู่ในรายการ`;
                break;
              }
              if (col.type === 'ref' && !this.refExists(col.ref ?? '', String(raw), user)) {
                errors[field.key] = `"${label}" แถวที่ ${i + 1}: ไม่พบ "${col.label}"`;
                break;
              }
            }
            if (errors[field.key]) break;
          }
          break;
        }
        default:
          break;
      }
      if (errors[field.key]) continue;
      if (field.unique && value !== undefined) {
        const dup = this.rawAll(def.key).find(
          (row) =>
            !row.deleted &&
            row.id !== selfId &&
            String(row.data[field.key] ?? '').trim().toLowerCase() === String(value).trim().toLowerCase(),
        );
        if (dup) errors[field.key] = `"${label}" ซ้ำกับรายการ ${dup.code}`;
      }
    }
    // Cross-document consistency: the site belongs to the selected customer.
    if (['tickets', 'projects', 'pmPlans', 'serials'].includes(def.key)) {
      const siteId = typeof data['site'] === 'string' ? data['site'] : '';
      const customerId = typeof data['customer'] === 'string' ? data['customer'] : '';
      if (siteId && customerId) {
        const site = this.rawGet('sites', siteId);
        const siteCustomer = site?.data['customer'];
        if (siteCustomer && siteCustomer !== customerId) {
          errors['site'] = `ไซต์ที่เลือกไม่ได้อยู่ในลูกค้ารายนี้ (ลูกค้าของไซต์: ${this.labelOf('customers', String(siteCustomer), user)})`;
        }
      }
    }

    const keys = Object.keys(errors);
    if (keys.length) {
      throw new FieldValidationError(errors[keys[0]] + (keys.length > 1 ? ` (และอีก ${keys.length - 1} ข้อ)` : ''), errors);
    }
  }

  private diff(def: EntityDef, before: Record<string, unknown>, after: Record<string, unknown>): unknown[] {
    const out: unknown[] = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (key.startsWith('_') || key === 'timeline' || key === 'steps') continue;
      if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) continue;
      out.push({
        field: def.fields.find((f) => f.key === key)?.label ?? key,
        from: before[key] ?? null,
        to: after[key] ?? null,
      });
    }
    return out;
  }
}
