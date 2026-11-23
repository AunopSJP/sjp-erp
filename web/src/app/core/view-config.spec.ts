import { describe, expect, it } from 'vitest';
import { sanitizeViewConfig, whereFieldKeys } from './view-config';

const allowed = new Set(['status', 'customer', 'amount', 'code']);

describe('sanitizeViewConfig', () => {
  it('keeps a compatible view unchanged', () => {
    const config = {
      q: 'acme',
      fv: { status: 'open' },
      sort: { key: 'amount' as const, dir: -1 as const },
      hiddenColumns: ['customer'],
      groupBy: ['status'],
      where: JSON.stringify({ field: 'amount', op: 'gt', value: 10 }),
      pageSize: 50,
    };
    const result = sanitizeViewConfig(config, allowed);
    expect(result.dropped).toEqual([]);
    expect(result.config).toEqual(config);
  });

  it('drops filters, sort, hidden columns and groups that reference missing fields', () => {
    const result = sanitizeViewConfig({
      fv: { status: 'open', removed: 'x' },
      sort: { key: 'removed', dir: 1 },
      hiddenColumns: ['customer', 'removed'],
      groupBy: ['removed'],
    }, allowed);
    expect(result.config.fv).toEqual({ status: 'open' });
    expect(result.config.sort).toEqual({ key: '', dir: 1 });
    expect(result.config.hiddenColumns).toEqual(['customer']);
    expect(result.config.groupBy).toEqual([]);
    expect(new Set(result.dropped)).toEqual(new Set(['removed']));
  });

  it('prunes only the unusable branches of an AND/OR filter tree', () => {
    const where = {
      join: 'and',
      clauses: [
        { field: 'status', op: 'eq', value: 'open' },
        { join: 'or', clauses: [
          { field: 'removed', op: 'eq', value: 1 },
          { field: 'amount', op: 'gt', value: 100 },
        ] },
      ],
    };
    const result = sanitizeViewConfig({ where: JSON.stringify(where) }, allowed);
    expect(result.dropped).toContain('removed');
    expect(JSON.parse(String(result.config.where))).toEqual({
      join: 'and',
      clauses: [
        { field: 'status', op: 'eq', value: 'open' },
        { join: 'or', clauses: [{ field: 'amount', op: 'gt', value: 100 }] },
      ],
    });
  });

  it('clears malformed filter JSON instead of failing to apply the view', () => {
    const result = sanitizeViewConfig({ where: '{not json' }, allowed);
    expect(result.config.where).toBe('');
    expect(result.dropped).toEqual(['where']);
  });

  it('lists field keys from a nested filter tree', () => {
    expect(whereFieldKeys({ join: 'or', clauses: [{ field: 'a' }, { clauses: [{ field: 'b' }] }] })).toEqual(['a', 'b']);
    expect(whereFieldKeys(null)).toEqual([]);
  });
});
