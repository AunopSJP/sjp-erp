import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Injector, OnDestroy, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { ApiService, apiErrorMessage, apiFieldErrors } from '../core/api.service';
import type { ListResponse } from '../core/models';
import { PendingEditsService } from '../core/pending-edits.service';
import { displayValue, downloadCsv, copyText, toTsv } from '../core/util';
import {
  readColumnOrder, readColumnPin, readColumnPrefs, readColumnWidths, readTableViews, readViewRecord,
  writeColumnOrder, writeColumnPin, writeColumnPrefs, writeColumnWidths, writeDetailNav, writeTableViews, writeViewRecord,
} from '../core/storage';
import { SavedViewsService, type SavedViewConfig, type ViewVisibility } from '../core/saved-views.service';
import { collectAllRows, EXPORT_ROW_LIMIT } from '../core/list-export';
import { sanitizeViewConfig } from '../core/view-config';
import { IconComponent } from './icon.component';
import { StateComponent } from './state.component';
import { ToastService } from './toast.service';

export type AnyRow = Record<string, unknown> & { _labels?: Record<string, string> };

export interface ColumnDef {
  key: string;
  label: string;
  value?: (row: AnyRow) => unknown;
  badge?: (row: AnyRow) => string;
  width?: string;
  sortable?: boolean;
  numeric?: boolean;
  editor?: {
    type: 'text' | 'textarea' | 'number' | 'date' | 'datetime-local' | 'boolean' | 'select';
    options?: string[];
    allowed?: (row: AnyRow) => boolean;
  };
}

export interface FilterDef {
  key: string;
  label: string;
  options: [string, string][];
  get: (row: AnyRow) => unknown;
}

export interface TabDef {
  key: string;
  label: string;
  test?: (row: AnyRow) => boolean;
  statuses?: string[];
}

export type TableQuery = Record<'page' | 'pageSize', number> & Record<'search' | 'sort' | 'filters' | 'where' | 'totals' | 'groupBy', string>;
export type PageLoader = (query: TableQuery) => Observable<ListResponse<RecordRowInput>>;

export interface ListTotals {
  totals?: Record<string, number>;
  groups?: { keys: (string | number | boolean | null)[]; count: number; totals: Record<string, number> }[];
  groupsTruncated?: boolean;
}

export interface FilterClause {
  field: string;
  op: string;
  value: string;
}

interface GroupDisplay {
  id: string;
  label: string;
  count: number;
  totalList: { key: string; label: string; text: string }[];
}

interface GroupPageDisplay extends GroupDisplay {
  rows: RecordRowInput[];
}
interface CellDraft {
  id: string;
  key: string;
  version: string;
  original: unknown;
  value: string;
  busy: boolean;
  error: string;
  uncertain?: boolean;
  latest?: RecordRowInput;
}

interface LocalView {
  id: string;
  name: string;
  q: string;
  fv: Record<string, string>;
  tab: string;
  sort: { key: string; dir: 1 | -1 };
}

interface UiView {
  id: string;
  name: string;
  visibility: ViewVisibility;
  ownerId: string;
  ownerName: string;
  mine: boolean;
  local?: boolean;
  config?: SavedViewConfig;
}

@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [IconComponent, StateComponent, NgTemplateOutlet],
  template: `
    <div class="dt">
      @if (tabs().length) {
        <div class="utabs" role="group" aria-label="ตัวกรองสถานะ" [attr.inert]="draft() ? '' : null">
          @for (item of tabs(); track item.key) {
            <button type="button" [attr.aria-pressed]="tab() === item.key" [class.active]="tab() === item.key" (click)="tab.set(item.key)">
              {{ item.label }}@if (!loadPage()) { <span class="tab-count">{{ countFor(item) }}</span> }
            </button>
          }
        </div>
      }
      <div class="table-tools" [attr.inert]="draft() ? '' : null">
        <div class="searchbox">
          <app-icon name="search" [size]="18" />
          <input type="search" [placeholder]="searchPlaceholder()" [value]="q()" (input)="onSearch($event)" aria-label="ค้นหา" />
          @if (q()) {
            <button type="button" class="search-clear" (click)="q.set('')" aria-label="ล้างคำค้น">×</button>
          }
        </div>
        @if (filters().length || loadPage()) {
          <button type="button" class="btn tool" [class.on]="showFilters() || activeFilterCount() || appliedWhere()" (click)="showFilters.set(!showFilters())">
            <app-icon name="filter" [size]="18" /> ตัวกรอง
            @if (activeFilterCount()) { <span class="tab-count">{{ activeFilterCount() }}</span> }
            @if (appliedWhere()) { <span class="tab-count">ขั้นสูง</span> }
          </button>
        }
        @if (groupableFields().length) {
          <div class="cols-wrap">
            <button type="button" class="btn tool" [class.on]="groupMenu() || groupBy().length" [attr.aria-expanded]="groupMenu()" aria-haspopup="true" (click)="toggleGroupMenu()">
              <app-icon name="grid" [size]="18" /> จัดกลุ่ม
              @if (groupBy().length) { <span class="tab-count">{{ groupBy().length }}</span> }
            </button>
            @if (groupMenu()) {
              <div class="cols-menu" role="dialog" aria-label="จัดกลุ่มรายการ">
                <label class="cols-item">ระดับ 1
                  <select [value]="groupBy()[0] ?? ''" (change)="setGroup(0, $any($event.target).value)" aria-label="จัดกลุ่มระดับ 1">
                    <option value="">ไม่จัดกลุ่ม</option>
                    @for (column of groupableFields(); track column.key) { <option [value]="column.key">{{ column.label }}</option> }
                  </select>
                </label>
                <label class="cols-item">ระดับ 2
                  <select [disabled]="!groupBy().length" [value]="groupBy()[1] ?? ''" (change)="setGroup(1, $any($event.target).value)" aria-label="จัดกลุ่มระดับ 2">
                    <option value="">ไม่จัดกลุ่ม</option>
                    @for (column of groupableFields(); track column.key) { <option [value]="column.key">{{ column.label }}</option> }
                  </select>
                </label>
                @if (groupBy().length) { <button type="button" class="btn sm" (click)="clearGroups()">ล้างการจัดกลุ่ม</button> }
              </div>
            }
          </div>
        }
        <span class="grow"></span>
        <ng-content />
        @if (unsavedView()) {
          <span class="view-unsaved" role="status">ยังไม่บันทึกมุมมอง</span>
        }
        <div class="views-wrap">
          <button #viewsButton type="button" class="btn tool" [class.on]="viewMenu()" [attr.aria-expanded]="viewMenu()" aria-haspopup="true" (click)="toggleViewMenu()">
            <app-icon name="folder" [size]="18" /> มุมมอง
            @if (viewCount()) { <span class="tab-count">{{ viewCount() }}</span> }
          </button>
          @if (restoreNotice()) {
            <div class="view-restore-note" role="status">{{ restoreNotice() }}</div>
          }
          @if (viewMenu()) {
            <div class="views-menu" role="dialog" aria-label="มุมมองที่บันทึก">
              <div class="view-save">
                <input [value]="viewName()" (input)="viewName.set($any($event.target).value)" placeholder="ตั้งชื่อมุมมอง…" aria-label="ชื่อมุมมอง" />
                @if (viewsEntity()) {
                  <label class="check"><input type="checkbox" [checked]="shareView()" [disabled]="!canShareViews()" (change)="shareView.set(checked($event))" /> แชร์ให้ทีม</label>
                }
                <button type="button" class="btn sm primary" [disabled]="!viewName().trim() || savingView()" (click)="saveView()">{{ savingView() ? 'กำลังบันทึก…' : 'บันทึก' }}</button>
              </div>
              @if (!viewCount()) {
                <div class="view-empty">ยังไม่มีมุมมองที่บันทึก</div>
              } @else {
                @for (view of savedViews(); track view.id) {
                  <div class="view-row">
                    <button type="button" class="view-apply" [class.on]="appliedViewId() === view.id" (click)="applyView(view)">
                      {{ view.name }}
                      <span class="view-badge {{ view.visibility === 'team' ? 'team' : 'mine' }}">{{ view.visibility === 'team' ? 'ทีม' : 'ฉัน' }}</span>
                    </button>
                    @if (view.mine || canShareViews()) {
                      <button type="button" class="view-del" (click)="deleteView(view.id, $event)" [attr.aria-label]="'ลบมุมมอง ' + view.name">×</button>
                    }
                  </div>
                }
              }
              @if (savedViews().some((view) => view.visibility === 'team' && !view.mine)) {
                <p class="view-hint">มุมมองของทีมแก้ไขได้เฉพาะผู้สร้างหรือผู้ดูแลการตั้งค่า และการแชร์ไม่ให้สิทธิ์อ่านข้อมูลเพิ่ม</p>
              }
            </div>
          }
        </div>
        <div class="cols-wrap">
          <button type="button" class="btn tool" [class.on]="columnMenu()" [attr.aria-expanded]="columnMenu()" aria-haspopup="true" (click)="toggleColumnMenu()">
            <app-icon name="columns" [size]="18" /> คอลัมน์
          </button>
          @if (columnMenu()) {
            <div class="cols-menu" role="group" aria-label="เลือกคอลัมน์ที่แสดง">
              @for (column of orderedColumns(); track column.key; let i = $index) {
                <div class="cols-item cols-item-row">
                  <label class="check">
                    <input type="checkbox" [checked]="true" [disabled]="!!loadPage() && i === 0" (change)="toggleColumn(column.key)" />
                    <span>{{ column.label }}</span>
                  </label>
                  <span class="cols-move">
                    <button type="button" class="btn ghost sm" [disabled]="i === 0" (click)="moveColumn(column.key, -1)" [attr.aria-label]="'ย้าย ' + column.label + ' ไปซ้าย'">←</button>
                    <button type="button" class="btn ghost sm" [disabled]="i === orderedColumns().length - 1" (click)="moveColumn(column.key, 1)" [attr.aria-label]="'ย้าย ' + column.label + ' ไปขวา'">→</button>
                  </span>
                </div>
              }
              @for (column of columns(); track column.key) {
                @if (!visibleColumns().includes(column)) {
                  <label class="cols-item">
                    <input type="checkbox" [checked]="false" (change)="toggleColumn(column.key)" />
                    <span>{{ column.label }} <span class="muted small">(ซ่อน)</span></span>
                  </label>
                }
              }
              @if (loadPage()) {
                <div class="cols-item cols-item-row" role="group" aria-label="ตรึงคอลัมน์ด้านซ้าย">
                  <span>ตรึงคอลัมน์ซ้าย: {{ pinCount() }}</span>
                  <span class="cols-move">
                    <button type="button" class="btn ghost sm" [disabled]="pinCount() <= 1" (click)="setPin(pinCount() - 1)" aria-label="ตรึงน้อยลง">−</button>
                    <button type="button" class="btn ghost sm" [disabled]="pinCount() >= maxPin()" (click)="setPin(pinCount() + 1)" aria-label="ตรึงเพิ่ม">+</button>
                  </span>
                </div>
                @if (pinCount() >= maxPin() && maxPin() < orderedColumns().length) {
                  <p class="muted small" role="status">ตรึงเพิ่มไม่ได้ ต้องเหลือพื้นที่เลื่อนอย่างน้อยครึ่งหนึ่งของตาราง</p>
                }
              }
              <button type="button" class="btn sm" (click)="resetColumnLayout()">รีเซ็ตลำดับ/ความกว้าง</button>
            </div>
          }
        </div>
        @if (canExport()) {
          <button
            type="button"
            class="btn tool"
            [disabled]="remoteLoading() || !filtered().length"
            (click)="copyList()"
            [attr.aria-label]="'คัดลอกรายการที่กรองแล้ว ' + filtered().length + ' รายการ'"
          >
            <app-icon name="copy" [size]="18" />
             <span aria-live="polite">
               {{ copyState() === 'done' ? 'คัดลอกแล้ว' : copyState() === 'fail' ? 'คัดลอกไม่ได้' : (loadPage() ? 'คัดลอกหน้านี้' : 'คัดลอกรายการ (' + filtered().length + ')') }}
            </span>
          </button>
          <button type="button" class="btn tool" [disabled]="remoteLoading() || exporting() || !filtered().length" (click)="exportCsv()">
            <app-icon name="download" [size]="18" /> {{ exporting() ? 'กำลังส่งออก…' : loadPage() ? 'ส่งออกทั้งหมด' : 'ส่งออก CSV' }}
          </button>
        }
      </div>
      <span class="sr-only" role="status" aria-live="polite">{{ editAnnouncement() }}</span>
      @if (showFilters() && (filters().length || loadPage())) {
        <div class="filter-row" [attr.inert]="draft() ? '' : null">
          @for (filter of filters(); track filter.key) {
            <select [value]="fv()[filter.key] || ''" (change)="setFilter(filter.key, $event)" [attr.aria-label]="filter.label">
              <option value="" [selected]="!fv()[filter.key]">{{ filter.label }}: ทั้งหมด</option>
              @for (option of filter.options; track option[0]) {
                <option [value]="option[0]" [selected]="option[0] === fv()[filter.key]">{{ option[1] }}</option>
              }
            </select>
          }
          @if (activeFilterCount()) {
            <button type="button" class="btn sm" (click)="fv.set({})">ล้างตัวกรอง</button>
          }
          @if (loadPage()) {
            <button type="button" class="btn sm" [attr.aria-expanded]="advancedOpen()" (click)="advancedOpen.set(!advancedOpen())">
              เงื่อนไขขั้นสูง (AND/OR){{ advancedRows().length + advancedGroup().length ? ' · ' + (advancedRows().length + advancedGroup().length) : '' }}
            </button>
          }
        </div>
      }
      @if (showFilters() && loadPage() && advancedOpen()) {
        <div class="dt-builder" role="group" aria-label="ตัวสร้างเงื่อนไข" [attr.inert]="draft() ? '' : null">
          <p class="muted small">จับคู่เงื่อนไขหลักด้วย
            <select [value]="rootJoin()" (change)="rootJoin.set($any($event.target).value)" aria-label="ตัวเชื่อมเงื่อนไขหลัก">
              <option value="and">และ (AND)</option>
              <option value="or">หรือ (OR)</option>
            </select>
            และจับคู่กลุ่มย่อยด้วย
            <select [value]="subJoin()" (change)="subJoin.set($any($event.target).value)" aria-label="ตัวเชื่อมกลุ่มย่อย">
              <option value="or">หรือ (OR)</option>
              <option value="and">และ (AND)</option>
            </select>
          </p>
          @for (clause of advancedRows(); track $index; let i = $index) {
            <div class="dt-condition">
              <select [value]="clause.field" (change)="setCondition('root', i, 'field', $any($event.target).value)" [attr.aria-label]="'ฟิลด์เงื่อนไขที่ ' + (i + 1)">
                @for (column of filterableFields(); track column.key) { <option [value]="column.key">{{ column.label }}</option> }
              </select>
              <select [value]="clause.op" (change)="setCondition('root', i, 'op', $any($event.target).value)" [attr.aria-label]="'ตัวดำเนินการเงื่อนไขที่ ' + (i + 1)">
                @for (op of operators; track op[0]) { <option [value]="op[0]">{{ op[1] }}</option> }
              </select>
              @if (needsValue(clause.op)) {
                @if (valueOptions(clause.field); as options) {
                  <select [value]="clause.value" (change)="setCondition('root', i, 'value', $any($event.target).value)" [attr.aria-label]="'ค่าเงื่อนไขที่ ' + (i + 1)">
                    <option value="">– เลือก –</option>
                    @for (option of options; track option[0]) { <option [value]="option[0]">{{ option[1] }}</option> }
                  </select>
                } @else {
                  <input [value]="clause.value" (input)="setCondition('root', i, 'value', $any($event.target).value)" [attr.aria-label]="'ค่าเงื่อนไขที่ ' + (i + 1)" placeholder="ค่า" />
                }
              }
              <button type="button" class="btn sm" (click)="removeCondition('root', i)" aria-label="ลบเงื่อนไข">×</button>
            </div>
          }
          <button type="button" class="btn sm" [disabled]="advancedRows().length >= 5" (click)="addCondition('root')">+ เพิ่มเงื่อนไข</button>
          <div class="dt-subgroup">
            <div class="dt-builder-head">
              <strong>กลุ่มย่อย ({{ subJoin() === 'or' ? 'หรือ' : 'และ' }})</strong>
              <button type="button" class="btn sm" [disabled]="advancedGroup().length >= 3" (click)="addCondition('sub')">+ เพิ่มในกลุ่มย่อย</button>
            </div>
            @for (clause of advancedGroup(); track $index; let i = $index) {
              <div class="dt-condition">
                <select [value]="clause.field" (change)="setCondition('sub', i, 'field', $any($event.target).value)" [attr.aria-label]="'ฟิลด์กลุ่มย่อยที่ ' + (i + 1)">
                  @for (column of filterableFields(); track column.key) { <option [value]="column.key">{{ column.label }}</option> }
                </select>
                <select [value]="clause.op" (change)="setCondition('sub', i, 'op', $any($event.target).value)" [attr.aria-label]="'ตัวดำเนินการกลุ่มย่อยที่ ' + (i + 1)">
                  @for (op of operators; track op[0]) { <option [value]="op[0]">{{ op[1] }}</option> }
                </select>
                @if (needsValue(clause.op)) {
                  @if (valueOptions(clause.field); as options) {
                    <select [value]="clause.value" (change)="setCondition('sub', i, 'value', $any($event.target).value)" [attr.aria-label]="'ค่ากลุ่มย่อยที่ ' + (i + 1)">
                      <option value="">– เลือก –</option>
                      @for (option of options; track option[0]) { <option [value]="option[0]">{{ option[1] }}</option> }
                    </select>
                  } @else {
                    <input [value]="clause.value" (input)="setCondition('sub', i, 'value', $any($event.target).value)" [attr.aria-label]="'ค่ากลุ่มย่อยที่ ' + (i + 1)" placeholder="ค่า" />
                  }
                }
                <button type="button" class="btn sm" (click)="removeCondition('sub', i)" aria-label="ลบเงื่อนไขกลุ่มย่อย">×</button>
              </div>
            }
          </div>
          @if (advancedSummary()) { <p class="muted small" role="status">สรุป: {{ advancedSummary() }}</p> }
          <div class="dt-builder-actions">
            <button type="button" class="btn sm" (click)="clearAdvanced()">ล้างเงื่อนไขขั้นสูง</button>
            <button type="button" class="btn sm primary" (click)="applyAdvanced()">นำไปใช้</button>
          </div>
        </div>
      }
      @if (error() && rows().length) {
        <div class="notice bad" role="alert">
          {{ error() }}
          <button type="button" class="btn sm" (click)="retry.emit()">ลองใหม่</button>
        </div>
      }
      <div class="tablecard">
        @if (remoteLoading()) {
          <app-state kind="loading" message="กำลังโหลดรายการ…" />
        } @else if (remoteError()) {
          <app-state kind="error" [message]="remoteError()" actionLabel="ลองใหม่" (action)="refresh()" />
        } @else if (error() && !rows().length) {
          <app-state kind="error" [message]="error()" actionLabel="ลองใหม่" (action)="retry.emit()" />
        } @else if (!(loadPage() ? total() : rows().length) && !(loadPage() && (q() || activeFilterCount() || selectedStatuses().length))) {
          <app-state kind="empty" [message]="emptyText()" [actionLabel]="emptyActionLabel()" (action)="emptyAction.emit()" />
        } @else if (!filtered().length) {
          <app-state
            kind="empty"
            message="ไม่พบรายการที่ตรงกับการค้นหา/ตัวกรอง"
            actionLabel="ล้างตัวกรอง"
            (action)="clearFilters()"
          />
        } @else {
           <div class="table-wrap" [class.dt-remote]="loadPage()" tabindex="0" aria-label="พื้นที่ตาราง">
            <table class="tbl">
              <colgroup>
                @for (column of orderedColumns(); track column.key; let i = $index) {
                  <col [style.width.px]="widthFor(column.key) ?? (i < pinCount() ? PIN_DEFAULT_WIDTH : null)" />
                }
                @if (canAddField()) { <col /> }
              </colgroup>
              <thead>
                <tr>
                  @for (column of orderedColumns(); track column.key; let i = $index) {
                     <th scope="col" draggable="true" [class.dt-pinned]="i < pinCount()" [style.left.px]="i < pinCount() ? pinLeft(i) : null" [class.sortable]="column.sortable !== false" [class.dt-numeric]="column.numeric" [attr.data-field]="column.key" [attr.tabindex]="-1" [attr.aria-sort]="sort().key === column.key ? (sort().dir === 1 ? 'ascending' : 'descending') : null"
                       (dragstart)="onColumnDragStart($event, column.key)" (dragover)="onColumnDragOver($event)" (drop)="onColumnDrop($event, column.key)">
                       <span class="dt-grip" aria-hidden="true">⋮⋮</span>
                       @if (column.sortable !== false) {
                         <button type="button" class="th-sort" [disabled]="!!draft()" (click)="toggleSort(column.key)">
                           {{ column.label }}
                           @if (sort().key === column.key) { {{ sort().dir === 1 ? '▲' : '▼' }} }
                         </button>
                       } @else { {{ column.label }} }
                       <span class="dt-resize" role="separator" tabindex="0" aria-label="ปรับความกว้าง {{ column.label }}"
                         aria-orientation="vertical" [attr.aria-valuemin]="80" [attr.aria-valuemax]="600" [attr.aria-valuenow]="widthFor(column.key) ?? 120"
                         (pointerdown)="startResize($event, column.key)" (keydown)="onResizeKey($event, column.key)"></span>
                    </th>
                  }
                  @if (canAddField()) {
                    <th scope="col" class="dt-add-col">
                      <button type="button" class="btn sm" [disabled]="!!draft()" (click)="addField.emit()">+ เพิ่มฟิลด์</button>
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                <ng-template #rowTpl let-row>
                  <tr
                    [class]="'click ' + rowClass()(row)"
                     [attr.tabindex]="rowHref() ? -1 : 0"
                     [attr.data-row-id]="row['id']"
                     (click)="!rowHref() && onRowClick(row)"
                    (keydown)="onRowKey($event, row)"
                  >
                    @for (column of orderedColumns(); track column.key; let first = $first; let i = $index) {
                       <td [class.dt-pinned]="i < pinCount()" [style.left.px]="i < pinCount() ? pinLeft(i) : null" [class.dt-numeric]="column.numeric" [attr.data-label]="column.label"
                         [attr.data-row-id]="row['id']" [attr.data-field]="column.key"
                         [attr.tabindex]="canEdit(row, column) ? 0 : null"
                         (click)="focusCell($event, row, column)" (dblclick)="startEdit(row, column)"
                         (keydown)="onCellKey($event, row, column)">
                         @if (draftFor(row, column); as cellDraft) {
                           <div class="dt-editor" (click)="$event.stopPropagation()" (keydown)="onEditorKey($event, column)">
                             <label class="sr-only" for="grid-cell-input">{{ column.label }} · {{ row['code'] }}</label>
                             @switch (column.editor?.type) {
                               @case ('textarea') {
                                 <textarea id="grid-cell-input" [value]="cellDraft.value" [disabled]="cellDraft.busy || !!cellDraft.latest"
                                   [attr.aria-invalid]="!!cellDraft.error" [attr.aria-describedby]="cellDraft.error ? 'grid-cell-error' : null"
                                   (input)="setDraftValue($event)"></textarea>
                               }
                               @case ('boolean') {
                                 <select id="grid-cell-input" [value]="cellDraft.value" [disabled]="cellDraft.busy || !!cellDraft.latest" (change)="setDraftValue($event)">
                                   <option value="">ยังไม่กำหนด</option><option value="true">ใช่</option><option value="false">ไม่</option>
                                 </select>
                               }
                               @case ('select') {
                                 <select id="grid-cell-input" [value]="cellDraft.value" [disabled]="cellDraft.busy || !!cellDraft.latest" (change)="setDraftValue($event)">
                                   <option value="">ยังไม่กำหนด</option>
                                   @for (option of column.editor?.options ?? []; track option) { <option [value]="option">{{ option }}</option> }
                                 </select>
                               }
                               @default {
                                 <input id="grid-cell-input" [type]="column.editor?.type ?? 'text'" [value]="cellDraft.value" step="any"
                                   [disabled]="cellDraft.busy || !!cellDraft.latest" [attr.aria-invalid]="!!cellDraft.error"
                                   [attr.aria-describedby]="cellDraft.error ? 'grid-cell-error' : null" (input)="setDraftValue($event)" />
                               }
                             }
                             @if (cellDraft.latest) {
                               <p class="dt-edit-error" role="status">ค่าล่าสุด: {{ display(cellDraft.latest[column.key]) }} · ค่าที่คุณกรอก: {{ cellDraft.value || 'ว่าง' }}</p>
                               <button type="button" class="btn sm" (click)="cancelEdit(true)">โหลดค่าล่าสุด</button>
                               <button type="button" class="btn sm" (click)="keepDraft()">เก็บร่างและแก้ก่อนลองใหม่</button>
                             } @else {
                               @if (cellDraft.error) { <p id="grid-cell-error" class="dt-edit-error" role="alert">{{ cellDraft.error }}</p> }
                               <button type="button" class="btn sm" [disabled]="cellDraft.busy" (click)="commitCell()">{{ cellDraft.busy ? 'กำลังบันทึก…' : cellDraft.error ? 'ลองอีกครั้ง' : 'บันทึก' }}</button>
                               <button type="button" class="btn sm" [disabled]="cellDraft.busy" (click)="cancelEdit()">ยกเลิก</button>
                             }
                           </div>
                         } @else if (first && rowHref(); as getHref) {
                           <a [href]="getHref(row)" (click)="followRow($event, row)">{{ cell(row, column) }}</a>
                         } @else if (column.badge) {
                          <span class="badge {{ column.badge(row) }}">{{ cell(row, column) }}</span>
                        } @else {
                          {{ cell(row, column) }}
                        }
                      </td>
                    }
                    @if (canAddField()) {
                      <td class="dt-add-cell"></td>
                    }
                  </tr>
                </ng-template>
                @if (groupBy().length && groupPageRows().length) {
                  @for (group of groupPageRows(); track group.id) {
                    <tr class="dt-group-row">
                      <td [attr.colspan]="orderedColumns().length + (canAddField() ? 1 : 0)">
                        <button type="button" class="dt-group-toggle" [attr.aria-expanded]="!isGroupCollapsed(group.id)" (click)="toggleGroupRow(group.id)">
                          <span aria-hidden="true">{{ isGroupCollapsed(group.id) ? '▸' : '▾' }}</span>
                          {{ group.label }}
                        </button>
                        <span class="badge gray">{{ group.count }}</span>
                        @for (total of group.totalList; track total.key) {
                          <span class="muted small">{{ total.label }} {{ total.text }}</span>
                        }
                      </td>
                    </tr>
                    @if (!isGroupCollapsed(group.id)) {
                      @for (row of group.rows; track row['id']) {
                        <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: row }" />
                      }
                    }
                  }
                } @else {
                  @for (row of pageRows(); track row['id']) {
                    <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: row }" />
                  }
                }
              </tbody>
              @if (totalColumns().length) {
                <tfoot>
                  <tr>
                    <th scope="row">รวมทั้งชุดที่กรองแล้ว</th>
                    @for (column of orderedColumns(); track column.key; let first = $first) {
                      @if (!first) {
                        <td [class.dt-numeric]="column.numeric">
                          @if (column.numeric) { {{ totalFor(column) }} }
                        </td>
                      }
                    }
                  </tr>
                </tfoot>
              }
            </table>
          </div>
        }
      </div>
      <div class="pager" [attr.inert]="draft() ? '' : null">
        <span class="muted" role="status" aria-live="polite">
           @if (!remoteLoading() && !remoteError()) {
             {{ pageRows().length ? ((currentPage() - 1) * size() + 1) + '–' + ((currentPage() - 1) * size() + pageRows().length) + ' จาก ' + total() : '0 รายการ' }}
             @if (!loadPage() && filtered().length !== rows().length && !tabs().length) { (ทั้งหมด {{ rows().length }}) }
           }
        </span>
        <select [value]="size()" (change)="setSize($event)" aria-label="จำนวนต่อหน้า">
          @for (n of sizes; track n) { <option [value]="n" [selected]="n === size()">{{ n }} / หน้า</option> }
        </select>
        <span class="grow"></span>
        <button type="button" class="btn sm" [disabled]="remoteLoading() || currentPage() <= 1" (click)="page.set(currentPage() - 1)">ก่อนหน้า</button>
        <span>หน้า {{ currentPage() }} / {{ pages() }}</span>
        <button type="button" class="btn sm" [disabled]="remoteLoading() || currentPage() >= pages()" (click)="page.set(currentPage() + 1)">ถัดไป</button>
      </div>
    </div>
  `,
  styles: [`
    .dt-remote { max-height: 68vh; overflow: auto; isolation: isolate; }
    .dt-remote .tbl th { position: sticky; top: 0; z-index: 2; background: var(--card); }
    .dt-remote .tbl :is(td, th).dt-pinned { position: sticky; z-index: 1; background: var(--card); }
    .dt-remote .tbl th.dt-pinned { z-index: 3; }
    .dt-remote .tbl .dt-pinned:last-of-type, .dt-remote .tbl .dt-pin-last { box-shadow: 1px 0 0 var(--line); }
    .dt-numeric { text-align: right; font-variant-numeric: tabular-nums; }
    .dt-editor { display: grid; min-width: 160px; gap: 6px; white-space: normal; text-align: start; }
    .dt-edit-error { margin: 0; white-space: normal; overflow-wrap: anywhere; }
    .dt-editor :is(input, select, textarea) { width: 100%; min-width: 0; }
    .dt-add-col { position: sticky; right: 0; background: var(--card); z-index: 3; white-space: nowrap; }
    .dt-add-cell { position: sticky; right: 0; background: var(--card); }
    .view-unsaved { font-size: .85em; color: var(--muted); border: 1px dashed var(--line); border-radius: 999px; padding: 2px 8px; }
    .view-badge { margin-left: 6px; font-size: .75em; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); }
    .view-badge.team { background: var(--pri-l); color: var(--pri); border-color: currentColor; }
    .view-apply.on { font-weight: 650; }
    .view-hint { margin: 8px 0 0; font-size: .8em; color: var(--muted); }
    .view-restore-note { position: absolute; top: 100%; right: 0; margin-top: 4px; padding: 6px 10px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; font-size: .85em; max-width: 320px; z-index: 5; }
    .views-wrap { position: relative; }
    .dt-builder { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); margin: 8px 0; }
    .dt-condition { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .dt-condition select, .dt-condition input { min-width: 0; flex: 1 1 140px; }
    .dt-subgroup { display: grid; gap: 8px; padding: 8px; border-left: 3px solid var(--line); margin-left: 4px; }
    .dt-builder-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
    .dt-builder-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .dt-groups { display: grid; gap: 6px; margin: 8px 0; }
    .dt-group { border: 1px solid var(--line); border-radius: 8px; background: var(--card); padding: 6px 10px; }
    .dt-group summary { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; cursor: pointer; min-height: 36px; }
    .dt-group-name { font-weight: 600; overflow-wrap: anywhere; }
    .dt tfoot th, .dt tfoot td { background: var(--card); font-weight: 600; border-top: 2px solid var(--line); }
    .dt-grip { color: var(--muted); font-size: .8em; margin-inline-end: 4px; cursor: grab; user-select: none; }
    .dt-resize { display: inline-block; width: 8px; margin-inline-start: 4px; height: 1.2em; cursor: col-resize; vertical-align: middle; border-inline-end: 2px solid var(--line); touch-action: none; }
    .dt-resize:focus-visible { outline: 2px solid var(--pri); outline-offset: 1px; }
    .dt-group-row td { background: var(--bg); font-weight: 600; }
    .dt-group-toggle { border: 0; background: none; font: inherit; font-weight: 650; color: inherit; cursor: pointer; min-height: 36px; padding: 0 6px 0 0; text-align: start; }
    .cols-item-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .cols-move { display: inline-flex; gap: 2px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataTableComponent implements OnInit, OnDestroy {
  readonly columns = input.required<ColumnDef[]>();
  readonly rows = input<RecordRowInput[]>([]);
  readonly filters = input<FilterDef[]>([]);
  readonly tabs = input<TabDef[]>([]);
  readonly pageSize = input(25);
  readonly exportName = input('export');
  readonly canExport = input(true);
  readonly searchPlaceholder = input('ค้นหา…');
  readonly emptyText = input('ยังไม่มีข้อมูล');
  readonly emptyActionLabel = input('');
  readonly error = input('');
  readonly rowClass = input<(row: AnyRow) => string>(() => '');
  readonly initialTab = input('');
  readonly initialFilters = input<Record<string, string>>({});
  readonly loadPage = input<PageLoader>();
  readonly editEntity = input('');
  readonly rowHref = input<(row: AnyRow) => string>();
  readonly canAddField = input(false);
  readonly viewsEntity = input('');
  readonly canShareViews = input(false);

  readonly rowClick = output<Record<string, unknown>>();
  readonly emptyAction = output<void>();
  readonly retry = output<void>();
  readonly addField = output<void>();

  readonly q = signal('');
  readonly fv = signal<Record<string, string>>({});
  readonly sort = signal<{ key: string; dir: 1 | -1 }>({ key: '', dir: 1 });
  readonly page = signal(1);
  readonly size = signal(25);
  readonly tab = signal('');
  readonly showFilters = signal(false);
  readonly hiddenColumns = signal<string[]>([]);
  readonly columnOrder = signal<string[]>([]);
  readonly columnWidths = signal<Record<string, number>>({});
  readonly PIN_DEFAULT_WIDTH = 160;
  readonly pinCount = signal(1);
  readonly gridWidth = signal(0);
  /** Pinned columns may use at most half of the grid so the rest can still scroll. */
  readonly maxPin = computed(() => {
    const limit = (this.gridWidth() || 1000) / 2;
    const columns = this.orderedColumns();
    let total = 0;
    let count = 0;
    for (const column of columns) {
      total += this.widthFor(column.key) ?? this.PIN_DEFAULT_WIDTH;
      if (total > limit) break;
      count++;
    }
    return Math.max(1, Math.min(6, count));
  });
  readonly collapsedGroups = signal<string[]>([]);
  private readonly dragColumn = signal('');
  readonly columnMenu = signal(false);
  readonly savedViews = signal<UiView[]>([]);
  readonly viewMenu = signal(false);
  readonly viewName = signal('');
  readonly shareView = signal(false);
  readonly savingView = signal(false);
  readonly appliedViewId = signal('');
  readonly restoreNotice = signal('');
  private readonly appliedSnapshot = signal('');
  private readonly pendingRestore = signal<{ id: string; after: number } | null>(null);
  private readonly loadToken = signal(0);
  private readonly viewNonce = signal(0);
  readonly viewCount = computed(() => this.savedViews().length);
  readonly copyState = signal<'idle' | 'done' | 'fail'>('idle');
  readonly groupBy = signal<string[]>([]);
  readonly groupMenu = signal(false);
  readonly advancedOpen = signal(false);
  readonly advancedRows = signal<FilterClause[]>([]);
  readonly advancedGroup = signal<FilterClause[]>([]);
  readonly rootJoin = signal<'and' | 'or'>('and');
  readonly subJoin = signal<'and' | 'or'>('or');
  readonly appliedWhere = signal('');
  readonly unsavedView = computed(() =>
    !!this.appliedViewId() && this.appliedSnapshot() !== this.stateSnapshot());
  readonly remoteLoading = signal(false);
  readonly exporting = signal(false);
  readonly remoteError = signal('');
  readonly draft = signal<CellDraft | null>(null);
  readonly editAnnouncement = signal('');
  readonly display = displayValue;
  private readonly remoteResult = signal<(ListResponse<RecordRowInput> & ListTotals) | null>(null);
  private readonly reload = signal(0);
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  readonly sizes = [10, 25, 50, 100];
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  private readonly injector = inject(Injector);
  private readonly destroy = inject(DestroyRef);
  private readonly views = inject(SavedViewsService);
  private readonly toast = inject(ToastService);
  private focusAfterLoad?: { id: string; key: string; next?: boolean };
  private resizeState: { key: string; startX: number; startWidth: number } | null = null;

  readonly visibleColumns = computed(() => {
    const hidden = new Set(this.hiddenColumns());
    const visible = this.columns().filter((column, index) => (this.loadPage() && index === 0) || !hidden.has(column.key));
    return visible.length ? visible : this.columns();
  });
  readonly orderedColumns = computed(() => {
    const visible = this.visibleColumns();
    const order = this.columnOrder();
    if (!order.length) return visible;
    const rank = new Map(order.map((key, index) => [key, index]));
    return [...visible].sort((left, right) =>
      (rank.get(left.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.key) ?? Number.MAX_SAFE_INTEGER));
  });

  readonly filtered = computed(() => {
    if (this.loadPage()) return this.remoteResult()?.items ?? [];
    let out = this.rows();
    const tabTest = this.tabs().find((t) => t.key === this.tab())?.test;
    if (tabTest) out = out.filter(tabTest);
    const filters = this.fv();
    for (const filter of this.filters()) {
      const value = filters[filter.key];
      if (value) out = out.filter((row) => String(filter.get(row) ?? '') === value);
    }
    const search = this.q().trim().toLowerCase();
    if (search) {
      out = out.filter((row) =>
        this.columns().some((column) => String(this.rawValue(row, column) ?? '').toLowerCase().includes(search)),
      );
    }
    const sort = this.sort();
    if (sort.key) {
      const column = this.columns().find((c) => c.key === sort.key);
      if (column) {
        out = [...out].sort((a, b) => {
          const x = this.rawValue(a, column);
          const y = this.rawValue(b, column);
          if (x === undefined || x === null || x === '') return 1;
          if (y === undefined || y === null || y === '') return -1;
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
          return String(x).localeCompare(String(y), 'th', { numeric: true }) * sort.dir;
        });
      }
    }
    return out;
  });
  readonly total = computed(() => this.loadPage() ? (this.remoteResult()?.total ?? 0) : this.filtered().length);
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.size())));
  readonly currentPage = computed(() => this.loadPage() ? (this.remoteResult()?.page ?? 1) : Math.min(this.page(), this.pages()));
  readonly pageRows = computed(() => {
    if (this.loadPage()) return this.filtered();
    const page = this.currentPage();
    return this.filtered().slice((page - 1) * this.size(), page * this.size());
  });
  readonly activeFilterCount = computed(() => Object.values(this.fv()).filter(Boolean).length);
  readonly selectedStatuses = computed(() => this.tabs().find((item) => item.key === this.tab())?.statuses ?? []);
  readonly groupableFields = computed(() => this.columns().filter((column) =>
    column.key !== 'stepLabel' && !column.editor?.type?.startsWith('date') && column.key !== 'code'));
  readonly filterableFields = computed(() => this.columns().filter((column) => column.key !== 'code'));
  readonly operators: [string, string][] = [
    ['contains', 'มีคำว่า'], ['eq', 'เท่ากับ'], ['neq', 'ไม่เท่ากับ'],
    ['gt', 'มากกว่า'], ['gte', 'มากกว่าหรือเท่ากับ'], ['lt', 'น้อยกว่า'], ['lte', 'น้อยกว่าหรือเท่ากับ'],
    ['empty', 'ว่าง'], ['notEmpty', 'ไม่ว่าง'],
  ];
  readonly numericColumns = computed(() => this.columns().filter((column) => column.numeric));
  readonly totals = computed<Record<string, number>>(() => {
    const remote = this.remoteResult();
    if (this.loadPage() && remote) return remote.totals ?? {};
    const out: Record<string, number> = {};
    for (const column of this.numericColumns()) {
      out[column.key] = this.filtered().reduce((sum, row) => sum + Number(row[column.key] ?? 0), 0);
    }
    return out;
  });
  readonly totalColumns = computed(() => (this.columns().length > 1 ? this.numericColumns() : []));
  readonly groupsTruncated = computed(() => this.loadPage() && !!this.remoteResult()?.groupsTruncated);
  readonly groupRows = computed<GroupDisplay[]>(() => {
    const fields = this.groupBy();
    if (!fields.length) return [];
    const columns = this.columns();
    const remote = this.remoteResult();
    const items: { keys: (string | number | boolean | null)[]; count: number; totals: Record<string, number> }[] =
      this.loadPage() && remote?.groups
        ? remote.groups
        : this.localGroups(fields);
    return items.map((group) => ({
      id: JSON.stringify(group.keys),
      label: group.keys.map((value, index) => `${columns.find((column) => column.key === fields[index])?.label ?? fields[index]}: ${this.groupValue(value)}`).join(' · '),
      count: group.count,
      totalList: this.numericColumns().map((column) => ({
        key: column.key, label: column.label, text: this.formatNumber(group.totals[column.key] ?? 0),
      })),
    }));
  });
  readonly advancedSummary = computed(() => this.describeWhere());
  readonly groupPageRows = computed<GroupPageDisplay[]>(() => {
    const fields = this.groupBy();
    if (!fields.length) return [];
    const summary = new Map(this.groupRows().map((group) => [group.id, group]));
    const buckets = new Map<string, { keys: (string | number | boolean | null)[]; rows: RecordRowInput[] }>();
    for (const row of this.pageRows()) {
      const keys = fields.map((key) => (row[key] === undefined ? null : row[key] as string | number | boolean | null));
      const id = JSON.stringify(keys);
      const bucket = buckets.get(id) ?? { keys, rows: [] };
      bucket.rows.push(row);
      buckets.set(id, bucket);
    }
    const columns = this.columns();
    return [...buckets.entries()].map(([id, bucket]) => {
      const head = summary.get(id);
      const localTotals = Object.fromEntries(this.numericColumns().map((column) => [
        column.key,
        bucket.rows.reduce((sum, row) => sum + Number(row[column.key] ?? 0), 0),
      ]));
      return {
        id,
        label: head?.label ?? bucket.keys.map((value, index) =>
          `${columns.find((column) => column.key === fields[index])?.label ?? fields[index]}: ${this.groupValue(value)}`).join(' · '),
        count: head?.count ?? bucket.rows.length,
        totalList: head?.totalList ?? this.numericColumns().map((column) => ({
          key: column.key, label: column.label, text: this.formatNumber(localTotals[column.key] ?? 0),
        })),
        rows: bucket.rows,
      };
    });
  });

  constructor() {
    this.destroy.onDestroy(inject(PendingEditsService).register(() => !!this.draft()));
    effect(() => {
      this.q();
      this.fv();
      this.size();
      this.tab();
      this.sort();
      this.page.set(1);
    });
    effect((cleanup) => {
      const load = this.loadPage();
      if (!load) return;
      this.reload();
      this.viewNonce();
      const query = this.remoteQuery(this.page(), this.size());
      this.remoteLoading.set(true);
      this.remoteError.set('');
      const request = load(query).subscribe({
        next: (result) => {
          this.remoteResult.set(result);
          this.loadToken.update((token) => token + 1);
          this.remoteLoading.set(false);
          const target = this.focusAfterLoad;
          if (target) {
            this.focusAfterLoad = undefined;
            this.focusEdited(target.id, target.key, target.next);
          }
        },
        error: (error: unknown) => {
          this.remoteResult.set(null);
          this.remoteError.set(apiErrorMessage(error));
          this.remoteLoading.set(false);
        },
      });
      cleanup(() => request.unsubscribe());
    });
    effect(() => {
      this.hiddenColumns.set(readColumnPrefs(this.exportName()));
    });
    effect(() => {
      this.columnOrder.set(readColumnOrder(this.exportName()));
    });
    effect(() => {
      this.columnWidths.set(readColumnWidths(this.exportName()));
    });
    effect(() => {
      this.pinCount.set(readColumnPin(this.exportName()));
    });
    effect((cleanup) => {
      const entity = this.viewsEntity();
      if (!entity) {
        this.savedViews.set(this.localViews());
        return;
      }
      const request = this.views.load(entity).subscribe({
        next: (result) => this.savedViews.set(result.items.map((view) => ({ ...view, local: false }))),
        error: () => this.savedViews.set([]),
      });
      cleanup(() => request.unsubscribe());
    });
    effect(() => {
      const target = this.pendingRestore();
      const result = this.remoteResult();
      if (!target || !result || this.loadToken() <= target.after) return;
      this.pendingRestore.set(null);
      setTimeout(() => this.restoreRow(target.id));
    });
  }

  private remoteQuery(page: number, pageSize: number): TableQuery {
    const sort = this.sort();
    const filters = Object.fromEntries(Object.entries(this.fv()).filter(([, value]) => value !== ''));
    const statuses = this.selectedStatuses();
    const totals = this.numericColumns().map((column) => column.key);
    const statusWhere = statuses.length ? { field: 'status', op: 'in', value: statuses } : null;
    const applied = this.appliedWhere();
    let where = '';
    if (statusWhere && applied) {
      try {
        where = JSON.stringify({ join: 'and', clauses: [statusWhere, JSON.parse(applied)] });
      } catch {
        where = JSON.stringify(statusWhere);
      }
    } else if (statusWhere) {
      where = JSON.stringify(statusWhere);
    } else {
      where = applied;
    }
    return {
      page,
      pageSize,
      search: this.q(),
      sort: sort.key ? `${sort.dir === -1 ? '-' : ''}${sort.key}` : '',
      filters: JSON.stringify(filters),
      where,
      totals: totals.join(','),
      groupBy: this.groupBy().join(','),
    };
  }

  private localViews(): UiView[] {
    const raw = readTableViews(this.exportName());
    return raw.filter((view): view is LocalView => this.isLocalView(view)).map((view) => ({
      id: view.id,
      name: view.name,
      visibility: 'private' as const,
      ownerId: '',
      ownerName: '',
      mine: true,
      local: true,
      config: { q: view.q, fv: view.fv, tab: view.tab, sort: view.sort },
    }));
  }

  private isLocalView(value: unknown): value is LocalView {
    if (!value || typeof value !== 'object') return false;
    const view = value as Partial<LocalView>;
    return typeof view.id === 'string' && typeof view.name === 'string' && typeof view.q === 'string';
  }

  toggleViewMenu(): void {
    const next = !this.viewMenu();
    this.viewMenu.set(next);
    this.columnMenu.set(false);
    this.groupMenu.set(false);
  }

  toggleColumnMenu(): void {
    this.gridWidth.set(this.host.nativeElement.querySelector<HTMLElement>('.dt-remote')?.clientWidth ?? 0);
    const next = !this.columnMenu();
    this.columnMenu.set(next);
    this.viewMenu.set(false);
    this.groupMenu.set(false);
  }

  toggleGroupMenu(): void {
    const next = !this.groupMenu();
    this.groupMenu.set(next);
    this.viewMenu.set(false);
    this.columnMenu.set(false);
  }

  setGroup(level: number, value: string): void {
    const current = [...this.groupBy()];
    if (level === 0) {
      current[0] = value;
      if (!value) current.length = 0;
    } else {
      if (!current[0]) return;
      current[1] = value;
      if (!value) current.length = 1;
    }
    const next = current.filter((key, index) => !!key && current.indexOf(key) === index);
    this.groupBy.set(next);
    this.page.set(1);
    this.refresh();
  }

  clearGroups(): void {
    this.groupBy.set([]);
    this.page.set(1);
    this.refresh();
  }

  toggleGroupRow(id: string): void {
    this.collapsedGroups.update((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  isGroupCollapsed(id: string): boolean {
    return this.collapsedGroups().includes(id);
  }

  pinLeft(index: number): number {
    return this.orderedColumns().slice(0, index)
      .reduce((sum, column) => sum + (this.widthFor(column.key) ?? this.PIN_DEFAULT_WIDTH), 0);
  }

  setPin(count: number): void {
    const next = Math.max(1, Math.min(this.maxPin(), count));
    this.pinCount.set(next);
    writeColumnPin(this.exportName(), next);
  }

  widthFor(key: string): number | null {
    return this.columnWidths()[key] ?? null;
  }

  moveColumn(key: string, delta: number): void {
    const keys = this.orderedColumns().map((column) => column.key);
    const from = keys.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= keys.length) return;
    [keys[from], keys[to]] = [keys[to], keys[from]];
    this.persistColumnOrder(keys);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`th[data-field="${key}"] .th-sort`)?.focus());
  }

  onColumnDragStart(event: DragEvent, key: string): void {
    this.dragColumn.set(key);
    event.dataTransfer?.setData('text/plain', key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onColumnDragOver(event: DragEvent): void {
    if (this.dragColumn()) event.preventDefault();
  }

  onColumnDrop(event: DragEvent, targetKey: string): void {
    event.preventDefault();
    const source = this.dragColumn();
    this.dragColumn.set('');
    if (!source || source === targetKey) return;
    const keys = this.orderedColumns().map((column) => column.key);
    const from = keys.indexOf(source);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    keys.splice(from, 1);
    keys.splice(to, 0, source);
    this.persistColumnOrder(keys);
  }

  startResize(event: PointerEvent, key: string): void {
    event.preventDefault();
    event.stopPropagation();
    const header = (event.target as HTMLElement | null)?.closest('th');
    this.resizeState = {
      key,
      startX: event.clientX,
      startWidth: header?.offsetWidth ?? this.widthFor(key) ?? 120,
    };
  }

  onResizeKey(event: KeyboardEvent, key: string): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const header = event.target instanceof HTMLElement ? event.target.closest('th') : null;
    const current = this.widthFor(key) ?? header?.offsetWidth ?? 120;
    const next = Math.min(600, Math.max(80, current + (event.key === 'ArrowRight' ? 16 : -16)));
    this.columnWidths.update((widths) => ({ ...widths, [key]: next }));
    writeColumnWidths(this.exportName(), this.columnWidths());
  }

  @HostListener('document:pointermove', ['$event'])
  onResizeMove(event: PointerEvent): void {
    const state = this.resizeState;
    if (!state) return;
    const width = Math.min(600, Math.max(80, state.startWidth + event.clientX - state.startX));
    this.columnWidths.update((widths) => ({ ...widths, [state.key]: Math.round(width) }));
  }

  @HostListener('document:pointerup')
  onResizeEnd(): void {
    if (!this.resizeState) return;
    this.resizeState = null;
    writeColumnWidths(this.exportName(), this.columnWidths());
  }

  resetColumnLayout(): void {
    this.pinCount.set(1);
    writeColumnPin(this.exportName(), 1);
    this.columnOrder.set([]);
    this.columnWidths.set({});
    writeColumnOrder(this.exportName(), []);
    writeColumnWidths(this.exportName(), {});
  }

  private persistColumnOrder(keys: string[]): void {
    this.columnOrder.set(keys);
    writeColumnOrder(this.exportName(), keys);
  }

  addCondition(target: 'root' | 'sub'): void {
    const rows = target === 'root' ? this.advancedRows() : this.advancedGroup();
    if (rows.length >= (target === 'root' ? 5 : 3)) return;
    const column = this.filterableFields()[target === 'root' ? 0 : 1] ?? this.filterableFields()[0];
    if (!column) return;
    const clause: FilterClause = { field: column.key, op: 'contains', value: '' };
    if (target === 'root') this.advancedRows.update((items) => [...items, clause]);
    else this.advancedGroup.update((items) => [...items, clause]);
  }

  removeCondition(target: 'root' | 'sub', index: number): void {
    if (target === 'root') this.advancedRows.update((items) => items.filter((_item, i) => i !== index));
    else this.advancedGroup.update((items) => items.filter((_item, i) => i !== index));
  }

  setCondition(target: 'root' | 'sub', index: number, key: keyof FilterClause, value: string): void {
    const update = (items: FilterClause[]): FilterClause[] =>
      items.map((item, i) => (i === index ? { ...item, [key]: value } : item));
    if (target === 'root') this.advancedRows.update(update);
    else this.advancedGroup.update(update);
  }

  needsValue(op: string): boolean {
    return op !== 'empty' && op !== 'notEmpty';
  }

  valueOptions(field: string): [string, string][] | null {
    const column = this.columns().find((item) => item.key === field);
    if (!column) return null;
    if (column.editor?.type === 'boolean') return [['true', 'ใช่'], ['false', 'ไม่']];
    if (column.editor?.options?.length) return column.editor.options.map((option) => [option, option]);
    return null;
  }

  applyAdvanced(): void {
    const clauses: unknown[] = this.advancedRows()
      .map((clause) => this.clauseJson(clause))
      .filter((clause): clause is Record<string, unknown> => !!clause);
    const sub = this.advancedGroup()
      .map((clause) => this.clauseJson(clause))
      .filter((clause): clause is Record<string, unknown> => !!clause);
    if (sub.length) clauses.push({ join: this.subJoin(), clauses: sub });
    this.appliedWhere.set(clauses.length ? JSON.stringify({ join: this.rootJoin(), clauses }) : '');
    this.page.set(1);
    this.refresh();
  }

  clearAdvanced(): void {
    this.advancedRows.set([]);
    this.advancedGroup.set([]);
    this.appliedWhere.set('');
    this.page.set(1);
    this.refresh();
  }

  totalFor(column: ColumnDef): string {
    return this.formatNumber(this.totals()[column.key] ?? 0);
  }

  private clauseJson(clause: FilterClause): Record<string, unknown> | null {
    const column = this.columns().find((item) => item.key === clause.field);
    if (!column) return null;
    if (!this.needsValue(clause.op)) return { field: clause.field, op: clause.op };
    if (column.numeric) {
      const number = Number(clause.value);
      if (clause.value.trim() === '' || !Number.isFinite(number)) return null;
      return { field: clause.field, op: clause.op, value: number };
    }
    if (column.editor?.type === 'boolean') {
      if (clause.value !== 'true' && clause.value !== 'false') return null;
      return { field: clause.field, op: clause.op, value: clause.value === 'true' };
    }
    if (!clause.value.trim()) return null;
    return { field: clause.field, op: clause.op, value: clause.value };
  }

  private describeWhere(): string {
    const text = (clause: FilterClause): string => {
      const column = this.columns().find((item) => item.key === clause.field);
      const label = column?.label ?? clause.field;
      const op = this.operators.find((item) => item[0] === clause.op)?.[1] ?? clause.op;
      return `${label} ${op}${this.needsValue(clause.op) ? ` “${clause.value}”` : ''}`;
    };
    const joinText = (join: 'and' | 'or') => (join === 'and' ? ' และ ' : ' หรือ ');
    const root = this.advancedRows().map(text);
    const sub = this.advancedGroup().map(text);
    const parts: string[] = [];
    if (root.length) parts.push(root.join(joinText(this.rootJoin())));
    if (sub.length) parts.push(`(${sub.join(joinText(this.subJoin()))})`);
    return parts.join(joinText(this.rootJoin()));
  }

  private localGroups(fields: string[]): { keys: (string | number | boolean | null)[]; count: number; totals: Record<string, number> }[] {
    const map = new Map<string, { keys: (string | number | boolean | null)[]; count: number; totals: Record<string, number> }>();
    for (const row of this.filtered()) {
      const keys = fields.map((key) => (row[key] === undefined ? null : row[key] as string | number | boolean | null));
      const id = JSON.stringify(keys);
      const entry = map.get(id) ?? {
        keys,
        count: 0,
        totals: Object.fromEntries(this.numericColumns().map((column) => [column.key, 0])),
      };
      entry.count++;
      for (const column of this.numericColumns()) entry.totals[column.key] += Number(row[column.key] ?? 0);
      map.set(id, entry);
    }
    return [...map.values()].sort((left, right) => right.count - left.count);
  }

  private groupValue(value: string | number | boolean | null): string {
    if (value === null || value === '') return 'ยังไม่กำหนด';
    if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่';
    if (typeof value === 'number') return this.formatNumber(value);
    if (value === '1') return 'ใช่';
    if (value === '0') return 'ไม่';
    return value;
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value);
  }

  saveView(): void {
    const name = this.viewName().trim();
    if (!name || this.savingView()) return;
    const config = this.currentConfig();
    const entity = this.viewsEntity();
    if (entity) {
      const visibility = this.shareView() && this.canShareViews() ? 'team' : 'private';
      this.savingView.set(true);
      this.views.create(entity, name, visibility, config).subscribe({
        next: (view) => {
          this.savingView.set(false);
          const existing = this.savedViews().some((item) => item.id === view.id);
          this.savedViews.set(existing
            ? this.savedViews().map((item) => item.id === view.id ? { ...view, local: false } : item)
            : [...this.savedViews(), { ...view, local: false }]);
          this.appliedViewId.set(view.id);
          this.appliedSnapshot.set(this.stateSnapshot());
          this.viewName.set('');
          this.shareView.set(false);
          this.toast.show(`บันทึกมุมมอง "${view.name}" ${visibility === 'team' ? 'ให้ทีม' : 'แล้ว'}`);
        },
        error: (error: unknown) => {
          this.savingView.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
      return;
    }
    const existing = this.savedViews().find((view) => view.name.toLowerCase() === name.toLowerCase());
    const view: LocalView = {
      id: existing?.id ?? `${Date.now()}`,
      name,
      q: config.q ?? '',
      fv: config.fv ?? {},
      tab: config.tab ?? '',
      sort: config.sort ?? { key: '', dir: 1 },
    };
    const next = existing
      ? this.savedViews().map((item) => (item.id === existing.id ? { ...item, name } : item))
      : [...this.savedViews(), { id: view.id, name, visibility: 'private' as const, ownerId: '', ownerName: '', mine: true, local: true, config }].slice(-12);
    this.savedViews.set(next);
    writeTableViews(this.exportName(), next.filter((item) => item.local).map((item) => ({
      id: item.id, name: item.name, q: item.config?.q ?? '', fv: item.config?.fv ?? {},
      tab: item.config?.tab ?? '', sort: item.config?.sort ?? { key: '', dir: 1 },
    })));
    this.appliedViewId.set(view.id);
    this.appliedSnapshot.set(this.stateSnapshot());
    this.viewName.set('');
  }

  applyView(view: UiView): void {
    const allowed = new Set([
      ...this.columns().map((column) => column.key),
      ...this.filters().map((filter) => filter.key),
      'code', 'status', '_createdAt', '_updatedAt', 'id',
    ]);
    const { config, dropped } = sanitizeViewConfig(view.config ?? {}, allowed);
    if (dropped.length) this.toast.show(`ปรับมุมมอง “${view.name}” แล้ว: ตัด ${dropped.length} ฟิลด์ที่ใช้ไม่ได้`);
    this.q.set(config.q ?? '');
    this.fv.set({ ...(config.fv ?? {}) });
    this.tab.set(config.tab ?? '');
    this.sort.set(config.sort?.key ? { key: config.sort.key, dir: config.sort.dir === -1 ? -1 : 1 } : { key: '', dir: 1 });
    if (Array.isArray(config.hiddenColumns)) {
      this.hiddenColumns.set(config.hiddenColumns);
      writeColumnPrefs(this.exportName(), config.hiddenColumns);
    }
    if (config.pageSize) this.size.set(config.pageSize);
    this.groupBy.set(Array.isArray(config.groupBy) ? config.groupBy.slice(0, 2) : []);
    this.appliedWhere.set(config.where ?? '');
    this.restoreBuilder(config.where ?? '');
    this.viewMenu.set(false);
    this.restoreNotice.set('');
    this.appliedViewId.set(view.id);
    this.appliedSnapshot.set(this.stateSnapshot());
    const last = readViewRecord(view.id);
    if (!last) {
      this.focusViewButton();
      return;
    }
    if (this.loadPage()) {
      this.pendingRestore.set({ id: last, after: this.loadToken() });
      this.viewNonce.update((value) => value + 1);
    } else {
      setTimeout(() => this.restoreRow(last));
    }
  }

  deleteView(id: string, event: MouseEvent): void {
    event.stopPropagation();
    const entity = this.viewsEntity();
    if (entity) {
      this.savingView.set(true);
      this.views.remove(id).subscribe({
        next: () => {
          this.savingView.set(false);
          this.savedViews.set(this.savedViews().filter((view) => view.id !== id));
          if (this.appliedViewId() === id) this.appliedViewId.set('');
        },
        error: (error: unknown) => {
          this.savingView.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
      return;
    }
    const next = this.savedViews().filter((view) => view.id !== id);
    this.savedViews.set(next);
    writeTableViews(this.exportName(), next.map((item) => ({
      id: item.id, name: item.name, q: item.config?.q ?? '', fv: item.config?.fv ?? {},
      tab: item.config?.tab ?? '', sort: item.config?.sort ?? { key: '', dir: 1 },
    })));
    if (this.appliedViewId() === id) this.appliedViewId.set('');
  }

  checked(event: Event): boolean {
    return event.target instanceof HTMLInputElement && event.target.checked;
  }

  private currentConfig(): SavedViewConfig {
    return {
      q: this.q(),
      fv: { ...this.fv() },
      tab: this.tab(),
      sort: { ...this.sort() },
      hiddenColumns: [...this.hiddenColumns()],
      pageSize: this.size(),
      where: this.appliedWhere(),
      groupBy: [...this.groupBy()],
    };
  }

  private stateSnapshot(): string {
    return JSON.stringify({
      q: this.q(), fv: this.fv(), tab: this.tab(), sort: this.sort(),
      size: this.size(), hidden: this.hiddenColumns(), group: this.groupBy(), where: this.appliedWhere(),
    });
  }

  private restoreRow(id: string): void {
    const row = [...this.host.nativeElement.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')]
      .find((item) => item.dataset['rowId'] === id);
    if (row) {
      row.scrollIntoView?.({ block: 'nearest' });
      row.focus();
      this.restoreNotice.set('กลับไปที่รายการที่เปิดล่าสุดแล้ว');
      return;
    }
    this.focusViewButton();
    this.restoreNotice.set('รายการที่เปิดล่าสุดไม่อยู่ในผลลัพธ์ของมุมมองนี้แล้ว — โฟกัสกลับที่หัวมุมมอง');
  }

  private focusViewButton(): void {
    this.host.nativeElement.querySelector<HTMLElement>('.views-wrap > button')?.focus();
  }

  /** Rebuilds the AND/OR builder inputs from a saved `where`, one sub-group deep. */
  private restoreBuilder(where: string): void {
    this.advancedRows.set([]);
    this.advancedGroup.set([]);
    if (!where) return;
    try {
      const root = JSON.parse(where) as { join?: string; clauses?: unknown[]; field?: string; op?: string; value?: unknown };
      if (!Array.isArray(root.clauses)) {
        if (typeof root.field === 'string') {
          this.advancedRows.set([{ field: root.field, op: String(root.op ?? 'eq'), value: root.value === undefined ? '' : String(root.value) }]);
        }
        return;
      }
      const parse = (node: unknown): FilterClause[] => {
        if (!node || typeof node !== 'object') return [];
        const record = node as { field?: unknown; op?: unknown; value?: unknown; clauses?: unknown[] };
        if (Array.isArray(record.clauses)) return [];
        if (typeof record.field !== 'string') return [];
        return [{
          field: record.field,
          op: String(record.op ?? 'eq'),
          value: Array.isArray(record.value) ? record.value.map(String).join(',') : record.value === undefined ? '' : String(record.value),
        }];
      };
      const rootClauses = root.clauses.filter((node) => !(node && typeof node === 'object' && Array.isArray((node as { clauses?: unknown[] }).clauses)));
      const subNode = root.clauses.find((node) => node && typeof node === 'object' && Array.isArray((node as { clauses?: unknown[] }).clauses)) as { join?: string; clauses?: unknown[] } | undefined;
      this.rootJoin.set(root.join === 'or' ? 'or' : 'and');
      this.advancedRows.set(rootClauses.flatMap(parse).slice(0, 5));
      if (subNode) {
        this.subJoin.set(subNode.join === 'and' ? 'and' : 'or');
        this.advancedGroup.set((subNode.clauses ?? []).flatMap(parse).slice(0, 3));
      }
    } catch {
      this.advancedRows.set([]);
      this.advancedGroup.set([]);
    }
  }

  ngOnInit(): void {
    this.size.set(this.pageSize());
    this.fv.set({ ...this.initialFilters() });
    this.tab.set(this.initialTab() || this.tabs()[0]?.key || '');
  }

  ngOnDestroy(): void {
    if (this.copyTimer) clearTimeout(this.copyTimer);
  }

  onSearch(event: Event): void {
    this.q.set((event.target as HTMLInputElement).value);
  }

  refresh(): void {
    this.reload.update((count) => count + 1);
  }

  setFilter(key: string, event: Event): void {
    this.fv.update((filters) => ({ ...filters, [key]: (event.target as HTMLSelectElement).value }));
  }

  setSize(event: Event): void {
    this.size.set(Number((event.target as HTMLSelectElement).value));
  }

  toggleSort(key: string): void {
    this.sort.update((sort) => (sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  onRowKey(event: KeyboardEvent, row: AnyRow): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.onRowClick(row);
  }

  onRowClick(row: AnyRow): void {
    writeDetailNav(this.exportName(), this.filtered().map((item) => String(item['id'])));
    const viewId = this.appliedViewId();
    if (viewId) writeViewRecord(viewId, String(row['id']));
    this.rowClick.emit(row);
  }

  followRow(event: MouseEvent, row: AnyRow): void {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.onRowClick(row);
  }

  canEdit(row: AnyRow, column: ColumnDef): boolean {
    return !!this.editEntity() && !!column.editor && typeof row['_updatedAt'] === 'string' &&
      (column.editor.allowed?.(row) ?? true);
  }

  draftFor(row: AnyRow, column: ColumnDef): CellDraft | null {
    const draft = this.draft();
    return draft && draft.id === row['id'] && draft.key === column.key ? draft : null;
  }

  focusCell(event: MouseEvent, row: AnyRow, column: ColumnDef): void {
    if (!this.canEdit(row, column) || this.draftFor(row, column)) return;
    event.stopPropagation();
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
  }

  onCellKey(event: KeyboardEvent, row: AnyRow, column: ColumnDef): void {
    if (event.target !== event.currentTarget || !this.canEdit(row, column)) return;
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      event.stopPropagation();
      this.startEdit(row, column);
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const cells = this.editableCells();
      const sameRow = cells.filter((cell) => cell.dataset['rowId'] === row['id']);
      const sameField = cells.filter((cell) => cell.dataset['field'] === column.key);
      const axis = ['ArrowLeft', 'ArrowRight'].includes(event.key) ? sameRow : sameField;
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      const current = axis.findIndex((cell) => cell === event.currentTarget);
      const next = axis[current + direction];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }
  }

  startEdit(row: AnyRow, column: ColumnDef): void {
    if (!this.canEdit(row, column) || this.draft()) return;
    const value = row[column.key];
    let text = value === null || value === undefined ? '' : String(value);
    if (column.editor?.type === 'datetime-local' && text) {
      const date = new Date(text);
      if (Number.isFinite(date.valueOf())) text = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    }
    this.editAnnouncement.set('');
    this.draft.set({ id: String(row['id']), key: column.key, version: String(row['_updatedAt']), original: value, value: text, busy: false, error: '' });
    this.focusEditor();
  }

  setDraftValue(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    this.draft.update((draft) => draft ? { ...draft, value: target.value, error: '' } : null);
  }

  onEditorKey(event: KeyboardEvent, column: ColumnDef): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    } else if (event.target instanceof HTMLButtonElement) {
      return;
    } else if ((event.key === 'Enter' && column.editor?.type !== 'textarea') || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      this.commitCell(event.key === 'Tab');
    }
  }

  commitCell(next = false): void {
    const draft = this.draft();
    if (!draft || draft.busy || draft.latest) return;
    const column = this.columns().find((item) => item.key === draft.key);
    if (!column?.editor) return;
    const input = this.host.nativeElement.querySelector<HTMLInputElement>('input#grid-cell-input');
    if (input?.validity.badInput) {
      this.draft.set({ ...draft, error: 'ค่าที่กรอกไม่ถูกต้อง' });
      return;
    }
    let value: string | number | boolean | null = draft.value || null;
    if (column.editor.type === 'number' && draft.value) value = Number(draft.value);
    if (column.editor.type === 'boolean' && draft.value) value = draft.value === 'true';
    if (column.editor.type === 'datetime-local' && draft.value) value = new Date(draft.value).toISOString();
    if (!draft.uncertain && this.equalValue(value, draft.original)) {
      this.draft.set(null);
      this.focusEdited(draft.id, draft.key, next);
      return;
    }
    this.draft.set({ ...draft, busy: true, error: '' });
    if (draft.uncertain) this.readCell(draft, value, next, true);
    else this.sendCell(draft, value, next);
  }

  private sendCell(draft: CellDraft, value: unknown, next: boolean): void {
    this.injector.get(ApiService).patch<RecordRowInput>(this.cellUrl(draft.id), {
      [draft.key]: value,
      _expectedUpdatedAt: draft.version,
    }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (saved) => this.completeCell(draft, saved, next),
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 409) this.readCell(draft, value, next, false);
        else this.failedCell(draft, error, error instanceof HttpErrorResponse && error.status === 0);
      },
    });
  }

  private readCell(draft: CellDraft, value: unknown, next: boolean, retry: boolean): void {
    this.injector.get(ApiService).get<RecordRowInput>(this.cellUrl(draft.id)).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (current) => {
        if (retry && this.equalValue(current[draft.key], value)) this.completeCell(draft, current, next);
        else if (retry && current['_updatedAt'] === draft.version) this.sendCell({ ...draft, uncertain: false }, value, next);
        else this.draft.set({ ...draft, busy: false, latest: current, error: '', uncertain: false });
      },
      error: (error: unknown) => this.failedCell(draft, error, true),
    });
  }

  private failedCell(draft: CellDraft, error: unknown, uncertain: boolean): void {
    this.draft.set({ ...draft, busy: false, uncertain, error: apiFieldErrors(error)[draft.key] || apiErrorMessage(error) });
    this.focusEditor();
  }

  private completeCell(draft: CellDraft, saved: RecordRowInput, next: boolean): void {
    this.draft.set(null);
    this.editAnnouncement.set('บันทึกค่าแล้ว');
    this.replaceRow(saved);
    if (this.loadPage()) {
      this.focusAfterLoad = { id: draft.id, key: draft.key, next };
      this.refresh();
    } else {
      this.focusEdited(draft.id, draft.key, next);
    }
  }

  cancelEdit(useLatest = false): void {
    const draft = this.draft();
    if (!draft || draft.busy) return;
    this.draft.set(null);
    if (useLatest && draft.latest) {
      this.replaceRow(draft.latest);
      this.refresh();
    }
    this.focusEdited(draft.id, draft.key);
  }

  keepDraft(): void {
    const draft = this.draft();
    if (!draft?.latest || typeof draft.latest['_updatedAt'] !== 'string') return;
    this.draft.set({ ...draft, version: draft.latest['_updatedAt'], original: draft.latest[draft.key], latest: undefined, error: '' });
    this.focusEditor();
  }

  private replaceRow(row: RecordRowInput): void {
    this.remoteResult.update((current) => current ? {
      ...current, items: current.items.map((item) => item.id === row.id ? { ...item, ...row } : item),
    } : null);
  }

  private cellUrl(id: string): string {
    return `/records/${encodeURIComponent(this.editEntity())}/${encodeURIComponent(id)}`;
  }

  private equalValue(left: unknown, right: unknown): boolean {
    return (left ?? null) === (right ?? null);
  }

  private editableCells(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('td[data-row-id][tabindex="0"]')];
  }

  private focusEditor(): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#grid-cell-input')?.focus());
  }

  private focusEdited(id: string, key: string, next = false): void {
    setTimeout(() => {
      const cells = this.editableCells();
      const index = cells.findIndex((cell) => cell.dataset['rowId'] === id && cell.dataset['field'] === key);
      const target = index < 0 ? undefined : cells[index + Number(next)];
      if (target) target.focus();
      else {
        const selector = index < 0 ? 'input[type="search"]' : '.pager select';
        this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
        if (index < 0) this.editAnnouncement.set('รายการไม่อยู่ในผลการค้นหาหรือหน้านี้แล้ว');
      }
    });
  }

  clearFilters(): void {
    this.q.set('');
    this.fv.set({});
    if (this.loadPage()) this.tab.set(this.tabs().find((item) => !item.statuses?.length)?.key ?? '');
  }

  toggleColumn(key: string): void {
    if (this.loadPage() && this.columns()[0]?.key === key) return;
    const current = this.hiddenColumns();
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    if (this.columns().length - next.length < 1) return;
    this.hiddenColumns.set(next);
    writeColumnPrefs(this.exportName(), next);
  }

  @HostListener('document:pointerdown', ['$event'])
  onPointer(event: PointerEvent): void {
    if (!this.columnMenu() && !this.viewMenu() && !this.groupMenu()) return;
    const target = event.target as Node | null;
    if (target && this.host.nativeElement.contains(target)) return;
    this.columnMenu.set(false);
    this.viewMenu.set(false);
    this.groupMenu.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.columnMenu.set(false);
    this.viewMenu.set(false);
    this.groupMenu.set(false);
  }

  countFor(tab: TabDef): number {
    return tab.test ? this.rows().filter(tab.test).length : this.rows().length;
  }

  rawValue(row: AnyRow, column: ColumnDef): unknown {
    return column.value ? column.value(row) : row[column.key];
  }

  cell(row: AnyRow, column: ColumnDef): string {
    return displayValue(this.rawValue(row, column));
  }

  min(a: number, b: number): number {
    return Math.min(a, b);
  }

  async exportCsv(): Promise<void> {
    if (this.exporting()) return;
    const columns = this.visibleColumns();
    const loader = this.loadPage();
    if (!loader) {
      const rows = this.filtered();
      const data = rows.map((row) => columns.map((column) => this.rawValue(row, column) ?? ''));
      downloadCsv(`${this.exportName()}-${new Date().toISOString().slice(0, 10)}.csv`, columns.map((c) => c.label), data);
      return;
    }
    this.exporting.set(true);
    try {
      const { rows, truncated } = await collectAllRows((page, pageSize) => loader(this.remoteQuery(page, pageSize)));
      downloadCsv(
        `${this.exportName()}-${new Date().toISOString().slice(0, 10)}.csv`,
        columns.map((column) => column.label),
        rows.map((row) => columns.map((column) => this.rawValue(row as AnyRow, column) ?? '')),
      );
      if (truncated) {
        this.toast.show(`ส่งออก ${EXPORT_ROW_LIMIT.toLocaleString('th-TH')} รายการแรกแล้ว — ปรับตัวกรองให้แคบลงเพื่อให้ครบ`);
      } else {
        this.toast.show(`ส่งออก ${rows.length.toLocaleString('th-TH')} รายการแล้ว`);
      }
    } catch (error) {
      this.toast.error(apiErrorMessage(error));
    } finally {
      this.exporting.set(false);
    }
  }

  /** Copies the current filter/sort result as TSV — handy for LINE or a spreadsheet. */
  async copyList(): Promise<void> {
    const rows = this.filtered();
    if (!rows.length) return;
    const columns = this.visibleColumns();
    const text = toTsv(
      columns.map((column) => column.label),
      rows.map((row) => columns.map((column) => this.rawValue(row, column))),
    );
    const ok = await copyText(text);
    this.copyState.set(ok ? 'done' : 'fail');
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.copyState.set('idle'), 2200);
  }
}

export type RecordRowInput = Record<string, unknown> & { id: string };
