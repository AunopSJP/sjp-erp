import { Injectable } from '@nestjs/common';
import { AccessService } from '../common/access.service.js';
import { ApprovalStoreService } from '../common/approvals.service.js';
import { todayStr } from '../common/dates.js';
import { bad } from '../common/exceptions.js';
import { getEntity, WORKFLOWS } from '../meta/entities.js';
import type { SafeUser } from '../auth/user.types.js';
import { RecordsService, type DecoratedRecord, type RawRecord } from '../records/records.service.js';
import type { ListQuery } from '../records/list-query.js';
import { StockService } from './stock.service.js';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly records: RecordsService,
    private readonly access: AccessService,
    private readonly stock: StockService,
    private readonly approvals: ApprovalStoreService,
  ) {
    records.useTransitionHandler(
      'purchaseOrders',
      (user, id, to, opts) => this.status(user, id, to, opts.comment) as DecoratedRecord,
    );
  }

  list(user: SafeUser) {
    this.access.require(user, 'purchase', 'view');
    const receivedByPo = this.receivedByPo();
    return this.records.all(user, 'purchaseOrders').map((po) => {
      const got = receivedByPo.get(String(po.id)) ?? {};
      return {
        ...po,
        amount: this.amount(po),
        receivedMap: got,
        pct: this.progress(po, got),
      };
    });
  }

  page(user: SafeUser, query: ListQuery) {
    const page = this.records.list(user, 'purchaseOrders', query);
    const received = this.receivedByPo(page.items.map((order) => order.id));
    return {
      ...page,
      items: page.items.map((order) => {
        const receivedMap = received.get(order.id) ?? {};
        return { ...order, receivedMap, amount: this.amount(order), pct: this.progress(order, receivedMap) };
      }),
    };
  }

  detail(user: SafeUser, id: string) {
    const po = this.records.get(user, 'purchaseOrders', id);
    const got = this.received(id);
    return {
      ...po,
      amount: this.amount(po),
      receivedMap: got,
      pct: this.progress(po, got),
      receipts: this.records
        .rawAll('stockMoves')
        .filter((move) => move.data['po'] === id && move.data['type'] === 'receive')
        .map((move) => ({ id: move.id, code: move.code, ...move.data })),
    };
  }

  amount(po: Record<string, unknown>): number {
    const lines = Array.isArray(po['lines']) ? (po['lines'] as Record<string, unknown>[]) : [];
    return lines.reduce((sum, line) => sum + Number(line['qty'] ?? 0) * Number(line['unitPrice'] ?? 0), 0);
  }

  /** Percentage received, counting each item once even when its lines are duplicated. */
  private progress(po: Record<string, unknown>, got: Record<string, number>): number {
    const lines = Array.isArray(po['lines']) ? (po['lines'] as Record<string, unknown>[]) : [];
    const ordered = new Map<string, number>();
    for (const line of lines) {
      const item = String(line['item'] ?? '');
      ordered.set(item, (ordered.get(item) ?? 0) + Number(line['qty'] ?? 0));
    }
    const total = [...ordered.values()].reduce((sum, qty) => sum + qty, 0);
    if (!total) return 0;
    const received = [...ordered.entries()].reduce((sum, [item, qty]) => sum + Math.min(qty, got[item] ?? 0), 0);
    return Math.round((received / total) * 100);
  }

  received(poId: string): Record<string, number> {
    return this.receivedByPo([poId]).get(poId) ?? {};
  }

  /** Load stock moves once and group by PO, so list() does not scan them per PO. */
  private receivedByPo(orderIds?: string[]): Map<string, Record<string, number>> {
    const out = new Map<string, Record<string, number>>();
    for (const move of orderIds ? this.records.purchaseReceipts(orderIds) : this.records.rawAll('stockMoves')) {
      if (move.data['type'] !== 'receive') continue;
      const poId = String(move.data['po'] ?? '');
      if (!poId) continue;
      const item = String(move.data['item'] ?? '');
      const byItem = out.get(poId) ?? {};
      byItem[item] = (byItem[item] ?? 0) + Number(move.data['qty'] ?? 0);
      out.set(poId, byItem);
    }
    return out;
  }

  status(user: SafeUser, id: string, to: string, comment?: string) {
    this.access.require(user, 'purchase', 'edit');
    const rec = this.records.get(user, 'purchaseOrders', id);
    if (rec._deleted) bad('ใบสั่งซื้อนี้ถูกยกเลิก/ซ่อนแล้ว');
    const statuses = WORKFLOWS.po.statuses;
    const from = statuses.find((s) => s.key === String(rec['status'] ?? ''));
    const target = statuses.find((s) => s.key === to);
    if (!target || target.enabled === false) bad('สถานะไม่ถูกต้อง');
    if (from?.key === target.key) bad('อยู่ในสถานะนี้แล้ว');
    if (from && !from.next.includes(target.key)) {
      bad(`ไม่สามารถเปลี่ยนจาก "${from.label}" เป็น "${target.label}"`);
    }
    if (target.needClosePerm) this.access.require(user, 'purchase', 'close');
    for (const key of (target as { requiredFields?: string[] }).requiredFields ?? []) {
      const value = rec[key];
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
        const label = getEntity('purchaseOrders')?.fields.find((field) => field.key === key)?.label ?? key;
        bad(`ต้องกรอก "${label}" ก่อนเปลี่ยนเป็น "${target.label}"`);
      }
    }
    if (to === 'ordered' && !(Array.isArray(rec['lines']) && rec['lines'].length)) {
      bad('ใบสั่งซื้อต้องมีรายการ');
    }
    if (to === 'ordered' && this.amount(rec) <= 0) bad('มูลค่าใบสั่งซื้อต้องมากกว่า 0');
    if (from?.final && !String(comment ?? '').trim()) bad('การเปิดรายการที่จบแล้วต้องระบุเหตุผล');

    let approval: { approverRole?: string; approverUser?: string } | null =
      target.approverRole || target.approverUser ? target : null;
    if (!approval && to === 'ordered') {
      const amount = this.amount(rec);
      const limit = [...(WORKFLOWS.po.limits ?? [])]
        .filter((l) => l.upTo !== '' && l.upTo != null)
        .sort((a, b) => Number(a.upTo) - Number(b.upTo))
        .find((l) => amount <= Number(l.upTo));
      if (limit?.approverRole || limit?.approverUser) approval = limit;
    }
    if (approval && (approval.approverRole || approval.approverUser) && !this.access.isApprover(user, approval)) {
      const request = this.approvals.create(user, {
        entity: 'purchaseOrders',
        recordId: id,
        kind: 'po-status',
        key: target.key,
        title: `ใบสั่งซื้อ ${String(rec.code)}: ${from?.label ?? '–'} → ${target.label}`,
        payload: { to: target.key, comment: comment ?? '' },
        approverRole: approval.approverRole,
        approverUser: approval.approverUser,
      });
      return { ...rec, _pendingApproval: request };
    }

    return this.records.patchSystem(
      user,
      'purchaseOrders',
      id,
      { status: target.key },
      `เปลี่ยนสถานะ ${String(rec.code)}: ${from?.label ?? '–'} → ${target.label}`,
      [{ field: 'สถานะ', from: from?.key, to: target.key }],
    );
  }

  receive(
    user: SafeUser,
    id: string,
    warehouse: string,
    lines: { item: string; qty: number; serialNos?: string[] }[],
  ) {
    this.access.require(user, 'warehouse', 'create');
    if (!warehouse) bad('กรุณาเลือกคลังรับเข้า');
    const po = this.records.get(user, 'purchaseOrders', id);
    if (po._deleted) bad('ใบสั่งซื้อนี้ถูกยกเลิก/ซ่อนแล้ว');
    const status = String(po['status'] ?? '');
    if (!['ordered', 'partial'].includes(status)) bad('ใบสั่งซื้อนี้ยังไม่อยู่ในสถานะที่รับสินค้าได้');
    const ordered = (po['lines'] as Record<string, unknown>[] | undefined) ?? [];
    const got = this.received(id);
    const warehouseRow = this.records.rawGet('warehouses', warehouse);
    if (!warehouseRow || warehouseRow.deleted) bad('ไม่พบคลังรับเข้า');

    const prepared: { item: RawRecord; qty: number; serialNos: string[] }[] = [];
    const requested = new Map<string, number>();
    for (const line of lines) {
      const qty = Number(line.qty ?? 0);
      if (!qty) continue;
      if (!Number.isFinite(qty) || qty < 0) bad('จำนวนรับไม่ถูกต้อง');
      const item = this.records.rawGet('items', line.item);
      if (!item || item.deleted) bad('ไม่พบสินค้าที่จะรับ');
      const serialNos = (line.serialNos ?? []).map((n) => n.trim()).filter(Boolean);
      if (item.data['trackSerial'] && serialNos.length !== qty) {
        bad(`กรอก Serial ให้ครบ ${qty} รายการสำหรับ ${String(item.data['name'] ?? '')}`);
      }
      requested.set(item.id, (requested.get(item.id) ?? 0) + qty);
      prepared.push({ item, qty, serialNos });
    }
    if (!prepared.length) bad('ยังไม่ได้ระบุจำนวนที่รับ');

    for (const [itemId, total] of requested) {
      const expected = ordered
        .filter((l) => String(l['item'] ?? '') === itemId)
        .reduce((sum, l) => sum + Number(l['qty'] ?? 0), 0);
      if ((got[itemId] ?? 0) + total > expected) {
        bad(`รับเกินจำนวนสั่งซื้อ: ${this.records.labelOf('items', itemId)}`);
      }
    }

    for (const { item, qty, serialNos } of prepared) {
      const serialIds: string[] = [];
      if (item.data['trackSerial']) {
        for (const serialNo of serialNos) {
          const created = this.records.create(
            user,
            'serials',
            { serialNo, item: item.id, status: 'ในคลัง', warehouse, receivedDate: todayStr() },
            { system: true, actor: user, summary: `รับ Serial ${serialNo} จาก ${String(po.code)}` },
          );
          serialIds.push(String(created.id));
        }
      }
      this.stock.createMove(
        user,
        {
          type: 'receive',
          item: item.id,
          qty,
          serials: serialIds,
          to: warehouse,
          po: id,
          project: (po['project'] as string | undefined) ?? null,
          note: 'ตรวจรับตามใบสั่งซื้อ',
        },
        { system: true, summary: `รับสินค้าตาม ${String(po.code)}` },
      );
    }

    const after = this.received(id);
    const full = ordered.every((line) => {
      const expected = ordered
        .filter((l) => String(l['item'] ?? '') === String(line['item'] ?? ''))
        .reduce((sum, l) => sum + Number(l['qty'] ?? 0), 0);
      return (after[String(line['item'] ?? '')] ?? 0) >= expected;
    });
    const next = full ? 'received' : 'partial';
    const updated = this.records.patchSystem(
      user,
      'purchaseOrders',
      id,
      { status: next },
      `รับสินค้าตาม ${String(po.code)} → ${next === 'received' ? 'รับครบ' : 'รับบางส่วน'}`,
    );
    return { po: updated, received: after, status: next };
  }
}

