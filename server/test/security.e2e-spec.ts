import { rmSync } from 'node:fs';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbPath = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '.';
  const path = `${base}/sjp-security-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  process.env.DATABASE_PATH = path;
  process.env.UPLOAD_DIR = `${base}/sjp-security-uploads-${Date.now()}`;
  return path;
});

const { AppModule } = await import('../src/app.module.js');

describe('security guards (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken = '';
  let techToken = '';
  let techId = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    const setup = await request(app.getHttpServer())
      .post('/api/auth/setup')
      .send({ name: 'Admin', username: 'admin', password: 'password123' })
      .expect(201);
    adminToken = setup.body.token;

    await request(app.getHttpServer())
      .put('/api/meta/roles/tech')
      .set(auth(adminToken))
      .send({ perms: { tickets: { view: true, edit: true }, projects: { view: true }, users: { view: true, edit: true }, settings: { view: true, edit: true } } })
      .expect(200);

    const tech = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({ name: 'Tech', username: 'tech.user', password: 'password123', roleId: 'tech', team: 'ทีมโครงการ' })
      .expect(201);
    techId = tech.body.id;

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'tech.user', password: 'password123' })
      .expect(200);
    techToken = login.body.token;
  });

  afterAll(async () => {
    await app.close();
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${dbPath}${suffix}`, { force: true });
    }
    rmSync(process.env.UPLOAD_DIR ?? '', { recursive: true, force: true });
  });

  it('does not expose a custom module in operational metadata without read permission', async () => {
    const key = 'privateCatalog';
    await request(app.getHttpServer())
      .post('/api/meta/entities')
      .set(auth(adminToken))
      .send({
        key, label: 'Private catalog', prefix: 'CAT', title: 'name',
        fields: [{ key: 'name', label: 'Name', type: 'text' }],
      })
      .expect(201);

    const admin = await request(app.getHttpServer()).get('/api/meta').set(auth(adminToken)).expect(200);
    expect(admin.body.customModules.map((item: { key: string }) => item.key)).toContain(key);
    const tech = await request(app.getHttpServer()).get('/api/meta').set(auth(techToken)).expect(200);
    expect(tech.body.customModules.map((item: { key: string }) => item.key)).not.toContain(key);
    expect(tech.body.entities).not.toHaveProperty(key);
    expect(tech.body.resources).not.toHaveProperty(key);
    await request(app.getHttpServer()).get(`/api/records/${key}`).set(auth(techToken)).expect(403);

    const profile = await request(app.getHttpServer()).get('/api/auth/me').set(auth(techToken)).expect(200);
    const perms = profile.body.perms;
    try {
      await request(app.getHttpServer()).put('/api/meta/roles/tech').set(auth(adminToken))
        .send({ perms: { ...perms, [key]: { view: true } } }).expect(200);
      const allowed = await request(app.getHttpServer()).get('/api/meta').set(auth(techToken)).expect(200);
      expect(allowed.body.customModules.map((item: { key: string }) => item.key)).toContain(key);
      await request(app.getHttpServer()).get(`/api/records/${key}`).set(auth(techToken)).expect(200);
    } finally {
      await request(app.getHttpServer()).put('/api/meta/roles/tech').set(auth(adminToken))
        .send({ perms }).expect(200);
    }
    const revoked = await request(app.getHttpServer()).get('/api/meta').set(auth(techToken)).expect(200);
    expect(revoked.body.entities).not.toHaveProperty(key);
    await request(app.getHttpServer()).get(`/api/records/${key}`).set(auth(techToken)).expect(403);
  });

  it('stores a workspace layout per user and sanitizes unsafe values', async () => {
    const workspaceAdmin = adminToken;
    const workspaceTech = techToken;
    const empty = await request(app.getHttpServer()).get('/api/prefs/workspace').set(auth(workspaceAdmin)).expect(200);
    expect(empty.body.widgets).toEqual({});

    const saved = await request(app.getHttpServer())
      .put('/api/prefs/workspace')
      .set(auth(workspaceAdmin))
      .send({
        version: 1,
        widgets: {
          kpi: { x: -10, y: -5, w: 400, z: 99_999 },
          queue: { x: 80, y: 120, w: 50 },
          'bad key!': { x: 0, y: 0, w: 10 },
        },
        hidden: ['finance', 'bad key!'],
      })
      .expect(200);

    expect(saved.body.widgets.kpi).toEqual({ x: 0, y: 0, w: 100, z: 10_000 });
    expect(saved.body.widgets.queue).toEqual({ x: 80, y: 120, w: 20, z: 0 });
    expect(saved.body.widgets['bad key!']).toBeUndefined();
    expect(saved.body.hidden).toEqual(['finance']);

    const again = await request(app.getHttpServer()).get('/api/prefs/workspace').set(auth(workspaceAdmin)).expect(200);
    expect(again.body.widgets.kpi).toEqual({ x: 0, y: 0, w: 100, z: 10_000 });

    const other = await request(app.getHttpServer()).get('/api/prefs/workspace').set(auth(workspaceTech)).expect(200);
    expect(other.body.widgets).toEqual({});

    await request(app.getHttpServer()).delete('/api/prefs/workspace').set(auth(workspaceAdmin)).expect(200);
    const reset = await request(app.getHttpServer()).get('/api/prefs/workspace').set(auth(workspaceAdmin)).expect(200);
    expect(reset.body.widgets).toEqual({});
  });

  it('queries the complete dataset using grouped filters and stable multi-column sorting', async () => {
    const entity = 'gridFixture';
    const http = request(app.getHttpServer());
    const headers = auth(adminToken);
    await http.post('/api/meta/entities').set(headers).send({
      key: entity, label: 'Grid fixture', title: 'name', prefix: 'GRD',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'qty', label: 'Quantity', type: 'number' },
        { key: 'flag', label: 'Flag', type: 'boolean' },
      ],
    }).expect(201);
    const create = (body: Record<string, unknown>) => http.post(`/api/records/${entity}`).set(headers).send(body).expect(201);
    await create({ name: 'Ignored', qty: 0, flag: true });
    await create({ name: 'Beta', qty: 0, flag: false });
    await create({ name: 'Alpha', qty: 0, flag: false });
    await create({ name: 'Blank', flag: false });
    const filter = {
      join: 'or',
      clauses: [
        { join: 'and', clauses: [{ field: 'qty', op: 'eq', value: 0 }, { field: 'flag', op: 'eq', value: false }] },
        { field: 'qty', op: 'empty' },
      ],
    };
    const page = await http.get(`/api/records/${entity}`).set(headers)
      .query({ pageSize: 1, page: 2, sort: '-qty,name', where: JSON.stringify(filter) }).expect(200);
    expect(page.body.total).toBe(3);
    expect(page.body.items.map((row: { name: string }) => row.name)).toEqual(['Beta']);
    await http.get(`/api/records/${entity}`).set(headers)
      .query({ filters: JSON.stringify({ removedField: 'value' }) }).expect(400);

    const original = await create({ name: 'Concurrent' });
    const url = `/api/records/${entity}/${original.body.id}`;
    await http.patch(url).set(headers).send({ name: 'New value', _expectedUpdatedAt: original.body._updatedAt }).expect(200);
    await http.patch(url).set(headers).send({ name: 'Stale value', _expectedUpdatedAt: original.body._updatedAt }).expect(409);
    const latest = await http.get(url).set(headers).expect(200);
    expect(latest.body.name).toBe('New value');

    const metrics = 'metricFixture';
    await http.post('/api/meta/entities').set(headers).send({
      key: metrics, label: 'Metrics', title: 'name', prefix: 'MET',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'flag', label: 'Flag', type: 'boolean' },
      ],
    }).expect(201);
    const add = (body: Record<string, unknown>) => http.post(`/api/records/${metrics}`).set(headers).send(body).expect(201);
    await add({ name: 'M1', qty: 10, flag: true });
    await add({ name: 'M2', qty: 20, flag: false });
    await add({ name: 'M3', qty: 30, flag: true });
    await add({ name: 'M4', qty: 40, flag: false });
    const totals = await http.get(`/api/records/${metrics}`).set(headers)
      .query({ pageSize: 1, totals: 'qty', groupBy: 'flag', where: JSON.stringify({ field: 'qty', op: 'lt', value: 40 }) })
      .expect(200);
    expect(totals.body.total).toBe(3);
    expect(totals.body.totals.qty).toBe(60);
    expect(totals.body.groups).toEqual([
      { keys: [true], count: 2, totals: { qty: 40 } },
      { keys: [false], count: 1, totals: { qty: 20 } },
    ]);
    await http.get(`/api/records/${metrics}`).set(headers).query({ totals: 'name' }).expect(400);
    await http.get(`/api/records/${metrics}`).set(headers).query({ groupBy: 'name,flag,qty' }).expect(400);
  });

  it('rejects a vehicle booking that is created as already approved', async () => {
    await request(app.getHttpServer())
      .post('/api/records/vehicleBookings')
      .set(auth(adminToken))
      .send({
        title: 'Site visit',
        vehicle: 'missing',
        requester: 'Admin',
        destination: 'Bangkok',
        startAt: '2026-11-12T09:00:00.000Z',
        endAt: '2026-11-12T10:00:00.000Z',
        status: 'อนุมัติแล้ว',
      })
      .expect(400);
  });

  it('does not let a regular edit request approve its own booking', async () => {
    const vehicle = await request(app.getHttpServer())
      .post('/api/records/vehicles')
      .set(auth(adminToken))
      .send({ name: 'Car 1', plateNo: 'ABC-1234', type: 'รถเก๋ง', status: 'พร้อมใช้' })
      .expect(201);

    const booking = await request(app.getHttpServer())
      .post('/api/records/vehicleBookings')
      .set(auth(adminToken))
      .send({
        title: 'Site visit',
        vehicle: vehicle.body.id,
        requester: 'Admin',
        destination: 'Bangkok',
        startAt: '2026-11-12T09:00:00.000Z',
        endAt: '2026-11-12T10:00:00.000Z',
        status: 'รออนุมัติ',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/records/vehicleBookings/${booking.body.id}`)
      .set(auth(adminToken))
      .send({ status: 'อนุมัติแล้ว' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/records/vehicleBookings/${booking.body.id}`)
      .set(auth(adminToken))
      .send({ status: 'ยกเลิก' })
      .expect(200);
  });

  it('paginates and filters records at the database layer for all-scope users', async () => {
    const paged = await request(app.getHttpServer())
      .get('/api/records/vehicles')
      .query({ pageSize: '10', filters: JSON.stringify({ status: 'พร้อมใช้' }) })
      .set(auth(adminToken))
      .expect(200);
    expect(paged.body.total).toBeGreaterThanOrEqual(1);
    expect(paged.body.items[0].plateNo).toBe('ABC-1234');

    const searched = await request(app.getHttpServer())
      .get('/api/records/vehicles')
      .query({ pageSize: '10', search: 'Car 1', filters: JSON.stringify({ status: 'พร้อมใช้' }) })
      .set(auth(adminToken))
      .expect(200);
    expect(searched.body.total).toBeGreaterThanOrEqual(1);
    expect(searched.body.items[0].plateNo).toBe('ABC-1234');
  });

  it('creates a schema field and its back-link together, and rejects unsafe changes', async () => {
    const http = request(app.getHttpServer());
    const headers = auth(adminToken);
    const base = (key: string, label: string) => ({
      key, label, prefix: 'FLD', title: 'name',
      fields: [{ key: 'name', label: 'Name', type: 'text' }],
    });
    await http.post('/api/meta/entities').set(headers).send(base('supplierDir', 'Supplier')).expect(201);
    await http.post('/api/meta/entities').set(headers).send(base('orderDoc', 'Order')).expect(201);

    await http.post('/api/meta/entity/orderDoc/fields').set(headers)
      .send({ field: { key: 'note', label: 'Note', type: 'text', required: true } }).expect(201);
    await http.post('/api/meta/entity/orderDoc/fields').set(headers)
      .send({ field: { key: 'note2', label: ' note ', type: 'text' } }).expect(400);
    await http.post('/api/meta/entity/orderDoc/fields').set(headers)
      .send({ field: { key: 'choice', label: 'Choice', type: 'select' } }).expect(400);
    await http.post('/api/meta/entity/stockMoves/fields').set(headers)
      .send({ field: { key: 'extra', label: 'Extra', type: 'text' } }).expect(400);

    await http.post('/api/meta/entity/orderDoc/fields').set(headers)
      .send({
        field: { key: 'supplier', label: 'Supplier', type: 'ref', ref: 'supplierDir' },
        backlink: { entity: 'missingModule', key: 'orders', label: 'Orders' },
      }).expect(400);
    const afterFailure = await http.get('/api/meta').set(headers).expect(200);
    expect(afterFailure.body.entities.orderDoc.fields.map((item: { key: string }) => item.key)).not.toContain('supplier');

    await http.post('/api/meta/entity/orderDoc/fields').set(headers)
      .send({
        field: { key: 'supplier', label: 'Supplier', type: 'ref', ref: 'supplierDir' },
        backlink: { entity: 'supplierDir', key: 'orders', label: 'Orders' },
      }).expect(201);
    const both = await http.get('/api/meta').set(headers).expect(200);
    expect(both.body.entities.orderDoc.fields.map((item: { key: string }) => item.key)).toContain('supplier');
    expect(both.body.entities.supplierDir.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'orders', type: 'ref', ref: 'orderDoc' }),
    ]));

    await http.post('/api/records/orderDoc').set(headers).send({ name: 'Existing order', note: 'n' }).expect(201);
    await http.post('/api/meta/entity/orderDoc/fields').set(headers)
      .send({ field: { key: 'approvedBy', label: 'Approved by', type: 'text', required: true } }).expect(400);
    const impact = await http.get('/api/meta/entity/orderDoc/field-impact').set(headers)
      .query({ field: 'approvedBy' }).expect(200);
    expect(impact.body).toMatchObject({ affected: 1, total: 1, views: [], workflows: [] });
    await http.post('/api/meta/entity/orderDoc/fields').set(headers)
      .send({ field: { key: 'approvedBy', label: 'Approved by', type: 'text', required: true }, confirmRequired: true }).expect(201);
    await http.get('/api/records/orderDoc').set(headers).expect(200);
  });

  it('stores saved views privately or for the team without widening data access', async () => {
    const http = request(app.getHttpServer());
    const admin = auth(adminToken);
    const viewer = await http.post('/api/users').set(admin)
      .send({ name: 'Viewer', username: 'viewer.only', password: 'password123', roleId: 'helpdesk' }).expect(201);
    expect(viewer.body.id).toBeTruthy();
    const login = await http.post('/api/auth/login')
      .send({ username: 'viewer.only', password: 'password123' }).expect(200);
    const tech = auth(login.body.token);
    const base = {
      entity: 'projects', name: 'โครงการทีมของฉัน', visibility: 'private',
      config: { q: 'ทีม', fv: { team: 'ทีมโครงการ' }, sort: { key: 'name', dir: 1 }, tab: '', pageSize: 25, hiddenColumns: ['track'] },
    };
    const created = await http.post('/api/views').set(admin).send(base).expect(201);
    expect(created.body.entity).toBe('projects');
    expect(created.body.mine).toBe(true);

    const adminList = await http.get('/api/views').query({ entity: 'projects' }).set(admin).expect(200);
    expect(adminList.body.items.map((item: { id: string }) => item.id)).toEqual([created.body.id]);
    const techList = await http.get('/api/views').query({ entity: 'projects' }).set(tech).expect(200);
    expect(techList.body.items).toEqual([]);

    await http.post('/api/views').set(admin)
      .send({ ...base, name: 'โครงการทีมของฉัน', visibility: 'private' }).expect(400);
    await http.post('/api/views').set(tech).send({ ...base, visibility: 'team' }).expect(403);
    await http.post('/api/views').set(admin).send({ ...base, visibility: 'team' }).expect(201);

    const shared = await http.get('/api/views').query({ entity: 'projects' }).set(tech).expect(200);
    const teamView = shared.body.items.find((item: { visibility: string }) => item.visibility === 'team');
    expect(teamView.mine).toBe(false);
    await http.put(`/api/views/${teamView.id}`).set(tech).send({ name: 'เปลี่ยนชื่อ' }).expect(403);
    await http.delete(`/api/views/${teamView.id}`).set(tech).expect(403);

    await http.post('/api/views').set(admin).send({ ...base, name: 'ซ่อนฟิลด์ลับ', config: { ...base.config, hiddenColumns: ['passwordHash'] } }).expect(400);
    await http.post('/api/views').set(admin).send({ ...base, name: 'เรียงฟิลด์ผิด', config: { ...base.config, sort: { key: 'missingField', dir: 1 } } }).expect(400);
    await http.post('/api/views').set(admin).send({ ...base, name: 'ขนาดหน้าเกิน', config: { ...base.config, pageSize: 10000 } }).expect(400);
    await http.post('/api/views').set(admin).send({ ...base, name: '', visibility: 'private' }).expect(400);

    const renamed = await http.put(`/api/views/${created.body.id}`).set(admin)
      .send({ name: 'โครงการทีมของฉัน 2569', config: { ...base.config, q: 'ทีมกว่า' } }).expect(200);
    expect(renamed.body.name).toBe('โครงการทีมของฉัน 2569');
    expect(renamed.body.config.q).toBe('ทีมกว่า');

    await http.delete(`/api/views/${created.body.id}`).set(admin).expect(200);
    const after = await http.get('/api/views').query({ entity: 'projects' }).set(admin).expect(200);
    expect(after.body.items.map((item: { id: string }) => item.id)).not.toContain(created.body.id);
  });

  it('rejects saved views for a dataset the user cannot read', async () => {
    const http = request(app.getHttpServer());
    await http.post('/api/views').set(auth(techToken))
      .send({ entity: 'privateCatalog', name: 'ลักลอบ', visibility: 'private', config: {} }).expect(403);
    await http.get('/api/views').query({ entity: 'privateCatalog' }).set(auth(techToken)).expect(403);
  });

  it('keeps option ids with colours and archived options, and validates multi-link relations', async () => {
    const http = request(app.getHttpServer());
    const headers = auth(adminToken);
    await http.post('/api/meta/entities').set(headers).send({
      key: 'optDoc', label: 'Option doc', title: 'name', prefix: 'OPT',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        {
          key: 'choice', label: 'Choice', type: 'select', options: ['a', 'b'],
          optionMeta: [
            { id: 'a', label: 'Alpha', color: 'blue' },
            { id: 'b', label: 'Beta', color: 'red', archived: true },
          ],
        },
      ],
    }).expect(201);
    const meta = await http.get('/api/meta').set(headers).expect(200);
    expect(meta.body.entities.optDoc.fields.find((field: { key: string }) => field.key === 'choice').optionMeta)
      .toEqual([
        { id: 'a', label: 'Alpha', color: 'blue' },
        { id: 'b', label: 'Beta', color: 'red', archived: true },
      ]);

    const record = await http.post('/api/records/optDoc').set(headers).send({ name: 'Doc 1', choice: 'a' }).expect(201);
    await http.post('/api/records/optDoc').set(headers).send({ name: 'Doc 2', choice: 'b' }).expect(400);
    await http.patch(`/api/records/optDoc/${record.body.id}`).set(headers).send({ choice: 'b' }).expect(400);
    await http.patch(`/api/records/optDoc/${record.body.id}`).set(headers).send({ name: 'Renamed', choice: 'a' }).expect(200);

    await http.post('/api/meta/entity/optDoc/fields').set(headers).send({
      field: {
        key: 'bad', label: 'Bad', type: 'select', options: ['x'],
        optionMeta: [{ id: 'not-in-options', label: 'X', color: 'pink' }],
      },
    }).expect(400);

    await http.post('/api/meta/entities').set(headers).send({
      key: 'linkTarget', label: 'Target', title: 'name', prefix: 'TGT',
      fields: [{ key: 'name', label: 'Name', type: 'text' }],
    }).expect(201);
    await http.post('/api/meta/entities').set(headers).send({
      key: 'linkSource', label: 'Source', title: 'name', prefix: 'SRC',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'targets', label: 'Targets', type: 'ref', ref: 'linkTarget', multiple: true, displayField: 'name' },
      ],
    }).expect(201);
    const badDisplay = await http.post('/api/meta/entity/linkSource/fields').set(headers).send({
      field: { key: 'wrongDisplay', label: 'Wrong', type: 'ref', ref: 'linkTarget', displayField: 'missing' },
    });
    expect(badDisplay.status).toBe(400);

    const a = await http.post('/api/records/linkTarget').set(headers).send({ name: 'Target A' }).expect(201);
    const b = await http.post('/api/records/linkTarget').set(headers).send({ name: 'Target B' }).expect(201);
    const source = await http.post('/api/records/linkSource').set(headers)
      .send({ name: 'Source 1', targets: [a.body.id, b.body.id] }).expect(201);
    expect(source.body.targets).toEqual([a.body.id, b.body.id]);
    expect(source.body._labels.targets).toBe('Target A, Target B');

    await http.post('/api/records/linkSource').set(headers)
      .send({ name: 'Bad', targets: ['missing-id'] }).expect(400);
    const deduped = await http.post('/api/records/linkSource').set(headers)
      .send({ name: 'Deduped', targets: Array.from({ length: 51 }, () => a.body.id) }).expect(201);
    expect(deduped.body.targets).toEqual([a.body.id]);

    const related = await http.get(`/api/records/linkTarget/${a.body.id}/related`).set(headers).expect(200);
    const group = related.body.groups.find((item: { entity: string }) => item.entity === 'linkSource');
    expect(group.records.map((item: { id: string }) => item.id)).toContain(source.body.id);

    const filtered = await http.get('/api/records/linkSource').set(headers)
      .query({ filters: JSON.stringify({ targets: b.body.id }) }).expect(200);
    expect(filtered.body.total).toBe(1);
  });

  it('applies row-level scope in SQL for team-scoped users', async () => {
    const customer = await request(app.getHttpServer())
      .post('/api/records/customers')
      .set(auth(adminToken))
      .send({ name: 'Scope Customer' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/records/projects')
      .set(auth(adminToken))
      .send({ name: 'Team A Project', customer: customer.body.id, team: 'ทีมโครงการ' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/records/projects')
      .set(auth(adminToken))
      .send({ name: 'Team B Project', customer: customer.body.id, team: 'ทีมเครือข่าย' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/api/records/projects')
      .query({ pageSize: '50' })
      .set(auth(techToken))
      .expect(200);
    expect(list.body.items.some((row: { name: string }) => row.name === 'Team A Project')).toBe(true);
    expect(list.body.items.some((row: { name: string }) => row.name === 'Team B Project')).toBe(false);

    const searched = await request(app.getHttpServer())
      .get('/api/records/projects')
      .query({ pageSize: '50', search: 'Scope Customer' })
      .set(auth(techToken))
      .expect(200);
    expect(searched.body.items.some((row: { name: string }) => row.name === 'Team A Project')).toBe(true);
    expect(searched.body.items.some((row: { name: string }) => row.name === 'Team B Project')).toBe(false);
  });

  it('rejects unsupported upload types and accepts allowlisted images', async () => {
    await request(app.getHttpServer())
      .post('/api/files')
      .set(auth(adminToken))
      .attach('file', Buffer.from('MZ'), 'evil.exe')
      .expect(400);

    const uploaded = await request(app.getHttpServer())
      .post('/api/files')
      .set(auth(adminToken))
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'photo.png')
      .expect(201);
    expect(uploaded.body.id).toBeTruthy();
    expect(uploaded.body.mime).toBe('image/png');
  });

  it('blocks webhook URLs that resolve to loopback through IPv4-mapped IPv6', async () => {
    await request(app.getHttpServer())
      .post('/api/webhooks')
      .set(auth(adminToken))
      .send({ name: 'loopback', url: 'http://[::ffff:7f00:1]/hook', events: ['record.created'] })
      .expect(400);
  });

  it('blocks ticket assignment without tickets.assign', async () => {
    const customer = await request(app.getHttpServer())
      .post('/api/records/customers')
      .set(auth(adminToken))
      .send({ name: 'Ticket Customer' })
      .expect(201);
    const site = await request(app.getHttpServer())
      .post('/api/records/sites')
      .set(auth(adminToken))
      .send({ name: 'Ticket Site', customer: customer.body.id })
      .expect(201);
    const ticket = await request(app.getHttpServer())
      .post('/api/records/tickets')
      .set(auth(adminToken))
      .send({
        title: 'Assignment guard',
        reportedBy: 'Admin',
        receivedAt: '2026-11-11T09:00:00.000Z',
        customer: customer.body.id,
        site: site.body.id,
        category: 'IT Support',
        priority: 'ปกติ',
        symptom: 'test',
        team: 'ทีมโครงการ',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/records/tickets/${ticket.body.id}`)
      .set(auth(techToken))
      .send({ assignee: techId })
      .expect(403);
  });

  it('records structured audit changes for user updates', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' })
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/api/users/${techId}`)
      .set(auth(adminToken))
      .send({ name: 'Tech Updated' })
      .expect(200);

    const audit = await request(app.getHttpServer())
      .get('/api/audit')
      .query({ limit: '100' })
      .set(auth(adminToken))
      .expect(200);
    const entries = audit.body as { action: string; recordId: string; changes: { field: string }[] }[];
    const entry = entries.find((row) => row.action === 'user.update' && row.recordId === techId);
    expect(entry).toBeTruthy();
    expect(entry!.changes.some((change) => change.field === 'ชื่อ-สกุล')).toBe(true);
    expect(entries.some((row) => row.action === 'login_failed')).toBe(true);
  });

  it('blocks generic edits after a project is closed', async () => {
    const customer = await request(app.getHttpServer())
      .post('/api/records/customers')
      .set(auth(adminToken))
      .send({ name: 'Closed Project Customer' })
      .expect(201);
    const project = await request(app.getHttpServer())
      .post('/api/records/projects')
      .set(auth(adminToken))
      .send({ name: 'Closed Project', customer: customer.body.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/projects/${project.body.id}/close`)
      .set(auth(adminToken))
      .send({ reason: 'done' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/records/projects/${project.body.id}`)
      .set(auth(adminToken))
      .send({ name: 'Changed after close' })
      .expect(400);
  });

  it('rejects custom module keys that collide with system resources', async () => {
    await request(app.getHttpServer())
      .post('/api/meta/entities')
      .set(auth(adminToken))
      .send({ key: 'users', label: 'Users clone', fields: [{ key: 'name', label: 'Name', type: 'text' }] })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/meta/entities')
      .set(auth(adminToken))
      .send({ key: 'roles', label: 'Roles clone', fields: [{ key: 'name', label: 'Name', type: 'text' }] })
      .expect(400);
  });

  it('stops users.edit from escalating a role or resetting the admin password', async () => {
    await request(app.getHttpServer())
      .patch(`/api/users/${techId}`)
      .set(auth(techToken))
      .send({ roleId: 'admin' })
      .expect(403);

    const users = await request(app.getHttpServer())
      .get('/api/users')
      .set(auth(adminToken))
      .expect(200);
    const admin = (users.body as { id: string; username: string }[]).find((row) => row.username === 'admin');
    expect(admin).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/api/users/${admin!.id}`)
      .set(auth(techToken))
      .send({ password: 'password456' })
      .expect(403);
  });

  it('requires an admin and re-authentication to export a backup', async () => {
    await request(app.getHttpServer())
      .post('/api/backup/export')
      .set(auth(techToken))
      .send({ password: 'password123' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/backup/export')
      .set(auth(adminToken))
      .send({ password: 'wrong-password' })
      .expect(400);
  });

  it('encrypts the backup and restores it with the same password', async () => {
    const exported = await request(app.getHttpServer())
      .post('/api/backup/export')
      .set(auth(adminToken))
      .send({ password: 'password123' })
      .expect(201);
    expect(exported.body.encrypted).toBe(true);
    expect(typeof exported.body.data).toBe('string');
    expect(JSON.stringify(exported.body)).not.toContain('passwordHash');

    await request(app.getHttpServer())
      .post('/api/backup/restore')
      .set(auth(adminToken))
      .send({ payload: exported.body, confirm: 'RESTORE', password: 'wrong-password' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/backup/restore')
      .set(auth(adminToken))
      .send({ payload: exported.body, confirm: 'RESTORE', password: 'password123' })
      .expect(201);

    await request(app.getHttpServer()).get('/api/auth/me').set(auth(adminToken)).expect(401);
  });

  it('supports HttpOnly cookie auth and requires a CSRF header for mutations', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'tech.user', password: 'password123' })
      .expect(200);
    const cookies = (login.headers['set-cookie'] ?? []) as unknown as string[];
    expect(cookies.some((cookie) => cookie.startsWith('sjp_session=') && cookie.includes('HttpOnly'))).toBe(true);
    const cookieHeader = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
    const csrf = /sjp_csrf=([^;]+)/.exec(cookieHeader)?.[1] ?? '';
    expect(csrf).not.toBe('');

    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookieHeader).expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Cookie', cookieHeader)
      .send({ currentPassword: 'password123', newPassword: 'password456' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'password123', newPassword: 'password456' })
      .expect(200);
  });

  it('revokes the session server-side on logout', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' })
      .expect(200);
    const cookies = (login.headers['set-cookie'] ?? []) as unknown as string[];
    const cookieHeader = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
    const csrf = /sjp_csrf=([^;]+)/.exec(cookieHeader)?.[1] ?? '';

    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookieHeader).expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrf)
      .expect(200);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookieHeader).expect(401);
    await request(app.getHttpServer()).get('/api/auth/me').set(auth(adminToken)).expect(401);
  });

});

