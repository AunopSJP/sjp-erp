import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/database.service.js';
import { approvals, roles, users } from '../db/schema.js';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from './access.service.js';
import { EventsService } from '../events/events.service.js';
import { nowIso } from './dates.js';
import { currentWorkspaceId } from './workspace-context.js';
import { notFound } from './exceptions.js';

export type ApprovalRow = typeof approvals.$inferSelect;

export interface ApprovalRequestInput {
  entity: string;
  recordId: string;
  kind: 'transition' | 'po-status' | 'project-step';
  key: string;
  title: string;
  payload?: Record<string, unknown>;
  approverRole?: string;
  approverUser?: string;
}

export interface ApprovalView extends ApprovalRow {
  byName: string;
  decidedByName: string;
  approverRoleName: string;
  approverUserName: string;
  canDecide: boolean;
}

@Injectable()
export class ApprovalStoreService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly access: AccessService,
    private readonly events: EventsService,
  ) {}

  create(user: SafeUser, input: ApprovalRequestInput): ApprovalView {
    const cfg = {
      approverRole: String(input.approverRole ?? ''),
      approverUser: String(input.approverUser ?? ''),
    };
    const existing = this.db
      .select()
      .from(approvals)
      .where(and(
        eq(approvals.status, 'pending'),
        eq(approvals.entity, input.entity),
        eq(approvals.recordId, input.recordId),
        eq(approvals.workspaceId, currentWorkspaceId()),
      ))
      .all()
      .find((row) => row.kind === input.kind && row.key === input.key);
    if (existing) return this.decorate(existing);

    const row: typeof approvals.$inferInsert = {
      id: crypto.randomUUID(),
      at: nowIso(),
      by: user.id,
      status: 'pending',
      entity: input.entity,
      recordId: input.recordId,
      kind: input.kind,
      key: input.key,
      title: input.title,
      payload: input.payload ?? {},
      cfg,
      note: '',
      workspaceId: currentWorkspaceId(),
    };
    this.db.insert(approvals).values(row).run();
    this.events.publish({
      type: 'approval.requested',
      entity: input.entity,
      recordId: input.recordId,
      actor: user,
      summary: `ขออนุมัติ: ${input.title}`,
      payload: { kind: input.kind, key: input.key, approverRole: cfg.approverRole, approverUser: cfg.approverUser },
    });
    return this.decorate(row as ApprovalRow);
  }

  pendingForRecord(entity: string, recordId: string): ApprovalView[] {
    return this.db
      .select()
      .from(approvals)
      .where(and(
        eq(approvals.status, 'pending'),
        eq(approvals.entity, entity),
        eq(approvals.recordId, recordId),
        eq(approvals.workspaceId, currentWorkspaceId()),
      ))
      .all()
      .map((row) => this.decorate(row));
  }

  listFor(user: SafeUser): { pending: ApprovalView[]; decided: ApprovalView[] } {
    const rows = this.db.select().from(approvals)
      .where(eq(approvals.workspaceId, currentWorkspaceId())).all();
    const relevant = (row: ApprovalRow): boolean => {
      if (user.isAdmin) return true;
      if (row.by === user.id) return true;
      const cfg = row.cfg as { approverRole?: string; approverUser?: string };
      return this.access.isApprover(user, cfg);
    };
    const visible = rows.filter(relevant);
    const pending = visible
      .filter((row) => row.status === 'pending')
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((row) => this.decorate(row, this.access.isApprover(user, row.cfg as { approverRole?: string; approverUser?: string })));
    const decided = visible
      .filter((row) => row.status !== 'pending')
      .sort((a, b) => String(b.decidedAt ?? b.at).localeCompare(String(a.decidedAt ?? a.at)))
      .slice(0, 100)
      .map((row) => this.decorate(row, this.access.isApprover(user, row.cfg as { approverRole?: string; approverUser?: string })));
    return { pending, decided };
  }

  find(id: string): ApprovalRow | undefined {
    return this.db.select().from(approvals)
      .where(and(eq(approvals.id, id), eq(approvals.workspaceId, currentWorkspaceId())))
      .all()[0];
  }

  decide(row: ApprovalRow, user: SafeUser, approve: boolean, note: string): ApprovalView {
    const status = approve ? 'approved' : 'rejected';
    this.db
      .update(approvals)
      .set({ status, decidedBy: user.id, decidedAt: nowIso(), note: String(note ?? '') })
      .where(eq(approvals.id, row.id))
      .run();
    const updated = this.find(row.id);
    if (!updated) notFound('ไม่พบคำขออนุมัติ');
    this.events.publish({
      type: approve ? 'approval.approved' : 'approval.rejected',
      entity: row.entity,
      recordId: row.recordId,
      actor: user,
      summary: `${approve ? 'อนุมัติ' : 'ปฏิเสธ'}: ${row.title}`,
      payload: { note: String(note ?? '') },
    });
    return this.decorate(updated);
  }

  private decorate(row: ApprovalRow, canDecide = false): ApprovalView {
    const userRows = this.db.select().from(users).all();
    const roleRows = this.db.select().from(roles).all();
    const cfg = row.cfg as { approverRole?: string; approverUser?: string };
    return {
      ...row,
      byName: userRows.find((user) => user.id === row.by)?.name ?? row.by,
      decidedByName: row.decidedBy ? (userRows.find((user) => user.id === row.decidedBy)?.name ?? row.decidedBy) : '',
      approverRoleName: cfg.approverRole ? (roleRows.find((role) => role.id === cfg.approverRole)?.name ?? cfg.approverRole) : '',
      approverUserName: cfg.approverUser ? (userRows.find((user) => user.id === cfg.approverUser)?.name ?? cfg.approverUser) : '',
      canDecide,
    };
  }
}
