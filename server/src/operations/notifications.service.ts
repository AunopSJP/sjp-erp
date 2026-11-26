import { Injectable } from '@nestjs/common';
import { AccessService } from '../common/access.service.js';
import { ApprovalStoreService } from '../common/approvals.service.js';
import { CompanyService } from '../common/company.service.js';
import { dateKeyOf, timeKeyOf, todayStr } from '../common/dates.js';
import type { SafeUser } from '../auth/user.types.js';
import { projectSteps, WORKFLOWS } from '../meta/entities.js';
import { RecordsService } from '../records/records.service.js';

const SLA_HOURS: Record<string, number> = {
  เร่งด่วน: 4,
  สูง: 8,
  ปกติ: 24,
  ต่ำ: 72,
};

export interface NotificationItem {
  id: string;
  type: 'approval' | 'ticket' | 'pm' | 'project' | 'po' | 'vehicle';
  tone: 'red' | 'amber' | 'blue';
  title: string;
  subtitle: string;
  link: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly records: RecordsService,
    private readonly access: AccessService,
    private readonly approvals: ApprovalStoreService,
    private readonly company: CompanyService,
  ) {}

  list(user: SafeUser) {
    const items: NotificationItem[] = [];
    const today = todayStr();

    for (const approval of this.approvals.listFor(user).pending) {
      if (approval.by === user.id) continue;
      items.push({
        id: `approval-${approval.id}`,
        type: 'approval',
        tone: 'amber',
        title: approval.title,
        subtitle: `${approval.byName} · รออนุมัติ`,
        link: '/approvals',
      });
    }

    if (this.access.canEntity(user, 'vehicleBookings', 'approve')) {
      for (const booking of this.records.all(user, 'vehicleBookings')) {
        if (String(booking['status'] ?? '') !== 'รออนุมัติ') continue;
        const day = dateKeyOf(booking['startAt']);
        if (!day) continue;
        const vehicle = booking['vehicle'] ? this.records.labelOf('vehicles', String(booking['vehicle']), user) : 'รถบริษัท';
        items.push({
          id: `vehicle-${booking.id}`,
          type: 'vehicle',
          tone: 'amber',
          title: `รออนุมัติจองรถ: ${String(booking['title'] ?? booking.code)}`,
          subtitle: `${vehicle} · ${day} ${timeKeyOf(booking['startAt'])} · ${String(booking['requester'] ?? '')}`,
          link: `/vehicles?date=${day}&booking=${booking.id}`,
        });
      }
    }

    if (this.company.get().slaSampleAlerts && this.access.canEntity(user, 'tickets', 'view')) {
      const statuses = WORKFLOWS.ticket.statuses;
      const now = Date.now();
      for (const ticket of this.records.all(user, 'tickets')) {
        const status = statuses.find((item) => item.key === ticket['status']);
        if (!status || status.final) continue;
        const start = ticket['receivedAt'] ? new Date(String(ticket['receivedAt'])).getTime() : now;
        if (!Number.isFinite(start)) continue;
        const ageH = (now - start) / 3600000;
        const limit = SLA_HOURS[String(ticket['priority'] ?? 'ปกติ')] ?? 24;
        if (ageH <= limit) continue;
        const over = Math.floor(ageH - limit);
        items.push({
          id: `ticket-${ticket.id}`,
          type: 'ticket',
          tone: 'red',
          title: `เกิน SLA ${over} ชม.: ${String(ticket['title'] ?? ticket.code)}`,
          subtitle: `${String(ticket.code)} · ${String(ticket['priority'] ?? 'ปกติ')} · ${status.label}`,
          link: `/tickets/${ticket.id}`,
        });
      }
    }

    if (this.access.canEntity(user, 'pmRecords', 'view')) {
      for (const record of this.records.all(user, 'pmRecords')) {
        const due = String(record['dueDate'] ?? '');
        if (!due || record['status'] === 'เสร็จ' || due >= today) continue;
        const plan = record['plan'] ? this.records.labelOf('pmPlans', String(record['plan']), user) : 'งาน PM';
        items.push({
          id: `pm-${record.id}`,
          type: 'pm',
          tone: 'red',
          title: `PM เกินกำหนด: ${plan}`,
          subtitle: `${String(record.code)} · ครบกำหนด ${due}`,
          link: `/pm/records/${record.id}`,
        });
      }
    }

    if (this.access.canEntity(user, 'purchaseOrders', 'view')) {
      for (const po of this.records.all(user, 'purchaseOrders')) {
        const due = String(po['dueDate'] ?? '');
        if (!due || due >= today || ['received', 'closed', 'cancelled'].includes(String(po['status'] ?? ''))) continue;
        items.push({
          id: `po-${po.id}`,
          type: 'po',
          tone: 'amber',
          title: `ใบสั่งซื้อเลยกำหนดส่ง ${String(po.code)}`,
          subtitle: `ครบกำหนด ${due}`,
          link: `/purchase-orders/${po.id}`,
        });
      }
    }

    if (this.access.canEntity(user, 'projects', 'view')) {
      for (const project of this.records.all(user, 'projects')) {
        if (project['closed']) continue;
        const steps = (project['steps'] as Record<string, { status?: string; plannedDate?: string }> | undefined) ?? {};
        for (const step of projectSteps().filter((item) => item.enabled)) {
          const current = steps[step.key];
          if (!current?.plannedDate || current.plannedDate >= today) continue;
          if (['done', 'skipped'].includes(current.status ?? 'pending')) continue;
          items.push({
            id: `project-${project.id}-${step.key}`,
            type: 'project',
            tone: 'amber',
            title: `ขั้นตอนเลยกำหนด: ${String(project['name'] ?? project.code)}`,
            subtitle: `${step.label} · ครบกำหนด ${current.plannedDate}`,
            link: `/projects/${project.id}`,
          });
        }
      }
    }

    const priority = { red: 0, amber: 1, blue: 2 } as const;
    items.sort((a, b) => priority[a.tone] - priority[b.tone]);
    return { count: items.length, items: items.slice(0, 50) };
  }
}
