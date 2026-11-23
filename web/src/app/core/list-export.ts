import { firstValueFrom, type Observable } from 'rxjs';

export interface ExportPage {
  items: Record<string, unknown>[];
}

export const EXPORT_PAGE_SIZE = 500;
export const EXPORT_ROW_LIMIT = 10_000;

/**
 * Pulls every page of a server-side list so CSV/copy actions cover the whole
 * filtered result, not only the page on screen. The cap keeps one export from
 * allocating an unbounded array; the caller tells the user when it was hit.
 */
export async function collectAllRows(
  load: (page: number, pageSize: number) => Observable<ExportPage>,
  options: { pageSize?: number; limit?: number } = {},
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? EXPORT_PAGE_SIZE, 1), 1000);
  const limit = Math.max(options.limit ?? EXPORT_ROW_LIMIT, 1);
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; ; page++) {
    const result = await firstValueFrom(load(page, pageSize));
    const items = Array.isArray(result?.items) ? result.items : [];
    rows.push(...items);
    if (items.length < pageSize) return { rows: rows.slice(0, limit), truncated: rows.length > limit };
    if (rows.length >= limit) return { rows: rows.slice(0, limit), truncated: true };
  }
}
