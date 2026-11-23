import { Injectable } from '@nestjs/common';
import type { SafeUser } from '../auth/user.types.js';
import { AccessService } from '../common/access.service.js';
import { todayStr } from '../common/dates.js';
import { bad } from '../common/exceptions.js';
import { projectStepsFor, WORKFLOWS } from '../meta/entities.js';
import { PdfService } from '../pdf/pdf.service.js';
import { RecordsService } from '../records/records.service.js';
import { StockService } from './stock.service.js';
import { DashboardService } from './dashboard.service.js';

@Injectable()
export class ReportsService {
  constructor(
    private readonly records: RecordsService,
    private readonly access: AccessService,
    private readonly stock: StockService,
    private readonly dashboard: DashboardService,
    private readonly pdfService: PdfService,
  ) {}

  tickets(user: SafeUser) {
    return this.records.all(user, 'tickets').map((t) => ({
      ...t,
      ...this.dashboard.ticketMetrics(t),
      statusLabel: WORKFLOWS.ticket.statuses.find((s) => s.key === t['status'])?.label ?? String(t['status'] ?? ''),
      open: this.dashboard.isOpen(t),
    }));
  }

  projects(user: SafeUser) {
    return this.records.all(user, 'projects').map((project) => {
      const defs = projectStepsFor(String(project['track'] ?? ''));
      const steps = (project['steps'] as Record<string, { status?: string }> | undefined) ?? {};
      const current = defs.find((s) => !['done', 'skipped'].includes(steps[s.key]?.status ?? 'pending'));
      const done = defs.filter((s) => ['done', 'skipped'].includes(steps[s.key]?.status ?? 'pending')).length;
      const proposal = this.stepValues(project, 'proposal');
      const kickoff = this.stepValues(project, 'kickoff');
      const after = this.stepValues(project, 'after');
      const svcEnd = String(after['svcEnd'] ?? '').trim();
      const svcDays = svcEnd ? Math.ceil((new Date(`${svcEnd}T00:00:00`).getTime() - Date.now()) / 86400000) : null;
      return {
        ...project,
        stepLabel: project['closed'] ? `ปิดโครงการ: ${String(project['closeReason'] ?? '')}` : current?.label ?? 'ครบทุกขั้นตอน',
        done,
        total: defs.length,
        partner: String(kickoff['partner'] ?? ''),
        mouNo: String(kickoff['mouNo'] ?? ''),
        ictDefend: String(proposal['ictDefend'] ?? ''),
        sharePercent: Number(project['sharePercent'] ?? 0) || 0,
        svcContract: String(after['svcContract'] ?? ''),
        svcStart: String(after['svcStart'] ?? ''),
        svcEnd,
        svcDays,
      };
    });
  }

  /** Service contracts that exist on projects, soonest expiry first. */
  serviceContracts(user: SafeUser) {
    return this.projects(user)
      .filter((project) => String(project['svcEnd'] ?? '').trim())
      .map((project) => {
        const days = Number(project['svcDays'] ?? 0);
        return {
          ...project,
          serviceStatus: days < 0 ? 'หมดสัญญา' : days <= 60 ? 'ใกล้หมด' : 'ใช้งาน',
        };
      })
      .sort((a, b) => Number(a['svcDays'] ?? 0) - Number(b['svcDays'] ?? 0));
  }

  private stepValues(project: Record<string, unknown>, key: string): Record<string, unknown> {
    const steps = project['steps'] as Record<string, { values?: Record<string, unknown> }> | undefined;
    return steps?.[key]?.values ?? {};
  }

  /** Revenue split for projects that have a partner share. */
  revenueShare(user: SafeUser) {
    const canAccounting = this.access.can(user, 'accounting', 'view');
    const projects = this.records.all(user, 'projects');
    const invoices = canAccounting ? this.records.all(user, 'invoices') : [];
    const receipts = canAccounting ? this.records.all(user, 'receipts') : [];
    const invoiceProject = new Map(invoices.map((invoice) => [invoice.id, String(invoice['project'] ?? '')]));
    const receivedByProject = new Map<string, number>();
    for (const receipt of receipts) {
      const projectId = invoiceProject.get(String(receipt['invoice'] ?? ''));
      if (!projectId) continue;
      receivedByProject.set(projectId, (receivedByProject.get(projectId) ?? 0) + Number(receipt['amount'] ?? 0));
    }
    return projects
      .map((project) => {
        const kickoff = this.stepValues(project, 'kickoff');
        const sharePercent = Number(project['sharePercent'] ?? 0) || 0;
        const invoiced = invoices
          .filter((invoice) => String(invoice['project'] ?? '') === project.id)
          .reduce((sum, invoice) => sum + Number(invoice['total'] ?? 0), 0);
        const received = receivedByProject.get(project.id) ?? 0;
        const sjpShare = Math.round(received * (sharePercent / 100) * 100) / 100;
        return {
          ...project,
          partner: String(kickoff['partner'] ?? ''),
          sharePercent,
          invoiced,
          received,
          sjpShare,
          partnerShare: Math.round((received - sjpShare) * 100) / 100,
        };
      })
      .filter((row) => row.sharePercent > 0 || String(row['partner']) === 'NT')
      .sort((a, b) => Number(b['received']) - Number(a['received']));
  }

  /** Per-project service summary for one month (tickets + PM). */
  monthlyService(user: SafeUser, month?: string) {
    const period = /^\d{4}-\d{2}$/.test(String(month ?? '')) ? String(month) : todayStr().slice(0, 7);
    const tickets = this.access.canEntity(user, 'tickets', 'view') ? this.records.all(user, 'tickets') : [];
    const projects = this.access.canEntity(user, 'projects', 'view') ? this.records.all(user, 'projects') : [];
    const pm = this.access.can(user, 'pm', 'view') ? this.records.all(user, 'pmRecords') : [];
    const byId = new Map(projects.map((project) => [project.id, project]));
    type Row = {
      id: string;
      projectCode: string;
      projectName: string;
      opened: number;
      closed: number;
      urgent: number;
      responseSum: number;
      responseCount: number;
      resolveSum: number;
      resolveCount: number;
      pmDue: number;
      pmDone: number;
    };
    const rows = new Map<string, Row>();
    const ensure = (id: string): Row => {
      if (!rows.has(id)) {
        const project = byId.get(id);
        rows.set(id, {
          id,
          projectCode: project ? String(project.code) : '',
          projectName: project ? String(project['name'] ?? '') : '(ไม่ระบุโครงการ)',
          opened: 0,
          closed: 0,
          urgent: 0,
          responseSum: 0,
          responseCount: 0,
          resolveSum: 0,
          resolveCount: 0,
          pmDue: 0,
          pmDone: 0,
        });
      }
      return rows.get(id)!;
    };
    for (const ticket of tickets) {
      const openedIn = String(ticket['receivedAt'] ?? '').slice(0, 7);
      const closedIn = String(ticket['closedAt'] ?? '').slice(0, 7);
      if (openedIn !== period && closedIn !== period) continue;
      const row = ensure(String(ticket['project'] ?? '') || '(ไม่ระบุโครงการ)');
      if (openedIn === period) {
        row.opened += 1;
        if (['เร่งด่วน', 'สูง'].includes(String(ticket['priority'] ?? ''))) row.urgent += 1;
        const metrics = this.dashboard.ticketMetrics(ticket);
        if (typeof metrics.responseH === 'number') {
          row.responseSum += metrics.responseH;
          row.responseCount += 1;
        }
      }
      if (closedIn === period) {
        row.closed += 1;
        const metrics = this.dashboard.ticketMetrics(ticket);
        if (typeof metrics.resolveH === 'number') {
          row.resolveSum += metrics.resolveH;
          row.resolveCount += 1;
        }
      }
    }
    for (const record of pm) {
      if (String(record['dueDate'] ?? '').slice(0, 7) !== period) continue;
      const row = ensure(String(record['project'] ?? '') || '(ไม่ระบุโครงการ)');
      row.pmDue += 1;
      if (record['status'] === 'เสร็จ') row.pmDone += 1;
    }
    return [...rows.values()]
      .map((row) => ({
        ...row,
        avgResponse: row.responseCount ? Math.round((row.responseSum / row.responseCount) * 10) / 10 : null,
        avgResolve: row.resolveCount ? Math.round((row.resolveSum / row.resolveCount) * 10) / 10 : null,
      }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName, 'th'));
  }

  serials(user: SafeUser) {
    return this.records.all(user, 'serials').map((s) => {
      const end = s['warrantyEnd'] ? new Date(`${String(s['warrantyEnd'])}T00:00:00Z`).getTime() : null;
      const days = end === null ? null : Math.ceil((end - Date.now()) / 86400000);
      return {
        ...s,
        warranty: end === null ? 'ไม่ระบุ' : days! < 0 ? 'หมดประกัน' : days! <= 30 ? 'ใกล้หมด' : 'อยู่ในประกัน',
      };
    });
  }

  stockReport(user: SafeUser) {
    const balances = this.stock.balances();
    const warehouses = this.access.can(user, 'warehouse', 'view') ? this.records.all(user, 'warehouses') : [];
    const items = this.records.all(user, 'items');
    return items.map((item) => {
      const per = Object.fromEntries(warehouses.map((w) => [w.id, balances[String(w.id)]?.[String(item.id)] ?? 0]));
      return {
        ...item,
        per,
        total: Object.values(per).reduce((sum, value) => sum + value, 0),
      };
    });
  }

  boq(user: SafeUser) {
    const projects = this.records.all(user, 'projects');
    const canPurchase = this.access.can(user, 'purchase', 'view');
    const canWarehouse = this.access.can(user, 'warehouse', 'view');
    const canAssets = this.access.can(user, 'assets', 'view');
    const pos = canPurchase ? this.records.rawAll('purchaseOrders') : [];
    const moves = canWarehouse ? this.records.rawAll('stockMoves') : [];
    const serials = canAssets ? this.records.rawAll('serials') : [];
    return projects.flatMap((project) => {
      const lines = Array.isArray(project['boq']) ? (project['boq'] as Record<string, unknown>[]) : [];
      return lines
        .filter((line) => line['item'])
        .map((line) => {
          const itemId = String(line['item']);
          const ordered = pos
            .filter((p) => !p.deleted && p.data['project'] === project.id && p.data['status'] !== 'cancelled')
            .flatMap((p) => (p.data['lines'] as Record<string, unknown>[] | undefined) ?? [])
            .filter((l) => String(l['item'] ?? '') === itemId)
            .reduce((sum, l) => sum + Number(l['qty'] ?? 0), 0);
          const received = moves
            .filter((m) => !m.deleted && m.data['project'] === project.id && m.data['type'] === 'receive' && String(m.data['item'] ?? '') === itemId)
            .reduce((sum, m) => sum + Number(m.data['qty'] ?? 0), 0);
          const issued = moves
            .filter((m) => !m.deleted && m.data['project'] === project.id && m.data['type'] === 'issue' && String(m.data['item'] ?? '') === itemId)
            .reduce((sum, m) => sum + Number(m.data['qty'] ?? 0), 0);
          const installed = serials.filter(
            (s) => !s.deleted && s.data['project'] === project.id && s.data['item'] === itemId && s.data['status'] === 'ติดตั้งแล้ว',
          ).length;
          return {
            id: `${project.id}-${itemId}`,
            projectId: project.id,
            projectCode: project.code,
            item: itemId,
            itemLabel: this.records.labelOf('items', itemId),
            desc: line['desc'] ?? '',
            qty: Number(line['qty'] ?? 0),
            ordered,
            received,
            issued,
            installed,
          };
        });
    });
  }

  /**
   * สร้าง PDF ของรายงานที่รองรับ (บริการรายเดือน / ส่วนแบ่งรายได้ / สัญญาบริการ)
   * ข้อมูลถูกส่งเป็นตารางให้ PdfService พิมพ์เป็น A4 แนวนอน
   */
  async pdf(user: SafeUser, name: string, month?: string) {
    const money = (value: unknown): string =>
      new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);

    if (name === 'monthly-service') {
      const period = /^\d{4}-\d{2}$/.test(String(month ?? '')) ? String(month) : todayStr().slice(0, 7);
      const rows = this.monthlyService(user, period);
      return this.pdfService.renderReport({
        title: 'รายงานบริการรายเดือน',
        subtitle: `เดือน ${period}`,
        columns: [
          { label: 'โครงการ' },
          { label: 'เปิดใหม่', align: 'right' },
          { label: 'ปิดในเดือน', align: 'right' },
          { label: 'เร่งด่วน/สูง', align: 'right' },
          { label: 'ตอบสนองเฉลี่ย (ชม.)', align: 'right' },
          { label: 'แก้ไขเฉลี่ย (ชม.)', align: 'right' },
          { label: 'PM ครบกำหนด', align: 'right' },
          { label: 'PM เสร็จ', align: 'right' },
        ],
        rows: rows.map((row) => [
          row.projectName,
          String(row.opened),
          String(row.closed),
          String(row.urgent),
          row.avgResponse == null ? '–' : String(row.avgResponse),
          row.avgResolve == null ? '–' : String(row.avgResolve),
          String(row.pmDue),
          String(row.pmDone),
        ]),
        summary: [
          { label: 'โครงการ', value: String(rows.length) },
          { label: 'เคสเปิดใหม่', value: String(rows.reduce((sum, row) => sum + row.opened, 0)) },
          { label: 'ปิดในเดือน', value: String(rows.reduce((sum, row) => sum + row.closed, 0)) },
          { label: 'PM เสร็จ', value: String(rows.reduce((sum, row) => sum + row.pmDone, 0)) },
        ],
        filename: `monthly-service-${period}.pdf`,
        userName: user.name,
      });
    }

    if (name === 'revenue-share') {
      const rows = this.revenueShare(user) as unknown as Record<string, unknown>[];
      return this.pdfService.renderReport({
        title: 'รายงานส่วนแบ่งรายได้',
        subtitle: 'สรุปจากใบแจ้งหนี้และการรับชำระ',
        columns: [
          { label: 'โครงการ' },
          { label: 'คู่สัญญา' },
          { label: 'SJP %', align: 'right' },
          { label: 'มูลค่าสัญญา', align: 'right' },
          { label: 'ออกใบแจ้งหนี้', align: 'right' },
          { label: 'รับชำระแล้ว', align: 'right' },
          { label: 'ส่วน SJP', align: 'right' },
          { label: 'ส่วนพาร์ตเนอร์', align: 'right' },
        ],
        rows: rows.map((row) => [
          String(row['name'] ?? row['code'] ?? ''),
          String(row['partner'] ?? ''),
          String(row['sharePercent'] ?? 0),
          money(row['value']),
          money(row['invoiced']),
          money(row['received']),
          money(row['sjpShare']),
          money(row['partnerShare']),
        ]),
        summary: [
          { label: 'รับชำระรวม', value: money(rows.reduce((sum, row) => sum + Number(row['received'] ?? 0), 0)) },
          { label: 'ส่วน SJP รวม', value: money(rows.reduce((sum, row) => sum + Number(row['sjpShare'] ?? 0), 0)) },
          { label: 'ส่วนพาร์ตเนอร์รวม', value: money(rows.reduce((sum, row) => sum + Number(row['partnerShare'] ?? 0), 0)) },
        ],
        filename: 'revenue-share.pdf',
        userName: user.name,
      });
    }

    if (name === 'service-contracts') {
      const rows = this.serviceContracts(user) as unknown as Record<string, unknown>[];
      return this.pdfService.renderReport({
        title: 'รายงานสัญญาบริการ',
        subtitle: 'สถานะสัญญาและวันหมดอายุ',
        columns: [
          { label: 'รหัส' },
          { label: 'โครงการ' },
          { label: 'เลขที่สัญญา' },
          { label: 'เริ่ม' },
          { label: 'สิ้นสุด' },
          { label: 'เหลือ (วัน)', align: 'right' },
          { label: 'สถานะ' },
        ],
        rows: rows.map((row) => [
          String(row['code'] ?? ''),
          String(row['name'] ?? ''),
          String(row['svcContract'] ?? ''),
          String(row['svcStart'] ?? ''),
          String(row['svcEnd'] ?? ''),
          String(row['svcDays'] ?? ''),
          String(row['serviceStatus'] ?? ''),
        ]),
        summary: [
          { label: 'สัญญาทั้งหมด', value: String(rows.length) },
          { label: 'ใกล้หมด (≤60 วัน)', value: String(rows.filter((row) => row['serviceStatus'] === 'ใกล้หมด').length) },
          { label: 'หมดสัญญา', value: String(rows.filter((row) => row['serviceStatus'] === 'หมดสัญญา').length) },
        ],
        filename: 'service-contracts.pdf',
        userName: user.name,
      });
    }

    bad('ไม่มีรายงาน PDF ชนิดนี้');
  }
}

