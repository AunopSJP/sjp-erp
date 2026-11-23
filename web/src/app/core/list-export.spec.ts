import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { collectAllRows } from './list-export';

describe('collectAllRows', () => {
  it('walks every page until a short page arrives', async () => {
    const load = vi.fn((page: number) =>
      of({ items: page < 3 ? Array.from({ length: 2 }, (_, index) => ({ id: `${page}-${index}` })) : [{ id: '3-0' }] }));
    const result = await collectAllRows(load, { pageSize: 2 });
    expect(load).toHaveBeenCalledTimes(3);
    expect(result.rows.map((row) => row['id'])).toEqual(['1-0', '1-1', '2-0', '2-1', '3-0']);
    expect(result.truncated).toBe(false);
  });

  it('stops at the row limit and reports truncation', async () => {
    const load = vi.fn((page: number) =>
      of({ items: Array.from({ length: 2 }, (_, index) => ({ id: `${page}-${index}` })) }));
    const result = await collectAllRows(load, { pageSize: 2, limit: 4 });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });

  it('handles an empty first page and clamps odd page sizes', async () => {
    const load = vi.fn(() => of({ items: [] }));
    const result = await collectAllRows(load, { pageSize: 0 });
    expect(result).toEqual({ rows: [], truncated: false });
    expect(load).toHaveBeenCalledWith(1, 1);
  });
});
