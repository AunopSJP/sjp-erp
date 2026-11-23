import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { audit } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { nowIso } from './dates.js';
import { currentWorkspaceId } from './workspace-context.js';

export interface AuditInput {
  action: string;
  entity?: string | null;
  recordId?: string | null;
  recordCode?: string | null;
  summary: string;
  changes?: unknown[];
}

@Injectable()
export class AuditService {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  log(actor: SafeUser | null, input: AuditInput): void {
    this.db
      .insert(audit)
      .values({
        id: crypto.randomUUID(),
        workspaceId: currentWorkspaceId(),
        at: nowIso(),
        userId: actor?.id ?? null,
        userName: actor?.name ?? 'ระบบ',
        action: input.action,
        entity: input.entity ?? null,
        recordId: input.recordId ?? null,
        recordCode: input.recordCode ?? '',
        summary: input.summary,
        changes: input.changes ?? [],
      })
      .run();
  }

  listByEntity(entity: string, recordId?: string) {
    const where = recordId
      ? and(eq(audit.entity, entity), eq(audit.recordId, recordId), eq(audit.workspaceId, currentWorkspaceId()))
      : and(eq(audit.entity, entity), eq(audit.workspaceId, currentWorkspaceId()));
    return this.db.select().from(audit).where(where).orderBy(desc(audit.at)).all();
  }

  recent(limit = 20) {
    return this.db.select().from(audit)
      .where(eq(audit.workspaceId, currentWorkspaceId()))
      .orderBy(desc(audit.at)).limit(limit).all();
  }

  recentForUser(userId: string, limit = 20) {
    return this.db
      .select()
      .from(audit)
      .where(and(eq(audit.userId, userId), eq(audit.workspaceId, currentWorkspaceId())))
      .orderBy(desc(audit.at))
      .limit(limit)
      .all();
  }
}
