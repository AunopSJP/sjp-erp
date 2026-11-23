import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, apiErrorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { fmtDuration, ageHours } from '../core/util';
import type { ColumnDef, FilterDef, TabDef } from '../shared/data-table.component';
import { DataTableComponent } from '../shared/data-table.component';
import { ToastService } from '../shared/toast.service';
import type { ListResponse, RecordRow, WorkflowStatus } from '../core/models';

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [DataTableComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div><h1>แจ้งซ่อม</h1><div class="muted">รับแจ้งเหตุ ซ่อม และบำรุงรักษา</div></div>
        <div class="page-actions">
          @if (auth.can('tickets', 'create')) { <button type="button" class="btn primary" (click)="create()">+ เปิดเคสใหม่</button> }
        </div>
      </div>
      <app-data-table
        [columns]="columns()"
        [rows]="rows()"
        [tabs]="tabs()"
        [filters]="filters()"
        [initialTab]="'open'"
        [exportName]="'tickets'"
        [viewsEntity]="'tickets'"
        [canShareViews]="auth.can('settings', 'edit')"
        [canExport]="auth.can('tickets', 'export')"
        [searchPlaceholder]="'ค้นหาเลขที่ หัวข้อ อาการ จุดติดตั้ง วงจร…'"
        [emptyText]="'ยังไม่มีเคสแจ้งซ่อม'"
        [error]="loadError()"
        [rowClass]="rowClass"
        (rowClick)="open($event)"
        (retry)="load()"
      />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketsComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly meta = inject(MetaService);

  readonly rows = signal<RecordRow[]>([]);
  readonly loadError = signal('');
  readonly statuses = computed<WorkflowStatus[]>(() => this.meta.ticketWorkflow());
  readonly fmtDuration = fmtDuration;
  readonly rowClass = (row: Record<string, unknown>) => {
    const hours = ageHours(row['receivedAt'], row['closedAt']);
    return this.isOpen(row) && hours >= 48 ? 'hl-3' : '';
  };

  ngOnInit(): void {
    this.meta.load();
    this.load();
  }

  load(): void {
    this.loadError.set('');
    this.api.get<ListResponse<RecordRow>>('/records/tickets', { pageSize: 500, sort: '-_createdAt' }).subscribe({
      next: (result) => this.rows.set(result.items),
      error: (error: unknown) => {
        const message = apiErrorMessage(error);
        this.loadError.set(message);
        this.toast.error(message);
      },
    });
  }

  columns(): ColumnDef[] {
    return [
      { key: 'code', label: 'เลขที่' },
      { key: 'title', label: 'หัวข้อ', value: (row) => `${row['title']}${row['point'] ? ' · ' + row['point'] : ''}` },
      { key: 'customer', label: 'ลูกค้า', value: (row) => row._labels?.['customer'] ?? '–' },
      { key: 'site', label: 'ไซต์', value: (row) => row._labels?.['site'] ?? '–' },
      { key: 'category', label: 'หมวดงาน' },
      { key: 'priority', label: 'เร่งด่วน', badge: (row) => this.priorityColor(row['priority']) },
      { key: 'status', label: 'สถานะ', value: (row) => this.statusLabel(row['status']), badge: (row) => this.statusColor(row['status']) },
      { key: 'assignee', label: 'ผู้รับผิดชอบ', value: (row) => row._labels?.['assignee'] ?? '–' },
      { key: 'age', label: 'อายุเคส', value: (row) => fmtDuration(ageHours(row['receivedAt'], row['closedAt'])) },
    ];
  }

  tabs(): TabDef[] {
    return [
      { key: 'open', label: 'กำลังดำเนินการ', test: (row) => this.isOpen(row) && !String(row['status'] ?? '').startsWith('wait') },
      { key: 'wait', label: 'รอ', test: (row) => this.isOpen(row) && String(row['status'] ?? '').startsWith('wait') },
      { key: 'closed', label: 'ปิดแล้ว', test: (row) => !this.isOpen(row) },
      { key: 'all', label: 'ทั้งหมด' },
    ];
  }

  filters(): FilterDef[] {
    return [
      { key: 'status', label: 'สถานะ', options: this.statuses().map((s) => [s.key, s.label]), get: (row) => row['status'] },
      { key: 'priority', label: 'ความเร่งด่วน', options: ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'].map((v) => [v, v]), get: (row) => row['priority'] },
      { key: 'team', label: 'ทีม', options: this.meta.lists().teams.map((v) => [v, v]), get: (row) => row['team'] },
      {
        key: 'assignee',
        label: 'ผู้รับผิดชอบ',
        options: (this.rows().map((r) => r['assignee']).filter(Boolean) as string[])
          .filter((v, i, all) => all.indexOf(v) === i)
          .map((id) => [id, this.rows().find((r) => r['assignee'] === id)?._labels?.['assignee'] ?? id]),
        get: (row) => row['assignee'],
      },
    ];
  }

  isOpen(row: Record<string, unknown>): boolean {
    return !this.statuses().find((s) => s.key === row['status'])?.final;
  }

  open(row: Record<string, unknown>): void {
    void this.router.navigate(['/tickets', String(row['id'])]);
  }

  create(): void {
    void this.router.navigate(['/tickets/new']);
  }

  private statusLabel(value: unknown): string {
    return this.statuses().find((s) => s.key === value)?.label ?? String(value ?? '–');
  }

  private statusColor(value: unknown): string {
    return this.statuses().find((s) => s.key === value)?.color ?? 'gray';
  }

  private priorityColor(value: unknown): string {
    return value === 'เร่งด่วน' ? 'red' : value === 'สูง' ? 'amber' : 'gray';
  }
}
