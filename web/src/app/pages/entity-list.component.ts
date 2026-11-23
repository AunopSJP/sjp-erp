import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { MetaService } from '../core/meta.service';
import { displayValue, fmtDate, fmtDateTime } from '../core/util';
import type { AnyRow, ColumnDef, FilterDef, PageLoader } from '../shared/data-table.component';
import { DataTableComponent } from '../shared/data-table.component';
import { KanbanBoardComponent } from '../shared/kanban-board.component';
import { RecordFormComponent } from '../shared/record-form.component';
import { StateComponent } from '../shared/state.component';
import { readExtraColumns, writeExtraColumns } from '../core/storage';
import { SchemaDrawerComponent, type CreatedField } from '../shared/schema-drawer.component';
import { ToastService } from '../shared/toast.service';
import type { EntityDef, FieldDef, ListResponse, RecordRow, WorkflowStatus } from '../core/models';

@Component({
  selector: 'app-entity-list',
  standalone: true,
  imports: [RouterLink, DataTableComponent, KanbanBoardComponent, RecordFormComponent, StateComponent, SchemaDrawerComponent],
  template: `
    @if (def(); as entity) {
      <div class="page">
        <div class="page-head">
          <div>
            <nav class="breadcrumb muted small" aria-label="ตำแหน่งปัจจุบัน">
              <a routerLink="/apps">แอปทั้งหมด</a>
              @if (entity.group) { <span aria-hidden="true"> / </span><span>{{ entity.group }}</span> }
              <span aria-hidden="true"> / </span><span aria-current="page">{{ entity.label }}</span>
            </nav>
            <h1>{{ entity.label }} <span class="muted small">· {{ view() === 'kanban' ? 'Kanban' : 'ตาราง' }}</span></h1>
          </div>
          <div class="page-actions">
            @if (kanban(); as board) {
              <div class="seg" role="group" aria-label="สลับมุมมอง">
                <button type="button" class="seg-btn" [class.on]="view() === 'grid'" [attr.aria-pressed]="view() === 'grid'" (click)="setView('grid')">ตาราง</button>
                <button type="button" class="seg-btn" [class.on]="view() === 'kanban'" [attr.aria-pressed]="view() === 'kanban'" [title]="'แบ่งเลนตาม ' + board.label" (click)="setView('kanban')">Kanban</button>
              </div>
            }
            @if (canEditSchema() && !entity.system) {
              <button type="button" class="btn" (click)="schemaOpen.set(true)">จัดการฟิลด์</button>
            }
            @if (auth.can(entity.resource, 'create')) {
              <button type="button" class="btn primary" [title]="'เพิ่ม' + entity.label" (click)="formOpen.set(true)">+ {{ addLabel() }}</button>
            }
          </div>
        </div>
        @if (view() === 'kanban' && kanban(); as board) {
          <app-kanban-board
            [loadPage]="tableLoader()"
            [statuses]="board.lanes"
            [field]="board.field"
            [includeEmpty]="board.includeEmpty"
            [rowHref]="rowHref"
            [columns]="columns()"
            [moveRecord]="board.move"
            [blockedTargets]="[]"
          />
        } @else {
        <app-data-table
          [columns]="columns()"
          [loadPage]="tableLoader()"
          [editEntity]="auth.can(entity.resource, 'edit') && (!entity.system || entity.key === 'vehicles') ? entity.key : ''"
          [rowHref]="rowHref"
          [filters]="filters()"
          [exportName]="entity.key"
          [viewsEntity]="entity.key"
          [canShareViews]="canEditSchema()"
          [canExport]="auth.can(entity.resource, 'export')"
          [canAddField]="canEditSchema() && !entity.system"
          [emptyText]="'ยังไม่มี' + entity.label"
          [emptyActionLabel]="auth.can(entity.resource, 'create') ? '+ เพิ่มรายการแรก' : ''"
          [rowClass]="rowClass"
          (rowClick)="open($event)"
          (emptyAction)="formOpen.set(true)"
          (addField)="schemaOpen.set(true)"
        />
        }
      </div>
      @if (formOpen()) {
        <app-record-form
          [entity]="entity.key"
          [entityLabel]="entity.label"
          [fields]="entity.fields"
          [lists]="lists()"
          [defaults]="defaultsFor(entity.key)"
          [side]="wideScreen()"
          (saved)="onSaved($event)"
          (closed)="formOpen.set(false)"
        />
      }
      @if (schemaOpen()) {
        <app-schema-drawer [entity]="entity" (created)="fieldCreated($event)" (closed)="schemaOpen.set(false)" />
      }
    } @else if (meta.loading()) {
      <app-state kind="loading" message="กำลังโหลดข้อมูล…" />
    } @else {
      <app-state kind="error" message="ไม่พบชนิดข้อมูลนี้" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntityListComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly meta = inject(MetaService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly formOpen = signal(false);
  readonly schemaOpen = signal(false);
  readonly canEditSchema = computed(() => this.auth.can('settings', 'edit'));
  readonly extraColumns = signal<string[]>([]);
  readonly filters = signal<FilterDef[]>([]);
  private readonly newRequested = signal(false);
  private readonly params = toSignal(this.route.paramMap);
  readonly entityKey = computed(() => this.params()?.get('entity') ?? '');
  readonly def = computed(() => this.meta.entity(this.entityKey()));
  readonly tableLoader = computed<PageLoader>(() => {
    const entity = this.entityKey();
    return (query) => this.api.get<ListResponse<RecordRow>>(`/records/${entity}`, query);
  });
  readonly view = signal<'grid' | 'kanban'>('grid');
  readonly wideScreen = () => typeof window !== 'undefined' && window.innerWidth >= 1100;
  /** Kanban lanes come from the workflow status, else the first usable single-choice field. */
  readonly kanban = computed(() => {
    const entity = this.def();
    if (!entity || entity.system) return null;
    const workflow = this.meta.workflowFor(entity).filter((status) => status.enabled);
    if (workflow.length && !entity.fields.some((field) => field.key === 'status' && field.type !== 'select')) {
      return {
        field: 'status', label: 'สถานะ', lanes: workflow, includeEmpty: false,
        move: (row: AnyRow, to: string) => this.api.post<RecordRow>(
          `/records/${entity.key}/${encodeURIComponent(String(row['id']))}/transition`, { to }) as never,
      };
    }
    const field = entity.fields.find((item) => item.type === 'select' && !item.archived && !item.hidden && !item.sensitive && !item.readOnly &&
      (item.optionMeta ?? []).some((option) => !option.archived));
    if (!field) return null;
    const live = (field.optionMeta ?? []).filter((option) => !option.archived);
    const lanes: WorkflowStatus[] = live.map((option) => ({
      key: option.id, label: option.label, color: option.color ?? 'gray', enabled: true, requiredFields: [],
      next: live.map((other) => other.id).filter((id) => id !== option.id),
    }));
    return {
      field: field.key, label: field.label, lanes, includeEmpty: !field.required,
      move: (row: AnyRow, to: string) => this.api.patch<RecordRow>(
        `/records/${entity.key}/${encodeURIComponent(String(row['id']))}`,
        { [field.key]: to, _expectedUpdatedAt: row['_updatedAt'] ?? row['updatedAt'] }) as never,
    };
  });
  readonly lists = computed(() => this.meta.lists());
  readonly addLabel = computed(() => {
    const label = this.def()?.label ?? '';
    return label.length + 5 > 16 ? 'เพิ่มรายการ' : `เพิ่ม${label}`;
  });
  readonly fmtDate = fmtDate;
  readonly fmtDateTime = fmtDateTime;
  readonly rowClass = () => '';
  readonly rowHref = (row: AnyRow) =>
    `/entities/${encodeURIComponent(this.entityKey())}/${encodeURIComponent(String(row['id']))}`;

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      if (params.get('new') !== '1') return;
      this.newRequested.set(true);
      this.tryOpenNew();
    });
    effect(() => {
      if (this.meta.meta()) {
        this.buildFilters();
        this.tryOpenNew();
      }
    });
    effect(() => {
      const key = this.entityKey();
      this.extraColumns.set(key ? readExtraColumns(key) : []);
      this.view.set('grid');
    });
  }

  setView(next: 'grid' | 'kanban'): void {
    this.view.set(next);
  }

  fieldCreated(event: CreatedField): void {
    if (event.showInView) {
      const next = [...new Set([...this.extraColumns(), event.field.key])];
      writeExtraColumns(event.entity, next);
      this.extraColumns.set(next);
    }
    this.meta.load(true);
    const target = event.showInView ? event.field.key : '';
    if (target) {
      const started = Date.now();
      const focusColumn = () => {
        const header = document.querySelector<HTMLElement>(`th[data-field="${target}"]`);
        if (header) {
          header.focus();
          return;
        }
        if (Date.now() - started < 2000) setTimeout(focusColumn, 100);
      };
      setTimeout(focusColumn, 100);
    }
    if (event.backlink) {
      this.toast.show(`เพิ่มลิงก์ย้อนกลับที่ ${event.backlink.entity} แล้ว`);
    }
  }

  private tryOpenNew(): void {
    const entity = this.def();
    if (!this.newRequested() || !entity || !this.auth.can(entity.resource, 'create')) return;
    this.formOpen.set(true);
    this.newRequested.set(false);
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  ngOnInit(): void {
    this.meta.load();
  }

  open(row: Record<string, unknown>): void {
    const entity = this.def();
    if (entity) void this.router.navigate(['/entities', entity.key, String(row['id'])]);
  }

  onSaved(record: RecordRow): void {
    const entity = this.def();
    if (entity && record?.id) void this.router.navigate(['/entities', entity.key, record.id]);
  }

  defaultsFor(entity: string): Record<string, unknown> {
    return entity === 'serials' ? { status: 'ในคลัง' } : {};
  }

  columns(): ColumnDef[] {
    const entity = this.def();
    if (!entity) return [];
    const fields = new Map(entity.fields.map((field) => [field.key, field]));
    const columns: ColumnDef[] = [{ key: 'code', label: 'รหัส' }];
    for (const key of entity.cols) {
      if (key === 'code') continue;
      if (key === 'stepLabel') {
        columns.push({ key: 'stepLabel', label: 'ขั้นตอนปัจจุบัน', sortable: false, value: (row) => this.projectStep(row) });
        continue;
      }
      if (key === 'status' && !fields.has('status') && this.meta.workflowFor(entity).length) {
        columns.push({ key: 'status', label: 'สถานะ', value: (row) => this.statusLabel(entity, row['status']), badge: (row) => this.statusColor(entity, row['status']) });
        continue;
      }
      const field = fields.get(key);
      if (!field || field.hidden || field.sensitive) continue;
      columns.push(this.columnFor(field, entity));
    }
    if (entity.key === 'serials') {
      columns.push({ key: 'warranty', label: 'ประกัน', sortable: false, value: (row) => this.warranty(row), badge: (row) => this.warrantyColor(row) });
    }
    for (const key of this.extraColumns()) {
      if (columns.some((column) => column.key === key)) continue;
      const field = fields.get(key);
      if (field && !field.hidden && !field.sensitive) columns.push(this.columnFor(field, entity));
    }
    if (!columns.some((column) => column.key === 'status') && !fields.has('status') && this.meta.workflowFor(entity).length) {
      columns.push({ key: 'status', label: 'สถานะ', value: (row) => this.statusLabel(entity, row['status']), badge: (row) => this.statusColor(entity, row['status']) });
    }
    return columns;
  }

  private columnFor(field: FieldDef, entity: EntityDef): ColumnDef {
    if (field.key === 'status' && this.meta.workflowFor(entity).length) {
      return {
        key: field.key,
        label: field.label,
        value: (row) => this.statusLabel(entity, row[field.key]),
        badge: (row) => this.statusColor(entity, row[field.key]),
      };
    }
    const optionLabel = (value: unknown): string => {
      const id = String(value ?? '');
      return field.optionMeta?.find((option) => option.id === id)?.label ?? id;
    };
    const optionColor = (value: unknown): string | undefined =>
      field.optionMeta?.find((option) => option.id === String(value ?? ''))?.color;
    if (field.type === 'select') {
      return {
        key: field.key,
        label: field.label,
        value: (row) => optionLabel(row[field.key]),
        badge: (row) => optionColor(row[field.key]) ?? 'gray',
      };
    }
    if (field.type === 'multiselect') {
      return {
        key: field.key,
        label: field.label,
        sortable: false,
        value: (row) => (Array.isArray(row[field.key]) ? (row[field.key] as unknown[]).map(optionLabel).join(', ') : ''),
      };
    }
    return {
      key: field.key,
      label: field.label,
      numeric: field.type === 'number',
      sortable: !['ref', 'section', 'formula', 'file', 'rows'].includes(field.type),
      editor: this.editorFor(field, entity),
      value: (row) => {
        const value = row[field.key];
        if (field.type === 'ref') return row._labels?.[field.key] ?? '–';
        if (field.type === 'boolean') return value == null || value === '' ? 'ยังไม่กำหนด' : value ? 'ใช่' : 'ไม่';
        if (field.type === 'date') return fmtDate(value);
        if (field.type === 'datetime') return fmtDateTime(value);
        if (field.type === 'number') return this.number(value, field);
        if (field.type === 'rows') return Array.isArray(value) ? `${value.length} แถว` : '–';
        if (field.type === 'file') return Array.isArray(value) ? (value as { name: string }[]).map((f) => f.name).join(', ') : '–';
        return displayValue(value);
      },
    };
  }

  private editorFor(field: FieldDef, entity: EntityDef): ColumnDef['editor'] {
    if (field.readOnly || ['status', 'assignee', 'manager', 'team'].includes(field.key)) return undefined;
    const allowed = (row: AnyRow) => !row['_deleted'] &&
      (entity.key !== 'purchaseOrders' || row['status'] === 'draft') &&
      !this.meta.workflowFor(entity).some((status) => status.key === row['status'] && status.final);
    switch (field.type) {
      case 'datetime': return { type: 'datetime-local', allowed };
      case 'email': case 'phone': case 'url': return { type: 'text', allowed };
      case 'text': case 'textarea': case 'number': case 'date': case 'boolean': return { type: field.type, allowed };
      case 'select': return {
        type: 'select', allowed,
        options: field.optionsFrom === 'teams'
          ? this.lists().teams
          : field.optionsFrom === 'depts'
            ? this.lists().depts
            : field.options,
      };
      default: return undefined;
    }
  }

  private number(value: unknown, field?: FieldDef): string {
    if (value === undefined || value === null || value === '') return '–';
    const n = Number(value);
    if (!Number.isFinite(n)) return '–';
    const digits = field?.decimals;
    const text = new Intl.NumberFormat('th-TH', {
      minimumFractionDigits: digits ?? 0,
      maximumFractionDigits: digits ?? 2,
    }).format(n);
    return field?.currency ? `${text} ${field.currency}` : text;
  }

  private buildFilters(): void {
    const entity = this.def();
    if (!entity) return;
    const fields = new Map(entity.fields.map((field) => [field.key, field]));
    const out: FilterDef[] = [];
    const apply = () => this.filters.set([...out]);
    for (const key of entity.filters) {
      const field = fields.get(key);
      if (!field) {
        if (key === 'status') {
          const statuses = this.meta.workflowFor(entity);
          out.push({ key, label: 'สถานะ', options: statuses.map((s) => [s.key, s.label]), get: (row) => row[key] });
          apply();
        }
        continue;
      }
      if (field.type === 'select' || field.type === 'boolean') {
        const options =
          field.type === 'boolean'
             ? [['1', 'ใช่'], ['0', 'ไม่']] as [string, string][]
            : field.optionsFrom === 'teams'
              ? this.lists().teams.map((o) => [o, o] as [string, string])
              : field.optionsFrom === 'depts'
                ? this.lists().depts.map((o) => [o, o] as [string, string])
                : (field.options ?? []).map((o) => [o, field.optionMeta?.find((option) => option.id === o)?.label ?? o] as [string, string]);
        out.push({
          key,
          label: field.label,
          options,
          get: (row) => (field.type === 'boolean' ? String(!!row[key]) : row[key]),
        });
        apply();
      } else if (field.type === 'ref' && field.ref) {
        const filter: FilterDef = { key, label: field.label, options: [], get: (row) => row[key] };
        out.push(filter);
        apply();
        this.meta.options(field.ref).subscribe((options) => {
          filter.options = options.map((o) => [o.value, o.label]);
          apply();
        });
      }
    }
    this.filters.set(out);
  }

  private statusLabel(entity: EntityDef, value: unknown): string {
    return this.meta.workflowFor(entity).find((s) => s.key === value)?.label ?? displayValue(value);
  }

  private statusColor(entity: EntityDef, value: unknown): string {
    return this.meta.workflowFor(entity).find((s) => s.key === value)?.color ?? 'gray';
  }

  private projectStep(row: Record<string, unknown>): string {
    const steps = (row['steps'] as Record<string, { status?: string }> | undefined) ?? {};
    const next = this.meta.projectSteps().find((step) => step.enabled && !['done', 'skipped'].includes(steps[step.key]?.status ?? 'pending'));
    return next?.label ?? 'ครบทุกขั้นตอน';
  }

  private warranty(row: Record<string, unknown>): string {
    const end = row['warrantyEnd'] ? new Date(`${String(row['warrantyEnd'])}T00:00:00`) : null;
    if (!end) return 'ไม่ระบุ';
    const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    return days < 0 ? 'หมดประกัน' : days <= 30 ? `ใกล้หมด (${days} วัน)` : 'อยู่ในประกัน';
  }

  private warrantyColor(row: Record<string, unknown>): string {
    const text = this.warranty(row);
    return text === 'หมดประกัน' ? 'red' : text.startsWith('ใกล้') ? 'amber' : text === 'ไม่ระบุ' ? 'gray' : 'green';
  }
}
