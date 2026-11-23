import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { AccessService } from '../common/access.service.js';
import { ApprovalStoreService } from '../common/approvals.service.js';
import { addDays, todayStr } from '../common/dates.js';
import { projectStepsFor, WORKFLOWS } from '../meta/entities.js';
import type { SafeUser } from '../auth/user.types.js';
import { RecordsService } from '../records/records.service.js';
import { AccountingService } from './accounting.service.js';
import { StockService } from './stock.service.js';

const HOUR = 3600000;

@Injectable()
export class DashboardService {
  constructor(
    private readonly records: RecordsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly approvals: ApprovalStoreService,
    private readonly accounting: AccountingService,
  ) {}

  ticketMetrics(ticket: Record<string, unknown>) {
    const start = ticket['receivedAt'] ? new Date(String(ticket['receivedAt'])) : new Date();
    const end = ticket['closedAt'] ? new Date(String(ticket['closedAt'])) : new Date();
    return {
      ageH: Math.max(0, (end.getTime() - start.getTime()) / HOUR),
      responseH: ticket['respondedAt'] ? (new Date(String(ticket['respondedAt'])).getTime() - start.getTime()) / HOUR : null,
      resolveH: ticket['resolvedAt'] ? (new Date(String(ticket['resolvedAt'])).getTime() - start.getTime()) / HOUR : null,
    };
  }

  isOpen(ticket: Record<string, unknown>): boolean {
    const status = WORKFLOWS.ticket.statuses.find((s) => s.key === ticket['status']);
    return !status?.final;
  }

  get(user: SafeUser) {
    const tickets = this.access.canEntity(user, 'tickets', 'view') ? this.records.all(user, 'tickets') : [];
    const open = tickets.filter((t) => this.isOpen(t));
    const mine = open.filter((t) => t['assignee'] === user.id);
    const projects = this.access.canEntity(user, 'projects', 'view') ? this.records.all(user, 'projects') : [];
    const activeProjects = projects.filter((p) => !p['closed']);
    const contracts = projects
      .map((project) => {
        const steps = (project['steps'] as Record<string, { values?: Record<string, unknown> }> | undefined) ?? {};
        const end = String(steps['after']?.values?.['svcEnd'] ?? '').trim();
        if (!end) return null;
        const time = new Date(`${end}T00:00:00`).getTime();
        if (!Number.isFinite(time)) return null;
        return { days: Math.ceil((time - Date.now()) / 86400000) };
      })
      .filter((row): row is { days: number } => !!row);
    const pm = this.access.can(user, 'pm', 'view') ? this.records.all(user, 'pmRecords') : [];
    const today = todayStr();
    const pmOpen = pm.filter((r) => r['status'] !== 'เสร็จ');
    const pmOverdue = pmOpen.filter((r) => String(r['dueDate'] ?? '') && String(r['dueDate']) < today);
    const items = this.access.can(user, 'assets', 'view') ? this.records.all(user, 'items') : [];
    const balances = this.stock.balances();
    const lowStock = items.filter((item) => {
      const min = Number(item['minStock'] ?? 0);
      if (!min) return false;
      const total = Object.values(balances).reduce((sum, wh) => sum + (wh[String(item.id)] ?? 0), 0);
      return total < min;
    });
    const serials = this.access.can(user, 'assets', 'view') ? this.records.all(user, 'serials') : [];
    const soon = Date.now() + 30 * 86400000;
    const warranty = serials.filter((s) => {
      if (s['status'] !== 'ติดตั้งแล้ว' || !s['warrantyEnd']) return false;
      const end = new Date(`${String(s['warrantyEnd'])}T00:00:00`).getTime();
      return end >= Date.now() && end <= soon;
    });

    const stepCount: Record<string, number> = {};
    for (const project of activeProjects) {
      const key = this.currentStep(project);
      stepCount[key] = (stepCount[key] ?? 0) + 1;
    }
    const byStatus = WORKFLOWS.ticket.statuses
      .filter((s) => !s.final)
      .map((s) => ({ key: s.key, label: s.label, count: open.filter((t) => t['status'] === s.key).length }))
      .filter((s) => s.count > 0);
    const byTeamMap = new Map<string, number>();
    for (const ticket of open) {
      const key = String(ticket['team'] ?? '(ยังไม่ระบุทีม)');
      byTeamMap.set(key, (byTeamMap.get(key) ?? 0) + 1);
    }
    const byAssigneeMap = new Map<string, number>();
    for (const ticket of open) {
      const key = String(ticket['assignee'] ?? '');
      byAssigneeMap.set(key, (byAssigneeMap.get(key) ?? 0) + 1);
    }
    const metrics = tickets.map((t) => ({ ...this.ticketMetrics(t), code: t.code, title: t.title }));

    const activity = (user.isAdmin ? this.audit.recent(9) : this.audit.recentForUser(user.id, 9)).filter(
      (entry) => !['login', 'logout', 'export', 'seed'].includes(entry.action),
    );

    return {
      tickets: { open: open.length, urgent: open.filter((t) => ['เร่งด่วน', 'สูง'].includes(String(t['priority']))).length, mine: mine.length },
      projects: { active: activeProjects.length, closed: projects.length - activeProjects.length, byStep: stepCount },
      pm: { overdue: pmOverdue.length, week: pmOpen.filter((r) => String(r['dueDate'] ?? '') >= today && String(r['dueDate'] ?? '') <= addDays(today, 7)).length },
      stock: { low: lowStock.length, names: lowStock.slice(0, 3).map((i) => String(i['name'] ?? '')) },
      warranty: warranty.length,
      contracts: {
        active: contracts.filter((row) => row.days > 60).length,
        expiring: contracts.filter((row) => row.days >= 0 && row.days <= 60).length,
        expired: contracts.filter((row) => row.days < 0).length,
      },
      pendingApprovals: this.approvals.listFor(user).pending.filter((row) => row.by !== user.id).length,
      finance: this.accounting.summary(user),
      oldest: [...open]
        .sort((a, b) => new Date(String(a['receivedAt'])).getTime() - new Date(String(b['receivedAt'])).getTime())
        .slice(0, 6)
        .map((t) => ({ ...t, ...this.ticketMetrics(t) })),
      myTickets: mine,
      myPm: pmOpen.filter((r) => r['assignee'] === user.id),
      myProjects: activeProjects.filter((p) => p['manager'] === user.id),
      byStatus,
      byTeam: [...byTeamMap.entries()].map(([label, count]) => ({ label, count })),
      byAssignee: [...byAssigneeMap.entries()].map(([id, count]) => ({ id, label: id ? this.records.labelOf('users', id) : '(ยังไม่มอบหมาย)', count })),
      metrics,
      activity: activity.map((a) => ({ id: a.id, at: a.at, userName: a.userName, action: a.action, summary: a.summary })),
    };
  }

  private currentStep(project: Record<string, unknown>): string {
    const steps = (project['steps'] as Record<string, { status?: string }> | undefined) ?? {};
    const next = projectStepsFor(String(project['track'] ?? '')).find(
      (s) => !['done', 'skipped'].includes(steps[s.key]?.status ?? 'pending'),
    );
    return next?.label.replace(/^\d+\.\s*/, '') ?? 'ครบทุกขั้นตอน';
  }
}

