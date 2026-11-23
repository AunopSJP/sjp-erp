import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { fmtDate, fmtMoney, todayStr } from '../core/util';
import type { AnyRow, ColumnDef, PageLoader, TabDef } from '../shared/data-table.component';
import { DataTableComponent } from '../shared/data-table.component';
import { KanbanBoardComponent } from '../shared/kanban-board.component';
import { RecordFormComponent } from '../shared/record-form.component';
import type { ListResponse, RecordRow, WorkflowStatus } from '../core/models';

@Component({
  selector: 'app-purchase',
  standalone: true,
  imports: [DataTableComponent, KanbanBoardComponent, RecordFormComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div><h1>ใบสั่งซื้อและรับสินค้า</h1><div class="muted">จัดซื้อ → รับสินค้า → เข้าคลัง</div></div>
        <div class="page-actions">
          <div class="seg" role="group" aria-label="สลับมุมมอง">
            <button type="button" class="seg-btn" [class.on]="view() === 'grid'" (click)="view.set('grid')">ตาราง</button>
            <button type="button" class="seg-btn" [class.on]="view() === 'kanban'" (click)="view.set('kanban')">Kanban</button>
          </div>
          @if (auth.can('purchase','create')) { <button type="button" class="btn primary" (click)="formOpen.set(true)">+ สร้างใบสั่งซื้อ</button> }
        </div>
      </div>
      @if (view() === 'kanban') {
        <app-kanban-board
          [loadPage]="tableLoader"
          [statuses]="meta.poWorkflow()"
          [rowHref]="rowHref"
          [columns]="columns()"
          [moveRecord]="moveRecord"
          [blockedTargets]="blockedTargets()"
        />
      } @else {
        <app-data-table
          [columns]="columns()"
          [loadPage]="tableLoader"
          [editEntity]="auth.can('purchase', 'edit') ? 'purchaseOrders' : ''"
          [rowHref]="rowHref"
          [tabs]="tabs"
          [exportName]="'purchase-orders'"
          [viewsEntity]="'purchaseOrders'"
          [canShareViews]="auth.can('settings', 'edit')"
          [canExport]="auth.can('purchase','export')"
          [emptyText]="'ยังไม่มีใบสั่งซื้อ'"
          [rowClass]="rowClass"
          (rowClick)="open($event)"
        />
      }
    </div>
    @if (formOpen()) {
      <app-record-form entity="purchaseOrders" entityLabel="ใบสั่งซื้อ" createUrl="/records/purchaseOrders" [fields]="fields()" [lists]="meta.lists()" [defaults]="{ orderDate: today, lines: [{}] }" (saved)="saved($event)" (closed)="formOpen.set(false)" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PurchaseComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly meta = inject(MetaService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly tableLoader: PageLoader = (query) => this.api.get<ListResponse<RecordRow>>('/purchase-orders/page', query);
  readonly formOpen = signal(false);
  readonly view = signal<'grid' | 'kanban'>('grid');
  readonly fields = computed(() => this.meta.entity('purchaseOrders')?.fields ?? []);
  readonly moveRecord = (row: AnyRow, to: string) =>
    this.api.post<RecordRow>(`/purchase-orders/${encodeURIComponent(String(row['id']))}/status`, { to });
  readonly blockedTargets = computed(() => {
    const workflow = this.meta.poWorkflow();
    const close = this.auth.can('purchase', 'close');
    return workflow.filter((status: WorkflowStatus) => status.needClosePerm && !close).map((status) => status.key);
  });
  readonly today = todayStr();
  readonly tabs: TabDef[] = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'wait', label: 'รอรับสินค้า', statuses: ['ordered', 'partial'] },
    { key: 'draft', label: 'ร่าง', statuses: ['draft'] },
    { key: 'done', label: 'รับครบ/ปิด', statuses: ['received', 'closed'] },
  ];
  readonly rowClass = () => '';
  readonly rowHref = (row: AnyRow) => `/purchase-orders/${encodeURIComponent(String(row['id']))}`;

  ngOnInit(): void {
    this.meta.load();
    this.route.queryParamMap.subscribe((params) => {
      if (params.get('new') !== '1' || !this.auth.can('purchase', 'create')) return;
      this.formOpen.set(true);
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    });
  }

  columns(): ColumnDef[] {
    return [
      { key: 'code', label: 'เลขที่ PO' },
      { key: 'vendor', label: 'ผู้ขาย', sortable: false, value: (row) => row._labels?.['vendor'] ?? '–' },
      { key: 'project', label: 'โครงการ', sortable: false, value: (row) => row._labels?.['project'] ?? '–' },
      { key: 'orderDate', label: 'วันที่สั่ง', value: (row) => fmtDate(row['orderDate']) },
      {
        key: 'dueDate', label: 'กำหนดส่ง', value: (row) => fmtDate(row['dueDate']),
        editor: { type: 'date', allowed: (row) => !row['_deleted'] && row['status'] === 'draft' },
      },
      { key: 'amount', label: 'มูลค่า (บาท)', numeric: true, value: (row) => fmtMoney(row['amount']) },
      { key: 'pct', label: 'รับแล้ว', numeric: true, sortable: false, value: (row) => `${row['pct'] ?? 0}%` },
      { key: 'status', label: 'สถานะ', value: (row) => this.statusLabel(row['status']), badge: (row) => this.statusColor(row['status']) },
    ];
  }

  statusLabel(value: unknown): string {
    return this.meta.poWorkflow().find((status) => status.key === value)?.label ?? String(value ?? '–');
  }

  statusColor(value: unknown): string {
    return this.meta.poWorkflow().find((status) => status.key === value)?.color ?? 'gray';
  }

  open(row: Record<string, unknown>): void {
    void this.router.navigate(['/purchase-orders', String(row['id'])]);
  }

  saved(record: RecordRow): void {
    void this.router.navigate(['/purchase-orders', record.id]);
  }
}
