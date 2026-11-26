import { Injectable } from '@nestjs/common';
import { AccessService } from '../common/access.service.js';
import { ApprovalStoreService } from '../common/approvals.service.js';
import { nowIso } from '../common/dates.js';
import { bad } from '../common/exceptions.js';
import { ENTITY_DEFS, WORKFLOWS } from '../meta/entities.js';
import type { SafeUser } from '../auth/user.types.js';
import { RecordsService, type DecoratedRecord } from '../records/records.service.js';

interface TimelineItem {
  id: string;
  at: string;
  by: string | null;
  type: string;
  text: string;
  [key: string]: unknown;
}

const isBlank = (v: unknown) => v === undefined || v === null || v === '';

@Injectable()
export class TicketsService {
  constructor(
    private readonly records: RecordsService,
    private readonly access: AccessService,
    private readonly approvals: ApprovalStoreService,
  ) {
    records.useTransitionHandler('tickets', (user, id, to, opts) => this.status(user, id, to, opts) as DecoratedRecord);
  }

  create(user: SafeUser, values: Record<string, unknown>) {
    const rec = this.records.create(user, 'tickets', values);
    const timeline: TimelineItem[] = [
      {
        id: crypto.randomUUID(),
        at: nowIso(),
        by: user.id,
        type: 'status',
        text: `เปิดเคส (${String(values['channel'] ?? 'ไม่ระบุช่องทาง')}) โดย ${user.name}`,
      },
    ];
    return this.records.patchSystem(user, 'tickets', String(rec.id), { timeline }, `เปิดเคส ${rec.code}`);
  }

  status(
    user: SafeUser,
    id: string,
    to: string,
    opts: { comment?: string; fields?: Record<string, unknown> } = {},
  ) {
    const rec = this.records.get(user, 'tickets', id);
    if (rec._deleted) bad('รายการนี้ถูกยกเลิก/ซ่อนแล้ว');
    this.access.requireEntity(user, 'tickets', 'edit');
    this.access.requireSee(user, WORKFLOW_ENTITY, this.records.rawGet('tickets', id)!);

    const statuses = WORKFLOWS.ticket.statuses;
    const from = statuses.find((s) => s.key === String(rec['status'] ?? ''));
    const target = statuses.find((s) => s.key === to);
    if (!target || !target.enabled) bad('สถานะปลายทางไม่ถูกต้อง');
    if (from?.key === target.key) bad('อยู่ในสถานะนี้แล้ว');
    if (from?.next?.length && !from.next.includes(target.key)) {
      bad(`ไม่สามารถเปลี่ยนจาก "${from.label}" เป็น "${target.label}" ตามเงื่อนไข workflow`);
    }
    if (from?.final && !String(opts.comment ?? '').trim()) bad('การเปิดเคสที่ปิดแล้วต้องระบุเหตุผล');
    if (target.needClosePerm) this.access.requireEntity(user, 'tickets', 'close');

    const fields = this.pickFields('tickets', opts.fields ?? {});
    const merged = { ...rec, ...fields };
    for (const key of target.requiredFields) {
      if (isBlank(merged[key])) {
        const label = ENTITY_DEFS['tickets'].fields.find((field) => field.key === key)?.label ?? key;
        bad(`ต้องกรอก "${label}" ก่อนเปลี่ยนเป็น "${target.label}"`);
      }
    }
    if ((target.approverRole || target.approverUser) && !this.access.isApprover(user, target)) {
      const request = this.approvals.create(user, {
        entity: 'tickets',
        recordId: id,
        kind: 'transition',
        key: target.key,
        title: `Service Ticket ${String(rec.code)}: ${from?.label ?? '–'} → ${target.label}`,
        payload: { to: target.key, fields, comment: opts.comment ?? '' },
        approverRole: target.approverRole,
        approverUser: target.approverUser,
      });
      return { ...rec, _pendingApproval: request };
    }

    const now = nowIso();
    const patch: Record<string, unknown> = { ...fields, status: target.key };
    if (!rec['respondedAt'] && target.key !== 'received') patch['respondedAt'] = now;
    if (['verify', 'informed', 'closed'].includes(target.key) && !rec['resolvedAt']) patch['resolvedAt'] = now;
    if (target.key === 'closed') patch['closedAt'] = now;
    if (from?.final && !target.final) {
      patch['closedAt'] = null;
      patch['reopenedCount'] = Number(rec['reopenedCount'] ?? 0) + 1;
    }
    const timeline: TimelineItem[] = [...((rec['timeline'] as TimelineItem[] | undefined) ?? [])];
    timeline.push({
      id: crypto.randomUUID(),
      at: now,
      by: user.id,
      type: 'status',
      text: `${from?.label ?? '–'} → ${target.label}${opts.comment ? ` — ${opts.comment}` : ''}`,
      from: from?.key,
      to: target.key,
    });
    patch['timeline'] = timeline;
    return this.records.patchSystem(
      user,
      'tickets',
      id,
      patch,
      `เปลี่ยนสถานะ ${String(rec.code)}: ${from?.label ?? '–'} → ${target.label}`,
      [{ field: 'สถานะ', from: from?.key, to: target.key }],
    );
  }

  assign(user: SafeUser, id: string, team: string | undefined, assignee: string | null | undefined, note: string | undefined) {
    this.access.requireEntity(user, 'tickets', 'assign');
    const rec = this.records.get(user, 'tickets', id);
    if (rec._deleted) bad('รายการนี้ถูกยกเลิก/ซ่อนแล้ว');
    this.access.requireSee(user, WORKFLOW_ENTITY, this.records.rawGet('tickets', id)!);
    const timeline: TimelineItem[] = [...((rec['timeline'] as TimelineItem[] | undefined) ?? [])];
    timeline.push({
      id: crypto.randomUUID(),
      at: nowIso(),
      by: user.id,
      type: 'assign',
      text: `มอบหมาย/ส่งต่องาน: ${team ?? rec['team'] ?? '–'} / ${assignee ? this.records.labelOf('users', assignee) : '–'}${note ? ` — ${note}` : ''}`,
    });
    const patch: Record<string, unknown> = { timeline };
    if (team !== undefined) patch['team'] = team;
    if (assignee !== undefined) patch['assignee'] = assignee || null;
    return this.records.patchSystem(user, 'tickets', id, patch, `มอบหมาย ${rec.code}`);
  }

  note(user: SafeUser, id: string, type: string, text: string) {
    this.access.requireEntity(user, 'tickets', 'edit');
    if (!text?.trim()) bad('กรุณากรอกข้อความ');
    const rec = this.records.get(user, 'tickets', id);
    this.access.requireSee(user, WORKFLOW_ENTITY, this.records.rawGet('tickets', id)!);
    const timeline: TimelineItem[] = [...((rec['timeline'] as TimelineItem[] | undefined) ?? [])];
    timeline.push({ id: crypto.randomUUID(), at: nowIso(), by: user.id, type, text: text.trim() });
    return this.records.patchSystem(user, 'tickets', id, { timeline }, `บันทึกข้อความ ${rec.code}`);
  }

  addAppointment(user: SafeUser, id: string, input: Record<string, unknown>) {
    this.access.requireEntity(user, 'tickets', 'edit');
    if (!input['date']) bad('กรุณาระบุวันนัดหมาย');
    const rec = this.records.get(user, 'tickets', id);
    this.access.requireSee(user, WORKFLOW_ENTITY, this.records.rawGet('tickets', id)!);
    const appointments = [...((rec['appointments'] as Record<string, unknown>[] | undefined) ?? [])];
    const appointment = {
      id: crypto.randomUUID(),
      date: String(input['date']),
      time: String(input['time'] ?? ''),
      tech: input['tech'] ?? null,
      note: String(input['note'] ?? ''),
      status: 'นัดหมาย',
    };
    appointments.push(appointment);
    const timeline: TimelineItem[] = [...((rec['timeline'] as TimelineItem[] | undefined) ?? [])];
    timeline.push({
      id: crypto.randomUUID(),
      at: nowIso(),
      by: user.id,
      type: 'visit',
      text: `นัดหมายเข้าหน้างาน ${appointment.date} ${appointment.time} ช่าง: ${appointment.tech ? this.records.labelOf('users', String(appointment.tech)) : '–'}`,
    });
    return this.records.patchSystem(user, 'tickets', id, { appointments, timeline }, `นัดหมายช่าง ${rec.code}`);
  }

  resolveAppointment(user: SafeUser, id: string, appointmentId: string, status: string, result?: string) {
    this.access.requireEntity(user, 'tickets', 'edit');
    if (status === 'เสร็จ' && !String(result ?? '').trim()) bad('กรุณาบันทึกผลการเข้าหน้างาน');
    const rec = this.records.get(user, 'tickets', id);
    this.access.requireSee(user, WORKFLOW_ENTITY, this.records.rawGet('tickets', id)!);
    const appointments = [...((rec['appointments'] as Record<string, unknown>[] | undefined) ?? [])];
    const target = appointments.find((a) => a['id'] === appointmentId);
    if (!target) bad('ไม่พบนัดหมาย');
    target['status'] = status;
    target['result'] = String(result ?? '');
    const timeline: TimelineItem[] = [...((rec['timeline'] as TimelineItem[] | undefined) ?? [])];
    timeline.push({
      id: crypto.randomUUID(),
      at: nowIso(),
      by: user.id,
      type: 'visit',
      text: `${status === 'เสร็จ' ? 'เข้าหน้างานแล้ว' : 'ยกเลิกนัด'} (${target['date']}) — ${result ?? ''}`,
    });
    return this.records.patchSystem(user, 'tickets', id, { appointments, timeline }, `${status} นัดหมาย ${rec.code}`);
  }

  private pickFields(entity: string, values: Record<string, unknown>): Record<string, unknown> {
    // Only fields from metadata are accepted; unknown keys never reach storage.
    const allowed = ENTITY_FIELDS[entity] ?? new Set<string>();
    return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)));
  }
}

const ENTITY_FIELDS: Record<string, Set<string>> = Object.fromEntries(
  Object.values(ENTITY_DEFS).map((def) => [def.key, new Set(def.fields.map((f) => f.key))]),
);
const WORKFLOW_ENTITY = ENTITY_DEFS['tickets'];
