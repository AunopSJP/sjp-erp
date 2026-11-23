import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { ACTIONS, RESOURCES } from '../db/database.service.js';
import { records, roles, savedViews, settings, approvals, users } from '../db/schema.js';
import { bad, forbidden, notFound } from '../common/exceptions.js';
import { currentWorkspaceId } from '../common/workspace-context.js';
import { AuditService } from '../common/audit.service.js';
import type { SafeUser } from '../auth/user.types.js';
import {
  DEFAULT_ENTITY_DEFS,
  DEFAULT_LISTS,
  DEFAULT_RESOURCE_LABELS,
  DEFAULT_WORKFLOWS,
  ENTITY_DEFS,
  LISTS,
  RESOURCE_LABELS,
  WORKFLOWS,
  ENTITY_WORKFLOW_KEY,
  WORKFLOW_ENTITY_KEY,
  type EntityDef,
  type EntityInput,
  type FieldDef,
  type FieldDefInput,
  type OptionDef,
  type ProjectStepDef,
  findEntity,
} from './entities.js';

const SETTINGS_KEY = 'metadata';
const FIELD_TYPES = new Set([
  'text', 'textarea', 'number', 'date', 'datetime', 'select', 'multiselect', 'boolean',
  'ref', 'file', 'rows', 'formula', 'section', 'email', 'phone', 'url',
]);
const KEY = /^[a-zA-Z][A-Za-z0-9_]*$/;
const FIELD_TYPE_LIST = [
  'text', 'textarea', 'number', 'date', 'datetime', 'select', 'multiselect', 'boolean',
  'ref', 'file', 'rows', 'formula', 'section', 'email', 'phone', 'url',
] as const;
const isFieldType = (value: string): value is (typeof FIELD_TYPE_LIST)[number] =>
  (FIELD_TYPE_LIST as readonly string[]).includes(value);
const OPTION_COLORS = ['gray', 'red', 'amber', 'green', 'blue'] as const;
const isOptionColor = (value: string): value is NonNullable<OptionDef['color']> =>
  (OPTION_COLORS as readonly string[]).includes(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Keys that would collide with built-in resources or JavaScript object internals. */
const RESERVED_ENTITY_KEYS = new Set([
  ...RESOURCES,
  'files', 'backup', 'notify', 'webhooks', 'approvals', 'events', 'audit', 'metadata',
  'dashboard', 'reports', 'search', 'pdf', 'auth', 'company', 'health',
  'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf', 'isPrototypeOf',
]);
const RESERVED_FIELD_KEYS = new Set(['constructor', 'prototype', '__proto__', 'hasOwnProperty', 'toString', 'valueOf']);

export interface StoredMetadata {
  entities: Record<string, EntityDef>;
  workflows: Record<string, unknown>;
  lists: { teams: string[]; depts: string[] };
}

export interface RoleInput {
  name?: string;
  scope?: string;
  perms?: Record<string, Record<string, boolean>>;
}

export interface NewFieldInput {
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
  sensitive?: boolean;
  wide?: boolean;
  help?: string;
  suffix?: string;
  decimals?: number;
  min?: number;
  max?: number;
  currency?: string;
  maxLength?: number;
  ref?: string;
  multiple?: boolean;
  displayField?: string;
  optionMeta?: { id?: string; label?: string; color?: string; archived?: boolean; roles?: string[] }[];
  options?: unknown[];
  optionsFrom?: string;
  archived?: boolean;
  mirror?: { entity?: string; field?: string };
  optionFilter?: { by?: string; targetField?: string };
}

export interface BacklinkInput {
  entity?: string;
  key?: string;
  label?: string;
  /** Create the reverse side as a list (many-to-many) instead of a single link. */
  multiple?: boolean;
}

@Injectable()
export class MetadataService implements OnApplicationBootstrap {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    this.apply(this.read());
  }

  reload(): void {
    this.apply(this.read());
  }

  config() {
    return {
      entities: Object.fromEntries(
        Object.entries(ENTITY_DEFS).map(([key, def]) => [
          key,
          { ...def, workflowKey: ENTITY_WORKFLOW_KEY[key] ?? def.key },
        ]),
      ) as Record<string, EntityDef>,
      workflows: JSON.parse(JSON.stringify(WORKFLOWS)) as Record<string, unknown>,
      lists: JSON.parse(JSON.stringify(LISTS)) as { teams: string[]; depts: string[] },
      resources: { ...RESOURCE_LABELS },
    };
  }

  saveEntity(input: EntityInput, roleIds?: string[]): EntityDef {
    if (!input || typeof input !== 'object') bad('ข้อมูลโมดูลไม่ถูกต้อง');
    const key = String(input.key ?? '').trim();
    if (!KEY.test(key)) bad('key ของโมดูลต้องเป็นภาษาอังกฤษ/ตัวเลข/ขีดล่าง และขึ้นต้นด้วยตัวอักษร');
    if (!String(input.label ?? '').trim()) bad('กรุณากรอกชื่อโมดูล/เอกสาร');
    const existing = Object.prototype.hasOwnProperty.call(ENTITY_DEFS, key) ? ENTITY_DEFS[key] : undefined;
    if (!existing && RESERVED_ENTITY_KEYS.has(key)) bad(`key "${key}" เป็นชื่อสงวนของระบบ`);
    if (!existing && WORKFLOW_ENTITY_KEY[key]) bad(`key "${key}" เป็นชื่อสงวนของ workflow ระบบ`);
    if (existing?.system) bad('ข้อมูลระบบนี้แก้ไขโครงสร้างไม่ได้');
    if (existing && !existing.custom && input.custom) bad('ไม่สามารถเปลี่ยนโมดูลระบบเป็นโมดูลที่สร้างเองได้');
    if (existing && existing.custom === false && input.custom === false && input.resource !== existing.resource) {
      bad('ไม่สามารถเปลี่ยน resource ของโมดูลระบบได้');
    }

    const prefix = String(input.prefix ?? existing?.prefix ?? 'DOC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!/^[A-Z][A-Z0-9]{0,7}$/.test(prefix || '')) bad('prefix ต้องเป็นตัวพิมพ์ใหญ่/ตัวเลข 1–8 ตัว');
    const fields = this.normalizeFields(input.fields ?? [], key);
    if (!fields.length) bad('โมดูลต้องมีอย่างน้อย 1 ฟิลด์');
    const title = String(input.title ?? existing?.title ?? fields.find((f) => f.type === 'text')?.key ?? 'name');
    if (title !== 'code' && !fields.some((f) => f.key === title)) bad(`ฟิลด์ชื่อรายการ "${title}" ไม่มีอยู่`);
    const workflowKey = ENTITY_WORKFLOW_KEY[key] ?? key;
    const hasWorkflow = !!((WORKFLOWS as Record<string, { statuses?: unknown[] }>)[workflowKey]?.statuses?.length);
    const allowedColumn = (column: string) =>
      column === 'code' ||
      column === 'stepLabel' ||
      (column === 'status' && hasWorkflow) ||
      fields.some((f) => f.key === column);
    const cols = (input.cols ?? existing?.cols ?? ['code', title]).filter(allowedColumn);
    const filters = (input.filters ?? existing?.filters ?? []).filter(allowedColumn);

    if (existing) {
      const oldKeys = new Set(existing.fields.map((f) => f.key));
      const newKeys = new Set(fields.map((f) => f.key));
      for (const fieldKey of oldKeys) {
        if (!newKeys.has(fieldKey) && this.fieldHasData(key, fieldKey)) {
          bad(`ลบฟิลด์ "${existing.fields.find((f) => f.key === fieldKey)?.label ?? fieldKey}" ไม่ได้ เพราะมีข้อมูลอยู่ — ใช้การซ่อนแทน`);
        }
      }
    }

    const isCustom = existing ? !!existing.custom : true;
    const resource = existing ? existing.resource : key;
    const aliases = input.aliases === undefined ? existing?.aliases ?? [] : this.normalizeAliases(input.aliases);
    const requestedStatus = input.status === undefined
      ? existing?.status
      : String(input.status);
    if (requestedStatus !== undefined && !['draft', 'published', 'archived'].includes(requestedStatus)) {
      bad('สถานะโมดูลต้องเป็น draft, published หรือ archived');
    }
    const def: EntityDef = {
      key,
      label: String(input.label).trim(),
      resource,
      prefix: prefix || 'DOC',
      title,
      cols: cols.length ? cols : ['code', title],
      filters,
      fields,
      scoped: typeof input.scoped === 'boolean' ? input.scoped : existing?.scoped ?? false,
      custom: isCustom,
      system: existing?.system ?? false,
      status: isCustom ? (requestedStatus as EntityDef['status'] ?? 'published') : undefined,
      group: input.group !== undefined ? String(input.group).trim().slice(0, 60) : existing?.group,
      navLabel: input.navLabel !== undefined ? String(input.navLabel).trim().slice(0, 40) : existing?.navLabel,
      icon: input.icon !== undefined ? String(input.icon).trim().slice(0, 40) : existing?.icon,
      description: input.description !== undefined ? String(input.description).trim().slice(0, 240) : existing?.description,
      aliases: aliases.length ? aliases : undefined,
    };
    ENTITY_DEFS[key] = def;
    RESOURCE_LABELS[resource] = def.label;

    const stored = this.read();
    stored.entities[key] = JSON.parse(JSON.stringify(def));
    this.write(stored);

    if (existing) {
      const changes = this.describeSchemaChanges(existing, def);
      if (changes.length) {
        this.audit.log(null, {
          action: 'metadata.options',
          entity: 'settings',
          recordId: key,
          recordCode: key,
          summary: `แก้ไขโมดูล ${def.label}: ${changes.join(' | ')}`,
        });
      }
    }

    if (isCustom && roleIds?.length) {
      const wanted = new Set(roleIds.map(String));
      for (const role of this.db.select().from(roles).all()) {
        if (role.isAdmin) continue;
        const has = !!role.perms[key];
        if (wanted.has(role.id)) {
          const current = role.perms[key] ?? {};
          const perms = {
            ...role.perms,
            [key]: {
              create: existing ? current.create ?? false : true,
              edit: existing ? current.edit ?? false : true,
              ...current,
              view: true,
            },
          };
          this.db.update(roles).set({ perms }).where(eq(roles.id, role.id)).run();
        } else if (has) {
          const perms = { ...role.perms };
          delete perms[key];
          this.db.update(roles).set({ perms }).where(eq(roles.id, role.id)).run();
        }
      }
    }
    return def;
  }

  /** Impact of adding a required field: record counts plus views/workflows that reference it. */
  fieldImpact(entityKey: string, fieldKey: string): {
    affected: number;
    total: number;
    views: { id: string; name: string; visibility: string }[];
    workflows: string[];
  } {
    const def = findEntity(entityKey);
    if (!def) notFound('ไม่พบโมดูล');
    // Advice for the operator who is editing the module: count the records they
    // can see, not records belonging to other workspaces.
    const rows = this.db.select().from(records)
      .where(and(eq(records.entity, entityKey), eq(records.workspaceId, currentWorkspaceId())))
      .all().filter((row) => !row.deleted);
    const hasValue = (value: unknown) =>
      value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
    return {
      affected: rows.filter((row) => !hasValue(row.data[fieldKey])).length,
      total: rows.length,
      views: this.viewsUsingField(entityKey, fieldKey),
      workflows: this.workflowsUsingField(entityKey, fieldKey),
    };
  }

  /** Changes a field's type (with data conversion) or archives it without losing values. */
  updateField(
    entityKey: string,
    fieldKey: string,
    input: { type?: string; archived?: boolean; confirm?: boolean; options?: string[]; optionMeta?: unknown[] },
  ): { entity: EntityDef; field: FieldDef; converted: number; cleared: number; views: { id: string; name: string }[] } {
    const def = findEntity(entityKey);
    if (!def) notFound('ไม่พบโมดูล');
    if (def.system) bad('ข้อมูลระบบนี้แก้ไขโครงสร้างไม่ได้');
    const field = def.fields.find((item) => item.key === fieldKey);
    if (!field) notFound('ไม่พบฟิลด์');
    const type = input.type === undefined ? field.type : String(input.type);
    if (!isFieldType(type)) bad(`ชนิดฟิลด์ "${type}" ไม่รองรับ`);
    const archived = input.archived === undefined ? !!field.archived : !!input.archived;
    const editsOptions = input.options !== undefined || input.optionMeta !== undefined;
    if (type === field.type && archived === !!field.archived && !editsOptions) {
      return { entity: def, field, converted: 0, cleared: 0, views: this.viewsUsingField(entityKey, fieldKey) };
    }
    if (archived && (type !== field.type || editsOptions)) bad('แปลงชนิด/แก้ตัวเลือกและเก็บถาวรพร้อมกันไม่ได้ — ทำทีละอย่าง');
    let converted = 0;
    let cleared = 0;
    let nextFieldBase: FieldDef = field;
    if (editsOptions) {
      const rawMeta = input.optionMeta === undefined
        ? (input.options
            ? (field.optionMeta ?? []).filter((option) => (input.options ?? []).includes(option.id))
            : field.optionMeta)
        : input.optionMeta.map((item) => {
            const row = isRecord(item) ? item : {};
            return {
              id: String(row['id'] ?? ''),
              label: String(row['label'] ?? ''),
              color: row['color'] === undefined ? undefined : String(row['color']),
              archived: row['archived'] === true,
              roles: Array.isArray(row['roles']) ? row['roles'].map(String) : undefined,
            };
          });
      const [normalized] = this.normalizeFields([this.toFieldDef({
        key: field.key,
        label: field.label,
        type,
        options: input.options ?? field.options,
        optionMeta: rawMeta,
      })], entityKey);
      const nextOptions = new Set(normalized.options ?? []);
      const removed = (field.options ?? []).filter((option) => !nextOptions.has(option));
      if (removed.length) {
        const rows = this.db.select().from(records).where(eq(records.entity, entityKey)).all();
        const used = rows.filter((row) => {
          const value = row.data[field.key];
          const list = Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === '' ? [] : [String(value)];
          return list.some((id) => removed.includes(id));
        }).length;
        if (used) bad(`ลบตัวเลือกที่มีข้อมูลใช้งานอยู่ ${used} รายการไม่ได้ — ใช้ "เก็บถาวร" แทน`);
      }
      nextFieldBase = { ...field, type, options: normalized.options, optionMeta: normalized.optionMeta };
    }
    if (type !== field.type) {
      const blocked = new Set(['ref', 'rows', 'formula', 'section', 'file']);
      if (blocked.has(field.type) || blocked.has(type)) bad('แปลงชนิดของ Relation/ไฟล์/ตารางย่อย/สูตร/ส่วนได้ไม่รองรับ');
      if (field.sensitive || field.unique) bad('ฟิลด์จำกัดสิทธิ์หรือห้ามซ้ำแปลงชนิดไม่ได้');

      const rows = this.db.select().from(records).where(eq(records.entity, entityKey)).all();
      const updates: { id: string; data: Record<string, unknown> }[] = [];
      const samples: string[] = [];
      for (const row of rows) {
        if (!Object.prototype.hasOwnProperty.call(row.data, fieldKey)) continue;
        const raw = row.data[fieldKey];
        if (raw === null || raw === undefined || raw === '') continue;
        const result = this.convertFieldValue(raw, field, type);
        if (result.ok) {
          converted++;
          if (JSON.stringify(result.value) !== JSON.stringify(raw)) {
            updates.push({ id: row.id, data: { ...row.data, [fieldKey]: result.value } });
          }
        } else {
          cleared++;
          if (samples.length < 3) samples.push(row.code);
          updates.push({ id: row.id, data: { ...row.data, [fieldKey]: null } });
        }
      }
      if (cleared && !input.confirm) {
        bad(`แปลงชนิดไม่ได้ ${cleared} รายการ (เช่น ${samples.join(', ')}) — ส่ง confirm=true เพื่อล้างค่าเหล่านี้`);
      }
      if (updates.length) {
        this.db.transaction(() => {
          for (const item of updates) {
            this.db.update(records).set({ data: item.data }).where(eq(records.id, item.id)).run();
          }
        });
      }
      const keepsOptions = type === 'select' || type === 'multiselect';
      nextFieldBase = {
        ...nextFieldBase,
        type,
        options: keepsOptions ? (nextFieldBase.options ?? field.options) : undefined,
        optionMeta: keepsOptions ? (nextFieldBase.optionMeta ?? field.optionMeta) : undefined,
      };
    }
    const nextField: FieldDef = { ...nextFieldBase, archived };
    const nextDef: EntityDef = {
      ...def,
      fields: def.fields.map((item) => (item.key === fieldKey ? nextField : item)),
      filters: archived ? def.filters.filter((item) => item !== fieldKey) : def.filters,
    };
    ENTITY_DEFS[entityKey] = nextDef;
    const stored = this.read();
    stored.entities[entityKey] = JSON.parse(JSON.stringify(nextDef));
    this.write(stored);
    const views = this.viewsUsingField(entityKey, fieldKey);
    this.audit.log(null, {
      action: 'metadata.field',
      entity: 'settings',
      recordId: `${entityKey}.${fieldKey}`,
      recordCode: entityKey,
      summary: `ปรับฟิลด์ "${nextField.label}" (${entityKey}.${fieldKey}): ${field.type !== type ? `ชนิด ${field.type}→${type}, ` : ''}${editsOptions ? 'แก้ตัวเลือก, ' : ''}${archived ? 'เก็บถาวร' : 'ใช้งาน'}${cleared ? `, ล้างค่า ${cleared} รายการ` : ''}`,
    });
    return { entity: nextDef, field: nextField, converted, cleared, views };
  }

  private convertFieldValue(value: unknown, field: FieldDef, type: string): { ok: true; value: unknown } | { ok: false } {
    const text = Array.isArray(value) ? value.map(String).join(', ') : String(value);
    switch (type) {
      case 'number': {
        if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : { ok: false };
        if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value))) return { ok: false };
        return { ok: true, value: Number(value) };
      }
      case 'date':
      case 'datetime': {
        if (typeof value !== 'string' && typeof value !== 'number') return { ok: false };
        const time = Date.parse(String(value));
        if (!Number.isFinite(time)) return { ok: false };
        const iso = new Date(time).toISOString();
        return { ok: true, value: type === 'date' ? iso.slice(0, 10) : iso };
      }
      case 'boolean': {
        if (typeof value === 'boolean') return { ok: true, value };
        const normalized = String(value).trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(normalized)) return { ok: true, value: true };
        if (['false', '0', 'no', 'n'].includes(normalized)) return { ok: true, value: false };
        return { ok: false };
      }
      case 'multiselect': {
        const list = Array.isArray(value) ? value.map(String) : String(value).split(',').map((item) => item.trim()).filter(Boolean);
        if (!list.length || (field.options?.length && list.some((item) => !field.options?.includes(item)))) return { ok: false };
        return { ok: true, value: list };
      }
      case 'select': {
        const single = Array.isArray(value) ? value.map(String) : [String(value).trim()];
        if (single.length !== 1 || !single[0]) return { ok: false };
        if (field.options?.length && !field.options.includes(single[0])) return { ok: false };
        return { ok: true, value: single[0] };
      }
      default: {
        if (Array.isArray(value) && value.some((item) => item !== null && typeof item === 'object')) return { ok: false };
        if (value !== null && typeof value === 'object') return { ok: false };
        return { ok: true, value: text.slice(0, 5000) };
      }
    }
  }

  private viewsUsingField(entityKey: string, fieldKey: string): { id: string; name: string; visibility: string }[] {
    return this.db.select().from(savedViews)
      .where(and(eq(savedViews.entity, entityKey), eq(savedViews.workspaceId, currentWorkspaceId())))
      .all()
      .filter((row) => this.configUsesField(row.config, fieldKey))
      .map((row) => ({ id: row.id, name: row.name, visibility: row.visibility }));
  }

  private configUsesField(config: unknown, fieldKey: string): boolean {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
    const value = config as Record<string, unknown>;
    const fv = value['fv'];
    if (fv && typeof fv === 'object' && !Array.isArray(fv) && Object.prototype.hasOwnProperty.call(fv, fieldKey)) return true;
    const sort = value['sort'];
    if (sort && typeof sort === 'object' && (sort as Record<string, unknown>)['key'] === fieldKey) return true;
    for (const key of ['hiddenColumns', 'groupBy']) {
      const list = value[key];
      if (Array.isArray(list) && list.includes(fieldKey)) return true;
    }
    return this.whereUsesField(value['where'], fieldKey);
  }

  private whereUsesField(where: unknown, fieldKey: string): boolean {
    if (!where) return false;
    let parsed: unknown = where;
    if (typeof where === 'string') {
      try {
        parsed = JSON.parse(where);
      } catch {
        return false;
      }
    }
    if (!parsed || typeof parsed !== 'object') return false;
    const node = parsed as Record<string, unknown>;
    if (node['field'] === fieldKey) return true;
    const clauses = node['clauses'];
    return Array.isArray(clauses) && clauses.some((clause) => this.whereUsesField(clause, fieldKey));
  }

  private workflowsUsingField(entityKey: string, fieldKey: string): string[] {
    const workflowKey = ENTITY_WORKFLOW_KEY[entityKey] ?? entityKey;
    const workflow = (WORKFLOWS as Record<string, { statuses?: { label?: string; requiredFields?: string[] }[] }>)[workflowKey];
    return (workflow?.statuses ?? [])
      .filter((status) => status.requiredFields?.includes(fieldKey))
      .map((status) => String(status.label ?? fieldKey));
  }

  /**
   * Adds one field to an existing dataset. A requested back-link is written in the
   * same settings row, so both sides appear together or not at all.
   */
  createField(
    entityKey: string,
    raw: NewFieldInput,
    options: { confirmRequired?: boolean; backlink?: BacklinkInput } = {},
  ): { entity: EntityDef; field: FieldDef; backlink?: { entity: EntityDef; field: FieldDef } } {
    const def = findEntity(entityKey);
    if (!def) notFound('ไม่พบโมดูล');
    if (def.system) bad('ข้อมูลระบบนี้แก้ไขโครงสร้างไม่ได้');
    const [field] = this.normalizeFields([this.toFieldDef(raw)], entityKey);
    this.assertNewFieldName(def, field);

    if (field.required) {
      const impact = this.fieldImpact(entityKey, field.key);
      if (impact.affected && !options.confirmRequired) {
        bad(`มี ${impact.affected} รายการเดิมที่ยังไม่มีค่า "${field.label}" — ต้องยืนยันก่อนสร้างฟิลด์บังคับกรอก`);
      }
    }

    const source: EntityDef = { ...def, fields: [...def.fields, field] };
    // Make the pending field visible while validating the reverse side, then roll
    // back the in-memory definition if anything below is rejected.
    ENTITY_DEFS[entityKey] = source;
    let target: EntityDef | undefined;
    let backField: FieldDef | undefined;
    try {
      if (options.backlink) {
        const link = options.backlink;
        if (String(link.entity ?? '') === entityKey) bad('ลิงก์ย้อนกลับต้องชี้ไปคนละโมดูล');
        const destination = findEntity(String(link.entity ?? ''));
        if (!destination) bad('ไม่พบโมดูลปลายทางของลิงก์ย้อนกลับ');
        if (destination.system) bad('โมดูลระบบแก้ไขโครงสร้างไม่ได้ จึงเพิ่มลิงก์ย้อนกลับไม่ได้');
        const candidate = this.toFieldDef({
          key: link.key || `${entityKey}Ref`,
          label: link.label || `${def.label} (อ้างอิง)`,
          type: 'ref',
          ref: entityKey,
          multiple: link.multiple === true,
          readOnly: true,
          mirror: { entity: entityKey, field: field.key },
          help: link.multiple === true
            ? `รายการทั้งหมดที่อ้างถึงจากโมดูล ${def.label} (เชื่อมโยงสองทาง)`
            : `รายการที่อ้างถึงจากโมดูล ${def.label}`,
        });
        [backField] = this.normalizeFields([candidate], destination.key);
        this.assertNewFieldName(destination, backField);
        target = { ...destination, fields: [...destination.fields, backField] };
      }
    } catch (error) {
      ENTITY_DEFS[entityKey] = def;
      throw error;
    }

    const stored = this.read();
    const snapshot = JSON.stringify(stored.entities);
    stored.entities[entityKey] = JSON.parse(JSON.stringify(source));
    if (target) {
      ENTITY_DEFS[target.key] = target;
      stored.entities[target.key] = JSON.parse(JSON.stringify(target));
    }
    try {
      this.write(stored);
    } catch (error) {
      Object.assign(stored.entities, JSON.parse(snapshot) as Record<string, EntityDef>);
      ENTITY_DEFS[entityKey] = { ...def };
      if (target) ENTITY_DEFS[target.key] = { ...target, fields: target.fields.filter((item) => item.key !== backField?.key) };
      throw error;
    }
    return { entity: source, field, backlink: target && backField ? { entity: target, field: backField } : undefined };
  }

  private toFieldDef(raw: NewFieldInput): FieldDefInput {
    const type = String(raw.type ?? 'text');
    if (!FIELD_TYPES.has(type)) bad(`ชนิดฟิลด์ "${type}" ไม่รองรับ`);
    return {
      key: String(raw.key ?? '').trim(),
      label: String(raw.label ?? '').trim(),
      type,
      required: !!raw.required,
      hidden: !!raw.hidden,
      readOnly: !!raw.readOnly,
      sensitive: !!raw.sensitive,
      wide: !!raw.wide,
      help: raw.help ? String(raw.help).slice(0, 240) : undefined,
      suffix: raw.suffix ? String(raw.suffix).slice(0, 20) : undefined,
      ...this.constraintsOf(raw, type),
      ref: raw.ref ? String(raw.ref) : undefined,
      multiple: raw.multiple === true ? true : undefined,
      displayField: raw.displayField ? String(raw.displayField) : undefined,
      optionMeta: raw.optionMeta,
      options: Array.isArray(raw.options) ? raw.options.map((option) => String(option).trim()).filter(Boolean) : undefined,
      optionsFrom: raw.optionsFrom === 'teams' || raw.optionsFrom === 'depts' ? raw.optionsFrom : undefined,
      archived: raw.archived === true ? true : undefined,
      mirror: raw.mirror ? { entity: raw.mirror.entity, field: raw.mirror.field } : undefined,
      optionFilter: raw.optionFilter ? { by: raw.optionFilter.by, targetField: raw.optionFilter.targetField } : undefined,
    };
  }

  /** Validates and keeps only the constraints that apply to the field type. */
  private constraintsOf(raw: NewFieldInput, type: string): Partial<FieldDefInput> {
    const num = (value: unknown, label: string): number | undefined => {
      if (value === undefined || value === null || value === '') return undefined;
      const n = Number(value);
      if (!Number.isFinite(n)) bad(`${label} ต้องเป็นตัวเลข`);
      return n;
    };
    const out: Partial<FieldDefInput> = {};
    if (type === 'number') {
      const decimals = num(raw.decimals, 'จำนวนทศนิยม');
      if (decimals !== undefined) {
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) bad('จำนวนทศนิยมต้องเป็นจำนวนเต็ม 0–6');
        out.decimals = decimals;
      }
      const min = num(raw.min, 'ค่าต่ำสุด');
      const max = num(raw.max, 'ค่าสูงสุด');
      if (min !== undefined && max !== undefined && min > max) bad('ค่าต่ำสุดต้องไม่มากกว่าค่าสูงสุด');
      if (min !== undefined) out.min = min;
      if (max !== undefined) out.max = max;
      if (raw.currency) {
        const code = String(raw.currency).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(code)) bad('รหัสสกุลเงินต้องเป็นตัวอักษร 3 ตัว เช่น THB');
        out.currency = code;
      }
    }
    if (type === 'text' || type === 'textarea') {
      const maxLength = num(raw.maxLength, 'ความยาวสูงสุด');
      if (maxLength !== undefined) {
        if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 10000) bad('ความยาวสูงสุดต้องเป็นจำนวนเต็ม 1–10000');
        out.maxLength = maxLength;
      }
    }
    return out;
  }

  private mirrorOf(raw: FieldDefInput): FieldDef['mirror'] {
    if (!raw.mirror) return undefined;
    const entity = String(raw.mirror.entity ?? '').trim();
    const field = String(raw.mirror.field ?? '').trim();
    if (!entity || !field) bad('ข้อมูลลิงก์ย้อนกลับไม่ครบ');
    const target = findEntity(entity);
    if (!target) bad(`ไม่พบโมดูล "${entity}" ของลิงก์ย้อนกลับ`);
    const source = target.fields.find((item) => item.key === field);
    if (!source || source.type !== 'ref') bad(`ลิงก์ย้อนกลับชี้ฟิลด์ "${field}" ที่ไม่ใช่ Relation`);
    return { entity, field };
  }

  private normalizeAliases(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const out: string[] = [];
    for (const raw of input) {
      const value = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!value || out.some((item) => item.toLowerCase() === value.toLowerCase())) continue;
      out.push(value);
      if (out.length >= 20) break;
    }
    return out;
  }

  /** Readable diff for the audit log: field/option changes made from the module builder. */
  private describeSchemaChanges(before: EntityDef, after: EntityDef): string[] {
    const changes: string[] = [];
    for (const field of after.fields) {
      const old = before.fields.find((item) => item.key === field.key);
      if (!old) {
        changes.push(`เพิ่มฟิลด์ ${field.label}`);
        continue;
      }
      const oldMeta = old.optionMeta ?? [];
      const newMeta = field.optionMeta ?? [];
      const added = newMeta.filter((option) => !oldMeta.some((item) => item.id === option.id));
      const removed = oldMeta.filter((option) => !newMeta.some((item) => item.id === option.id));
      const edited = newMeta.filter((option) => {
        const previous = oldMeta.find((item) => item.id === option.id);
        return !!previous && (previous.label !== option.label || previous.color !== option.color || !!previous.archived !== !!option.archived);
      });
      if (added.length || removed.length || edited.length) {
        const parts = [
          added.length ? `เพิ่มตัวเลือก ${added.map((option) => option.label).join(', ')}` : '',
          removed.length ? `ลบตัวเลือก ${removed.map((option) => option.label).join(', ')}` : '',
          edited.length ? `แก้ตัวเลือก ${edited.map((option) => option.label).join(', ')}` : '',
        ].filter(Boolean);
        changes.push(`${field.label}: ${parts.join('; ')}`);
      }
    }
    const removedFields = before.fields.filter((field) => !after.fields.some((item) => item.key === field.key));
    if (removedFields.length) changes.push(`ลบฟิลด์ ${removedFields.map((field) => field.label).join(', ')}`);
    return changes;
  }

  private assertNewFieldName(def: EntityDef, field: FieldDef): void {
    if (def.fields.some((item) => item.key === field.key)) bad(`key "${field.key}" ถูกใช้อยู่แล้วในโมดูลนี้`);
    const label = field.label.trim().toLowerCase();
    if (def.fields.some((item) => item.label.trim().toLowerCase() === label)) bad(`ชื่อฟิลด์ "${field.label}" มีอยู่แล้วในโมดูลนี้`);
  }

  renameField(entityKey: string, fromInput: unknown, toInput: unknown) {    const def = findEntity(entityKey);
    if (!def) notFound('ไม่พบโมดูล');
    if (def.system) bad('ข้อมูลระบบนี้แก้ไขโครงสร้างไม่ได้');
    const from = String(fromInput ?? '').trim();
    const to = String(toInput ?? '').trim();
    const field = def.fields.find((item) => item.key === from);
    if (!field) notFound(`ไม่พบฟิลด์ "${from}"`);
    if (!KEY.test(to)) bad('key ใหม่ต้องเป็นภาษาอังกฤษ/ตัวเลข/ขีดล่าง และขึ้นต้นด้วยตัวอักษร');
    if (RESERVED_FIELD_KEYS.has(to)) bad(`key ใหม่ "${to}" เป็นชื่อสงวนของระบบ`);
    if (from === to) bad('key ใหม่ต้องต่างจาก key เดิม');
    if (def.fields.some((item) => item.key === to)) bad(`key "${to}" ถูกใช้อยู่แล้วในโมดูลนี้`);

    const rows = this.db.select().from(records).where(eq(records.entity, entityKey)).all();
    // Global on purpose: schema changes (rename/delete) apply to every workspace,
    // so the guard must see data from every workspace before allowing it.
    const hasValue = (value: unknown) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
    if (rows.some((row) => hasValue(row.data[to]))) bad(`key "${to}" มีข้อมูลเดิมอยู่แล้ว จึงเปลี่ยนทับไม่ได้`);

    let migrated = 0;
    this.db.transaction((tx) => {
      for (const row of rows) {
        if (!Object.prototype.hasOwnProperty.call(row.data, from)) continue;
        const data = { ...row.data, [to]: row.data[from] };
        delete data[from];
        tx.update(records).set({ data }).where(eq(records.id, row.id)).run();
        migrated++;
      }
    });

    const fields = def.fields.map((item) => {
      if (item.key === from) {
        return {
          ...item,
          key: to,
          formula: item.formula ? String(item.formula).split(`{${from}}`).join(`{${to}}`) : item.formula,
        };
      }
      const next: FieldDef = { ...item };
      if (next.showIf?.field === from) next.showIf = { ...next.showIf, field: to };
      if (next.formula) next.formula = String(next.formula).split(`{${from}}`).join(`{${to}}`);
      return next;
    });
    const updated: EntityDef = {
      ...def,
      fields,
      title: def.title === from ? to : def.title,
      cols: def.cols.map((column) => (column === from ? to : column)),
      filters: def.filters.map((column) => (column === from ? to : column)),
    };
    ENTITY_DEFS[entityKey] = updated;

    for (const row of this.db.select().from(approvals).where(eq(approvals.entity, entityKey)).all()) {
      const payload = row.payload as Record<string, unknown>;
      const fields = payload['fields'];
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
      const map = fields as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(map, from)) continue;
      const nextFields = { ...map, [to]: map[from] };
      delete nextFields[from];
      this.db.update(approvals).set({ payload: { ...payload, fields: nextFields } }).where(eq(approvals.id, row.id)).run();
    }

    const stored = this.read();
    stored.entities[entityKey] = JSON.parse(JSON.stringify(updated));

    const workflowKey = ENTITY_WORKFLOW_KEY[entityKey] ?? entityKey;
    const workflow = (WORKFLOWS as Record<string, { statuses?: { requiredFields?: string[] }[] } | undefined>)[workflowKey];
    if (workflow?.statuses?.length) {
      for (const status of workflow.statuses) {
        if (Array.isArray(status.requiredFields)) {
          status.requiredFields = status.requiredFields.map((key) => (key === from ? to : key));
        }
      }
      stored.workflows[workflowKey] = JSON.parse(JSON.stringify(workflow));
    }

    this.write(stored);
    return { entity: updated, from, to, migrated };
  }

  deleteEntity(key: string): void {
    const def = findEntity(key);
    if (!def) notFound('ไม่พบโมดูล');
    if (!def.custom) bad('ลบได้เฉพาะโมดูลที่สร้างเอง — โมดูลระบบใช้การซ่อน/ปิดใช้งานแทน');
    const count = this.db.select().from(records).where(eq(records.entity, key)).all().filter((r) => !r.deleted).length;
    if (count) bad(`ลบโมดูลไม่ได้ เพราะมีข้อมูล ${count} รายการ`);
    delete ENTITY_DEFS[key];
    delete RESOURCE_LABELS[def.resource];
    delete (WORKFLOWS as Record<string, unknown>)[key];
    const stored = this.read();
    delete stored.entities[key];
    delete stored.workflows[key];
    this.write(stored);
    for (const role of this.db.select().from(roles).all()) {
      if (role.perms[def.resource]) {
        const perms = { ...role.perms };
        delete perms[def.resource];
        this.db.update(roles).set({ perms }).where(eq(roles.id, role.id)).run();
      }
    }
  }

  saveWorkflow(key: string, workflow: unknown): unknown {
    const entityKey = WORKFLOW_ENTITY_KEY[key] ?? key;
    const def = findEntity(entityKey);
    if (!def) notFound('ไม่พบโมดูล');
    if (key === 'project') return this.saveProjectWorkflow(workflow as { steps?: ProjectStepDef[] });
    const wf = workflow as { confirmed?: boolean; statuses?: Record<string, unknown>[] };
    const statuses = Array.isArray(wf?.statuses) ? wf.statuses : [];
    if (!statuses.length) bad('workflow ต้องมีอย่างน้อย 1 สถานะ');
    const keys = new Set<string>();
    const normalized = statuses.map((raw) => {
      const statusKey = String(raw['key'] ?? '').trim();
      if (!KEY.test(statusKey)) bad(`key สถานะ "${statusKey}" ไม่ถูกต้อง`);
      if (keys.has(statusKey)) bad(`key สถานะ "${statusKey}" ซ้ำ`);
      keys.add(statusKey);
      return {
        key: statusKey,
        label: String(raw['label'] ?? statusKey),
        color: String(raw['color'] ?? 'gray'),
        next: Array.isArray(raw['next']) ? raw['next'].map(String) : [],
        requiredFields: Array.isArray(raw['requiredFields']) ? raw['requiredFields'].map(String) : [],
        enabled: raw['enabled'] !== false,
        final: !!raw['final'],
        needClosePerm: !!raw['needClosePerm'],
        approverRole: String(raw['approverRole'] ?? ''),
        approverUser: String(raw['approverUser'] ?? ''),
      };
    });
    for (const status of normalized) {
      for (const next of status.next) if (!keys.has(next)) bad(`สถานะ "${status.label}" ชี้ไปสถานะถัดไป "${next}" ที่ไม่มี`);
      for (const field of status.requiredFields) if (!def.fields.some((f) => f.key === field)) bad(`ฟิลด์บังคับ "${field}" ไม่มีในโมดูล`);
    }
    this.assertApprovers(normalized);
    const old = (WORKFLOWS as Record<string, { statuses?: { key: string }[] }>)[key];
    for (const status of old?.statuses ?? []) {
      if (!keys.has(status.key) && this.statusHasData(entityKey, status.key)) bad(`ลบสถานะ "${status.key}" ไม่ได้ เพราะมีข้อมูลใช้งานอยู่`);
    }
    const previous = ((WORKFLOWS as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>;
    const incoming = wf as Record<string, unknown>;
    const { confirmed, statuses: _incomingStatuses, ...extra } = incoming;
    void _incomingStatuses;
    const savedWorkflow = { ...previous, ...extra, confirmed: !!confirmed, statuses: normalized };
    (WORKFLOWS as Record<string, unknown>)[key] = savedWorkflow;
    const stored = this.read();
    stored.workflows[key] = JSON.parse(JSON.stringify(savedWorkflow));
    this.write(stored);
    this.syncStatusOptions(entityKey, normalized);
    return (WORKFLOWS as Record<string, unknown>)[key];
  }

  /**
   * Keeps the dataset's `status` field options in step with workflow labels/colors,
   * so grids, filters and badges show one consistent set.
   */
  private syncStatusOptions(entityKey: string, statuses: { key: string; label: string; color: string }[]): void {
    const def = findEntity(entityKey);
    const field = def?.fields.find((item) => item.key === 'status');
    if (!def || !field || !statuses.length) return;
    const nextField: FieldDef = {
      ...field,
      options: statuses.map((status) => status.key),
      optionMeta: statuses.map((status) => ({
        id: status.key,
        label: status.label,
        color: isOptionColor(status.color) ? status.color : 'gray',
      })),
    };
    const nextDef: EntityDef = { ...def, fields: def.fields.map((item) => (item.key === 'status' ? nextField : item)) };
    ENTITY_DEFS[entityKey] = nextDef;
    const stored = this.read();
    stored.entities[entityKey] = JSON.parse(JSON.stringify(nextDef));
    this.write(stored);
  }

  saveProjectWorkflow(workflow: { steps?: ProjectStepDef[]; confirmed?: boolean }): unknown {
    const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
    if (!steps.length) bad('workflow โครงการต้องมีอย่างน้อย 1 ขั้นตอน');
    const keys = new Set<string>();
    const normalized = steps.map((raw) => {
      const key = String(raw.key ?? '').trim();
      if (!KEY.test(key)) bad(`key ขั้นตอน "${key}" ไม่ถูกต้อง`);
      if (keys.has(key)) bad(`key ขั้นตอน "${key}" ซ้ำ`);
      keys.add(key);
      return {
        key,
        label: String(raw.label ?? key),
        desc: String(raw.desc ?? ''),
        fields: this.normalizeFields(Array.isArray(raw.fields) ? raw.fields : [], 'project', false),
        docs: Array.isArray(raw.docs)
          ? raw.docs.map((d) => {
              const docKey = String(d.key ?? '').trim();
              if (!KEY.test(docKey)) bad(`key เอกสาร "${docKey}" ไม่ถูกต้อง`);
              return {
                key: docKey,
                label: String(d.label ?? docKey).slice(0, 120),
                ...(d.required ? { required: true } : {}),
                ...(d.signoff ? { signoff: true } : {}),
              };
            })
          : [],
        enabled: raw.enabled !== false,
        requireDocs: !!raw.requireDocs,
        approvalRequired: !!raw.approvalRequired,
        approverRole: String(raw.approverRole ?? ''),
        approverUser: String(raw.approverUser ?? ''),
        source: raw.source ?? 'document',
        ...(Array.isArray(raw.tracks) ? { tracks: raw.tracks.map((track) => String(track)) } : {}),
      };
    });
    const old = WORKFLOWS.project.steps;
    for (const step of old) {
      if (!keys.has(step.key) && this.projectStepUsed(step.key)) bad(`ลบขั้นตอน "${step.label}" ไม่ได้ เพราะมีข้อมูลโครงการใช้งานอยู่`);
    }
    this.assertApprovers(normalized);
    WORKFLOWS.project = { confirmed: !!workflow['confirmed'], steps: normalized as ProjectStepDef[] };
    const stored = this.read();
    stored.workflows['project'] = JSON.parse(JSON.stringify(WORKFLOWS.project));
    this.write(stored);
    return WORKFLOWS.project;
  }

  saveLists(input: { teams?: string[]; depts?: string[] }): { teams: string[]; depts: string[] } {
    const teams = (Array.isArray(input.teams) ? input.teams : LISTS.teams).map((s) => String(s).trim()).filter(Boolean);
    const depts = (Array.isArray(input.depts) ? input.depts : LISTS.depts).map((s) => String(s).trim()).filter(Boolean);
    LISTS.teams = [...new Set(teams)];
    LISTS.depts = [...new Set(depts)];
    const stored = this.read();
    stored.lists = { teams: LISTS.teams, depts: LISTS.depts };
    this.write(stored);
    return stored.lists;
  }

  resetEntity(key: string): void {
    const stored = this.read();
    delete stored.entities[key];
    this.write(stored);
    this.apply(stored);
  }

  saveRole(user: SafeUser, id: string, input: RoleInput): unknown {
    if (!user.isAdmin) forbidden('เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขบทบาทได้');
    const role = this.db.select().from(roles).where(eq(roles.id, id)).all()[0];
    if (!role) notFound('ไม่พบบทบาท');
    if (role.isAdmin && input.perms) bad('บทบาทผู้ดูแลระบบแก้ไขสิทธิ์ไม่ได้');
    if (input.perms) {
      const allowedResources = new Set([
        ...RESOURCES,
        ...Object.values(ENTITY_DEFS).map((entity) => entity.resource),
      ]);
      for (const [resource, actions] of Object.entries(input.perms)) {
        if (!allowedResources.has(resource)) bad(`ไม่รู้จัก resource "${resource}"`);
        if (!actions || typeof actions !== 'object' || Array.isArray(actions)) bad(`สิทธิ์ของ "${resource}" ไม่ถูกต้อง`);
        for (const [action, enabled] of Object.entries(actions)) {
          if (!(ACTIONS as readonly string[]).includes(action)) bad(`ไม่รู้จักสิทธิ์ "${action}"`);
          if (typeof enabled !== 'boolean') bad(`ค่าสิทธิ์ "${resource}.${action}" ต้องเป็น true/false`);
        }
      }
    }
    const next = {
      name: input.name !== undefined ? String(input.name).trim().slice(0, 120) : role.name,
      scope: input.scope ?? role.scope,
      perms: input.perms ?? role.perms,
    };
    if (!next.name) bad('กรุณากรอกชื่อบทบาท');
    if (!['all', 'dept', 'team', 'project', 'site', 'own'].includes(next.scope)) bad('ขอบเขตข้อมูลไม่ถูกต้อง');
    this.db.update(roles).set(next).where(eq(roles.id, id)).run();
    return { ...role, ...next };
  }

  private read(): StoredMetadata {
    const empty: StoredMetadata = { entities: {}, workflows: {}, lists: { ...DEFAULT_LISTS } };
    const row = this.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).all()[0];
    if (!row) return empty;
    try {
      const parsed = row.value as Partial<StoredMetadata>;
      return {
        entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
        workflows: parsed.workflows && typeof parsed.workflows === 'object' ? parsed.workflows : {},
        lists: {
          teams: Array.isArray(parsed.lists?.teams) ? parsed.lists!.teams : [...DEFAULT_LISTS.teams],
          depts: Array.isArray(parsed.lists?.depts) ? parsed.lists!.depts : [...DEFAULT_LISTS.depts],
        },
      };
    } catch {
      return empty;
    }
  }

  private write(stored: StoredMetadata): void {
    const value = JSON.stringify(stored);
    const row = this.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).all()[0];
    if (row) this.db.update(settings).set({ value: stored }).where(eq(settings.key, SETTINGS_KEY)).run();
    else this.db.insert(settings).values({ key: SETTINGS_KEY, value: stored }).run();
    void value;
  }

  private apply(stored: StoredMetadata): void {
    for (const key of Object.keys(ENTITY_DEFS)) {
      if (!DEFAULT_ENTITY_DEFS[key]) delete ENTITY_DEFS[key];
    }
    for (const [key, def] of Object.entries(DEFAULT_ENTITY_DEFS)) ENTITY_DEFS[key] = JSON.parse(JSON.stringify(def));
    for (const [key, def] of Object.entries(stored.entities)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      ENTITY_DEFS[key] = JSON.parse(JSON.stringify(def));
    }

    for (const key of Object.keys(WORKFLOWS)) delete (WORKFLOWS as Record<string, unknown>)[key];
    Object.assign(WORKFLOWS, JSON.parse(JSON.stringify(DEFAULT_WORKFLOWS)));
    for (const [key, wf] of Object.entries(stored.workflows)) (WORKFLOWS as Record<string, unknown>)[key] = JSON.parse(JSON.stringify(wf));

    for (const key of Object.keys(RESOURCE_LABELS)) delete RESOURCE_LABELS[key];
    Object.assign(RESOURCE_LABELS, DEFAULT_RESOURCE_LABELS);
    for (const def of Object.values(ENTITY_DEFS)) RESOURCE_LABELS[def.resource] = def.label;

    LISTS.teams = [...stored.lists.teams];
    LISTS.depts = [...stored.lists.depts];
  }

  private assertApprovers(statuses: { approverRole?: string; approverUser?: string }[]): void {
    const roleIds = new Set(this.db.select().from(roles).all().map((role) => role.id));
    const userIds = new Set(this.db.select().from(users).all().filter((row) => row.active).map((row) => row.id));
    for (const status of statuses) {
      if (status.approverRole && !roleIds.has(status.approverRole)) bad(`ไม่พบบทบาทผู้อนุมัติ "${status.approverRole}"`);
      if (status.approverUser && !userIds.has(status.approverUser)) bad(`ไม่พบผู้ใช้อนุมัติ "${status.approverUser}"`);
    }
  }

  private normalizeFields(fields: FieldDefInput[], entityKey: string, requireLabel = true): FieldDef[] {
    const out: FieldDef[] = [];
    const keys = new Set<string>();
    for (const raw of fields) {
      const key = String(raw.key ?? '').trim();
      if (!KEY.test(key)) bad(`key ฟิลด์ "${key}" ไม่ถูกต้อง`);
      if (RESERVED_FIELD_KEYS.has(key)) bad(`key ฟิลด์ "${key}" เป็นชื่อสงวนของระบบ`);
      if (keys.has(key)) bad(`key ฟิลด์ "${key}" ซ้ำ`);
      keys.add(key);
      const type = String(raw.type ?? 'text') as FieldDef['type'];
      if (!FIELD_TYPES.has(type)) bad(`ชนิดฟิลด์ "${type}" ไม่รองรับ`);
      if (requireLabel && !String(raw.label ?? '').trim()) bad(`กรุณากรอกชื่อฟิลด์ "${key}"`);
      if (raw.required && raw.hidden) bad(`ฟิลด์ "${raw.label || key}" บังคับและซ่อนพร้อมกันไม่ได้`);
      const optionsFrom = raw.optionsFrom === 'teams' || raw.optionsFrom === 'depts' ? raw.optionsFrom : undefined;
      const optionMeta = this.normalizeOptionMeta(raw, type, optionsFrom);
      const options = type === 'select' || type === 'multiselect'
        ? (raw.options ?? []).map(String).length
          ? (raw.options ?? []).map(String)
          : optionMeta.map((option) => option.id)
        : undefined;
      if (options && optionMeta.length && optionMeta.some((option) => !options.includes(option.id))) {
        bad(`ตัวเลือก "${raw.label || key}" มี id ที่ไม่อยู่ในรายการตัวเลือก`);
      }
      if (type === 'select' && !(options ?? []).length && !optionsFrom) bad(`ฟิลด์ "${raw.label || key}" ต้องมีตัวเลือก`);
      if (type === 'ref' && !raw.ref) bad(`ฟิลด์ "${raw.label || key}" ต้องเลือกปลายทาง`);
      if (type === 'ref' && raw.ref !== 'users' && !findEntity(raw.ref ?? '')) bad(`ฟิลด์ "${raw.label || key}" ชี้ไปโมดูล "${raw.ref}" ที่ไม่มี`);
      if (raw.multiple && type !== 'ref') bad(`ฟิลด์ "${raw.label || key}" ตั้งหลายรายการได้เฉพาะ Relation`);
      const displayField = type === 'ref' ? this.displayFieldOf(raw) : undefined;
      if (type === 'rows' && !(raw.cols ?? []).length) bad(`ฟิลด์ "${raw.label || key}" ต้องมีคอลัมน์`);
      out.push({
        ...raw,
        key,
        label: String(raw.label ?? key),
        type,
        required: !!raw.required,
        hidden: !!raw.hidden,
        readOnly: !!raw.readOnly,
        sensitive: !!raw.sensitive,
        archived: !!raw.archived,
        mirror: this.mirrorOf(raw),
        optionFilter: raw.optionFilter?.by && raw.optionFilter?.targetField
          ? { by: String(raw.optionFilter.by), targetField: String(raw.optionFilter.targetField) }
          : undefined,
        options: options ? options.map((option) => option.trim()).filter(Boolean) : undefined,
        optionMeta: optionMeta.length ? optionMeta : undefined,
        multiple: type === 'ref' ? !!raw.multiple : undefined,
        displayField,
        optionsFrom,
        cols: type === 'rows'
          ? (raw.cols ?? []).map((c) => ({
              key: String(c.key ?? ''),
              label: String(c.label ?? c.key ?? ''),
              type: (c.type && FIELD_TYPES.has(c.type) ? c.type : 'text') as FieldDef['type'],
              ref: c.ref ? String(c.ref) : undefined,
              options: Array.isArray(c.options) ? c.options.map(String) : undefined,
              required: !!c.required,
            }))
          : undefined,
        showIf: raw.showIf?.field ? { field: String(raw.showIf.field), value: raw.showIf.value } : undefined,
      });
    }
    for (const field of out) {
      if (field.showIf && !out.some((f) => f.key === field.showIf!.field)) bad(`เงื่อนไขแสดงผลของ "${field.label}" ชี้ไปฟิลด์ที่ไม่มี`);
      if (field.optionFilter) {
        if (field.type !== 'ref') bad(`ตัวกรองตัวเลือกใช้ได้เฉพาะ Relation ("${field.label}")`);
        const by = String(field.optionFilter.by ?? '');
        const targetFieldKey = String(field.optionFilter.targetField ?? '');
        const siblings = out.some((f) => f.key === by) || !!findEntity(entityKey)?.fields.some((f) => f.key === by);
        if (!siblings) bad(`ตัวกรองตัวเลือกของ "${field.label}" ชี้ฟิลด์ "${by}" ที่ไม่มี`);
        const target = findEntity(field.ref ?? '');
        if (!target) bad(`ตัวกรองตัวเลือกของ "${field.label}" ไม่พบโมดูลปลายทาง`);
        const targetField = target.fields.find((f) => f.key === targetFieldKey);
        if (!targetField) bad(`ตัวกรองตัวเลือกของ "${field.label}" ชี้ฟิลด์ "${targetFieldKey}" ที่ไม่มีในปลายทาง`);
        if (targetField.sensitive) bad(`ตัวกรองตัวเลือกของ "${field.label}" ใช้ฟิลด์จำกัดสิทธิ์ไม่ได้`);
      }
    }
    void entityKey;
    return out;
  }

  private normalizeOptionMeta(
    raw: FieldDefInput,
    type: FieldDef['type'],
    optionsFrom: 'teams' | 'depts' | undefined,
  ): OptionDef[] {
    if (type !== 'select' && type !== 'multiselect') return [];
    const input = raw.optionMeta;
    if (!input) return [];
    if (optionsFrom) bad(`ฟิลด์ "${raw.label || raw.key}" ที่ดึงจากรายการทีม/แผนกไม่มี metadata ตัวเลือก`);
    if (!Array.isArray(input)) bad(`metadata ตัวเลือกของ "${raw.label || raw.key}" ไม่ถูกต้อง`);
    const colors = new Set(['gray', 'red', 'amber', 'green', 'blue']);
    const knownRoles = new Set(this.db.select({ id: roles.id }).from(roles).all().map((role) => role.id));
    const out: OptionDef[] = [];
    const ids = new Set<string>();
    for (const option of input) {
      const id = String(option?.id ?? '').trim();
      if (!id) bad(`ตัวเลือกของ "${raw.label || raw.key}" ต้องมี id`);
      if (ids.has(id)) bad(`id ตัวเลือก "${id}" ซ้ำ`);
      ids.add(id);
      const color = option.color === undefined ? undefined : String(option.color);
      if (color && !colors.has(color)) bad(`สีตัวเลือก "${color}" ไม่รองรับ`);
      const optionRoles = Array.isArray(option.roles)
        ? [...new Set(option.roles.map((role) => String(role).trim()).filter(Boolean))]
        : [];
      if (optionRoles.length > 20) bad(`ตัวเลือก "${id}" กำหนดได้ไม่เกิน 20 บทบาท`);
      for (const role of optionRoles) {
        if (!knownRoles.has(role)) bad(`ไม่พบบทบาท "${role}" ของตัวเลือก "${id}"`);
      }
      out.push({
        id,
        label: String(option.label ?? id).trim() || id,
        color: color as OptionDef['color'],
        archived: option.archived === true ? true : undefined,
        roles: optionRoles.length ? optionRoles : undefined,
      });
    }
    return out;
  }

  private displayFieldOf(raw: FieldDefInput): string | undefined {
    if (!raw.displayField) return undefined;
    const target = findEntity(String(raw.ref ?? ''));
    if (!target) bad(`ฟิลด์แสดงชื่อของ "${raw.label || raw.key}" ชี้โมดูลปลายทางที่ไม่มี`);
    const field = target.fields.find((item) => item.key === raw.displayField);
    if (!field) bad(`ฟิลด์แสดงชื่อ "${raw.displayField}" ไม่มีใน ${target.label}`);
    if (field.sensitive) bad(`ฟิลด์แสดงชื่อ "${raw.displayField}" เป็นข้อมูลที่จำกัดสิทธิ์`);
    return field.key;
  }

  private fieldHasData(entity: string, field: string): boolean {
    return this.db
      .select()
      .from(records)
      .where(eq(records.entity, entity))
      .all()
      .filter((row) => !row.deleted)
      .some((row) => {
        const value = row.data[field];
        return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
      });
  }

  private statusHasData(entity: string, status: string): boolean {
    return this.db
      .select()
      .from(records)
      .where(eq(records.entity, entity))
      .all()
      .filter((row) => !row.deleted)
      .some((row) => row.data['status'] === status);
  }

  private projectStepUsed(key: string): boolean {
    return this.db
      .select()
      .from(records)
      .where(eq(records.entity, 'projects'))
      .all()
      .some((row) => {
        const step = (row.data['steps'] as Record<string, { status?: string; values?: Record<string, unknown> }> | undefined)?.[key];
        return !!step && (step.status !== 'pending' || Object.keys(step.values ?? {}).length > 0);
      });
  }
}
