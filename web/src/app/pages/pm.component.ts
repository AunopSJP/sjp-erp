import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { fmtDate, todayStr } from '../core/util';
import type { ColumnDef, TabDef } from '../shared/data-table.component';
import { DataTableComponent } from '../shared/data-table.component';
import { RecordFormComponent } from '../shared/record-form.component';
import { ToastService } from '../shared/toast.service';
import type { ListResponse, RecordRow } from '../core/models';

@Component({
  selector: 'app-pm',
  standalone: true,
  imports: [DataTableComponent, RecordFormComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div><h1>งาน PM และรายงานบริการ</h1><div class="muted">รอบตรวจ รายการตรวจ และติดตามสิ่งผิดปกติ</div></div>
        <div class="page-actions">
          @if (auth.can('pm','create') && tab() === 'jobs') { <button type="button" class="btn primary" title="สร้างงาน PM ล่วงหน้า 7 วัน" [disabled]="busy()" (click)="generate()">{{ busy() ? 'กำลังสร้าง…' : 'สร้างงานตามรอบ' }}</button> }
          @if (auth.can('pm','create') && tab() === 'plans') { <button type="button" class="btn primary" (click)="planOpen.set({})">+ เพิ่มแผน PM</button> }
          @if (auth.can('pm','create') && tab() === 'tpl') { <button type="button" class="btn primary" (click)="openTemplate(null)">+ สร้างแม่แบบ</button> }
        </div>
      </div>
      <div class="notice small">รอบ PM และรายการตรวจในระบบเป็นตัวอย่างจำลอง รอผู้ใช้ยืนยัน — ปรับแผน/แม่แบบได้ในหน้านี้</div>
      <div class="tabs">
        <button type="button" [class.active]="tab() === 'jobs'" (click)="tab.set('jobs')">งานตามรอบ <span class="tab-count">{{ jobs().length }}</span></button>
        <button type="button" [class.active]="tab() === 'plans'" (click)="tab.set('plans')">แผน PM</button>
        <button type="button" [class.active]="tab() === 'tpl'" (click)="tab.set('tpl')">แม่แบบรายการตรวจ</button>
      </div>

      @if (tab() === 'jobs') {
        <app-data-table [columns]="jobColumns()" [rows]="jobs()" [tabs]="jobTabs" [exportName]="'pm-jobs'" [viewsEntity]="'pmRecords'" [canShareViews]="auth.can('settings', 'edit')" [canExport]="auth.can('pm','export')" [emptyText]="'ยังไม่มีงาน PM ที่คุณเข้าถึงได้ — ตรวจสอบทีม/ผู้รับผิดชอบในแผน แล้วกด “สร้างงานตามรอบ”'" [error]="loadError()" [rowClass]="jobRowClass" (rowClick)="openJob($event)" (retry)="load()" />
      }

      @if (tab() === 'plans') {
        <app-data-table [columns]="planColumns()" [rows]="plans()" [exportName]="'pm-plans'" [viewsEntity]="'pmPlans'" [canShareViews]="auth.can('settings', 'edit')" [canExport]="auth.can('pm','export')" [emptyText]="'ยังไม่มีแผน PM'" [error]="loadError()" [rowClass]="rowClass" (rowClick)="editPlan($event)" (retry)="load()" />
      }

      @if (tab() === 'tpl') {
        <div class="grid c2">
          @for (template of templates(); track template.id) {
            <div class="card"><h3>{{ template['name'] }}</h3><div class="muted small">{{ template['category'] }}</div>
              <ol>@for (item of asArray(template['items']); track $index) { <li>{{ item['label'] }}</li> }</ol>
              @if (auth.can('pm','edit')) { <button type="button" class="btn sm" (click)="openTemplate(template)">แก้ไข</button> }
            </div>
          }
        </div>
      }
    </div>

    @if (planOpen()) {
      <app-record-form entity="pmPlans" entityLabel="แผน PM" [fields]="planFields()" [record]="planOpen()?.id ? asRecord(planOpen()) : null" [lists]="meta.lists()" [defaults]="{ active: true, frequency: 'รายเดือน' }" (saved)="onPlanSaved()" (closed)="planOpen.set(null)" />
    }

    @if (templateOpen()) {
      <div class="overlay" (mousedown)="closeTemplate($event)">
        <div class="menu-panel" role="dialog" aria-label="แม่แบบรายการตรวจ">
          <div class="menu-head"><b>{{ templateForm.id ? 'แก้ไขแม่แบบรายการตรวจ' : 'สร้างแม่แบบรายการตรวจ' }}</b><span class="grow"></span><button type="button" class="icon-btn" (click)="templateOpen.set(false)" aria-label="ปิด">×</button></div>
          <div class="form-grid">
            <div class="field"><label for="lf-pm-component-1">ชื่อแม่แบบ *</label><input id="lf-pm-component-1" [value]="templateForm.name" (input)="templateForm.name = $any($event.target).value" /></div>
            <div class="field"><label for="lf-pm-component-2">ประเภทอุปกรณ์</label><input id="lf-pm-component-2" [value]="templateForm.category" (input)="templateForm.category = $any($event.target).value" /></div>
            <div class="field wide"><label for="lf-pm-component-3">รายการตรวจ (บรรทัดละ 1 รายการ)</label><textarea id="lf-pm-component-3" rows="8" [value]="templateForm.items" (input)="templateForm.items = $any($event.target).value"></textarea></div>
          </div>
          @if (templateError()) { <div class="err">{{ templateError() }}</div> }
          <div class="form-actions"><button type="button" class="btn" (click)="templateOpen.set(false)">ยกเลิก</button><button type="button" class="btn primary" [disabled]="templateBusy()" (click)="saveTemplate()">บันทึก</button></div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PmComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly meta = inject(MetaService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly tab = signal<'jobs' | 'plans' | 'tpl'>('jobs');
  readonly jobs = signal<RecordRow[]>([]);
  readonly plans = signal<RecordRow[]>([]);
  readonly templates = signal<RecordRow[]>([]);
  readonly loadError = signal('');
  readonly busy = signal(false);
  readonly planOpen = signal<Record<string, unknown> | null>(null);
  readonly templateOpen = signal(false);
  readonly templateBusy = signal(false);
  readonly templateError = signal('');
  readonly planFields = computed(() => this.meta.entity('pmPlans')?.fields ?? []);
  readonly jobTabs: TabDef[] = [
    { key: 'todo', label: 'ที่ต้องทำ', test: (row) => row['status'] !== 'เสร็จ' },
    { key: 'over', label: 'เกินกำหนด', test: (row) => row['status'] !== 'เสร็จ' && String(row['dueDate'] ?? '') < this.today() },
    { key: 'done', label: 'เสร็จแล้ว', test: (row) => row['status'] === 'เสร็จ' },
    { key: 'all', label: 'ทั้งหมด' },
  ];
  readonly jobRowClass = (row: Record<string, unknown>) => (row['status'] !== 'เสร็จ' && String(row['dueDate'] ?? '') < this.today() ? 'hl-3' : '');
  readonly rowClass = () => '';
  readonly fmtDate = fmtDate;
  templateForm = { id: '', name: '', category: '', items: '' };

  ngOnInit(): void {
    this.meta.load();
    this.load();
  }

  load(): void {
    this.loadError.set('');
    this.api.get<ListResponse<RecordRow>>('/records/pmRecords', { pageSize: 500, sort: '-dueDate' }).subscribe({
      next: (result) => this.jobs.set(result.items),
      error: (error: unknown) => {
        this.loadError.set(apiErrorMessage(error));
        this.jobs.set([]);
      },
    });
    this.api.get<ListResponse<RecordRow>>('/records/pmPlans', { pageSize: 500, sort: '-_createdAt' }).subscribe({
      next: (result) => this.plans.set(result.items),
      error: (error: unknown) => {
        this.loadError.set(apiErrorMessage(error));
        this.plans.set([]);
      },
    });
    this.api.get<ListResponse<RecordRow>>('/records/pmTemplates', { pageSize: 500 }).subscribe({ next: (result) => this.templates.set(result.items), error: () => this.templates.set([]) });
  }

  generate(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.post<{ created: number }>('/pm/generate', {}).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.toast.show(result.created ? `สร้างงาน PM ใหม่ ${result.created} งาน` : 'ไม่มีงานครบรอบที่ต้องสร้างเพิ่ม');
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  jobColumns(): ColumnDef[] {
    return [
      { key: 'code', label: 'เลขที่' },
      { key: 'plan', label: 'แผน', value: (row) => row._labels?.['plan'] ?? '–' },
      { key: 'site', label: 'ไซต์', value: (row) => row._labels?.['site'] ?? '–' },
      { key: 'dueDate', label: 'กำหนด', value: (row) => fmtDate(row['dueDate']) },
      { key: 'assignee', label: 'ผู้รับผิดชอบ', value: (row) => row._labels?.['assignee'] ?? '–' },
      { key: 'status', label: 'สถานะ', badge: (row) => (row['status'] === 'เสร็จ' ? 'green' : row['status'] === 'กำลังตรวจ' ? 'blue' : 'gray') },
    ];
  }

  planColumns(): ColumnDef[] {
    return [
      { key: 'code', label: 'รหัส' }, { key: 'name', label: 'แผน' },
      { key: 'site', label: 'ไซต์', value: (row) => row._labels?.['site'] ?? '–' },
      { key: 'frequency', label: 'รอบ' },
      { key: 'template', label: 'แม่แบบ', value: (row) => row._labels?.['template'] ?? '–' },
      { key: 'active', label: 'ใช้งาน', value: (row) => (row['active'] ? 'ใช้งาน' : 'หยุด'), badge: (row) => (row['active'] ? 'green' : 'gray') },
    ];
  }

  openJob(row: Record<string, unknown>): void {
    void this.router.navigate(['/pm/records', String(row['id'])]);
  }

  editPlan(row: Record<string, unknown>): void {
    if (this.auth.can('pm', 'edit')) this.planOpen.set(row);
  }

  asRecord(row: Record<string, unknown> | null): RecordRow | null {
    return row as RecordRow | null;
  }

  onPlanSaved(): void {
    this.planOpen.set(null);
    this.load();
  }

  openTemplate(template: RecordRow | null): void {
    this.templateForm = template
      ? { id: template.id, name: String(template['name'] ?? ''), category: String(template['category'] ?? ''), items: this.asArray(template['items']).map((item) => String(item['label'] ?? '')).join('\n') }
      : { id: '', name: '', category: '', items: '' };
    this.templateError.set('');
    this.templateOpen.set(true);
  }

  saveTemplate(): void {
    if (this.templateBusy()) return;
    const items = this.templateForm.items.split('\n').map((line) => line.trim()).filter(Boolean).map((label) => ({ label }));
    if (!items.length) return this.toast.error('ต้องมีรายการตรวจอย่างน้อย 1 รายการ');
    this.templateBusy.set(true);
    const body = { name: this.templateForm.name, category: this.templateForm.category, items };
    const request = this.templateForm.id
      ? this.api.patch(`/pm/templates/${this.templateForm.id}`, body)
      : this.api.post('/pm/templates', body);
    request.subscribe({
      next: () => {
        this.templateBusy.set(false);
        this.templateOpen.set(false);
        this.toast.show('บันทึกแม่แบบแล้ว');
        this.load();
      },
      error: (error: unknown) => {
        this.templateBusy.set(false);
        this.templateError.set(apiErrorMessage(error));
      },
    });
  }

  closeTemplate(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.templateOpen.set(false);
  }

  asArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  }

  private today(): string {
    return todayStr();
  }
}
