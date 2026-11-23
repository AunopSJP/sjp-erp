import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { approvals, audit, counters, events, records, roles, settings, userWorkspaces, users, webhookDeliveries, webhooks, workspaces } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from '../common/access.service.js';
import { AuditService } from '../common/audit.service.js';
import { nowIso } from '../common/dates.js';
import { bad, forbidden } from '../common/exceptions.js';
import { currentWorkspaceId } from '../common/workspace-context.js';
import { FilesService } from '../files/files.service.js';
import { ENTITY_DEFS } from '../meta/entities.js';
import { MetadataService } from '../meta/metadata.service.js';

interface BackupPayload {
  app: string;
  version: number;
  exportedAt: string;
  secretsRedacted?: boolean;
  users: Record<string, unknown>[];
  roles: Record<string, unknown>[];
  records: Record<string, unknown>[];
  counters: Record<string, unknown>[];
  audit: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  files?: unknown[];
  webhooks?: unknown[];
  webhookDeliveries?: unknown[];
  workspaces?: Record<string, unknown>[];
  userWorkspaces?: Record<string, unknown>[];
}

export interface EncryptedBackup {
  app: 'sjp-erp';
  version: 1;
  encrypted: true;
  iv: string;
  tag: string;
  data: string;
}

@Injectable()
export class BackupService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly metadata: MetadataService,
    private readonly files: FilesService,
  ) {}

  private backupKey(): Buffer {
    const secret = process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'sjp-erp-development-backup-key';
    return createHash('sha256').update(secret).digest();
  }

  private encryptPayload(payload: BackupPayload): EncryptedBackup {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.backupKey(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return {
      app: 'sjp-erp',
      version: 1,
      encrypted: true,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  }

  private decryptPayload(input: EncryptedBackup): BackupPayload {
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.backupKey(), Buffer.from(input.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(input.tag, 'base64'));
      const plain = Buffer.concat([decipher.update(Buffer.from(input.data, 'base64')), decipher.final()]).toString('utf8');
      return JSON.parse(plain) as BackupPayload;
    } catch {
      bad('ถอดรหัสไฟล์สำรองไม่สำเร็จ — ตรวจสอบ BACKUP_ENCRYPTION_KEY');
    }
  }

  private async assertCurrentPassword(user: SafeUser, password: string): Promise<void> {
    const row = this.db.select().from(users).where(eq(users.id, user.id)).all()[0];
    if (!row || !(await compare(String(password ?? ''), row.passwordHash))) bad('รหัสผ่านยืนยันไม่ถูกต้อง');
  }

  async exportAll(user: SafeUser, password: string) {
    this.access.require(user, 'settings', 'edit');
    if (!user.isAdmin) forbidden('เฉพาะผู้ดูแลระบบเท่านั้นที่สำรองข้อมูลได้');
    await this.assertCurrentPassword(user, password);
    const settingsRows = this.db.select().from(settings).all().map((row) => {
      if (row.key !== 'notify' || !row.value || typeof row.value !== 'object' || Array.isArray(row.value)) return row;
      return { ...row, value: { ...(row.value as Record<string, unknown>), smtpPass: '', lineToken: '' } };
    });
    const payload = {
      app: 'sjp-erp',
      version: 1,
      exportedAt: nowIso(),
      secretsRedacted: true,
      users: this.db.select().from(users).all(),
      roles: this.db.select().from(roles).all(),
      records: this.db.select().from(records).all(),
      counters: this.db.select().from(counters).all(),
      audit: this.db.select().from(audit).all(),
      settings: settingsRows,
      approvals: this.db.select().from(approvals).all(),
      events: this.db.select().from(events).all(),
      files: this.files.exportAll(),
      webhooks: this.db.select().from(webhooks).all().map((row) => ({ ...row, secret: '' })),
      webhookDeliveries: this.db.select().from(webhookDeliveries).all(),
      workspaces: this.db.select().from(workspaces).all(),
      userWorkspaces: this.db.select().from(userWorkspaces).all(),
    } satisfies BackupPayload;
    return this.encryptPayload(payload);
  }

  async restore(user: SafeUser, input: unknown, confirm: string, password: string) {
    this.access.require(user, 'settings', 'edit');
    if (!user.isAdmin) forbidden('เฉพาะผู้ดูแลระบบเท่านั้นที่กู้คืนข้อมูลได้');
    await this.assertCurrentPassword(user, password);
    if (confirm !== 'RESTORE') bad('ต้องพิมพ์ RESTORE เพื่อยืนยันการกู้คืนข้อมูล');
    const encrypted = input as Partial<EncryptedBackup> | null;
    const payload = encrypted && encrypted.encrypted === true ? this.decryptPayload(encrypted as EncryptedBackup) : (input as BackupPayload | undefined);
    if (!payload || payload.app !== 'sjp-erp' || !Array.isArray(payload.users) || !payload.users.length) {
      bad('ไฟล์สำรองไม่ถูกต้องหรือไม่มีข้อมูลผู้ใช้');
    }
    const tables = ['users', 'roles', 'records', 'counters', 'audit', 'settings', 'approvals'] as const;
    for (const key of tables) {
      if (!Array.isArray(payload[key])) bad(`ไฟล์สำรองขาดส่วน ${key}`);
    }
    this.assertBackupRows(payload);
    const adminRoles = new Set(
      (payload.roles as { id?: unknown; isAdmin?: unknown }[])
        .filter((role) => role?.isAdmin === true)
        .map((role) => String(role.id ?? '')),
    );
    const hasActiveAdmin = (payload.users as { roleId?: unknown; active?: unknown }[]).some(
      (user) => user?.active !== false && adminRoles.has(String(user?.roleId ?? '')),
    );
    if (!hasActiveAdmin) bad('ไฟล์สำรองต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน');

    this.db.transaction((tx) => {
      tx.delete(userWorkspaces).run();
      tx.delete(approvals).run();
      tx.delete(events).run();
      tx.delete(webhookDeliveries).run();
      tx.delete(webhooks).run();
      tx.delete(records).run();
      tx.delete(counters).run();
      tx.delete(settings).run();
      tx.delete(users).run();
      tx.delete(roles).run();
      tx.delete(workspaces).run();

      if (payload.roles.length) tx.insert(roles).values(payload.roles as (typeof roles.$inferInsert)[]).run();
      if (Array.isArray(payload.workspaces) && payload.workspaces.length) {
        tx.insert(workspaces).values(payload.workspaces as (typeof workspaces.$inferInsert)[]).run();
      }
      if (!tx.select().from(workspaces).all().length) {
        const now = nowIso();
        tx.insert(workspaces).values({ id: 'default', name: 'องค์กรหลัก', archived: false, createdAt: now, updatedAt: now }).run();
      }
      if (payload.users.length) tx.insert(users).values(payload.users as (typeof users.$inferInsert)[]).run();
      if (Array.isArray(payload.userWorkspaces) && payload.userWorkspaces.length) {
        tx.insert(userWorkspaces).values(payload.userWorkspaces as (typeof userWorkspaces.$inferInsert)[]).onConflictDoNothing().run();
      }
      // Old backups (and hand-edited ones) may lack memberships: every restored
      // user must still belong to the default workspace and to their active one.
      for (const row of tx.select().from(users).all()) {
        const workspaceId = row.activeWorkspaceId || 'default';
        for (const id of new Set(['default', workspaceId])) {
          tx.insert(userWorkspaces).values({ userId: row.id, workspaceId: id }).onConflictDoNothing().run();
        }
      }
      if (payload.records.length) tx.insert(records).values(payload.records as (typeof records.$inferInsert)[]).run();
      if (payload.counters.length) tx.insert(counters).values(payload.counters as (typeof counters.$inferInsert)[]).run();
      if (payload.settings.length) tx.insert(settings).values(payload.settings as (typeof settings.$inferInsert)[]).run();
      if (payload.approvals.length) tx.insert(approvals).values(payload.approvals as (typeof approvals.$inferInsert)[]).run();
      if (Array.isArray(payload.events) && payload.events.length) {
        tx.insert(events).values(payload.events as (typeof events.$inferInsert)[]).run();
      }
      if (Array.isArray(payload.webhooks) && payload.webhooks.length) {
        tx.insert(webhooks).values(payload.webhooks as (typeof webhooks.$inferInsert)[]).run();
      }
      if (Array.isArray(payload.webhookDeliveries) && payload.webhookDeliveries.length) {
        tx.insert(webhookDeliveries).values(payload.webhookDeliveries as (typeof webhookDeliveries.$inferInsert)[]).run();
      }
    });

    const restoredFiles = Array.isArray(payload.files) ? this.files.restoreAll(payload.files) : 0;
    this.metadata.reload();
    this.bumpAllSessionVersions();
    this.audit.log(user, { action: 'restore', entity: 'settings', summary: 'กู้คืนข้อมูลจากไฟล์สำรอง' });
    return {
      ok: true,
      users: payload.users.length,
      records: payload.records.length,
      settings: payload.settings.length,
      approvals: payload.approvals.length,
      events: payload.events?.length ?? 0,
      files: restoredFiles,
      webhooks: payload.webhooks?.length ?? 0,
      audit: 0,
    };
  }

  private bumpAllSessionVersions(): void {
    const existing = this.db.select().from(settings).where(eq(settings.key, 'session_versions')).all()[0];
    const versions =
      existing?.value && typeof existing.value === 'object' && !Array.isArray(existing.value)
        ? { ...(existing.value as Record<string, number>) }
        : {};
    for (const user of this.db.select().from(users).all()) {
      versions[user.id] = Number(versions[user.id] ?? 0) + 1;
    }
    if (existing) this.db.update(settings).set({ value: versions }).where(eq(settings.key, 'session_versions')).run();
    else this.db.insert(settings).values({ key: 'session_versions', value: versions }).run();
  }

  private assertBackupRows(payload: BackupPayload): void {
    const isObject = (value: unknown): value is Record<string, unknown> =>
      !!value && typeof value === 'object' && !Array.isArray(value);
    const needs = (value: unknown, keys: string[], label: string): void => {
      if (!isObject(value)) bad(`ข้อมูล ${label} ในไฟล์สำรองไม่ถูกต้อง`);
      for (const key of keys) {
        if (typeof value[key] !== 'string' || !String(value[key]).trim()) bad(`ข้อมูล ${label} ขาดฟิลด์ ${key}`);
      }
    };
    for (const row of payload.users) needs(row, ['id', 'username', 'name', 'passwordHash', 'roleId'], 'ผู้ใช้');
    for (const row of payload.roles) {
      needs(row, ['id', 'name'], 'บทบาท');
      if (!isObject(row['perms'])) bad('ข้อมูลบทบาทขาดสิทธิ์ (perms)');
    }
    for (const row of payload.records) {
      needs(row, ['id', 'entity', 'code'], 'รายการ');
      if (!isObject(row['data'])) bad('ข้อมูลรายการขาด data');
    }
    for (const row of payload.settings) needs(row, ['key'], 'ตั้งค่า');
    for (const row of payload.approvals) needs(row, ['id', 'entity', 'recordId', 'kind', 'key'], 'คำขออนุมัติ');
  }

  legacyImport(user: SafeUser, state: unknown, confirm: string) {
    this.access.require(user, 'settings', 'edit');
    if (!user.isAdmin) forbidden('เฉพาะผู้ดูแลระบบเท่านั้นที่นำเข้าข้อมูลได้');
    if (confirm !== 'IMPORT') bad('ต้องพิมพ์ IMPORT เพื่อยืนยันการนำเข้าข้อมูล');
    if (!state || typeof state !== 'object') bad('ข้อมูลจาก React เดิมไม่ถูกต้อง');
    const root = state as Record<string, unknown>;
    const data = (root['data'] && typeof root['data'] === 'object' ? root['data'] : root) as Record<string, unknown>;
    const allowed = new Set(Object.keys(ENTITY_DEFS));
    const imported: Record<string, number> = {};
    const skipped: Record<string, number> = {};
    const codesByEntity = new Map<string, string[]>();
    const now = nowIso();

    this.db.transaction((tx) => {
      for (const [entity, value] of Object.entries(data)) {
        if (!Array.isArray(value)) continue;
        if (!allowed.has(entity)) {
          skipped[entity] = value.length;
          continue;
        }
        const rows: (typeof records.$inferInsert)[] = [];
        const codes: string[] = [];
        for (const item of value) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
          const raw = item as Record<string, unknown>;
          const id = String(raw['id'] ?? crypto.randomUUID()).trim();
          if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;
          const code = (String(raw['code'] ?? '').trim() || `IMP-${id.slice(0, 8)}`).slice(0, 64);
          const recordData = Object.fromEntries(
            Object.entries(raw).filter(
              ([key]) => key !== 'id' && key !== 'code' && !key.startsWith('_') && /^[A-Za-z][A-Za-z0-9_]*$/.test(key),
            ),
          );
          rows.push({
            id,
            entity,
            code,
            data: recordData,
            deleted: raw['_deleted'] === true,
            deletedAt: raw['_deletedAt'] ? String(raw['_deletedAt']) : null,
            deletedBy: raw['_deletedBy'] ? String(raw['_deletedBy']) : null,
            deletedReason: raw['_deletedReason'] ? String(raw['_deletedReason']) : null,
            createdBy: raw['_createdBy'] ? String(raw['_createdBy']) : user.id,
            createdAt: raw['_createdAt'] ? String(raw['_createdAt']) : now,
            updatedBy: raw['_updatedBy'] ? String(raw['_updatedBy']) : user.id,
            updatedAt: raw['_updatedAt'] ? String(raw['_updatedAt']) : now,
          });
          codes.push(code);
        }
        for (let index = 0; index < rows.length; index += 50) {
          tx.insert(records).values(rows.slice(index, index + 50)).onConflictDoNothing().run();
        }
        imported[entity] = rows.length;
        codesByEntity.set(entity, codes);
      }

      for (const [entity, codes] of codesByEntity) {
        let max = 0;
        for (const code of codes) {
          const match = code.match(/(\d+)\s*$/);
          if (match) max = Math.max(max, Number(match[1]));
        }
        const value = max || codes.length;
        const workspaceId = currentWorkspaceId();
        const existing = tx.select().from(counters)
          .where(and(eq(counters.entity, entity), eq(counters.workspaceId, workspaceId))).all()[0];
        if (existing) {
          tx.update(counters).set({ value })
            .where(and(eq(counters.entity, entity), eq(counters.workspaceId, workspaceId))).run();
        } else {
          tx.insert(counters).values({ workspaceId, entity, value }).run();
        }
      }
    });

    const total = Object.values(imported).reduce((sum, count) => sum + count, 0);
    this.audit.log(user, {
      action: 'import',
      entity: 'settings',
      summary: `นำเข้าข้อมูลจาก React เดิม ${total} รายการ`,
    });
    return { ok: true, imported, skipped, total };
  }
}
