export const TOKEN_KEY = 'sjp-erp-token';
export const THEME_KEY = 'sjp-theme';
export const SIDEBAR_KEY = 'sjp-sidebar-collapsed';
export const NAV_FAVORITES_KEY = 'sjp-nav-favorites';
export const NAV_RECENT_KEY = 'sjp-nav-recent';
export const NAV_CLOSED_GROUPS_KEY = 'sjp-nav-closed-groups';
const ACTIVE_WORKSPACE_KEY = 'sjp-active-workspace';

export const readActiveWorkspace = (): string => readLocal(ACTIVE_WORKSPACE_KEY) ?? '';
export const writeActiveWorkspace = (id: string): void => {
  if (id) writeLocal(ACTIVE_WORKSPACE_KEY, id);
  else removeLocal(ACTIVE_WORKSPACE_KEY);
};

/** Private-mode browsers can throw on storage; preferences fall back to defaults instead of breaking the app. */
let storageBlocked = false;

export const storageBlockedByBrowser = (): boolean => storageBlocked;

const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    storageBlocked = true;
    void error;
    return null;
  }
};

const writeLocal = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    storageBlocked = true;
    void error;
  }
};

const removeLocal = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    storageBlocked = true;
    void error;
  }
};

const readSession = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch (error) {
    storageBlocked = true;
    void error;
    return null;
  }
};

const writeSession = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
  } catch (error) {
    storageBlocked = true;
    void error;
  }
};

export const readToken = (): string => readLocal(TOKEN_KEY) ?? '';

export const writeToken = (token: string): void => {
  if (token) writeLocal(TOKEN_KEY, token);
  else removeLocal(TOKEN_KEY);
};

/** Read a non-HttpOnly cookie (used for the double-submit CSRF token). */
export const readCookie = (name: string): string => {
  try {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const value = part.trim();
      if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
    }
    return '';
  } catch {
    return '';
  }
};

/** `system` follows the OS preference; the other two are explicit choices. */
export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const readThemePref = (): ThemePref => {
  const stored = readLocal(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
};

export const writeThemePref = (pref: ThemePref): void => {
  if (pref === 'system') removeLocal(THEME_KEY);
  else writeLocal(THEME_KEY, pref);
};

export const systemPrefersDark = (): boolean => {
  try {
    return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
};

export const resolveTheme = (pref: ThemePref = readThemePref()): ResolvedTheme =>
  pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;

/** Resolved theme for code that only needs the theme currently painted. */
export const readTheme = (): ResolvedTheme => resolveTheme();

/** Kept for explicit light/dark writes; clears the `system` override. */
export const writeTheme = (theme: ResolvedTheme): void => writeThemePref(theme);

export const readSidebarCollapsed = (): boolean => readLocal(SIDEBAR_KEY) === '1';

export const writeSidebarCollapsed = (collapsed: boolean): void => writeLocal(SIDEBAR_KEY, collapsed ? '1' : '0');

/** Returns `null` when the key has never been written, so callers can seed defaults. */
function readStringList(key: string): string[] | null {
  const raw = readLocal(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return null;
  }
}

function writeStringList(key: string, values: string[]): void {
  writeLocal(key, JSON.stringify(values));
}

const navStorageKey = (key: string, userId?: string): string => userId ? `${key}:${userId}` : key;

export const readNavFavorites = (userId?: string): string[] | null => readStringList(navStorageKey(NAV_FAVORITES_KEY, userId));
export const writeNavFavorites = (paths: string[], userId?: string): void => writeStringList(navStorageKey(NAV_FAVORITES_KEY, userId), paths);

export const readNavRecent = (userId?: string): string[] => readStringList(navStorageKey(NAV_RECENT_KEY, userId)) ?? [];
export const writeNavRecent = (paths: string[], userId?: string): void => writeStringList(navStorageKey(NAV_RECENT_KEY, userId), paths);

export const readNavClosedGroups = (userId?: string): string[] | null => readStringList(navStorageKey(NAV_CLOSED_GROUPS_KEY, userId));
export const writeNavClosedGroups = (labels: string[], userId?: string): void => writeStringList(navStorageKey(NAV_CLOSED_GROUPS_KEY, userId), labels);

const EXTRA_COLUMNS_PREFIX = 'sjp-extra-columns:';

/** Columns this browser added to its own view, so new fields never change another user's layout. */
export const readExtraColumns = (table: string): string[] => readStringList(EXTRA_COLUMNS_PREFIX + table) ?? [];
export const writeExtraColumns = (table: string, keys: string[]): void => writeStringList(EXTRA_COLUMNS_PREFIX + table, keys);

const VIEW_RECORD_PREFIX = 'sjp-view-record:';

/** Last record opened inside a saved view, used to restore position by Record ID. */
export const readViewRecord = (viewId: string): string => readLocal(VIEW_RECORD_PREFIX + viewId) ?? '';

export const writeViewRecord = (viewId: string, recordId: string): void => writeLocal(VIEW_RECORD_PREFIX + viewId, recordId);

const COLUMN_ORDER_PREFIX = 'sjp-column-order:';
const COLUMN_WIDTH_PREFIX = 'sjp-column-width:';
const COLUMN_PIN_PREFIX = 'sjp-column-pin:';

/** How many leading columns stay frozen while scrolling sideways (default: the identifier column). */
export const readColumnPin = (table: string): number => {
  const value = Number(readLocal(COLUMN_PIN_PREFIX + table));
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : 1;
};
export const writeColumnPin = (table: string, count: number): void => writeLocal(COLUMN_PIN_PREFIX + table, String(count));

export const readColumnOrder = (table: string): string[] => readStringList(COLUMN_ORDER_PREFIX + table) ?? [];
export const writeColumnOrder = (table: string, keys: string[]): void => writeStringList(COLUMN_ORDER_PREFIX + table, keys);

export const readColumnWidths = (table: string): Record<string, number> => {
  const raw = readLocal(COLUMN_WIDTH_PREFIX + table);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 60 && value <= 800) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
};

export const writeColumnWidths = (table: string, widths: Record<string, number>): void =>
  writeLocal(COLUMN_WIDTH_PREFIX + table, JSON.stringify(widths));

export const DENSITY_KEY = 'sjp-density';

export type Density = 'compact' | 'comfy';

export const readDensity = (): Density => readLocal(DENSITY_KEY) === 'comfy' ? 'comfy' : 'compact';

export const writeDensity = (density: Density): void => writeLocal(DENSITY_KEY, density);

const DETAIL_NAV_PREFIX = 'sjp-detail-nav-';

/**
 * Remembers the visible order of a list (session-scoped) so the record detail
 * page can offer previous/next without another round trip.
 */
export const writeDetailNav = (key: string, ids: string[]): void =>
  writeSession(DETAIL_NAV_PREFIX + key, JSON.stringify({ ids, at: Date.now() }));

export const readDetailNav = (key: string, maxAgeMs = 30 * 60_000): string[] | null => {
  const raw = readSession(DETAIL_NAV_PREFIX + key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as { ids?: unknown; at?: unknown };
    if (!Array.isArray(value.ids) || typeof value.at !== 'number') return null;
    if (Date.now() - value.at > maxAgeMs) return null;
    const ids = value.ids.filter((id): id is string => typeof id === 'string');
    return ids.length ? ids : null;
  } catch {
    return null;
  }
};

const COLUMN_PREFIX = 'sjp-cols-';

export const readColumnPrefs = (table: string): string[] => {
  const raw = readLocal(COLUMN_PREFIX + table);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

export const writeColumnPrefs = (table: string, keys: string[]): void =>
  writeLocal(COLUMN_PREFIX + table, JSON.stringify(keys));

const VIEWS_PREFIX = 'sjp-views-';

export const readTableViews = (table: string): unknown[] => {
  const raw = readLocal(VIEWS_PREFIX + table);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const writeTableViews = (table: string, views: unknown[]): void =>
  writeLocal(VIEWS_PREFIX + table, JSON.stringify(views));
