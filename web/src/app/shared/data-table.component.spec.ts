import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTableComponent } from './data-table.component';
import { readDetailNav, readColumnOrder, readColumnWidths, writeViewRecord } from '../core/storage';
import { SavedViewsService } from '../core/saved-views.service';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';

const writeText = vi.fn(() => Promise.resolve());

describe('DataTableComponent copy list', () => {
  beforeEach(async () => {
    writeText.mockClear();
    sessionStorage.clear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await TestBed.configureTestingModule({ imports: [DataTableComponent] }).compileComponents();
  });

  it('keeps the typed draft and shows the newest value when another user saved first', () => {
    const patch = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'conflict' } })));
    const get = vi.fn(() => of({ id: 'row1', code: 'C-1', name: 'ค่าล่าสุดจากคนอื่น', _updatedAt: 'v2' }));
    TestBed.overrideProvider(ApiService, { useValue: { patch, get } });
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [
      { key: 'code', label: 'รหัส' },
      { key: 'name', label: 'ชื่อ', editor: { type: 'text' } },
    ]);
    fixture.componentRef.setInput('editEntity', 'customers');
    fixture.componentRef.setInput('rows', [{ id: 'row1', code: 'C-1', name: 'ค่าเดิม', _updatedAt: 'v1' }]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const cell = host.querySelectorAll('tbody td')[1]!;
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();
    const editor = host.querySelector<HTMLInputElement>('#grid-cell-input')!;
    editor.value = 'ค่าที่ฉันกรอก';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(patch).toHaveBeenCalledWith('/records/customers/row1', { name: 'ค่าที่ฉันกรอก', _expectedUpdatedAt: 'v1' });
    expect(host.textContent).toContain('ค่าล่าสุด: ค่าล่าสุดจากคนอื่น');
    expect(host.textContent).toContain('ค่าที่ฉันกรอก');
    expect(host.querySelector<HTMLInputElement>('#grid-cell-input')?.value).toBe('ค่าที่ฉันกรอก');
  });

  it('marks a view as unsaved after the filters change and clears it when applied again', () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [{ key: 'code', label: 'รหัส' }]);
    fixture.componentRef.setInput('rows', [{ id: '1', code: 'A' }]);
    fixture.componentRef.setInput('exportName', 'views-unsaved');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const view = {
      id: 'v1', name: 'มุมมองทดสอบ', visibility: 'private' as const, ownerId: 'u1', ownerName: 'Me', mine: true,
      config: { q: 'A', fv: {}, tab: '', sort: { key: '', dir: 1 as const }, hiddenColumns: [], pageSize: 25 },
    };
    component.applyView(view);
    expect(component.unsavedView()).toBe(false);
    component.q.set('เปลี่ยนแล้ว');
    expect(component.unsavedView()).toBe(true);
    component.applyView(view);
    expect(component.unsavedView()).toBe(false);
  });

  it('saves a team view with the current layout only when the user may share', () => {
    const create = vi.fn(() => of({
      id: 'v9', entity: 'customers', name: 'ทีมขาย', visibility: 'team' as const,
      ownerId: 'u1', ownerName: 'Me', config: {}, mine: true, createdAt: '', updatedAt: '',
    }));
    TestBed.overrideProvider(SavedViewsService, { useValue: { load: () => of({ items: [] }), create, update: vi.fn(), remove: vi.fn() } });
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [{ key: 'code', label: 'รหัส' }]);
    fixture.componentRef.setInput('viewsEntity', 'customers');
    fixture.componentRef.setInput('canShareViews', true);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.q.set('ขาย');
    component.viewName.set('ทีมขาย');
    component.shareView.set(true);
    component.saveView();
    expect(create).toHaveBeenCalledWith('customers', 'ทีมขาย', 'team', expect.objectContaining({ q: 'ขาย', pageSize: 25 }));
    expect(component.appliedViewId()).toBe('v9');

    create.mockClear();
    fixture.componentRef.setInput('canShareViews', false);
    component.viewName.set('ส่วนตัว');
    component.saveView();
    expect(create).toHaveBeenCalledWith('customers', 'ส่วนตัว', 'private', expect.any(Object));
  });

  it('restores the last opened record of a view, or says why it cannot', async () => {
    const rows = [{ id: 'r2', code: 'C-2' }];
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [{ key: 'code', label: 'รหัส' }]);
    fixture.componentRef.setInput('loadPage', () => of({ items: rows, total: 1, page: 1, pageSize: 25 }));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    writeViewRecord('v2', 'r2');
    component.applyView({
      id: 'v2', name: 'มุมมอง', visibility: 'private', ownerId: 'u1', ownerName: 'Me', mine: true,
      config: { q: '', fv: {}, tab: '', sort: { key: '', dir: 1 }, hiddenColumns: [], pageSize: 25 },
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    fixture.detectChanges();
    expect(host.querySelector('tr[data-row-id="r2"]')).toBe(document.activeElement);
    expect(component.restoreNotice()).toContain('กลับไปที่รายการที่เปิดล่าสุด');

    writeViewRecord('v2', 'missing');
    component.applyView({
      id: 'v2b', name: 'มุมมอง 2', visibility: 'private', ownerId: 'u1', ownerName: 'Me', mine: true,
      config: { q: '', fv: {}, tab: '', sort: { key: '', dir: 1 }, hiddenColumns: [], pageSize: 25 },
    });
    writeViewRecord('v2b', 'missing');
    component.applyView({
      id: 'v2b', name: 'มุมมอง 2', visibility: 'private', ownerId: 'u1', ownerName: 'Me', mine: true,
      config: { q: '', fv: {}, tab: '', sort: { key: '', dir: 1 }, hiddenColumns: [], pageSize: 25 },
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    fixture.detectChanges();
    expect(component.restoreNotice()).toContain('ไม่อยู่ในผลลัพธ์');
    expect(document.activeElement?.textContent).toContain('มุมมอง');
  });

  it('builds an AND/OR condition and sends it with totals and grouping', async () => {
    const calls: { where: string; totals: string; groupBy: string }[] = [];
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [
      { key: 'code', label: 'รหัส' },
      { key: 'name', label: 'ชื่อ' },
      { key: 'qty', label: 'จำนวน', numeric: true },
    ]);
    fixture.componentRef.setInput('loadPage', (query: { where: string; totals: string; groupBy: string }) => {
      calls.push({ where: query.where, totals: query.totals, groupBy: query.groupBy });
      return of({ items: [{ id: 'r1', code: 'C-1', name: 'A', qty: 10 }], total: 1, page: 1, pageSize: 25 });
    });
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.addCondition('root');
    component.setCondition('root', 0, 'field', 'qty');
    component.setCondition('root', 0, 'op', 'gt');
    component.setCondition('root', 0, 'value', '10');
    component.addCondition('sub');
    component.setCondition('sub', 0, 'field', 'name');
    component.setCondition('sub', 0, 'op', 'contains');
    component.setCondition('sub', 0, 'value', 'Alpha');
    component.applyAdvanced();
    await fixture.whenStable();
    expect(JSON.parse(component.appliedWhere())).toEqual({
      join: 'and',
      clauses: [
        { field: 'qty', op: 'gt', value: 10 },
        { join: 'or', clauses: [{ field: 'name', op: 'contains', value: 'Alpha' }] },
      ],
    });
    expect(component.advancedSummary()).toContain('จำนวน มากกว่า “10”');
    expect(component.advancedSummary()).toContain('(ชื่อ มีคำว่า “Alpha”)');
    const last = calls[calls.length - 1];
    expect(last.totals).toBe('qty');
    expect(last.where).toContain('"op":"gt"');
  });

  it('shows totals and group counts for the whole filtered set, not the current page', async () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [
      { key: 'code', label: 'รหัส' },
      { key: 'qty', label: 'จำนวน', numeric: true },
      { key: 'flag', label: 'สถานะ', editor: { type: 'boolean' } },
    ]);
    fixture.componentRef.setInput('loadPage', () => of({
      items: [{ id: 'r1', code: 'M1', qty: 10, flag: true }],
      total: 3,
      page: 1,
      pageSize: 25,
      totals: { qty: 60 },
      groups: [
        { keys: [true], count: 2, totals: { qty: 40 } },
        { keys: [false], count: 1, totals: { qty: 20 } },
      ],
    } as never));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.setGroup(0, 'flag');
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const text = host.textContent ?? '';
    expect(text).toContain('รวมทั้งชุดที่กรองแล้ว');
    expect(text).toContain('60');
    expect(host.querySelector('.dt-group-row')).toBeTruthy();
    expect(text).toContain('สถานะ: ใช่');
    expect(text).toContain('40');
  });

  it('expands and collapses inline group rows without losing them', () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [
      { key: 'code', label: 'รหัส' },
      { key: 'flag', label: 'สถานะ', editor: { type: 'boolean' } },
    ]);
    fixture.componentRef.setInput('rows', [
      { id: 'a', code: 'A-1', flag: true },
      { id: 'b', code: 'B-1', flag: false },
      { id: 'c', code: 'C-1', flag: true },
    ]);
    fixture.componentRef.setInput('exportName', 'inline-groups');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.setGroup(0, 'flag');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const headers = [...host.querySelectorAll<HTMLButtonElement>('.dt-group-toggle')];
    expect(headers).toHaveLength(2);
    expect(host.querySelectorAll('tbody tr[data-row-id]')).toHaveLength(3);
    headers[0].click();
    fixture.detectChanges();
    const collapsed = headers[0].getAttribute('aria-expanded');
    const remaining = host.querySelectorAll('tbody tr[data-row-id]').length;
    headers[0].click();
    fixture.detectChanges();
    expect(collapsed).toBe('false');
    expect(remaining).toBeLessThan(3);
    expect(host.querySelectorAll('tbody tr[data-row-id]')).toHaveLength(3);
  });

  it('reorders and resizes columns, persisting both per table', () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [
      { key: 'code', label: 'รหัส' },
      { key: 'name', label: 'ชื่อ' },
      { key: 'qty', label: 'จำนวน', numeric: true },
    ]);
    fixture.componentRef.setInput('rows', [{ id: '1', code: 'C-1', name: 'A', qty: 1 }]);
    fixture.componentRef.setInput('exportName', 'columns-layout');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.moveColumn('qty', -1);
    fixture.detectChanges();
    const headers = [...(fixture.nativeElement as HTMLElement).querySelectorAll('thead th')]
      .map((th) => th.getAttribute('data-field'));
    expect(headers).toEqual(['code', 'qty', 'name']);
    expect(readColumnOrder('columns-layout')).toEqual(['code', 'qty', 'name']);
    component.onResizeKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }), 'name');
    expect(component.widthFor('name')).toBe(136);
    expect(readColumnWidths('columns-layout').name).toBe(136);
    const col = (fixture.nativeElement as HTMLElement).querySelector('colgroup col:nth-child(3)') as HTMLElement;
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('colgroup col')).toHaveLength(3);
    expect(col).toBeTruthy();
    component.resetColumnLayout();
    expect(readColumnOrder('columns-layout')).toEqual([]);
    expect(readColumnWidths('columns-layout')).toEqual({});
  });

  it('keeps a validation error in the cell and Escape restores focus without saving', async () => {
    const patch = vi.fn(() => throwError(() => new HttpErrorResponse({
      status: 400, error: { message: 'invalid', fieldErrors: { name: 'ชื่อต้องยาวอย่างน้อย 3 ตัว' } },
    })));
    TestBed.overrideProvider(ApiService, { useValue: { patch, get: vi.fn() } });
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [
      { key: 'code', label: 'รหัส' },
      { key: 'name', label: 'ชื่อ', editor: { type: 'text' } },
    ]);
    fixture.componentRef.setInput('editEntity', 'customers');
    fixture.componentRef.setInput('rows', [{ id: 'row9', code: 'C-9', name: 'เดิม', _updatedAt: 'v1' }]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const cell = host.querySelectorAll('tbody td')[1]!;
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();
    const editor = host.querySelector<HTMLInputElement>('#grid-cell-input')!;
    editor.value = 'x';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('#grid-cell-error')?.textContent).toContain('ชื่อต้องยาวอย่างน้อย 3 ตัว');
    expect(host.querySelector<HTMLInputElement>('#grid-cell-input')?.value).toBe('x');
    host.querySelector<HTMLInputElement>('#grid-cell-input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(host.querySelector('#grid-cell-input')).toBeNull();
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('data-field')).toBe('name');
  });

  it('asks for another server page and reports the count over the full result', () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [{ key: 'code', label: 'รหัส' }]);
    fixture.componentRef.setInput('loadPage', ({ page }: { page: number }) =>
      of({ page, pageSize: 25, total: 51, items: [{ id: String(page), code: `GR-${page}` }] }),
    );
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('1–1 จาก 51');
    const next = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'ถัดไป');
    next?.click();
    fixture.detectChanges();
    expect(host.textContent).toContain('GR-2');
    expect(host.textContent).not.toContain('GR-1');
  });

  it('commits a cell only on explicit confirmation and sends the row version', () => {
    const patch = vi.fn(() => of({ id: 'row1', name: 'Changed', _updatedAt: 'next' }));
    TestBed.overrideProvider(ApiService, { useValue: { patch } });
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [
      { key: 'code', label: 'รหัส' },
      { key: 'name', label: 'ชื่อ', editor: { type: 'text' } },
    ]);
    fixture.componentRef.setInput('editEntity', 'customers');
    fixture.componentRef.setInput('rows', [{ id: 'row1', code: 'C-1', name: 'Before', _updatedAt: 'previous' }]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const cell = host.querySelectorAll('tbody td')[1]!;
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();
    const editor = host.querySelector<HTMLInputElement>('td input')!;
    editor.value = 'Changed';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new FocusEvent('blur'));
    expect(patch).not.toHaveBeenCalled();
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(patch).toHaveBeenCalledWith('/records/customers/row1', { name: 'Changed', _expectedUpdatedAt: 'previous' });
  });

  it('copies the filtered rows as TSV and confirms in the button', async () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [
      { key: 'code', label: 'รหัส' },
      { key: 'name', label: 'ชื่อ' },
    ]);
    fixture.componentRef.setInput('rows', [
      { id: '1', code: 'T-1', name: 'แจ้งซ่อม' },
      { id: '2', code: 'T-2', name: 'งาน PM' },
    ]);
    fixture.componentRef.setInput('exportName', 'tickets');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const button = [...host.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('คัดลอกรายการ'),
    ) as HTMLButtonElement | undefined;
    expect(button?.textContent).toContain('(2)');

    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith('รหัส\tชื่อ\r\nT-1\tแจ้งซ่อม\r\nT-2\tงาน PM');
    expect(button?.textContent).toContain('คัดลอกแล้ว');
  });

  it('disables copying when the current filters match nothing', () => {    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [{ key: 'code', label: 'รหัส' }]);
    fixture.componentRef.setInput('rows', [{ id: '1', code: 'T-1' }]);
    fixture.componentRef.setInput('exportName', 'tickets');
    fixture.detectChanges();

    fixture.componentInstance.q.set('ไม่มีทางเจอ');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const button = [...host.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('คัดลอกรายการ'),
    ) as HTMLButtonElement | undefined;
    expect(button?.disabled).toBe(true);
  });

  it('remembers the filtered order when a row is opened', async () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('columns', [
      { key: 'code', label: 'รหัส' },
      { key: 'name', label: 'ชื่อ' },
    ]);
    fixture.componentRef.setInput('rows', [
      { id: '1', code: 'T-1', name: 'แจ้งซ่อม' },
      { id: '2', code: 'T-2', name: 'งาน PM' },
    ]);
    fixture.componentRef.setInput('exportName', 'tickets');
    fixture.detectChanges();

    const row = (fixture.nativeElement as HTMLElement).querySelector('tbody tr') as HTMLElement;
    row.click();

    expect(readDetailNav('tickets')).toEqual(['1', '2']);
  });
});
