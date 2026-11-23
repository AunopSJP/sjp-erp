import { and, inArray, or, sql, type SQL } from 'drizzle-orm';
import { bad } from '../common/exceptions.js';

export interface ListQuery {
  search?: string;
  page?: number | string;
  pageSize?: number | string;
  sort?: string;
  filters?: Record<string, string>;
  where?: string;
  totals?: string;
  groupBy?: string;
}

function json(input: string): unknown {
  if (input.length > 20_000) bad('เงื่อนไขมีขนาดใหญ่เกินไป');
  try {
    return JSON.parse(input);
  } catch {
    return bad('รูปแบบตัวกรองไม่ถูกต้อง');
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseListQuery(query: Record<string, string>): ListQuery {
  const rawFilters = query['filters'];
  const filters: Record<string, string> = {};
  if (rawFilters) {
    if (typeof rawFilters !== 'string') bad('รูปแบบตัวกรองไม่ถูกต้อง');
    const parsed = json(rawFilters);
    if (!object(parsed)) bad('รูปแบบตัวกรองไม่ถูกต้อง');
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') bad('ค่าตัวกรองไม่ถูกต้อง');
      Object.defineProperty(filters, key, { value, enumerable: true });
    }
  }
  for (const key of ['search', 'sort', 'where', 'page', 'pageSize', 'totals', 'groupBy']) {
    if (query[key] !== undefined && typeof query[key] !== 'string') bad('พารามิเตอร์รายการไม่ถูกต้อง');
  }
  return {
    search: query['search'], page: query['page'], pageSize: query['pageSize'],
    sort: query['sort'], filters, where: query['where'],
    totals: query['totals'], groupBy: query['groupBy'],
  };
}

type Scalar = string | number | boolean;

function scalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
}

function sqliteValue(value: Scalar): string | number {
  return typeof value === 'boolean' ? Number(value) : value;
}

export function compileWhere(
  input: string,
  field: (key: string) => SQL,
  isArray: (key: string) => boolean = () => false,
): SQL {
  let nodes = 0;
  const compile = (node: unknown, depth: number): SQL => {
    if (!object(node) || depth > 4 || ++nodes > 64) bad('เงื่อนไขตัวกรองไม่ถูกต้องหรือซับซ้อนเกินไป');
    if ('join' in node) {
      if ((node['join'] !== 'and' && node['join'] !== 'or') || !Array.isArray(node['clauses']) || !node['clauses'].length) {
        bad('แต่ละกลุ่มต้องมีเงื่อนไข');
      }
      const children = node['clauses'].map((child) => compile(child, depth + 1));
      return (node['join'] === 'and' ? and(...children) : or(...children)) ?? sql`0 = 1`;
    }
    if (typeof node['field'] !== 'string') bad('ต้องระบุฟิลด์สำหรับกรอง');
    const key = node['field'];
    const column = field(key);
    const multiple = isArray(key);
    const op = node['op'];
    const value = node['value'];
    const matches = (compare: string | number): SQL =>
      multiple
        ? sql`EXISTS (SELECT 1 FROM json_each(${jsonColumn(key)}) WHERE value = ${compare})`
        : sql`${column} = ${compare}`;
    switch (op) {
      case 'empty':
        return multiple
          ? sql`COALESCE(json_array_length(${jsonColumn(key)}), 0) = 0`
          : sql`(${column} IS NULL OR ${column} = '')`;
      case 'notEmpty':
        return multiple
          ? sql`COALESCE(json_array_length(${jsonColumn(key)}), 0) > 0`
          : sql`(${column} IS NOT NULL AND ${column} <> '')`;
      case 'in': {
        if (!Array.isArray(value) || !value.length || value.length > 50 || !value.every(scalar)) bad('รายการค่าตัวกรองไม่ถูกต้อง');
        const values = value.map(sqliteValue);
        if (multiple) {
          return sql`EXISTS (SELECT 1 FROM json_each(${jsonColumn(key)}) WHERE value IN (${sql.join(values.map((item) => sql`${item}`), sql`, `)}))`;
        }
        return inArray(column, values);
      }
      case 'contains': {
        if (typeof value !== 'string' || !value.length) bad('ต้องระบุข้อความที่ต้องการค้นหา');
        return sql`instr(lower(CAST(${column} AS TEXT)), lower(${value})) > 0`;
      }
      default: {
        if (!scalar(value)) bad('ค่าตัวกรองไม่ถูกต้อง');
        const compare = sqliteValue(value);
        switch (op) {
          case 'eq': return matches(compare);
          case 'neq':
            return multiple
              ? sql`NOT EXISTS (SELECT 1 FROM json_each(${jsonColumn(key)}) WHERE value = ${compare})`
              : sql`${column} <> ${compare}`;
          case 'gt': return sql`${column} > ${compare}`;
          case 'gte': return sql`${column} >= ${compare}`;
          case 'lt': return sql`${column} < ${compare}`;
          case 'lte': return sql`${column} <= ${compare}`;
          default: return bad('ตัวดำเนินการกรองไม่ถูกต้อง');
        }
      }
    }
  };
  return compile(json(input), 0);
}

/** JSON path for an array-valued (multi-link) field on the records table. */
function jsonColumn(key: string): SQL {
  return sql`records.data, ${'$.' + key}`;
}
