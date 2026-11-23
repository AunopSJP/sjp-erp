import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { users } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { findEntity, isOperational, type EntityDef } from '../meta/entities.js';
import { forbidden, notFound } from './exceptions.js';

export interface RecordLike {
  id: string;
  data: Record<string, unknown>;
  createdBy?: string | null;
  deleted?: boolean;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

@Injectable()
export class AccessService {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  can(user: SafeUser, resource: string, action: string): boolean {
    if (!user.active) return false;
    if (user.isAdmin) return true;
    return !!user.perms?.[resource]?.[action];
  }

  require(user: SafeUser, resource: string, action: string): void {
    if (!this.can(user, resource, action)) forbidden();
  }

  /** File uploads are allowed for users who can create/edit any business record. */
  canUploadFiles(user: SafeUser): boolean {
    if (!user.active) return false;
    if (user.isAdmin) return true;
    return ['master', 'assets', 'projects', 'tickets', 'purchase', 'warehouse', 'accounting', 'pm', 'vehicles', 'vehicleBookings', 'settings'].some(
      (resource) => !!user.perms?.[resource]?.['create'] || !!user.perms?.[resource]?.['edit'],
    );
  }

  requireUploadFiles(user: SafeUser): void {
    if (!this.canUploadFiles(user)) forbidden('ไม่มีสิทธิ์อัปโหลดไฟล์');
  }

  /** User pickers are available to user managers and roles that assign work. */
  canPickUsers(user: SafeUser): boolean {
    return this.can(user, 'users', 'view') || ['tickets', 'projects', 'pm', 'vehicleBookings'].some((resource) => this.can(user, resource, 'edit'));
  }

  canEntity(user: SafeUser, entityKey: string, action: string): boolean {
    const def = findEntity(entityKey);
    return !!def && isOperational(def) && this.can(user, def.resource, action);
  }

  requireEntity(user: SafeUser, entityKey: string, action: string): EntityDef {
    const def = findEntity(entityKey);
    if (!def || !isOperational(def)) forbidden('ไม่พบรายการหรือคุณไม่มีสิทธิ์เข้าถึง');
    this.require(user, def.resource, action);
    return def;
  }

  canSee(user: SafeUser, def: EntityDef, record: RecordLike): boolean {
    if (!user.active) return false;
    if (user.isAdmin || user.scope === 'all' || !def.scoped) return true;
    const data = record.data;
    const mine =
      str(data['assignee']) === user.id ||
      str(data['manager']) === user.id ||
      record.createdBy === user.id;
    if (mine) return true;
    switch (user.scope) {
      case 'own':
        return false;
      case 'team':
        return !!str(data['team']) && str(data['team']) === user.team;
      case 'dept': {
        const ownerId = str(data['assignee']) || str(data['manager']) || record.createdBy || '';
        if (!ownerId) return false;
        const owner = this.db.select().from(users).where(eq(users.id, ownerId)).all()[0];
        return !!owner && !!user.dept && owner.dept === user.dept;
      }
      case 'project':
        return def.key === 'projects'
          ? user.projectIds.includes(record.id)
          : user.projectIds.includes(str(data['project']));
      case 'site':
        return def.key === 'sites'
          ? user.siteIds.includes(record.id)
          : user.siteIds.includes(str(data['site']));
      default:
        return false;
    }
  }

  requireSee(user: SafeUser, def: EntityDef, record: RecordLike): void {
    // ตอบ 404 แทน 403 เพื่อไม่เปิดเผยว่ามีรายการนี้อยู่จริง
    if (!this.canSee(user, def, record)) notFound('ไม่พบรายการ');
  }

  isApprover(user: SafeUser, cfg: { approverRole?: string; approverUser?: string } | null | undefined): boolean {
    if (!cfg) return false;
    if (user.isAdmin) return true;
    return (!!cfg.approverUser && cfg.approverUser === user.id) || (!!cfg.approverRole && cfg.approverRole === user.roleId);
  }
}
