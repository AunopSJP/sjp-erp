import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { PdfService } from '../core/pdf.service';
import { readDetailNav } from '../core/storage';
import { fmtDate, fmtDateTime, listNeighbours } from '../core/util';
import { ProjectStepComponent } from './project-step.component';
import { RecordFormComponent } from '../shared/record-form.component';
import { ToastService } from '../shared/toast.service';
import type { FieldDef, ProjectStepDef, RecordRow } from '../core/models';

type StepData = Record<string, unknown>;

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [ProjectStepComponent, RecordFormComponent],
  template: `
    @if (project(); as p) {
      <div class="page">
        <div class="page-head">
          <div><h1>{{ p['name'] }}</h1><div class="muted">{{ p.code }} · {{ statusText(p) }}</div></div>
          <div class="page-actions">
            <button type="button" class="btn" (click)="back()">‹ รายการ</button>
            @if (nav(); as position) {
              <div class="nav-pair" role="group" aria-label="เลื่อนไประหว่างโครงการ">
                <button type="button" class="btn nav-step" [disabled]="!position.prev" (click)="goSibling(position.prev)" aria-label="โครงการก่อนหน้า">‹</button>
                <span class="nav-count">{{ position.index + 1 }}/{{ position.total }}</span>
                <button type="button" class="btn nav-step" [disabled]="!position.next" (click)="goSibling(position.next)" aria-label="โครงการถัดไป">›</button>
              </div>
            }
            <button type="button" class="btn" (click)="printPage()">พิมพ์</button>
            <button type="button" class="btn" (click)="downloadPdf()">ดาวน์โหลด PDF</button>
            @if (auth.can('projects','edit') && !p['closed']) { <button type="button" class="btn" (click)="editOpen.set(true)">แก้ไขข้อมูล</button> }
            @if (auth.can('projects','close') && !p['closed']) { <button type="button" class="btn" (click)="closeProject()">ปิดโครงการ</button> }
          </div>
        </div>
        <div class="statbar">
          <div class="stat"><div class="l">ขั้นตอนปัจจุบัน</div><div class="v" style="font-size:18px">{{ currentLabel() }}</div><div class="s">เสร็จแล้ว {{ done() }} จาก {{ steps().length }}</div></div>
          <div class="stat"><div class="l">ความคืบหน้า</div><div class="v">{{ steps().length ? Math.round(done() / steps().length * 100) : 0 }}%</div><div class="bar" style="margin-top:6px"><div [style.width.%]="steps().length ? done() / steps().length * 100 : 0"></div></div></div>
          <div class="stat"><div class="l">ลูกค้า</div><div class="v" style="font-size:18px">{{ p._labels?.['customer'] }}</div><div class="s">{{ p['type'] }}</div></div>
          <div class="stat"><div class="l">ผู้จัดการโครงการ</div><div class="v" style="font-size:18px">{{ p._labels?.['manager'] || '–' }}</div><div class="s">{{ p['contractNo'] ? 'สัญญา ' + p['contractNo'] : '' }}</div></div>
        </div>
        @if (p['closed']) { <div class="notice bad">โครงการปิดแล้ว — {{ p['closeReason'] }}</div> }

        @if (govGate(); as gate) {
          <div class="card gov-gate">
            <div class="gov-head">
              <h3>เส้นทางโครงการ: {{ gate.track }}</h3>
              <span class="badge {{ gate.ictRequired ? (gate.ictOk ? 'green' : 'amber') : 'gray' }}">
                {{ gate.ictRequired ? (gate.ictOk ? 'defended ICT ผ่าน' : 'รอ defended ICT') : 'ไม่ต้อง defended' }}
              </span>
            </div>
            <div class="gov-grid">
              <div class="gov-item">
                <span class="gov-label">มูลค่า / เกณฑ์</span>
                <div class="gov-value">{{ baht(gate.value) }} <span class="muted">/ {{ baht(gate.threshold) }}</span></div>
                <span class="gov-note">{{ gate.ictRequired ? (gate.ictOk ? 'ผ่าน defended ICT แล้ว — ไปต่อได้' : 'เกินเกณฑ์ — ต้อง defended ICT ก่อนจบขั้นเสนอ') : (gate.track === 'ราชการ (ประมูล)' ? 'ต่ำกว่าเกณฑ์ที่ต้อง defended' : 'เส้นทางนี้ไม่ต้อง defended ICT') }}</span>
              </div>
              <div class="gov-item">
                <span class="gov-label">ผล defended ICT</span>
                <div class="gov-value">{{ gate.ict || 'ยังไม่บันทึก' }}</div>
                @if (gate.ictRequired && !gate.ictOk) {
                  <button type="button" class="btn sm" (click)="focusStep('proposal')">ไปบันทึกที่ขั้น 3</button>
                }
              </div>
              <div class="gov-item">
                <span class="gov-label">คู่สัญญา / MOU</span>
                <div class="gov-value">{{ gate.partner || 'ยังไม่ระบุ' }}@if (gate.mouNo) { · {{ gate.mouNo }} }</div>
                @if (gate.mouRequired && !gate.mouOk) {
                  <button type="button" class="btn sm" (click)="focusStep('kickoff')">ไปบันทึกที่ขั้น 5</button>
                }
              </div>
              <div class="gov-item">
                <span class="gov-label">ส่วนแบ่งรายได้ SJP</span>
                <div class="gov-value">{{ gate.share ? gate.share + '%' : '—' }}</div>
              </div>
            </div>
          </div>
        }

        <div class="tabs">
          <button type="button" [class.active]="tab() === 'steps'" (click)="tab.set('steps')">ขั้นตอน <span class="tab-count">{{ steps().length }}</span></button>
          <button type="button" [class.active]="tab() === 'info'" (click)="tab.set('info')">ข้อมูลโครงการ</button>
          <button type="button" [class.active]="tab() === 'boq'" (click)="tab.set('boq')">BOQ / อุปกรณ์</button>
          <button type="button" [class.active]="tab() === 'audit'" (click)="tab.set('audit')">ประวัติ</button>
        </div>

        @if (tab() === 'steps') {
          <div class="stepper">
            @for (step of steps(); track step.key) {
              <div class="step" [class.done]="stepData(step.key)['status'] === 'done'" [class.doing]="stepData(step.key)['status'] === 'doing'" [class.skipped]="stepData(step.key)['status'] === 'skipped'">
                <div class="step-head" role="button" tabindex="0" (click)="toggle(step.key)" (keydown.enter)="toggle(step.key)">
                  <span class="dot">{{ stepData(step.key)['status'] === 'done' ? '✓' : $index + 1 }}</span>
                  <b>{{ step.label }}</b><span class="grow"></span>
                  @if (stepData(step.key)['owner']) { <span class="small muted">{{ userLabel(stepData(step.key)['owner']) }}</span> }
                  @if (stepData(step.key)['plannedDate']) { <span class="small muted">แผน {{ fmtDate(stepData(step.key)['plannedDate']) }}</span> }
                  <span class="badge {{ statusColor(stepData(step.key)['status']) }}">{{ statusLabel(stepData(step.key)['status']) }}</span>
                </div>
                @if (openKey() === step.key) {
                  <app-project-step
                    [projectId]="p.id"
                    [step]="step"
                    [data]="stepData(step.key)"
                    [canEdit]="auth.can('projects','edit')"
                    [current]="currentKey() === step.key"
                    [projectClosed]="!!p['closed']"
                    [lists]="meta.lists()"
                    (reload)="load()"
                  />
                }
              </div>
            }
          </div>
        }

        @if (tab() === 'info') {
          <div class="card">@for (field of fields(); track field.key) { <div class="kv"><div class="k">{{ field.label }}</div><div class="v">{{ display(field, p) }}@if (field.help) { <div class="kv-help">{{ field.help }}</div> }</div></div> }</div>
        }

        @if (tab() === 'boq') {
          <div class="card">
            <h3>BOQ เทียบการสั่งซื้อ/รับ/เบิก/ติดตั้ง</h3>
            @if (!boqRows().length) { <div class="muted">ยังไม่มีรายการ BOQ</div> }
            @else {
              <div class="table-wrap"><table class="mini"><thead><tr><th scope="col">สินค้า</th><th scope="col">ต้องใช้</th><th scope="col">สั่งซื้อ</th><th scope="col">รับเข้า</th><th scope="col">เบิกไปหน้างาน</th><th scope="col">ติดตั้งแล้ว</th></tr></thead>
                <tbody>@for (row of boqRows(); track $index) { <tr><td>{{ row.itemLabel }}</td><td>{{ row.qty }}</td><td>{{ row.ordered }}</td><td>{{ row.received }}</td><td>{{ row.issued }}</td><td>{{ row.installed }}</td></tr> }</tbody>
              </table></div>
            }
          </div>
        }

        @if (tab() === 'audit') {
          <div class="card">@if (!audit().length) { <div class="state empty">ยังไม่มีประวัติ</div> } @else { @for (entry of audit(); track entry['id']) { <div class="tl-item"><div class="tl-dot"></div><div><b>{{ entry['summary'] }}</b><div class="muted small">{{ entry['userName'] }} · {{ fmtDateTime(entry['at']) }}</div></div></div> } }</div>
        }
      </div>
      @if (editOpen()) { <app-record-form entity="projects" entityLabel="โครงการ" [fields]="fields()" [record]="p" [lists]="meta.lists()" (saved)="onSaved($event)" (closed)="editOpen.set(false)" /> }
    } @else if (loading()) {
      <div class="state"><div class="spinner"></div>กำลังโหลดข้อมูล…</div>
    } @else {
      <div class="state error">ไม่พบโครงการ หรือไม่มีสิทธิ์เข้าถึง</div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetailComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly meta = inject(MetaService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly pdf = inject(PdfService);

  readonly project = signal<RecordRow | null>(null);
  readonly audit = signal<Record<string, unknown>[]>([]);
  readonly boqRows = signal<Record<string, unknown>[]>([]);
  readonly loading = signal(true);
  readonly nav = signal<{ index: number; total: number; prev: string; next: string } | null>(null);
  readonly bidThreshold = signal(500_000);
  readonly govGate = computed(() => {
    const project = this.project();
    if (!project) return null;
    const track = String(project['track'] ?? '');
    if (track !== 'ราชการ (ประมูล)' && track !== 'ร่วมทุน SJP–NT') return null;
    const threshold = this.bidThreshold();
    const value = Number(project['value'] ?? 0);
    const ict = String(this.stepValue('proposal', 'ictDefend') ?? '');
    const partner = String(this.stepValue('kickoff', 'partner') ?? '');
    const mouNo = String(this.stepValue('kickoff', 'mouNo') ?? '');
    return {
      track,
      threshold,
      value,
      ict,
      ictRequired: track === 'ราชการ (ประมูล)' && Number.isFinite(value) && value > threshold,
      ictOk: ict === 'ผ่าน',
      partner,
      mouNo,
      mouRequired: partner === 'NT' || track === 'ร่วมทุน SJP–NT',
      mouOk: !!mouNo.trim(),
      share: Number(project['sharePercent'] ?? 0) || 0,
    };
  });
  readonly editOpen = signal(false);
  readonly tab = signal<'steps' | 'info' | 'boq' | 'audit'>('steps');
  readonly openKey = signal('');
  readonly users = signal<{ value: string; label: string }[]>([]);
  readonly fields = computed(() => (this.meta.entity('projects')?.fields ?? []).filter((field) => !field.hidden));
  readonly steps = computed(() => {
    const track = String(this.project()?.['track'] ?? '').trim() || 'มาตรฐาน';
    return this.meta.projectSteps().filter((step) =>
      step.enabled && (track === 'R&D' ? step.tracks?.includes('R&D') : !step.tracks),
    );
  });
  readonly fmtDate = fmtDate;
  readonly fmtDateTime = fmtDateTime;
  readonly Math = Math;

  ngOnInit(): void {
    this.meta.load();
    this.meta.options('users').subscribe((users) => this.users.set(users));
    this.api.get<{ governmentBidThreshold?: number }>('/company').subscribe({
      next: (company) => {
        const threshold = Number(company.governmentBidThreshold);
        if (Number.isFinite(threshold) && threshold >= 0) this.bidThreshold.set(threshold);
      },
      error: () => undefined,
    });
    // Reused when moving between projects: reset and reload on the new id.
    this.route.paramMap.subscribe(() => {
      this.project.set(null);
      this.audit.set([]);
      this.boqRows.set([]);
      this.openKey.set('');
      this.loading.set(true);
      this.tab.set('steps');
      this.load();
    });
  }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.api.get<RecordRow>(`/records/projects/${id}`).subscribe({
      next: (project) => {
        this.project.set(project);
        this.nav.set(listNeighbours(readDetailNav('projects'), id));
        this.loading.set(false);
        if (!this.openKey()) this.openKey.set(this.currentKey());
        this.api.get<Record<string, unknown>[]>(`/audit/records/projects/${id}`).subscribe({ next: (audit) => this.audit.set(audit), error: () => this.audit.set([]) });
        this.api.get<Record<string, unknown>[]>('/reports/boq').subscribe({
          next: (rows) => this.boqRows.set(rows.filter((row) => row['projectId'] === id)),
          error: () => this.boqRows.set([]),
        });
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  stepsData(): Record<string, StepData> {
    return (this.project()?.['steps'] as Record<string, StepData> | undefined) ?? {};
  }

  stepData(key: string): StepData {
    return this.stepsData()[key] ?? { status: 'pending', values: {}, docs: {}, log: [] };
  }

  stepValue(step: string, key: string): unknown {
    const values = this.stepData(step)['values'];
    return values && typeof values === 'object' ? (values as Record<string, unknown>)[key] : undefined;
  }

  baht(value: number): string {
    return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
  }

  focusStep(key: string): void {
    this.tab.set('steps');
    this.openKey.set(key);
  }

  done(): number {
    return this.steps().filter((step) => ['done', 'skipped'].includes(String(this.stepData(step.key)['status']))).length;
  }

  currentKey(): string {
    return this.steps().find((step) => !['done', 'skipped'].includes(String(this.stepData(step.key)['status'] ?? 'pending')))?.key ?? '';
  }

  currentLabel(): string {
    return this.steps().find((step) => step.key === this.currentKey())?.label ?? 'ครบทุกขั้นตอน';
  }

  toggle(key: string): void {
    this.openKey.set(this.openKey() === key ? '' : key);
  }

  statusText(project: RecordRow): string {
    if (project['closed']) return `ปิดโครงการ: ${project['closeReason'] ?? ''}`;
    return this.currentLabel();
  }

  statusLabel(value: unknown): string {
    return ({ pending: 'ยังไม่เริ่ม', doing: 'กำลังดำเนินการ', done: 'เสร็จ', skipped: 'ข้าม' } as Record<string, string>)[String(value)] ?? 'ยังไม่เริ่ม';
  }

  statusColor(value: unknown): string {
    return ({ pending: 'gray', doing: 'blue', done: 'green', skipped: 'amber' } as Record<string, string>)[String(value)] ?? 'gray';
  }

  userLabel(value: unknown): string {
    return this.users().find((user) => user.value === value)?.label ?? '–';
  }

  display(field: FieldDef, project: RecordRow): string {
    const value = project[field.key];
    if (field.type === 'ref') return project._labels?.[field.key] ?? '–';
    if (field.type === 'boolean') return value ? 'ใช่' : 'ไม่';
    if (field.type === 'date') return fmtDate(value);
    if (field.type === 'datetime') return fmtDateTime(value);
    if (field.type === 'rows') return Array.isArray(value) ? `${value.length} แถว` : '–';
    return value === undefined || value === null || value === '' ? '–' : String(value);
  }

  onSaved(record: RecordRow): void {
    this.editOpen.set(false);
    this.project.set(record);
    this.load();
  }

  closeProject(): void {
    const project = this.project();
    if (!project) return;
    const reason = prompt('เหตุผลการปิดโครงการ');
    if (!reason?.trim()) return;
    this.api.post(`/projects/${project.id}/close`, { reason }).subscribe({
      next: () => {
        this.toast.show('ปิดโครงการแล้ว');
        this.load();
      },
      error: (error: unknown) => this.toast.error(apiErrorMessage(error)),
    });
  }

  back(): void {
    void this.router.navigate(['/projects']);
  }

  goSibling(id: string): void {
    if (id) void this.router.navigate(['/projects', id]);
  }

  printPage(): void {
    window.print();
  }

  downloadPdf(): void {
    const project = this.project();
    if (project) this.pdf.download('projects', project.id, String(project.code));
  }
}
