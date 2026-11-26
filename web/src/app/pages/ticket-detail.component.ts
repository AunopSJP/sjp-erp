import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { PdfService } from '../core/pdf.service';
import { readDetailNav } from '../core/storage';
import { ageHours, fmtDate, fmtDateTime, fmtDuration, listNeighbours, todayStr } from '../core/util';
import { FieldComponent } from '../shared/fields.component';
import { IconComponent } from '../shared/icon.component';
import { RecordFormComponent } from '../shared/record-form.component';
import { ToastService } from '../shared/toast.service';
import type { ApprovalRow, FieldDef, Option, RecordRow, WorkflowStatus } from '../core/models';

const SLA_HOURS: Record<string, number> = { เร่งด่วน: 4, สูง: 8, ปกติ: 24, ต่ำ: 72 };

@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  imports: [FieldComponent, IconComponent, RecordFormComponent],
  template: `
    @if (record(); as ticket) {
      <div class="page">
        <div class="page-head">
          <div><h1>{{ ticket['title'] }}</h1><div class="muted">{{ ticket.code }} · เปิดเมื่อ {{ fmtDateTime(ticket['receivedAt']) }}</div></div>
          <div class="page-actions">
            <button type="button" class="btn" (click)="back()">‹ รายการ</button>
            @if (nav(); as position) {
              <div class="nav-pair" role="group" aria-label="เลื่อนไประหว่างเคส">
                <button type="button" class="btn nav-step" [disabled]="!position.prev" (click)="goSibling(position.prev)" aria-label="เคสก่อนหน้า">‹</button>
                <span class="nav-count">{{ position.index + 1 }}/{{ position.total }}</span>
                <button type="button" class="btn nav-step" [disabled]="!position.next" (click)="goSibling(position.next)" aria-label="เคสถัดไป">›</button>
              </div>
            }
            <button type="button" class="btn" (click)="printPage()">พิมพ์</button>
            <button type="button" class="btn" (click)="downloadPdf()">ดาวน์โหลด PDF</button>
            @if (auth.can('tickets', 'edit')) { <button type="button" class="btn" (click)="editOpen.set(true)">แก้ไขข้อมูล</button> }
          </div>
        </div>

        <div class="statbar">
          <div class="stat"><div class="l">สถานะ</div><div class="v"><span class="badge {{ statusColor(ticket['status']) }}">{{ statusLabel(ticket['status']) }}</span></div><div class="s">{{ ticket['priority'] }} · {{ ticket['category'] }}</div></div>
          <div class="stat"><div class="l">อายุเคส</div><div class="v">{{ fmtDuration(age(ticket)) }}</div><div class="s">@if (slaEnabled()) {เป้าหมาย SLA {{ slaLimit(ticket) }} ชม. · }นับจาก {{ fmtDateTime(ticket['receivedAt']) }}</div></div>
          <div class="stat"><div class="l">เวลาตอบสนองครั้งแรก</div><div class="v">{{ response(ticket) }}</div><div class="s">{{ ticket['respondedAt'] ? fmtDateTime(ticket['respondedAt']) : 'ยังไม่ได้ตอบสนอง' }}</div></div>
          <div class="stat"><div class="l">เวลาแก้ไข/ปิด</div><div class="v">{{ resolve(ticket) }}</div><div class="s">{{ ticket['closedAt'] ? 'ปิดเมื่อ ' + fmtDateTime(ticket['closedAt']) : 'ยังไม่ปิดเคส' }}</div></div>
        </div>

        @if (slaNotice(); as sla) {
          <div class="notice sla-notice" [class.warn]="sla.tone === 'warn'" [class.bad]="sla.tone === 'bad'">
            <app-icon name="clock" [size]="18" class="sla-ic" />
            <div class="sla-body"><b>{{ sla.title }}</b><span>{{ sla.detail }}</span></div>
          </div>
        }

        @if (pendingApprovals().length) {
          <div class="notice small" role="status">
            รออนุมัติ: {{ pendingApprovals()[0].title }} · ผู้อนุมัติ {{ pendingApprovals()[0].approverUserName || pendingApprovals()[0].approverRoleName || 'ผู้ดูแลระบบ' }}
            — ติดตามผลได้ที่เมนู “คำขออนุมัติ”
          </div>
        }

        <div class="tabs">
          <button type="button" [class.active]="tab() === 'info'" (click)="tab.set('info')">รายละเอียด</button>
          <button type="button" [class.active]="tab() === 'timeline'" (click)="tab.set('timeline')">ไทม์ไลน์ <span class="tab-count">{{ asArray(ticket['timeline']).length }}</span></button>
          <button type="button" [class.active]="tab() === 'visit'" (click)="tab.set('visit')">นัดหมาย/หน้างาน <span class="tab-count">{{ asArray(ticket['appointments']).length }}</span></button>
          <button type="button" [class.active]="tab() === 'audit'" (click)="tab.set('audit')">ประวัติการแก้ไข</button>
        </div>

        @if (tab() === 'info') {
          <div class="detail-layout">
            <div class="card">
              @for (field of visibleFields(); track field.key) { <div class="kv"><div class="k">{{ field.label }}</div><div class="v">{{ display(field, ticket) }}@if (field.help) { <div class="kv-help">{{ field.help }}</div> }</div></div> }
            </div>
            <div class="card no-print action-panel">
              <h3>เปลี่ยนสถานะ</h3>
              @if (!statusOptions().length) {
                <div class="muted">ไม่มีสถานะถัดไปที่เปลี่ยนได้</div>
              } @else {
                <div class="field"><label for="lf-ticket-detail-component-1">เปลี่ยนเป็น</label><select id="lf-ticket-detail-component-1" [value]="statusTo()" (change)="setStatusTo($any($event.target).value)">@for (status of statusOptions(); track status.key) { <option [value]="status.key" [selected]="status.key === statusTo()">{{ status.label }}</option> }</select></div>
                @for (field of requiredFields(); track field.key) {
                  <app-field [field]="field" [value]="statusFields()[field.key] ?? ''" (valueChange)="setStatusField(field.key, $event)" />
                }
                <div class="field"><label for="lf-ticket-detail-component-2">หมายเหตุ/ข้อความแจ้งผู้ใช้</label><textarea id="lf-ticket-detail-component-2" rows="3" [value]="statusComment()" (input)="statusComment.set($any($event.target).value)"></textarea></div>
                <button type="button" class="btn primary block" [disabled]="statusBusy()" (click)="changeStatus()">{{ statusBusy() ? 'กำลังบันทึก…' : 'ยืนยันเปลี่ยนสถานะ' }}</button>
              }

              <h3>มอบหมาย/ส่งต่อ</h3>
              <div class="form-grid">
                <div class="field"><label for="lf-ticket-detail-component-3">ทีม</label><select id="lf-ticket-detail-component-3" [value]="assignTeam()" (change)="assignTeam.set($any($event.target).value)"><option value="" [selected]="!assignTeam()">–</option>@for (team of lists().teams; track team) { <option [value]="team" [selected]="team === assignTeam()">{{ team }}</option> }</select></div>
                <div class="field"><label for="lf-ticket-detail-component-4">ผู้รับผิดชอบ</label><select id="lf-ticket-detail-component-4" [value]="assignee()" (change)="assignee.set($any($event.target).value)"><option value="" [selected]="!assignee()">–</option>@for (user of users(); track user.value) { <option [value]="user.value" [selected]="user.value === assignee()">{{ user.label }}</option> }</select></div>
                <div class="field wide"><label for="lf-ticket-detail-component-5">หมายเหตุ</label><input id="lf-ticket-detail-component-5" [value]="assignNote()" (input)="assignNote.set($any($event.target).value)" /></div>
              </div>
              <button type="button" class="btn block" [disabled]="assignBusy()" (click)="assign()">บันทึกการมอบหมาย</button>

              <h3>เพิ่มบันทึก</h3>
              <div class="field"><label for="lf-ticket-detail-component-6">รายละเอียด/บันทึก</label><textarea id="lf-ticket-detail-component-6" rows="3" [value]="noteText()" (input)="noteText.set($any($event.target).value)" placeholder="ข้อความ เช่น แจ้งผลให้ผู้ใช้ ปัญหาที่ยังติดขัด"></textarea></div>
              <div class="action-row">
                <button type="button" class="btn" [disabled]="noteBusy()" (click)="addNote('note')">เพิ่มบันทึก</button>
                <button type="button" class="btn" [disabled]="noteBusy()" (click)="addNote('remote')">บันทึกแก้ไขระยะไกล</button>
              </div>
            </div>
          </div>
        }

        @if (tab() === 'timeline') {
          <div class="card">
            @if (!asArray(ticket['timeline']).length) { <div class="state empty">ยังไม่มีไทม์ไลน์</div> }
            @else {
              <div class="timeline">
                @for (item of asArray(ticket['timeline']).slice().reverse(); track item['id']) {
                  <div class="tl-item"><div class="tl-dot"></div><div><div><span class="badge gray">{{ item['type'] }}</span> {{ item['text'] }}</div><div class="muted small">{{ fmtDateTime(item['at']) }}</div></div></div>
                }
              </div>
            }
          </div>
        }

        @if (tab() === 'visit') {
          <div class="card">
            <h3>นัดหมายเข้าหน้างาน</h3>
            @if (asArray(ticket['appointments']).length) {
              <table class="mini"><thead><tr><th scope="col">วันที่</th><th scope="col">เวลา</th><th scope="col">ช่าง</th><th scope="col">สถานะ</th><th scope="col">ผล</th><th scope="col"></th></tr></thead>
                <tbody>@for (appt of asArray(ticket['appointments']); track appt['id']) {
                  <tr><td>{{ fmtDate(appt['date']) }}</td><td>{{ appt['time'] }}</td><td>{{ userName(appt['tech']) }}</td><td><span class="badge gray">{{ appt['status'] }}</span></td><td>{{ appt['result'] || appt['note'] }}</td><td>@if (appt['status'] === 'นัดหมาย') { <button type="button" class="btn sm" (click)="resolveAppointment(appt)">บันทึกผล</button> }</td></tr>
                }</tbody>
              </table>
            } @else { <div class="muted">ยังไม่มีนัดหมาย</div> }
            <div class="form-grid" style="margin-top:14px">
              <div class="field"><label for="lf-ticket-detail-component-7">วันที่</label><input id="lf-ticket-detail-component-7" type="date" [value]="appt().date" (input)="setAppt('date', $any($event.target).value)" /></div>
              <div class="field"><label for="lf-ticket-detail-component-8">เวลา</label><input id="lf-ticket-detail-component-8" type="time" [value]="appt().time" (input)="setAppt('time', $any($event.target).value)" /></div>
              <div class="field"><label for="lf-ticket-detail-component-9">ช่าง</label><select id="lf-ticket-detail-component-9" [value]="appt().tech" (change)="setAppt('tech', $any($event.target).value)"><option value="" [selected]="!appt().tech">–</option>@for (user of users(); track user.value) { <option [value]="user.value" [selected]="user.value === appt().tech">{{ user.label }}</option> }</select></div>
              <div class="field wide"><label for="lf-ticket-detail-component-10">รายละเอียด</label><input id="lf-ticket-detail-component-10" [value]="appt().note" (input)="setAppt('note', $any($event.target).value)" /></div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn primary" [disabled]="apptBusy()" (click)="addAppointment()">+ เพิ่มนัดหมาย</button>
            </div>
          </div>
        }

        @if (tab() === 'audit') {
          <div class="card">
            @if (!audit().length) { <div class="state empty">ยังไม่มีประวัติ</div> }
            @else { @for (entry of audit(); track entry['id']) { <div class="tl-item"><div class="tl-dot"></div><div><b>{{ entry['summary'] }}</b><div class="muted small">{{ entry['userName'] }} · {{ fmtDateTime(entry['at']) }}</div></div></div> } }
          </div>
        }
      </div>
      @if (editOpen()) { <app-record-form entity="tickets" entityLabel="Service Ticket" [fields]="visibleFields()" [record]="ticket" [lists]="lists()" (saved)="onSaved($event)" (closed)="editOpen.set(false)" /> }
    } @else if (loading()) {
      <div class="state"><div class="spinner"></div>กำลังโหลดข้อมูล…</div>
    } @else {
      <div class="state error">ไม่พบ Ticket หรือไม่มีสิทธิ์เข้าถึง</div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketDetailComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly meta = inject(MetaService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly pdf = inject(PdfService);

  readonly record = signal<RecordRow | null>(null);
  readonly audit = signal<Record<string, unknown>[]>([]);
  readonly loading = signal(true);
  readonly nav = signal<{ index: number; total: number; prev: string; next: string } | null>(null);
  readonly tab = signal<'info' | 'timeline' | 'visit' | 'audit'>('info');
  readonly editOpen = signal(false);
  readonly statusTo = signal('');
  readonly statusComment = signal('');
  readonly statusFields = signal<Record<string, unknown>>({});
  readonly statusBusy = signal(false);
  readonly pendingApprovals = signal<ApprovalRow[]>([]);
  readonly assignTeam = signal('');
  readonly assignee = signal('');
  readonly assignNote = signal('');
  readonly assignBusy = signal(false);
  readonly noteText = signal('');
  readonly noteBusy = signal(false);
  readonly apptBusy = signal(false);
  readonly appt = signal<Record<string, string>>({ date: todayStr(), time: '09:00', tech: '', note: '' });
  readonly users = signal<Option[]>([]);
  readonly lists = computed(() => this.meta.lists());
  readonly fmtDateTime = fmtDateTime;
  readonly fmtDate = fmtDate;
  readonly fmtDuration = fmtDuration;

  readonly visibleFields = computed(() => (this.meta.entity('tickets')?.fields ?? []).filter((field) => !field.hidden));
  readonly statuses = computed<WorkflowStatus[]>(() => this.meta.ticketWorkflow());
  readonly statusOptions = computed(() => {
    const ticket = this.record();
    const current = ticket?.['status'];
    const from = this.statuses().find((status) => status.key === current);
    return this.statuses().filter((status) => status.enabled && status.key !== current && (!from?.next?.length || from.next.includes(status.key)));
  });
  readonly requiredFields = computed<FieldDef[]>(() => {
    const target = this.statuses().find((status) => status.key === this.statusTo());
    return (target?.requiredFields ?? [])
      .map((key) => this.meta.entity('tickets')?.fields.find((field) => field.key === key))
      .filter((field): field is FieldDef => !!field);
  });
  /** Stays false until the company setting is known, so a disabled target never flashes. */
  readonly slaEnabled = signal(false);
  readonly slaNotice = computed<{ tone: 'ok' | 'warn' | 'bad'; title: string; detail: string } | null>(() => {
    const ticket = this.record();
    if (!ticket || !this.slaEnabled()) return null;
    const status = this.statuses().find((item) => item.key === ticket['status']);
    if (status?.final) return null;
    const priority = String(ticket['priority'] ?? 'ปกติ');
    const limit = SLA_HOURS[priority] ?? SLA_HOURS['ปกติ'];
    const elapsed = ageHours(ticket['receivedAt'], ticket['closedAt']);
    const remaining = limit - elapsed;
    if (remaining <= 0) {
      const over = Math.floor(-remaining);
      return {
        tone: 'bad',
        title: `เกินเวลา SLA ${over} ชม.`,
        detail: `เป้าหมาย ${limit} ชม. สำหรับความสำคัญ "${priority}" · ใช้ไปแล้ว ${Math.floor(elapsed)} ชม.`,
      };
    }
    if (remaining <= Math.max(1, limit * 0.25)) {
      return {
        tone: 'warn',
        title: `ใกล้ครบ SLA — เหลือ ${Math.floor(remaining)} ชม.`,
        detail: `เป้าหมาย ${limit} ชม. สำหรับความสำคัญ "${priority}" · ใช้ไปแล้ว ${Math.floor(elapsed)} ชม.`,
      };
    }
    return {
      tone: 'ok',
      title: `อยู่ในเวลา SLA — เหลือ ${Math.floor(remaining)} ชม.`,
      detail: `เป้าหมาย ${limit} ชม. สำหรับความสำคัญ "${priority}"`,
    };
  });

  constructor() {
    effect(() => {
      this.meta.meta();
      this.record();
      if (!this.statusTo()) this.statusTo.set(this.statusOptions()[0]?.key ?? '');
    });
  }

  ngOnInit(): void {
    // Reloaded because field help follows the company's SLA setting.
    this.meta.load(true);
    this.api.get<{ slaSampleAlerts?: boolean }>('/company').subscribe({
      next: (company) => this.slaEnabled.set(company.slaSampleAlerts !== false),
      // Unknown setting: show no target rather than one that may be switched off.
      error: () => this.slaEnabled.set(false),
    });
    this.api.get<Option[]>('/meta/options/users').subscribe({
      next: (users) => this.users.set(users),
      error: () => this.users.set([]),
    });
    // Reused when moving between tickets: reset and reload on the new id.
    this.route.paramMap.subscribe(() => {
      this.record.set(null);
      this.audit.set([]);
      this.pendingApprovals.set([]);
      this.loading.set(true);
      this.tab.set('info');
      this.load();
    });
  }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.api.get<RecordRow>(`/records/tickets/${id}`).subscribe({
      next: (ticket) => {
        this.record.set(ticket);
        this.nav.set(listNeighbours(readDetailNav('tickets'), id));
        this.loading.set(false);
        this.statusTo.set(this.statusOptions()[0]?.key ?? '');
        this.assignTeam.set(String(ticket['team'] ?? ''));
        this.assignee.set(String(ticket['assignee'] ?? ''));
        this.api.get<ApprovalRow[]>(`/records/tickets/${id}/approvals`).subscribe({ next: (rows) => this.pendingApprovals.set(rows), error: () => this.pendingApprovals.set([]) });
        this.api.get<Record<string, unknown>[]>(`/audit/records/tickets/${id}`).subscribe({ next: (audit) => this.audit.set(audit), error: () => this.audit.set([]) });
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  setStatusTo(value: string): void {
    this.statusTo.set(value);
    this.statusFields.set({});
  }

  setStatusField(key: string, value: unknown): void {
    this.statusFields.update((fields) => ({ ...fields, [key]: value }));
  }

  changeStatus(): void {
    const ticket = this.record();
    if (!ticket || this.statusBusy()) return;
    this.statusBusy.set(true);
    this.api.post(`/tickets/${ticket.id}/status`, { to: this.statusTo(), comment: this.statusComment(), fields: this.statusFields() }).subscribe({
      next: (result) => {
        this.statusBusy.set(false);
        this.statusComment.set('');
        const pending = !!(result as Record<string, unknown>)?.['_pendingApproval'];
        this.toast.show(pending ? 'ส่งคำขออนุมัติแล้ว — รอผู้อนุมัติ' : 'เปลี่ยนสถานะแล้ว');
        this.load();
      },
      error: (error: unknown) => {
        this.statusBusy.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  assign(): void {
    const ticket = this.record();
    if (!ticket || this.assignBusy()) return;
    this.assignBusy.set(true);
    this.api.post<RecordRow>(`/tickets/${ticket.id}/assign`, { team: this.assignTeam(), assignee: this.assignee(), note: this.assignNote() }).subscribe({
      next: (updated) => {
        this.assignBusy.set(false);
        this.assignNote.set('');
        this.record.set(updated);
        this.toast.show('มอบหมายแล้ว');
      },
      error: (error: unknown) => {
        this.assignBusy.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  addNote(type: string): void {
    const ticket = this.record();
    if (!ticket || this.noteBusy()) return;
    if (!this.noteText().trim()) return this.toast.error('กรุณากรอกข้อความ');
    this.noteBusy.set(true);
    this.api.post<RecordRow>(`/tickets/${ticket.id}/notes`, { type, text: this.noteText() }).subscribe({
      next: (updated) => {
        this.noteBusy.set(false);
        this.noteText.set('');
        this.record.set(updated);
        this.toast.show('บันทึกแล้ว');
      },
      error: (error: unknown) => {
        this.noteBusy.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  addAppointment(): void {
    const ticket = this.record();
    if (!ticket || this.apptBusy()) return;
    this.apptBusy.set(true);
    this.api.post<RecordRow>(`/tickets/${ticket.id}/appointments`, this.appt()).subscribe({
      next: (updated) => {
        this.apptBusy.set(false);
        this.record.set(updated);
        this.toast.show('บันทึกนัดหมายแล้ว');
      },
      error: (error: unknown) => {
        this.apptBusy.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  resolveAppointment(appointment: Record<string, unknown>): void {
    const ticket = this.record();
    if (!ticket) return;
    const result = prompt('ผลการเข้าหน้างาน/การซ่อม');
    if (!result?.trim()) return;
    this.api.post<RecordRow>(`/tickets/${ticket.id}/appointments/${String(appointment['id'])}/resolve`, { status: 'เสร็จ', result }).subscribe({
      next: (updated) => {
        this.record.set(updated);
        this.toast.show('บันทึกผลแล้ว');
      },
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }

  setAppt(key: string, value: string): void {
    this.appt.update((appt) => ({ ...appt, [key]: value }));
  }

  age(ticket: RecordRow): number {
    return ageHours(ticket['receivedAt'], ticket['closedAt']);
  }

  slaLimit(ticket: RecordRow): number {
    return SLA_HOURS[String(ticket['priority'] ?? 'ปกติ')] ?? SLA_HOURS['ปกติ'];
  }

  response(ticket: RecordRow): string {
    if (!ticket['respondedAt']) return '–';
    return fmtDuration(ageHours(ticket['receivedAt'], ticket['respondedAt']));
  }

  resolve(ticket: RecordRow): string {
    if (!ticket['resolvedAt']) return '–';
    return fmtDuration(ageHours(ticket['receivedAt'], ticket['resolvedAt']));
  }

  statusLabel(value: unknown): string {
    return this.statuses().find((status) => status.key === value)?.label ?? String(value ?? '–');
  }

  statusColor(value: unknown): string {
    return this.statuses().find((status) => status.key === value)?.color ?? 'gray';
  }

  userName(id: unknown): string {
    return this.users().find((user) => user.value === id)?.label ?? '–';
  }

  display(field: FieldDef, row: RecordRow): string {
    const value = row[field.key];
    if (field.type === 'ref') return row._labels?.[field.key] ?? '–';
    if (field.type === 'boolean') return value ? 'ใช่' : 'ไม่';
    if (field.type === 'date') return fmtDate(value);
    if (field.type === 'datetime') return fmtDateTime(value);
    if (field.type === 'file') return (Array.isArray(value) ? (value as { name: string }[]) : []).map((f) => f.name).join(', ') || '–';
    return value === undefined || value === null || value === '' ? '–' : String(value);
  }

  asArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  }

  onSaved(record: RecordRow): void {
    this.record.set(record);
    this.editOpen.set(false);
    this.load();
  }

  back(): void {
    void this.router.navigate(['/tickets']);
  }

  goSibling(id: string): void {
    if (id) void this.router.navigate(['/tickets', id]);
  }

  printPage(): void {
    window.print();
  }

  downloadPdf(): void {
    const ticket = this.record();
    if (ticket) this.pdf.download('tickets', ticket.id, String(ticket.code));
  }
}
