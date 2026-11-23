import { rmSync } from 'node:fs';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbPath = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '.';
  const path = `${base}/sjp-acceptance-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  process.env.DATABASE_PATH = path;
  process.env.UPLOAD_DIR = `${base}/sjp-acceptance-uploads-${Date.now()}`;
  // Seeding 501 modules in one burst is the scenario under test, not the rate limiter.
  process.env.THROTTLE_LIMIT = '10000';
  return path;
});

const { AppModule } = await import('../src/app.module.js');
const TOTAL_MODULES = 501;

describe('NAV-01 acceptance: modules appear and disappear with permission, without a deploy', () => {
  let app: INestApplication<App>;
  let adminToken = '';
  let viewerToken = '';
  let helpdeskPerms: Record<string, Record<string, boolean>> = {};

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const moduleKey = (index: number) => `bulk${String(index).padStart(3, '0')}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    const setup = await request(app.getHttpServer())
      .post('/api/auth/setup')
      .send({ name: 'Acceptance Admin', username: 'acceptance.admin', password: 'password123' })
      .expect(201);
    adminToken = setup.body.token;

    await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({ name: 'Viewer', username: 'acceptance.viewer', password: 'password123', roleId: 'helpdesk' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'acceptance.viewer', password: 'password123' })
      .expect(200);
    viewerToken = login.body.token;
  });

  afterAll(async () => {
    await app.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    rmSync(process.env.UPLOAD_DIR ?? '', { recursive: true, force: true });
  });

  it(`creates ${TOTAL_MODULES} modules and enforces visibility with no redeploy`, async () => {
    const http = request(app.getHttpServer());
    const started = Date.now();
    for (let index = 1; index <= TOTAL_MODULES; index += 1) {
      await http.post('/api/meta/entities').set(auth(adminToken)).send({
        key: moduleKey(index),
        label: `โมดูลทดสอบ ${String(index).padStart(4, '0')}`,
        prefix: `B${String(index).padStart(3, '0')}`,
        title: 'name',
        group: 'ทดสอบจำนวนมาก',
        fields: [{ key: 'name', label: 'ชื่อ', type: 'text', required: true }],
      }).expect(201);
    }
    const createdMs = Date.now() - started;
    process.stdout.write(`NAV-01: created ${TOTAL_MODULES} modules in ${createdMs} ms\n`);

    const role = (await http.get('/api/roles').set(auth(adminToken)).expect(200)).body
      .find((item: { id: string }) => item.id === 'helpdesk');
    helpdeskPerms = role.perms;

    const adminMeta = await http.get('/api/meta').set(auth(adminToken)).expect(200);
    const adminKeys = new Set(adminMeta.body.customModules.map((item: { key: string }) => item.key));
    expect(adminMeta.body.customModules).toHaveLength(TOTAL_MODULES);
    expect(adminKeys.has(moduleKey(1))).toBe(true);
    expect(adminKeys.has(moduleKey(TOTAL_MODULES))).toBe(true);
    const last = adminMeta.body.entities[moduleKey(TOTAL_MODULES)];
    expect(last.label).toBe(`โมดูลทดสอบ ${String(TOTAL_MODULES).padStart(4, '0')}`);
    expect(last.can.view).toBe(true);
    expect(adminMeta.body.entities[moduleKey(1)].group).toBe('ทดสอบจำนวนมาก');

    const adminList = await http.get(`/api/records/${moduleKey(TOTAL_MODULES)}`).set(auth(adminToken)).expect(200);
    expect(adminList.body.total).toBe(0);
    await http.post(`/api/records/${moduleKey(TOTAL_MODULES)}`).set(auth(adminToken))
      .send({ name: 'ใช้งานได้ทันที' }).expect(201);

    const viewerMeta = await http.get('/api/meta').set(auth(viewerToken)).expect(200);
    expect(viewerMeta.body.customModules).toEqual([]);
    expect(viewerMeta.body.entities).not.toHaveProperty(moduleKey(TOTAL_MODULES));
    expect(viewerMeta.body.entities).not.toHaveProperty(moduleKey(1));
    await http.get(`/api/records/${moduleKey(TOTAL_MODULES)}`).set(auth(viewerToken)).expect(403);
    await http.get(`/api/meta/entity/${moduleKey(TOTAL_MODULES)}`).set(auth(viewerToken)).expect(403);
    await http.get(`/api/meta/options/${moduleKey(TOTAL_MODULES)}`).set(auth(viewerToken)).expect(403);
    await http.get('/api/views').query({ entity: moduleKey(TOTAL_MODULES) }).set(auth(viewerToken)).expect(403);

    const granted = { ...helpdeskPerms, [moduleKey(TOTAL_MODULES)]: { view: true } };
    await http.put('/api/meta/roles/helpdesk').set(auth(adminToken)).send({ perms: granted }).expect(200);
    const visible = await http.get('/api/meta').set(auth(viewerToken)).expect(200);
    expect(visible.body.customModules.map((item: { key: string }) => item.key)).toContain(moduleKey(TOTAL_MODULES));
    await http.get(`/api/records/${moduleKey(TOTAL_MODULES)}`).set(auth(viewerToken)).expect(200);

    await http.put('/api/meta/roles/helpdesk').set(auth(adminToken)).send({ perms: helpdeskPerms }).expect(200);
    const revoked = await http.get('/api/meta').set(auth(viewerToken)).expect(200);
    expect(revoked.body.customModules).toEqual([]);
    await http.get(`/api/records/${moduleKey(TOTAL_MODULES)}`).set(auth(viewerToken)).expect(403);

    process.stdout.write(`NAV-01: verified ${TOTAL_MODULES} modules, permission grant/revoke in ${Date.now() - started} ms total\n`);
  }, 180_000);

  it('keeps draft and archived modules out of operations and direct links', async () => {
    const http = request(app.getHttpServer());
    const base = {
      key: 'lifecycleDoc',
      label: 'Lifecycle draft',
      prefix: 'LCY',
      title: 'name',
      group: 'ทดสอบสถานะ',
      fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
    };
    await http.post('/api/meta/entities').set(auth(adminToken))
      .send({ ...base, status: 'draft' }).expect(201);

    const draftMeta = await http.get('/api/meta').set(auth(adminToken)).expect(200);
    expect(draftMeta.body.entities).not.toHaveProperty('lifecycleDoc');
    expect(draftMeta.body.customModules.map((item: { key: string }) => item.key)).not.toContain('lifecycleDoc');
    await http.get('/api/records/lifecycleDoc').set(auth(adminToken)).expect(403);
    await http.post('/api/records/lifecycleDoc').set(auth(adminToken)).send({ name: 'Hidden' }).expect(403);
    await http.get('/api/meta/entity/lifecycleDoc').set(auth(adminToken)).expect(403);
    await http.get('/api/meta/options/lifecycleDoc').set(auth(adminToken)).expect(403);
    await http.get('/api/views').query({ entity: 'lifecycleDoc' }).set(auth(adminToken)).expect(403);
    const draftSearch = await http.get('/api/search').query({ q: 'Hidden' }).set(auth(adminToken)).expect(200);
    expect(draftSearch.body.results).toEqual([]);

    const config = await http.get('/api/meta/config').set(auth(adminToken)).expect(200);
    expect(config.body.entities.lifecycleDoc.status).toBe('draft');

    await http.put('/api/meta/entity/lifecycleDoc').set(auth(adminToken))
      .send({ ...base, status: 'published' }).expect(200);
    const publishedMeta = await http.get('/api/meta').set(auth(adminToken)).expect(200);
    expect(publishedMeta.body.entities.lifecycleDoc.status).toBe('published');
    const record = await http.post('/api/records/lifecycleDoc').set(auth(adminToken))
      .send({ name: 'Lifecycle record' }).expect(201);
    const search = await http.get('/api/search').query({ q: 'Lifecycle record' }).set(auth(adminToken)).expect(200);
    expect(search.body.results.some((item: { code: string }) => item.code === record.body.code)).toBe(true);

    await http.put('/api/meta/entity/lifecycleDoc').set(auth(adminToken))
      .send({ ...base, status: 'archived' }).expect(200);
    const archivedMeta = await http.get('/api/meta').set(auth(adminToken)).expect(200);
    expect(archivedMeta.body.entities).not.toHaveProperty('lifecycleDoc');
    await http.get('/api/records/lifecycleDoc').set(auth(adminToken)).expect(403);
    await http.patch(`/api/records/lifecycleDoc/${record.body.id}`).set(auth(adminToken))
      .send({ name: 'Changed' }).expect(403);
    await http.get(`/api/records/lifecycleDoc/${record.body.id}`).set(auth(adminToken)).expect(403);

    await http.put('/api/meta/entity/lifecycleDoc').set(auth(adminToken))
      .send({ ...base, status: 'unknown' }).expect(400);
    await http.post('/api/meta/entities').set(auth(adminToken))
      .send({ ...base, key: 'lifecycleBad', status: 'unknown' }).expect(400);
  });
});
