import { InjectDrizzle } from '@nestjs/drizzle';
import { ConflictException, Injectable } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { roles, settings, userWorkspaces, users, type Perms } from '../db/schema.js';
import { bad, forbidden, notFound } from '../common/exceptions.js';
import type { SafeUser } from './user.types.js';
import { nowIso } from '../common/dates.js';

export interface UserInput {
  username?: string;
  name?: string;
  password?: string;
  roleId?: string;
  dept?: string;
  team?: string;
  projectIds?: string[];
  siteIds?: string[];
  active?: boolean;
}

const USERNAME = /^[a-z0-9._-]{3,50}$/;

@Injectable()
export class UsersService {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  private role(roleId: string) {
    return this.db.select().from(roles).where(eq(roles.id, roleId)).all()[0];
  }

  private safe(row: typeof users.$inferSelect, role = this.role(row.roleId)): SafeUser {
    return {
      id: row.id,
      username: row.username,
      name: row.name,
      roleId: row.roleId,
      roleName: role?.name ?? '(ไม่พบบทบาท)',
      dept: row.dept,
      team: row.team,
      projectIds: row.projectIds,
      siteIds: row.siteIds,
      active: row.active,
      isAdmin: !!role?.isAdmin,
      scope: role?.scope ?? 'all',
      perms: (role?.perms ?? {}) as Perms,
      activeWorkspaceId: row.activeWorkspaceId,
    };
  }

  findByUsername(username: string) {
    return this.db.select().from(users).where(eq(users.username, username.trim().toLowerCase())).all()[0];
  }

  findById(id: string) {
    return this.db.select().from(users).where(eq(users.id, id)).all()[0];
  }

  safeById(id: string): SafeUser | undefined {
    const row = this.findById(id);
    return row ? this.safe(row) : undefined;
  }

  /** Short fingerprint of the current password hash; embedded in JWTs so password changes revoke old tokens. */
  passwordVersion(id: string): string | undefined {
    const row = this.findById(id);
    if (!row) return undefined;
    return createHash('sha256').update(`${row.id}:${row.passwordHash}`).digest('hex').slice(0, 24);
  }

  private sessionVersions(): Record<string, number> {
    const row = this.db.select().from(settings).where(eq(settings.key, 'session_versions')).all()[0];
    const value = row?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, number>;
  }

  sessionVersion(id: string): number {
    return Number(this.sessionVersions()[id] ?? 0);
  }

  /** Invalidate every token issued before this call (logout everywhere for one user). */
  bumpSessionVersion(id: string): number {
    const versions = this.sessionVersions();
    const next = Number(versions[id] ?? 0) + 1;
    versions[id] = next;
    const row = this.db.select().from(settings).where(eq(settings.key, 'session_versions')).all()[0];
    if (row) this.db.update(settings).set({ value: versions }).where(eq(settings.key, 'session_versions')).run();
    else this.db.insert(settings).values({ key: 'session_versions', value: versions }).run();
    return next;
  }

  list(): SafeUser[] {
    return this.db
      .select()
      .from(users)
      .all()
      .map((row) => this.safe(row));
  }

  roleExists(roleId: string): boolean {
    return !!this.role(roleId);
  }

  roles() {
    return this.db.select().from(roles).all();
  }

  private stringList(value: unknown, label: string, fallback: string[]): string[] {
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      bad(`${label} ต้องเป็นรายการข้อความ`);
    }
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 500);
  }

  private booleanValue(value: unknown, label: string, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') bad(`${label} ต้องเป็น true/false`);
    return value;
  }

  /** A non-admin may only assign a role whose permissions are a subset of their own. */
  private canAssignRole(actor: SafeUser | null | undefined, roleId: string): boolean {
    if (!actor || actor.isAdmin) return true;
    const role = this.role(roleId);
    if (!role || role.isAdmin) return false;
    for (const [resource, actions] of Object.entries(role.perms ?? {})) {
      for (const [action, enabled] of Object.entries(actions ?? {})) {
        if (enabled && !actor.perms?.[resource]?.[action]) return false;
      }
    }
    return true;
  }

  async create(input: UserInput, actor?: SafeUser | null): Promise<SafeUser> {
    const username = String(input.username ?? '').trim().toLowerCase();
    const name = String(input.name ?? '').trim().slice(0, 120);
    const password = String(input.password ?? '');
    const roleId = String(input.roleId ?? '');
    if (!USERNAME.test(username)) bad('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง 3–50 ตัวอักษร');
    if (!name) bad('กรุณากรอกชื่อ-สกุล');
    if (password.length < 8 || password.length > 200) bad('รหัสผ่านต้องมี 8–200 ตัวอักษร');
    if (!this.roleExists(roleId)) bad('ไม่พบบทบาทที่เลือก');
    if (!this.canAssignRole(actor, roleId)) forbidden('ไม่สามารถกำหนดบทบาทที่มีสิทธิ์สูงกว่าตัวเองได้');
    if (this.findByUsername(username)) throw new ConflictException('ชื่อผู้ใช้ซ้ำ');

    const now = nowIso();
    const row: typeof users.$inferInsert = {
      id: crypto.randomUUID(),
      username,
      name,
      passwordHash: await hash(password, 12),
      roleId,
      dept: String(input.dept ?? '').slice(0, 120),
      team: String(input.team ?? '').slice(0, 120),
      projectIds: this.stringList(input.projectIds, 'โครงการ', []),
      siteIds: this.stringList(input.siteIds, 'ไซต์', []),
      active: this.booleanValue(input.active, 'สถานะใช้งาน', true),
      activeWorkspaceId: 'default',
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(users).values(row).run();
    const workspaceId = actor?.activeWorkspaceId ?? 'default';
    for (const id of new Set(['default', workspaceId])) {
      this.db.insert(userWorkspaces).values({ userId: row.id, workspaceId: id }).onConflictDoNothing().run();
    }
    return this.safe(row as typeof users.$inferSelect);
  }

  async update(id: string, input: UserInput, actor?: SafeUser | null): Promise<SafeUser> {
    const row = this.findById(id);
    if (!row) notFound('ไม่พบผู้ใช้');
    const currentRole = this.role(row.roleId);
    const roleId = input.roleId ?? row.roleId;
    if (!this.roleExists(roleId)) bad('ไม่พบบทบาทที่เลือก');

    if (actor && !actor.isAdmin) {
      if (currentRole?.isAdmin) forbidden('ไม่สามารถแก้ไขผู้ดูแลระบบได้');
      if (!this.canAssignRole(actor, roleId)) forbidden('ไม่สามารถกำหนดบทบาทที่มีสิทธิ์สูงกว่าตัวเองได้');
      if (input.password && actor.id !== id && this.role(roleId)?.isAdmin) {
        forbidden('ไม่สามารถรีเซ็ตรหัสผ่านของผู้ดูแลระบบได้');
      }
    }

    const active = this.booleanValue(input.active, 'สถานะใช้งาน', row.active);
    const wasAdmin = !!currentRole?.isAdmin;
    const willAdmin = !!this.role(roleId)?.isAdmin;
    if (wasAdmin && (!active || !willAdmin)) {
      const otherAdmins = this.db
        .select()
        .from(users)
        .all()
        .filter((u) => u.id !== id && u.active && !!this.role(u.roleId)?.isAdmin);
      if (!otherAdmins.length) bad('ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน');
    }

    const patch: Partial<typeof users.$inferSelect> = {
      roleId,
      active,
      dept: input.dept !== undefined ? String(input.dept).slice(0, 120) : row.dept,
      team: input.team !== undefined ? String(input.team).slice(0, 120) : row.team,
      projectIds: this.stringList(input.projectIds, 'โครงการ', row.projectIds),
      siteIds: this.stringList(input.siteIds, 'ไซต์', row.siteIds),
      updatedAt: nowIso(),
    };
    if (input.username !== undefined) {
      const username = String(input.username).trim().toLowerCase();
      if (!USERNAME.test(username)) bad('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง 3–50 ตัวอักษร');
      if (this.db.select().from(users).all().some((u) => u.id !== id && u.username === username)) {
        throw new ConflictException('ชื่อผู้ใช้ซ้ำ');
      }
      patch.username = username;
    }
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) bad('กรุณากรอกชื่อ-สกุล');
      patch.name = name;
    }
    if (input.password) {
      if (String(input.password).length < 8) bad('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      patch.passwordHash = await hash(String(input.password), 12);
    }
    this.db.update(users).set(patch).where(eq(users.id, id)).run();
    return this.safe({ ...row, ...patch } as typeof users.$inferSelect);
  }

  activeAdminCount(): number {
    return this.db
      .select()
      .from(users)
      .all()
      .filter((u) => u.active && !!this.role(u.roleId)?.isAdmin).length;
  }

  ensureFirstAdminAllowed(): void {
    if (this.activeAdminCount() > 0) throw new ConflictException('ระบบมีผู้ดูแลระบบแล้ว กรุณาเข้าสู่ระบบ');
  }

  /** Cross-process setup lock. A stale lock older than 5 minutes is ignored. */
  tryAcquireSetupLock(): boolean {
    const existing = this.db.select().from(settings).where(eq(settings.key, 'setup_lock')).all()[0];
    if (existing) {
      const at = (existing.value as { at?: unknown } | null)?.at;
      const started = typeof at === 'string' ? Date.parse(at) : Number.NaN;
      if (Number.isFinite(started) && Date.now() - started < 5 * 60 * 1000) return false;
      this.db.delete(settings).where(eq(settings.key, 'setup_lock')).run();
    }
    try {
      this.db.insert(settings).values({ key: 'setup_lock', value: { at: nowIso() } }).run();
      return true;
    } catch {
      return false;
    }
  }

  releaseSetupLock(): void {
    this.db.delete(settings).where(eq(settings.key, 'setup_lock')).run();
  }
}
