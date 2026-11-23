import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { apiErrorMessage } from '../core/api.service';
import type { WorkflowStatus } from '../core/models';
import { displayValue } from '../core/util';
import type { AnyRow, ColumnDef, PageLoader, RecordRowInput } from './data-table.component';
import { PendingEditsService } from '../core/pending-edits.service';

type MoveRecord = (row: RecordRowInput, to: string) => Observable<RecordRowInput>;

interface LanePage {
  items: RecordRowInput[];
  page: number;
  total: number;
  loading: boolean;
  error?: string;
}

const INITIAL_LANE: LanePage = { items: [], page: 0, total: 0, loading: true };

@Component({
  selector: 'app-kanban-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kanban-board.component.html',
  styleUrl: './kanban-board.component.css',
})
export class KanbanBoardComponent {
  readonly loadPage = input.required<PageLoader>();
  readonly statuses = input.required<WorkflowStatus[]>();
  readonly rowHref = input.required<(row: AnyRow) => string>();
  readonly columns = input<ColumnDef[]>([]);
  readonly moveRecord = input<MoveRecord>();
  readonly blockedTargets = input<string[]>([]);
  readonly includeEmpty = input(false);
  readonly field = input('status');
  readonly rows = signal<Record<string, LanePage>>({});
  readonly query = signal('');
  readonly busy = signal<string | null>(null);
  readonly failure = signal<{ id: string; message: string } | null>(null);
  readonly notice = signal('');
  readonly dragId = signal('');
  readonly dragOver = signal<string | null>(null);
  private readonly reload = signal(0);
  private readonly destroy = inject(DestroyRef);
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  private queryVersion = 0;
  readonly activeLanes = computed(() => {
    const lanes = this.statuses().filter((status) => status.enabled);
    return this.includeEmpty()
      ? [...lanes, { key: '', label: 'ยังไม่กำหนด', next: lanes.map((lane) => lane.key), color: 'gray', enabled: true, requiredFields: [] }]
      : lanes;
  });
  readonly previewColumns = computed(() => this.columns().filter((column) =>
    column.key !== 'code' && column.key !== this.field(),
  ).slice(0, 4));

  constructor() {
    this.destroy.onDestroy(inject(PendingEditsService).register(() => this.busy() !== null));
    effect((cleanup) => {
      this.reload();
      this.query();
      this.queryVersion++;
      const lanes = this.activeLanes();
      this.rows.set({});
      const requests = lanes.map((lane) => this.loadLane(lane.key));
      cleanup(() => requests.forEach((request) => request.unsubscribe()));
    });
  }

  loadLane(key: string, previous?: LanePage) {
    const version = this.queryVersion;
    const page = previous ? previous.page + 1 : 1;
    this.rows.update((rows) => ({ ...rows, [key]: { ...(previous ?? INITIAL_LANE), loading: true, error: undefined } }));
    const filter = key ? { field: this.field(), op: 'eq', value: key } : { field: this.field(), op: 'empty' };
    return this.loadPage()({
      pageSize: 20, page, search: this.query(), filters: '', sort: '', where: JSON.stringify(filter), totals: '', groupBy: '',
    }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (result) => {
        if (version !== this.queryVersion) return;
        this.rows.update((rows) => ({
          ...rows,
          [key]: { ...result, items: [...(previous?.items ?? []), ...result.items], loading: false },
        }));
      },
      error: (error: unknown) => {
        if (version !== this.queryVersion) return;
        this.rows.update((rows) => ({
          ...rows, [key]: { ...(previous ?? INITIAL_LANE), loading: false, error: apiErrorMessage(error) },
        }));
      },
    });
  }

  state(key: string): LanePage {
    return this.rows()[key] ?? INITIAL_LANE;
  }

  targets(lane: WorkflowStatus): WorkflowStatus[] {
    if (!this.moveRecord() || lane.final) return [];
    return this.activeLanes().filter((status) =>
      lane.next.includes(status.key) && !this.blockedTargets().includes(status.key) && status.key !== lane.key,
    );
  }

  changeStatus(event: Event, row: RecordRowInput): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const target = event.target.value;
    event.target.value = '';
    if (target) this.move(row, target);
  }

  startDrag(event: DragEvent, row: RecordRowInput): void {
    if (!event.dataTransfer || this.busy()) return;
    this.dragId.set(row.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.id);
  }

  allowDrop(event: DragEvent, key: string): void {
    const source = this.dragged();
    if (!source || !this.targets(source.lane).some((lane) => lane.key === key)) return;
    event.preventDefault();
    this.dragOver.set(key);
  }

  drop(event: DragEvent, key: string): void {
    const source = this.dragged();
    this.endDrag();
    if (!source || !this.targets(source.lane).some((lane) => lane.key === key)) return;
    event.preventDefault();
    this.move(source.row, key);
  }

  endDrag(): void {
    this.dragId.set('');
    this.dragOver.set(null);
  }

  private dragged() {
    for (const lane of this.activeLanes()) {
      const row = this.state(lane.key).items.find((item) => item.id === this.dragId());
      if (row) return { row, lane };
    }
    return null;
  }

  private move(row: RecordRowInput, key: string): void {
    const move = this.moveRecord();
    if (!move || this.busy()) return;
    this.busy.set(row.id);
    this.failure.set(null);
    this.notice.set('');
    move(row, key).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (saved) => {
        const moved = saved[this.field()] === key;
        const label = this.activeLanes().find((lane) => lane.key === key)?.label ?? key;
        this.notice.set(moved ? `ย้าย ${String(row['code'] ?? '')} ไป ${label} แล้ว` :
          saved['_pendingApproval'] ? 'ส่งคำขออนุมัติแล้ว การ์ดยังอยู่สถานะเดิม' : 'สถานะยังไม่เปลี่ยน กรุณาตรวจรายการ');
        this.busy.set(null);
        if (moved) {
          this.rows.update((rows) => {
            const next = { ...rows };
            for (const lane of this.activeLanes()) {
              const state = rows[lane.key];
              if (!state) continue;
              if (lane.key === key) next[lane.key] = { ...state, total: state.total + 1, items: [saved, ...state.items] };
              else if (state.items.some((item) => item.id === row.id)) {
                next[lane.key] = { ...state, total: Math.max(0, state.total - 1), items: state.items.filter((item) => item.id !== row.id) };
              }
            }
            return next;
          });
        }
        this.focusCard(row.id);
      },
      error: (error: unknown) => {
        this.busy.set(null);
        if (error instanceof HttpErrorResponse && [403, 404].includes(error.status)) {
          this.reload.update((value) => value + 1);
          this.notice.set('ไม่พบรายการหรือคุณไม่มีสิทธิ์เข้าถึง โหลดสถานะใหม่แล้ว');
        } else {
          this.failure.set({ id: row.id, message: apiErrorMessage(error) });
        }
        this.focusCard(row.id, true);
      },
    });
  }

  private focusCard(id: string, preferMove = false): void {
    setTimeout(() => {
      const card = [...this.host.nativeElement.querySelectorAll<HTMLElement>('[data-card]')]
        .find((item) => item.dataset['card'] === id);
      (card?.querySelector<HTMLElement>(preferMove ? 'select' : 'a') ??
        this.host.nativeElement.querySelector<HTMLElement>('input[type="search"]'))?.focus();
    });
  }

  cell(row: AnyRow, column: ColumnDef): string {
    return displayValue(column.value ? column.value(row) : row[column.key]);
  }
}
