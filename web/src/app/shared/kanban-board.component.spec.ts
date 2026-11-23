import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { PageLoader } from './data-table.component';
import { KanbanBoardComponent } from './kanban-board.component';

describe('KanbanBoardComponent', () => {
  it('keeps the card in the original lane when the workflow rejects a keyboard move', () => {
    const fixture = TestBed.createComponent(KanbanBoardComponent);
    const load: PageLoader = (query) => {
      const rows = query.where.includes('"draft"') ? [{ id: 'po1', code: 'PO-1', status: 'draft' }] : [];
      return of({ items: rows, total: rows.length, page: 1, pageSize: 20 });
    };
    const move = vi.fn(() => throwError(() => new Error('ระบุผู้อนุมัติก่อนย้าย')));
    fixture.componentRef.setInput('loadPage', load);
    fixture.componentRef.setInput('statuses', [
      { key: 'draft', label: 'ร่าง', enabled: true, color: 'gray', next: ['review'], requiredFields: [] },
      { key: 'review', label: 'รออนุมัติ', enabled: true, color: 'blue', next: [], requiredFields: [] },
    ]);
    fixture.componentRef.setInput('rowHref', () => '/purchase-orders/po1');
    fixture.componentRef.setInput('moveRecord', move);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const picker = host.querySelector('select')!;
    picker.value = 'review';
    picker.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(move).toHaveBeenCalledWith(expect.objectContaining({ id: 'po1' }), 'review');
    expect(host.querySelector('[data-lane="draft"]')?.textContent).toContain('PO-1');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('ระบุผู้อนุมัติก่อนย้าย');
  });
});
