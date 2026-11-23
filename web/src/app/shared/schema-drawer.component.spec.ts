import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../core/api.service';
import { MetaService } from '../core/meta.service';
import { SchemaDrawerComponent } from './schema-drawer.component';
import type { EntityDef } from '../core/models';

const order: EntityDef = {
  key: 'orderDoc', label: 'ใบสั่งซื้อ', resource: 'purchase', prefix: 'PO', title: 'name',
  cols: ['code'], filters: [], fields: [{ key: 'name', label: 'ชื่อ', type: 'text' }], can: { view: true },
};
const supplier: EntityDef = {
  key: 'supplierDir', label: 'ผู้ขาย', resource: 'purchase', prefix: 'SUP', title: 'name',
  cols: ['code'], filters: [], fields: [{ key: 'name', label: 'ชื่อ', type: 'text' }], can: { view: true },
};

function setup(post: ReturnType<typeof vi.fn>) {
  TestBed.configureTestingModule({
    imports: [SchemaDrawerComponent],
    providers: [
      { provide: ApiService, useValue: { post, get: vi.fn(() => of({ affected: 0, total: 0, views: [], workflows: [] })) } },
      { provide: MetaService, useValue: { meta: () => ({ entities: { orderDoc: order, supplierDir: supplier } }), entity: (key: string) => key === 'supplierDir' ? supplier : order, load: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(SchemaDrawerComponent);
  fixture.componentRef.setInput('entity', order);
  fixture.detectChanges();
  return fixture;
}

describe('SchemaDrawerComponent', () => {
  it('sends the back-link and the in-view choice when a relation field is created', () => {
    const created = vi.fn(() => of({ entity: order, field: { key: 'supplier', label: 'ผู้ขาย', type: 'ref' } }));
    const fixture = setup(created);
    const component = fixture.componentInstance;
    component.setLabel('ผู้ขาย');
    expect(component.key()).toBe('');
    component.setKey('supplier');
    component.setType('ref');
    component.setRefTarget('supplierDir');
    component.setBacklink({ target: { checked: true } } as unknown as Event);
    expect(component.key()).toBe('supplier');
    component.create();
    expect(created).toHaveBeenCalledWith('/meta/entity/orderDoc/fields', expect.objectContaining({
      field: expect.objectContaining({ key: 'supplier', type: 'ref', ref: 'supplierDir' }),
      backlink: { entity: 'supplierDir', key: 'orderDocRef', label: 'ใบสั่งซื้อ (อ้างอิง)' },
    }));
  });

  it('blocks a select field without options before calling the API', () => {
    const post = vi.fn(() => of({}));
    const fixture = setup(post);
    const component = fixture.componentInstance;
    component.setLabel('สถานะตรวจ');
    component.setType('select');
    component.create();
    expect(post).not.toHaveBeenCalled();
    expect(component.fieldErrors()['options']).toContain('ตัวเลือก');
  });

  it('sends stable option ids with labels and colours', () => {
    const post = vi.fn(() => of({ entity: order, field: { key: 'checkStatus', label: 'สถานะตรวจ', type: 'select' } }));
    const fixture = setup(post);
    const component = fixture.componentInstance;
    component.setLabel('สถานะตรวจ');
    component.setKey('checkStatus');
    component.setType('select');
    component.addOption();
    component.setOption(0, 'id', 'pending');
    component.setOption(0, 'label', 'รอตรวจ');
    component.setOption(0, 'color', 'amber');
    component.addOption();
    component.setOption(1, 'id', 'done');
    component.setOption(1, 'label', 'ผ่าน');
    component.setOption(1, 'color', 'green');
    component.setOption(1, 'archived', true);
    component.create();
    expect(post).toHaveBeenCalledWith('/meta/entity/orderDoc/fields', expect.objectContaining({
      field: expect.objectContaining({
        options: ['pending', 'done'],
        optionMeta: [
          { id: 'pending', label: 'รอตรวจ', color: 'amber', archived: undefined },
          { id: 'done', label: 'ผ่าน', color: 'green', archived: true },
        ],
      }),
    }));
  });

  it('creates a multi-link relation with the target display field', () => {
    const post = vi.fn(() => of({ entity: order, field: { key: 'suppliers', label: 'ผู้ขาย', type: 'ref' } }));
    const fixture = setup(post);
    const component = fixture.componentInstance;
    component.setLabel('ผู้ขาย');
    component.setKey('suppliers');
    component.setType('ref');
    component.setRefTarget('supplierDir');
    component.setMultiple({ target: { checked: true } } as unknown as Event);
    component.create();
    expect(post).toHaveBeenCalledWith('/meta/entity/orderDoc/fields', expect.objectContaining({
      field: expect.objectContaining({ multiple: true, ref: 'supplierDir', displayField: 'name' }),
    }));
  });

  it('keeps the draft and points at the name field when the server reports a duplicate label', () => {
    const post = vi.fn(() => throwError(() => new HttpErrorResponse({
      status: 400, error: { message: 'ชื่อฟิลด์ "ผู้ขาย" มีอยู่แล้วในโมดูลนี้' },
    })));
    const fixture = setup(post);
    const component = fixture.componentInstance;
    component.setLabel('ผู้ขาย');
    component.setKey('seller');
    component.create();
    expect(component.label()).toBe('ผู้ขาย');
    expect(component.fieldErrors()['label']).toContain('มีอยู่แล้ว');
    expect(component.busy()).toBe(false);
  });
});
