import type { SavedViewConfig } from './saved-views.service';

export interface SanitizedView {
  config: SavedViewConfig;
  dropped: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function parseWhere(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Field keys referenced by an AND/OR filter tree. Unknown shapes are ignored. */
export function whereFieldKeys(node: unknown): string[] {
  if (!isRecord(node)) return [];
  const keys: string[] = [];
  if (typeof node['field'] === 'string') keys.push(node['field']);
  const clauses = node['clauses'];
  if (Array.isArray(clauses)) {
    for (const clause of clauses) keys.push(...whereFieldKeys(clause));
  }
  return keys;
}

function pruneWhere(node: unknown, allowed: Set<string>): unknown {
  if (!isRecord(node)) return null;
  const rawClauses = Array.isArray(node['clauses']) ? node['clauses'] : [];
  const clauses = rawClauses.map((clause) => pruneWhere(clause, allowed)).filter((clause) => clause !== null);
  const selfOk = typeof node['field'] !== 'string' || allowed.has(node['field']);
  if (!selfOk && !clauses.length) return null;
  if (!selfOk) return clauses.length === 1 ? clauses[0] : { join: node['join'] === 'or' ? 'or' : 'and', clauses };
  return clauses.length ? { ...node, clauses } : node;
}

/**
 * Drops parts of a saved view that reference fields the current user can no longer use
 * (for example after a permission change), so applying it neither fails nor hides data.
 */
export function sanitizeViewConfig(config: SavedViewConfig, allowed: Set<string>): SanitizedView {
  const dropped = new Set<string>();
  const fv = Object.fromEntries(Object.entries(config.fv ?? {}).filter(([key]) => {
    if (allowed.has(key)) return true;
    dropped.add(key);
    return false;
  }));
  let sort = config.sort;
  if (sort?.key && !allowed.has(sort.key)) {
    dropped.add(sort.key);
    sort = { key: '', dir: 1 };
  }
  const hiddenColumns = (config.hiddenColumns ?? []).filter((key) => {
    if (allowed.has(key)) return true;
    dropped.add(key);
    return false;
  });
  const groupBy = (config.groupBy ?? []).filter((key) => {
    if (allowed.has(key)) return true;
    dropped.add(key);
    return false;
  });
  let where = config.where ?? '';
  if (where) {
    const parsed = parseWhere(where);
    if (parsed === null) {
      dropped.add('where');
      where = '';
    } else {
      const missing = whereFieldKeys(parsed).filter((key) => !allowed.has(key));
      if (missing.length) {
        for (const key of missing) dropped.add(key);
        const pruned = pruneWhere(parsed, allowed);
        where = pruned ? JSON.stringify(pruned) : '';
      }
    }
  }
  return {
    config: { ...config, fv, sort, hiddenColumns, groupBy, where },
    dropped: [...dropped],
  };
}
