import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { userWorkspaces, users, workspaces } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from '../common/access.service.js';
import { AuditService } from '../common/audit.service.js';
import { nowIso } from '../common/dates.js';
import { bad, forbidden, notFound } from '../common/exceptions.js';

export interface WorkspaceView {
  id: string;
  name: string;
  archived: boolean;
}

const KEY = /^[a-z0-9-]{2,40}$/;

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  list(user: SafeUser): { items: WorkspaceView[]; active: string } {
    const items = this.available(user, true);
    const active = items.some((item) => item.id === user.activeWorkspaceId && !item.archived)
      ? user.activeWorkspaceId
      : items.find((item) => !item.archived)?.id ?? 'default';
    return { items, active };
  }

  create(user: SafeUser, input: { id?: string; name?: string }): WorkspaceView {
    this.access.require(user, 'settings', 'edit');
    const id = String(input?.id ?? '').trim().toLowerCase();
    const name = String(input?.name ?? '').trim();
    if (!KEY.test(id)) bad('รหัส Workspace ใช้ a-z 0-9 - ยาว 2–40 ตัว');
    if (!name) bad('กรุณากรอกชื่อ Workspace');
    if (this.db.select().from(workspaces).where(eq(workspaces.id, id)).all().length) bad('รหัส Workspace นี้มีอยู่แล้ว');
    const now = nowIso();
    this.db.transaction(() => {
      this.db.insert(workspaces).values({ id, name, archived: false, createdAt: now, updatedAt: now }).run();
      this.db.insert(userWorkspaces).values({ userId: user.id, workspaceId: id }).onConflictDoNothing().run();
    });
    this.audit.log(user, {
      action: 'workspace.create', entity: 'settings', recordId: id, recordCode: id,
      summary: `สร้าง Workspace "${name}" (${id})`,
    });
    return { id, name, archived: false };
  }

  update(user: SafeUser, id: string, input: { name?: string; archived?: boolean }): WorkspaceView {
    this.access.require(user, 'settings', 'edit');
    const row = this.db.select().from(workspaces).where(eq(workspaces.id, id)).all()[0];
    if (!row) notFound('ไม่พบ Workspace');
    if (id === 'default' && input?.archived === true) bad('เก็บถาวร Workspace หลักไม่ได้');
    const name = input?.name === undefined ? row.name : String(input.name).trim();
    if (!name) bad('กรุณากรอกชื่อ Workspace');
    const archived = input?.archived === undefined ? row.archived : input.archived === true;
    this.db.update(workspaces).set({ name, archived, updatedAt: nowIso() }).where(eq(workspaces.id, id)).run();
    this.audit.log(user, {
      action: 'workspace.update', entity: 'settings', recordId: id, recordCode: id,
      summary: `แก้ไข Workspace "${name}"${archived ? ' (เก็บถาวร)' : ''}`,
    });
    return { id, name, archived };
  }

  setActive(user: SafeUser, id: string): { active: string } {
    const available = this.available(user, false);
    if (!available.some((item) => item.id === id)) forbidden('ไม่พบ Workspace หรือคุณไม่มีสิทธิ์เข้าถึง');
    this.db.update(users).set({ activeWorkspaceId: id, updatedAt: nowIso() }).where(eq(users.id, user.id)).run();
    return { active: id };
  }

  members(user: SafeUser, id: string): { userIds: string[] } {
    this.access.require(user, 'settings', 'view');
    const exists = this.db.select().from(workspaces).where(eq(workspaces.id, id)).all()[0];
    if (!exists) notFound('ไม่พบ Workspace');
    return {
      userIds: this.db.select().from(userWorkspaces).where(eq(userWorkspaces.workspaceId, id)).all()
        .map((row) => row.userId),
    };
  }

  setMembers(user: SafeUser, id: string, userIds: string[]): { userIds: string[] } {
    this.access.require(user, 'settings', 'edit');
    const exists = this.db.select().from(workspaces).where(eq(workspaces.id, id)).all()[0];
    if (!exists) notFound('ไม่พบ Workspace');
    const wanted = new Set(userIds.map(String));
    const known = new Set(this.db.select().from(users).all().map((row) => row.id));
    for (const userId of wanted) if (!known.has(userId)) bad(`ไม่พบผู้ใช้ ${userId}`);
    this.db.transaction(() => {
      this.db.delete(userWorkspaces).where(eq(userWorkspaces.workspaceId, id)).run();
      for (const userId of wanted) this.db.insert(userWorkspaces).values({ userId, workspaceId: id }).run();
    });
    this.audit.log(user, {
      action: 'workspace.members', entity: 'settings', recordId: id, recordCode: id,
      summary: `ตั้งสมาชิก Workspace ${id}: ${wanted.size} คน`,
    });
    return { userIds: [...wanted] };
  }

  private available(user: SafeUser, includeArchived: boolean): WorkspaceView[] {
    const all = this.db.select().from(workspaces).all()
      .filter((row) => includeArchived || !row.archived)
      .sort((left, right) => (left.id === 'default' ? -1 : right.id === 'default' ? 1 : left.name.localeCompare(right.name, 'th')));
    const member = new Set(this.db.select().from(userWorkspaces)
      .where(eq(userWorkspaces.userId, user.id)).all().map((row) => row.workspaceId));
    return all
      .filter((row) => user.isAdmin || member.has(row.id))
      .map((row) => ({ id: row.id, name: row.name, archived: row.archived }));
  }
}
