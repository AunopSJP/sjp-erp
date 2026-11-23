import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { MetaService } from './meta.service';

describe('MetaService options', () => {
  let service: MetaService;
  const get = vi.fn((path: string, params?: Record<string, string | number | undefined>) =>
    of(params ? [{ value: 's1', label: 'Site One' }] : [{ value: 's1', label: 'Site One' }, { value: 's2', label: 'Site Two' }]));

  beforeEach(() => {
    get.mockClear();
    TestBed.configureTestingModule({
      providers: [MetaService, { provide: ApiService, useValue: { get } }],
    });
    service = TestBed.inject(MetaService);
  });

  it('passes the business filter to the options endpoint', () => {
    let result: { value: string; label: string }[] = [];
    service.options('sites', { field: 'customer', value: 'c1' }).subscribe((options) => (result = options));
    expect(get).toHaveBeenCalledWith('/meta/options/sites', { filterField: 'customer', filterValue: 'c1' });
    expect(result.map((option) => option.value)).toEqual(['s1']);
  });

  it('caches unfiltered and filtered requests separately', () => {
    service.options('sites').subscribe();
    service.options('sites', { field: 'customer', value: 'c1' }).subscribe();
    service.options('sites', { field: 'customer', value: 'c1' }).subscribe();
    service.options('sites').subscribe();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
