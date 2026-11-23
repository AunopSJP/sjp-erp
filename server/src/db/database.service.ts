import { InjectDrizzle } from '@nestjs/drizzle';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { chmodSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { roles } from './schema.js';

export type Db = BetterSQLite3Database & { $client: Database };

export const ACTIONS = [
  'view',
  'create',
  'edit',
  'assign',
  'approve',
  'export',
  'close',
  'delete',
] as const;

export const RESOURCES = [
  'master',
  'assets',
  'projects',
  'tickets',
  'purchase',
  'warehouse',
  'accounting',
  'pm',
  'reports',
  'settings',
  'users',
  'roles',
  'vehicles',
  'vehicleBookings',
] as const;

const V = ['view'];
const VC = ['view', 'create'];
const VCE = ['view', 'create', 'edit'];
const VCEA = ['view', 'create', 'edit', 'assign'];

function perms(map: Record<string, string[]>): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const resource of RESOURCES) {
    out[resource] = {};
    for (const action of map[resource] ?? []) out[resource][action] = true;
  }
  return out;
}

export const DEFAULT_ROLES = [
  {
    id: 'admin',
    name: 'ผู้ดูแลระบบ',
    isAdmin: true,
    scope: 'all',
    perms: perms(Object.fromEntries(RESOURCES.map((r) => [r, [...ACTIONS]]))),
  },
  {
    id: 'pm',
    name: 'ผู้จัดการโครงการ',
    isAdmin: false,
    scope: 'all',
    perms: perms({
      master: VCE,
      assets: VCE,
      projects: [...VCEA, 'close'],
      tickets: VCEA,
      purchase: VCE,
      warehouse: VCE,
      accounting: VCE,
      pm: VCEA,
      reports: ['view', 'export'],
      vehicles: V,
      vehicleBookings: [...VCE, 'approve'],
    }),
  },
  {
    id: 'helpdesk',
    name: 'ศูนย์รับแจ้ง',
    isAdmin: false,
    scope: 'all',
    perms: perms({
      master: V,
      assets: V,
      projects: V,
      tickets: [...VCEA, 'close'],
      warehouse: V,
      pm: V,
      reports: ['view'],
      vehicles: V,
      vehicleBookings: VCE,
    }),
  },
  {
    id: 'tech',
    name: 'ช่างบริการ/เทคนิค',
    isAdmin: false,
    scope: 'team',
    perms: perms({
      master: V,
      assets: ['view', 'edit'],
      projects: V,
      tickets: ['view', 'edit'],
      warehouse: VC,
      pm: VCE,
      reports: V,
      vehicles: V,
      vehicleBookings: VCE,
    }),
  },
  {
    id: 'store',
    name: 'พัสดุ/คลัง',
    isAdmin: false,
    scope: 'all',
    perms: perms({
      master: V,
      assets: VCE,
      projects: V,
      tickets: V,
      purchase: V,
      warehouse: [...VCE, 'close'],
      reports: ['view', 'export'],
      vehicles: VCE,
      vehicleBookings: VCE,
    }),
  },
  {
    id: 'buyer',
    name: 'จัดซื้อ',
    isAdmin: false,
    scope: 'all',
    perms: perms({
      master: VCE,
      assets: V,
      projects: V,
      purchase: [...VCE, 'close'],
      warehouse: V,
      reports: ['view', 'export'],
      vehicles: V,
      vehicleBookings: VCE,
    }),
  },
  {
    id: 'exec',
    name: 'ผู้บริหาร (ดู/ส่งออก)',
    isAdmin: false,
    scope: 'all',
    perms: perms({
      master: V,
      assets: V,
      projects: V,
      tickets: V,
      purchase: V,
      warehouse: V,
      accounting: ['view', 'export'],
      pm: V,
      reports: ['view', 'export'],
      vehicles: V,
      vehicleBookings: ['view', 'approve'],
    }),
  },
];

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@InjectDrizzle() readonly db: Db) {}

  onModuleInit(): void {
    const client = this.db.$client;
    client.pragma('journal_mode = WAL');
    client.pragma('foreign_keys = ON');
    try {
      chmodSync(client.name, 0o600);
    } catch (error) {
      this.logger.debug(`chmod database file skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    client.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role_id TEXT NOT NULL,
        dept TEXT NOT NULL DEFAULT '',
        team TEXT NOT NULL DEFAULT '',
        project_ids TEXT NOT NULL DEFAULT '[]',
        site_ids TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        scope TEXT NOT NULL DEFAULT 'all',
        perms TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        code TEXT NOT NULL,
        data TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        deleted_by TEXT,
        deleted_reason TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_by TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_records_entity ON records(entity, deleted);
      CREATE INDEX IF NOT EXISTS idx_records_code ON records(entity, code);
      CREATE TABLE IF NOT EXISTS counters (
        workspace_id TEXT NOT NULL DEFAULT 'default',
        entity TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace_id, entity)
      );
      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        user_id TEXT,
        user_name TEXT NOT NULL,
        action TEXT NOT NULL,
        entity TEXT,
        record_id TEXT,
        record_code TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL,
        changes TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit(entity, record_id, at);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        cfg TEXT NOT NULL,
        decided_by TEXT,
        decided_at TEXT,
        note TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        path TEXT NOT NULL,
        uploaded_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        type TEXT NOT NULL,
        entity TEXT NOT NULL DEFAULT '',
        record_id TEXT,
        code TEXT,
        actor_id TEXT,
        actor_name TEXT,
        summary TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL DEFAULT '',
        events TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        event_id TEXT,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
        ON webhook_deliveries(status, next_attempt_at);
      CREATE TABLE IF NOT EXISTS notify_queue (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_at TEXT NOT NULL,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_notify_queue_due
        ON notify_queue(status, next_at);
      CREATE TABLE IF NOT EXISTS saved_views (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        name TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        owner_id TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_saved_views_entity ON saved_views(entity, visibility, owner_id);
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_workspaces (
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        PRIMARY KEY (user_id, workspace_id)
      );
    `);

    // Workspace isolation (model A): one shared schema, scoped by workspace_id.
    // Existing databases get the column with a `default` backfill.
    const ensureColumn = (table: string, column: string, ddl: string): void => {
      const columns = client.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some((entry) => entry.name === column)) {
        client.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
      }
    };
    for (const table of ['records', 'saved_views', 'audit', 'approvals', 'events', 'files']) {
      ensureColumn(table, 'workspace_id', "workspace_id TEXT NOT NULL DEFAULT 'default'");
    }
    ensureColumn('users', 'active_workspace_id', "active_workspace_id TEXT NOT NULL DEFAULT 'default'");

    // Document counters moved from one global sequence to one per workspace.
    // Existing databases keep their numbers, assigned to the `default` workspace.
    const counterColumns = client.prepare('PRAGMA table_info(counters)').all() as { name: string }[];
    if (!counterColumns.some((entry) => entry.name === 'workspace_id')) {
      client.exec(`
        CREATE TABLE counters_migrated (
          workspace_id TEXT NOT NULL DEFAULT 'default',
          entity TEXT NOT NULL,
          value INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (workspace_id, entity)
        );
        INSERT OR IGNORE INTO counters_migrated (workspace_id, entity, value)
          SELECT 'default', entity, value FROM counters;
        DROP TABLE counters;
        ALTER TABLE counters_migrated RENAME TO counters;
      `);
    }
    const now = new Date().toISOString();
    client
      .prepare('INSERT OR IGNORE INTO workspaces (id, name, archived, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
      .run('default', 'องค์กรหลัก', now, now);
    client.exec('INSERT OR IGNORE INTO user_workspaces (user_id, workspace_id) SELECT id, \'default\' FROM users;');
    client.exec(`
      CREATE INDEX IF NOT EXISTS idx_records_workspace ON records(workspace_id, entity, deleted);
      CREATE INDEX IF NOT EXISTS idx_saved_views_workspace ON saved_views(workspace_id, entity);
      CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit(workspace_id, at);
      CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_id, at);
      CREATE INDEX IF NOT EXISTS idx_approvals_workspace ON approvals(workspace_id, status);
      CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id, created_at);
    `);

    // Defence in depth for the atomic counter: never allow the same document
    // code twice inside one workspace. The index is rebuilt once because older
    // databases enforced uniqueness across every workspace (`entity`, `code`).
    const codeIndex = client
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'records_entity_code_uq'")
      .get() as { sql?: string } | undefined;
    if (codeIndex && !String(codeIndex.sql ?? '').includes('workspace_id')) {
      client.exec('DROP INDEX records_entity_code_uq;');
    }
    const duplicate = client
      .prepare('SELECT 1 FROM records GROUP BY workspace_id, entity, code HAVING COUNT(*) > 1 LIMIT 1')
      .get();
    if (duplicate) {
      this.logger.warn('records มี workspace/entity/code ซ้ำ — ยังไม่สร้าง unique index; ตรวจและล้างข้อมูลก่อน');
    } else {
      client.exec('CREATE UNIQUE INDEX IF NOT EXISTS records_entity_code_uq ON records(workspace_id, entity, code);');
    }

    this.db
      .insert(roles)
      .values(DEFAULT_ROLES)
      .onConflictDoNothing()
      .run();

    // Add newly introduced resources to roles created before the feature existed.
    for (const definition of DEFAULT_ROLES) {
      const row = this.db.select().from(roles).where(eq(roles.id, definition.id)).all()[0];
      if (!row) continue;
      const perms = { ...row.perms };
      let changed = false;
      for (const resource of ['vehicles', 'vehicleBookings'] as const) {
        if (!perms[resource]) {
          perms[resource] = definition.perms[resource] ?? {};
          changed = true;
        }
      }
      // Manager and executive roles may approve car bookings out of the box.
      if (['pm', 'exec'].includes(definition.id) && !perms['vehicleBookings']?.['approve']) {
        perms['vehicleBookings'] = { ...(perms['vehicleBookings'] ?? {}), view: true, approve: true };
        changed = true;
      }
      if (changed) {
        this.db.update(roles).set({ perms }).where(eq(roles.id, definition.id)).run();
      }
    }
  }
}
