import { Injectable } from '@nestjs/common';
import { AccessService } from '../common/access.service.js';
import { ApprovalStoreService } from '../common/approvals.service.js';
import { CompanyService } from '../common/company.service.js';
import { nowIso, todayStr } from '../common/dates.js';
import { bad } from '../common/exceptions.js';
import { projectSteps, projectStepsFor, WORKFLOWS, type ProjectStepDef } from '../meta/entities.js';
import type { SafeUser } from '../auth/user.types.js';
import { RecordsService } from '../records/records.service.js';

interface DocRecord {
  id?: string;
  name: string;
  size?: number;
  mime?: string;
  url?: string;
  at: string;
  by?: string;
  signerName?: string;
  signerRole?: string;
  signedDate?: string;
  version?: string;
}

interface StepRecord {
  status: 'pending' | 'doing' | 'done' | 'skipped';
  values: Record<string, unknown>;
  docs: Record<string, DocRecord[]>;
  log: { id: string; at: string; by?: string; text: string }[];
  startedAt?: string;
  doneAt?: string;
  actualDate?: string;
  plannedDate?: string;
  owner?: string;
  notes?: string;
}

const emptySteps = (): Record<string, StepRecord> =>
  Object.fromEntries(
    projectSteps().map((step) => [
      step.key,
      { status: 'pending', values: {}, docs: {}, log: [] } as StepRecord,
    ]),
  );

@Injectable()
export class ProjectsService {
  constructor(
    private readonly records: RecordsService,
    private readonly access: AccessService,
    private readonly approvals: ApprovalStoreService,
    private readonly company: CompanyService,
  ) {}

  create(user: SafeUser, values: Record<string, unknown>) {
    const rec = this.records.create(user, 'projects', values, {
      systemFields: { steps: emptySteps(), closed: false },
    });
    const steps = emptySteps();
    steps['req'].status = 'doing';
    steps['req'].startedAt = nowIso();
    steps['req'].log.push({ id: crypto.randomUUID(), at: nowIso(), by: user.id, text: 'เริ่มขั้นตอน' });
    return this.records.patchSystem(user, 'projects', String(rec.id), { steps }, `สร้างโครงการ ${rec.code}`);
  }

  saveStep(
    user: SafeUser,
    id: string,
    key: string,
    input: {
      values?: Record<string, unknown>;
      plannedDate?: string;
      owner?: string;
      notes?: string;
      docs?: Record<string, { name: string; size?: number; at: string; by?: string }[]>;
    },
  ) {
    this.access.requireEntity(user, 'projects', 'edit');
    const rec = this.records.get(user, 'projects', id);
    if (rec._deleted) bad('โครงการถูกยกเลิกแล้ว');
    if (rec['closed']) bad('โครงการถูกปิดแล้ว');
    const step = this.step(rec, key);
    if (!step) bad('ไม่พบขั้นตอน');
    const steps = this.steps(rec);
    const current = steps[key];
    if (input.values) current.values = { ...current.values, ...this.pickStepFields(key, input.values) };
    if (input.plannedDate !== undefined) current.plannedDate = input.plannedDate;
    if (input.owner !== undefined) current.owner = input.owner;
    if (input.notes !== undefined) current.notes = input.notes;
    if (input.docs) current.docs = this.cleanDocs(input.docs);
    current.log.push({ id: crypto.randomUUID(), at: nowIso(), by: user.id, text: 'บันทึกข้อมูลขั้นตอน' });
    return this.records.patchSystem(user, 'projects', id, { steps }, `บันทึกขั้นตอน "${step.label}" ของ ${String(rec.code)}`);
  }

  transit(
    user: SafeUser,
    id: string,
    key: string,
    action: 'start' | 'complete' | 'skip' | 'reopen',
    opts: { reason?: string } = {},
  ) {
    this.access.requireEntity(user, 'projects', 'edit');
    const rec = this.records.get(user, 'projects', id);
    if (rec._deleted) bad('โครงการถูกยกเลิกแล้ว');
    const step = this.step(rec, key);
    if (!step) bad('ไม่พบขั้นตอน');
    const steps = this.steps(rec);
    const current = steps[key];
    const active = this.current(user, rec);
    if (action !== 'reopen' && active?.key !== key) {
      bad(`ต้องดำเนินการขั้นตอนปัจจุบันก่อน ("${active?.label ?? 'ครบทุกขั้นตอน'}")`);
    }
    if (action === 'start') {
      if (current.status !== 'pending') bad('ขั้นตอนนี้เริ่มไปแล้ว');
      current.status = 'doing';
      current.startedAt = nowIso();
      current.log.push({ id: crypto.randomUUID(), at: nowIso(), by: user.id, text: 'เริ่มขั้นตอน' });
    } else if (action === 'complete') {
      for (const field of step.fields) {
        if (field.required && (current.values[field.key] === undefined || current.values[field.key] === '')) {
          bad(`ต้องกรอก "${field.label}" ก่อนจบขั้นตอน`);
        }
      }
      for (const doc of step.docs) {
        const files = current.docs[doc.key] ?? [];
        if ((step.requireDocs || doc.required) && !files.length) {
          bad(`ต้องแนบเอกสาร "${doc.label}" ก่อนจบขั้นตอน`);
        }
        if (doc.signoff && files.length && !files.some((file) => file.signerName && file.signedDate)) {
          bad(`ต้องบันทึกชื่อและวันที่ลงนามของ "${doc.label}" ก่อนจบขั้นตอน`);
        }
      }
      if (key === 'bid' && current.values['bidResult'] === 'รอผล') {
        bad('ผลยังเป็น "รอผล" — เลือกชนะ/ไม่ชนะก่อนจบขั้นตอน');
      }
      this.assertTrackGates(rec, key, current);
      if (step.approvalRequired && (step.approverRole || step.approverUser) && !this.access.isApprover(user, step)) {
        const request = this.approvals.create(user, {
          entity: 'projects',
          recordId: id,
          kind: 'project-step',
          key: step.key,
          title: `โครงการ ${String(rec.code)}: ขออนุมัติจบขั้นตอน "${step.label}"`,
          payload: { stepKey: step.key, action: 'complete' },
          approverRole: step.approverRole,
          approverUser: step.approverUser,
        });
        return { ...rec, _pendingApproval: request };
      }
      current.status = 'done';
      current.doneAt = nowIso();
      current.actualDate = current.actualDate || todayStr();
      current.log.push({ id: crypto.randomUUID(), at: nowIso(), by: user.id, text: 'จบขั้นตอน' });
      if (key === 'bid' && current.values['bidResult'] === 'ไม่ชนะ') {
        const closed = this.records.patchSystem(user, 'projects', id, { steps, closed: true, closeReason: 'ไม่ชนะการเสนอราคา/ประมูล' }, `ปิดโครงการ ${String(rec.code)}: ไม่ชนะ`);
        return closed;
      }
      const next = this.current(user, { ...rec, steps } as Record<string, unknown>);
      if (next?.key === key) {
        const order = projectStepsFor(String(rec['track'] ?? ''));
        const index = order.findIndex((s) => s.key === key);
        const following = order[index + 1];
        if (following && steps[following.key].status === 'pending') {
          steps[following.key].status = 'doing';
          steps[following.key].startedAt = nowIso();
          steps[following.key].log.push({ id: crypto.randomUUID(), at: nowIso(), by: user.id, text: 'เริ่มขั้นตอน' });
        }
      }
    } else if (action === 'skip') {
      if (!String(opts.reason ?? '').trim()) bad('ต้องระบุเหตุผลที่ข้ามขั้นตอน');
      current.status = 'skipped';
      current.log.push({ id: crypto.randomUUID(), at: nowIso(), by: user.id, text: `ข้ามขั้นตอน — ${opts.reason}` });
    } else if (action === 'reopen') {
      if (!String(opts.reason ?? '').trim()) bad('ต้องระบุเหตุผลที่เปิดขั้นตอนใหม่');
      current.status = 'doing';
      current.doneAt = undefined;
      current.log.push({ id: crypto.randomUUID(), at: nowIso(), by: user.id, text: `เปิดขั้นตอนใหม่ — ${opts.reason}` });
      if (rec['closed']) {
        this.access.requireEntity(user, 'projects', 'close');
        this.records.patchSystem(user, 'projects', id, { closed: false, closeReason: '' }, `เปิดโครงการ ${String(rec.code)}`);
      }
    }
    return this.records.patchSystem(
      user,
      'projects',
      id,
      { steps },
      `ขั้นตอน "${step.label}" (${String(rec.code)}): ${action}${opts.reason ? ` — ${opts.reason}` : ''}`,
    );
  }

  close(user: SafeUser, id: string, reason: string) {
    this.access.requireEntity(user, 'projects', 'close');
    if (!String(reason ?? '').trim()) bad('ต้องระบุเหตุผลการปิดโครงการ');
    const rec = this.records.get(user, 'projects', id);
    return this.records.patchSystem(user, 'projects', id, { closed: true, closeReason: reason.trim() }, `ปิดโครงการ ${String(rec.code)} — ${reason.trim()}`);
  }

  /** Keeps attachment payloads bounded and drops unknown keys from clients. */
  private cleanDocs(input: Record<string, unknown>): Record<string, DocRecord[]> {
    const out: Record<string, DocRecord[]> = {};
    for (const [key, list] of Object.entries(input)) {
      if (!Array.isArray(list)) continue;
      out[key] = list.slice(0, 50).map((entry) => {
        const file = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        const text = (value: unknown, max = 300): string => String(value ?? '').trim().slice(0, max);
        const size = Number(file['size'] ?? 0);
        return {
          ...(text(file['id'], 80) ? { id: text(file['id'], 80) } : {}),
          name: text(file['name']) || 'ไฟล์แนบ',
          ...(Number.isFinite(size) && size > 0 ? { size } : {}),
          ...(text(file['mime'], 120) ? { mime: text(file['mime'], 120) } : {}),
          ...(text(file['url'], 500) ? { url: text(file['url'], 500) } : {}),
          at: text(file['at'], 40) || nowIso(),
          ...(text(file['by'], 80) ? { by: text(file['by'], 80) } : {}),
          signerName: text(file['signerName'], 200),
          signerRole: text(file['signerRole'], 60),
          signedDate: text(file['signedDate'], 10),
          version: text(file['version'], 40),
        } as DocRecord;
      });
    }
    return out;
  }

  /**
   * Gates from the government sales/ICT flow:
   * - a government project above the configured value needs a passed ICT defence
   *   before the proposal step can close;
   * - an NT partnership needs the SJP–NT MOU before kickoff can close.
   */
  private assertTrackGates(rec: Record<string, unknown>, key: string, current: StepRecord): void {
    const track = String(rec['track'] ?? '');
    if (key === 'proposal' && track === 'ราชการ (ประมูล)') {
      const threshold = this.company.get().governmentBidThreshold;
      const value = Number(rec['value'] ?? 0);
      if (Number.isFinite(value) && value > threshold) {
        const result = String(current.values['ictDefend'] ?? '');
        if (result !== 'ผ่าน') {
          bad(
            `โครงการราชการมูลค่าเกิน ${threshold.toLocaleString('th-TH')} บาท ต้องบันทึกผล defended ICT เป็น "ผ่าน" ก่อนจบขั้นตอน`,
          );
        }
      }
    }
    if (key === 'kickoff') {
      const partner = String(current.values['partner'] ?? '');
      if ((partner === 'NT' || track === 'ร่วมทุน SJP–NT') && !String(current.values['mouNo'] ?? '').trim()) {
        bad('โครงการที่ร่วมกับ NT ต้องระบุเลขที่ MOU SJP–NT ก่อนจบขั้นตอน Kickoff');
      }
    }
  }

  private steps(rec: Record<string, unknown>): Record<string, StepRecord> {
    return (rec['steps'] as Record<string, StepRecord> | undefined) ?? emptySteps();
  }

  private step(rec: Record<string, unknown>, key: string): ProjectStepDef | undefined {
    return projectStepsFor(String(rec['track'] ?? '')).find((s) => s.key === key);
  }

  private current(user: SafeUser, rec: Record<string, unknown>): { key: string; label: string } | null {
    const steps = this.steps(rec);
    const step = projectStepsFor(String(rec['track'] ?? '')).find((s) => !['done', 'skipped'].includes(steps[s.key]?.status ?? 'pending'));
    void user;
    return step ? { key: step.key, label: step.label } : null;
  }

  private pickStepFields(key: string, values: Record<string, unknown>): Record<string, unknown> {
    const step = projectSteps().find((s) => s.key === key);
    const allowed = new Set((step?.fields ?? []).map((f) => f.key));
    return Object.fromEntries(Object.entries(values).filter(([k]) => allowed.has(k)));
  }
}
