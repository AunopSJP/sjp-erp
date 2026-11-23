import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type Perms = Record<string, Record<string, boolean>>;
export type JsonObject = Record<string, unknown>;

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  roleId: text('role_id').notNull(),
  dept: text('dept').notNull().default(''),
  team: text('team').notNull().default(''),
  projectIds: text('project_ids', { mode: 'json' }).$type<string[]>().notNull(),
  siteIds: text('site_ids', { mode: 'json' }).$type<string[]>().notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  activeWorkspaceId: text('active_workspace_id').notNull().default('default'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const userWorkspaces = sqliteTable('user_workspaces', {
  userId: text('user_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
});

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  scope: text('scope').notNull().default('all'),
  perms: text('perms', { mode: 'json' }).$type<Perms>().notNull(),
});

export const records = sqliteTable('records', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  entity: text('entity').notNull(),
  code: text('code').notNull(),
  data: text('data', { mode: 'json' }).$type<JsonObject>().notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  deletedAt: text('deleted_at'),
  deletedBy: text('deleted_by'),
  deletedReason: text('deleted_reason'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: text('updated_at').notNull(),
});

/** Document sequence per workspace: each organisation numbers its own documents. */
export const counters = sqliteTable('counters', {
  workspaceId: text('workspace_id').notNull().default('default'),
  entity: text('entity').notNull(),
  value: integer('value').notNull().default(0),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.entity] })]);

export const audit = sqliteTable('audit', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  at: text('at').notNull(),
  userId: text('user_id'),
  userName: text('user_name').notNull(),
  action: text('action').notNull(),
  entity: text('entity'),
  recordId: text('record_id'),
  recordCode: text('record_code').notNull().default(''),
  summary: text('summary').notNull(),
  changes: text('changes', { mode: 'json' }).$type<unknown[]>().notNull(),
});

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  at: text('at').notNull(),
  by: text('by').notNull(),
  status: text('status').notNull().default('pending'),
  entity: text('entity').notNull(),
  recordId: text('record_id').notNull(),
  kind: text('kind').notNull(),
  key: text('key').notNull(),
  title: text('title').notNull(),
  payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull(),
  cfg: text('cfg', { mode: 'json' }).$type<JsonObject>().notNull(),
  decidedBy: text('decided_by'),
  decidedAt: text('decided_at'),
  note: text('note').notNull().default(''),
});

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  at: text('at').notNull(),
  type: text('type').notNull(),
  entity: text('entity').notNull().default(''),
  recordId: text('record_id'),
  code: text('code'),
  actorId: text('actor_id'),
  actorName: text('actor_name'),
  summary: text('summary').notNull().default(''),
  payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull(),
});

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull().default(''),
  events: text('events', { mode: 'json' }).$type<string[]>().notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull(),
  eventId: text('event_id'),
  eventType: text('event_type').notNull(),
  payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: text('next_attempt_at').notNull(),
  lastError: text('last_error').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deliveredAt: text('delivered_at'),
});

export const savedViews = sqliteTable('saved_views', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  entity: text('entity').notNull(),
  name: text('name').notNull(),
  visibility: text('visibility').notNull().default('private'),
  ownerId: text('owner_id').notNull(),
  ownerName: text('owner_name').notNull(),
  config: text('config', { mode: 'json' }).$type<JsonObject>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type SavedViewRow = typeof savedViews.$inferSelect;

export const notifyQueue = sqliteTable('notify_queue', {
  id: text('id').primaryKey(),
  channel: text('channel').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAt: text('next_at').notNull(),
  lastError: text('last_error').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  sentAt: text('sent_at'),
});

export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  path: text('path').notNull(),
  uploadedBy: text('uploaded_by'),
  createdAt: text('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
});
