import { rmSync } from 'node:fs';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbPath = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '.';
  const path = `${base}/sjp-workspace-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  process.env.DATABASE_PATH = path;
  process.env.UPLOAD_DIR = `${base}/sjp-workspace-uploads-${Date.now()}`;
  process.env.THROTTLE_LIMIT = '10000';
  return path;
});

const { AppModule } = await import('../src/app.module.js');

describe('Workspace isolation (model A: shared schema with workspace_id)', () => {
  let app: INestApplication<App>;
  let adminToken = '';
  let viewerToken = '';
  let viewerId = '';
  let defaultRecordId = '';

  const auth = (token: string, workspace?: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (workspace) headers['X-Workspace-ID'] = workspace;
    return headers;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    const setup = await request(app.getHttpServer())
      .post('/api/auth/setup')
      .send({ name: 'Workspace Admin', username: 'ws.admin', password: 'password123' })
      .expect(201);
    adminToken = setup.body.token;
    const viewer = await request(app.getHttpServer())
      .post('/api/users').set(auth(adminToken))
      .send({ name: 'Branch Viewer', username: 'ws.viewer', password: 'password123', roleId: 'helpdesk' })
      .expect(201);
    viewerId = viewer.body.id;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'ws.viewer', password: 'password123' })
      .expect(200);
    viewerToken = login.body.token;
  });

  afterAll(async () => {
    await app.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    rmSync(process.env.UPLOAD_DIR ?? '', { recursive: true, force: true });
  });

  it('separates records and saved views per workspace and validates membership', async () => {
    const http = request(app.getHttpServer());

    const initial = await http.get('/api/workspaces').set(auth(adminToken)).expect(200);
    expect(initial.body.items.map((item: { id: string }) => item.id)).toEqual(['default']);
    expect(initial.body.active).toBe('default');

    const defaultRecord = await http.post('/api/records/customers').set(auth(adminToken))
      .send({ name: 'Default Co' }).expect(201);
    defaultRecordId = defaultRecord.body.id;
    expect(defaultRecord.body.code).toBe('CUS-0001');

    await http.post('/api/workspaces').set(auth(adminToken))
      .send({ id: 'branch', name: 'สาขา' }).expect(201);
    await http.post('/api/workspaces').set(auth(adminToken))
      .send({ id: 'branch', name: 'ซ้ำ' }).expect(400);
    await http.post('/api/workspaces').set(auth(adminToken))
      .send({ id: 'BAD ID', name: 'ผิด' }).expect(400);

    const branchRecord = await http.post('/api/records/customers')
      .set(auth(adminToken, 'branch')).send({ name: 'Branch Co' }).expect(201);
    expect(branchRecord.body._labels).toBeDefined();
    // Document numbering restarts inside each workspace (separate counters).
    expect(branchRecord.body.code).toBe('CUS-0001');

    const defaultList = await http.get('/api/records/customers').set(auth(adminToken)).expect(200);
    expect(defaultList.body.total).toBe(1);
    expect(defaultList.body.items[0].name).toBe('Default Co');
    const branchList = await http.get('/api/records/customers').set(auth(adminToken, 'branch')).expect(200);
    expect(branchList.body.total).toBe(1);
    expect(branchList.body.items[0].name).toBe('Branch Co');
    await http.get(`/api/records/customers/${defaultRecordId}`).set(auth(adminToken, 'branch')).expect(404);

    await http.post('/api/views').set(auth(adminToken))
      .send({ entity: 'customers', name: 'มุมมองกลาง', visibility: 'private', config: {} }).expect(201);
    const branchViews = await http.get('/api/views').query({ entity: 'customers' })
      .set(auth(adminToken, 'branch')).expect(200);
    expect(branchViews.body.items).toEqual([]);
    const defaultViews = await http.get('/api/views').query({ entity: 'customers' })
      .set(auth(adminToken)).expect(200);
    expect(defaultViews.body.items.map((item: { name: string }) => item.name)).toContain('มุมมองกลาง');

    await http.get('/api/records/customers').set(auth(viewerToken, 'branch')).expect(403);
    const viewerDefault = await http.get('/api/records/customers').set(auth(viewerToken)).expect(200);
    expect(viewerDefault.body.total).toBe(1);

    await http.put('/api/workspaces/branch/members').set(auth(adminToken))
      .send({ userIds: [viewerId] }).expect(200);
    const viewerBranch = await http.get('/api/records/customers').set(auth(viewerToken, 'branch')).expect(200);
    expect(viewerBranch.body.total).toBe(1);
    expect(viewerBranch.body.items[0].name).toBe('Branch Co');
    await http.get(`/api/records/customers/${defaultRecordId}`).set(auth(viewerToken, 'branch')).expect(404);

    await http.post('/api/workspaces/active').set(auth(viewerToken))
      .send({ id: 'branch' }).expect(201);
    const profile = await http.get('/api/auth/me').set(auth(viewerToken)).expect(200);
    expect(profile.body.activeWorkspaceId).toBe('branch');
    const viewerWorkspaces = await http.get('/api/workspaces').set(auth(viewerToken)).expect(200);
    expect(viewerWorkspaces.body.active).toBe('branch');

    await http.put('/api/workspaces/default').set(auth(adminToken))
      .send({ archived: true }).expect(400);
    await http.put('/api/workspaces/branch').set(auth(adminToken))
      .send({ archived: true }).expect(200);
    await http.get('/api/records/customers').set(auth(adminToken, 'branch')).expect(403);
    const archivedList = await http.get('/api/workspaces').set(auth(adminToken)).expect(200);
    expect(archivedList.body.items.find((item: { id: string }) => item.id === 'branch').archived).toBe(true);

    // A backup must carry workspaces and memberships through a restore.
    const exported = await http.post('/api/backup/export').set(auth(adminToken))
      .send({ password: 'password123' }).expect(201);
    await http.post('/api/workspaces').set(auth(adminToken))
      .send({ id: 'temp', name: 'ชั่วคราว' }).expect(201);
    await http.post('/api/backup/restore').set(auth(adminToken))
      .send({ payload: exported.body, confirm: 'RESTORE', password: 'password123' }).expect(201);
    const relogin = await http.post('/api/auth/login')
      .send({ username: 'ws.admin', password: 'password123' }).expect(200);
    const restored = await http.get('/api/workspaces').set(auth(relogin.body.token)).expect(200);
    const restoredIds = restored.body.items.map((item: { id: string }) => item.id);
    expect(restoredIds).toContain('branch');
    expect(restoredIds).not.toContain('temp');
    const viewerRelogin = await http.post('/api/auth/login')
      .send({ username: 'ws.viewer', password: 'password123' }).expect(200);
    const viewerRestored = await http.get('/api/workspaces').set(auth(viewerRelogin.body.token)).expect(200);
    expect(viewerRestored.body.items.map((item: { id: string }) => item.id)).toContain('branch');
  });
});
