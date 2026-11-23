import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { events, records, type JsonObject } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from '../common/access.service.js';
import { nowIso } from '../common/dates.js';
import { currentWorkspaceId } from '../common/workspace-context.js';
import { getEntity } from '../meta/entities.js';

export type EventRow = typeof events.$inferSelect;

export interface PublishEventInput {
  type: string;
  entity?: string;
  recordId?: string | null;
  code?: string | null;
  actor?: SafeUser | null;
  actorName?: string;
  summary?: string;
  payload?: JsonObject;
}

export interface EventFilter {
  entity?: string;
  type?: string;
  limit?: number;
}

@Injectable()
export class EventsService {
  private readonly emitter = new EventEmitter();

  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly access: AccessService,
  ) {
    this.emitter.setMaxListeners(50);
  }

  publish(input: PublishEventInput): EventRow {
    const row: typeof events.$inferInsert = {
      id: crypto.randomUUID(),
      workspaceId: currentWorkspaceId(),
      at: nowIso(),
      type: String(input.type ?? 'event'),
      entity: String(input.entity ?? ''),
      recordId: input.recordId ?? null,
      code: input.code ?? null,
      actorId: input.actor?.id ?? null,
      actorName: input.actorName ?? input.actor?.name ?? 'ระบบ',
      summary: String(input.summary ?? ''),
      payload: input.payload ?? {},
    };
    this.db.insert(events).values(row).run();
    const saved = row as EventRow;
    this.emitter.emit('event', saved);
    return saved;
  }

  /** Internal subscription for automation, webhooks or future realtime transports. */
  on(handler: (event: EventRow) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  list(user: SafeUser, filter: EventFilter = {}) {
    const limit = Math.max(1, Math.min(Number(filter.limit) || 100, 500));
    if (filter.entity) {
      const def = this.access.requireEntity(user, filter.entity, 'view');
      const byId = new Map(
        this.db.select().from(records)
          .where(and(eq(records.entity, filter.entity), eq(records.workspaceId, currentWorkspaceId())))
          .all().map((row) => [row.id, row]),
      );
      const rows = this.db
        .select()
        .from(events)
        .where(and(eq(events.entity, filter.entity), eq(events.workspaceId, currentWorkspaceId())))
        .orderBy(desc(events.at))
        .all()
        .filter((event) => {
          if (filter.type && event.type !== filter.type) return false;
          if (!event.recordId) return user.isAdmin || !def.scoped;
          const record = byId.get(event.recordId);
          return !!record && this.access.canSee(user, def, record);
        });
      return rows.slice(0, limit);
    }
    this.access.require(user, 'settings', 'view');
    return this.db
      .select()
      .from(events)
      .where(and(
        eq(events.workspaceId, currentWorkspaceId()),
        ...(filter.type ? [eq(events.type, filter.type)] : []),
      ))
      .orderBy(desc(events.at))
      .limit(limit)
      .all();
  }

  types(): string[] {
    return [...new Set(this.db.select().from(events)
      .where(eq(events.workspaceId, currentWorkspaceId())).all().map((row) => row.type))].sort();
  }
}
