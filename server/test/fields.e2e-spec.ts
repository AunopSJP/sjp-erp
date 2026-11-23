import { rmSync } from 'node:fs';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbPath = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '.';
  const path = `${base}/sjp-fields-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  process.env.DATABASE_PATH = path;
  process.env.UPLOAD_DIR = `${base}/sjp-fields-uploads-${Date.now()}`;
  process.env.THROTTLE_LIMIT = '10000';
  return path;
});

const { AppModule } = await import('../src/app.module.js');

describe('Field and relation lifecycle', () => {
  let app: INestApplication<App>;
  let token = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const createModule = async (key: string, label: string, fields: unknown[]) => {
    const result = await request(app.getHttpServer())
      .post('/api/meta/entities')
      .set(auth())
      .send({ key, label, fields, cols: ['code', ...fields.map((field) => (field as { key: string }).key)], filters: [] })
      .expect(201);
    return result.body as { key: string };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    const setup = await request(app.getHttpServer())
      .post('/api/auth/setup')
      .send({ name: 'Field Admin', username: 'field.admin', password: 'password123' })
      .expect(201);
    token = setup.body.token;
  });

  afterAll(async () => {
    await app.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    rmSync(process.env.UPLOAD_DIR ?? '', { recursive: true, force: true });
  });

  it('reports saved views that use a field', async () => {
    const http = request(app.getHttpServer());
    await createModule('impactItems', 'Impact items', [
      { key: 'name', type: 'text', label: 'ชื่อ' },
      { key: 'qty', type: 'number', label: 'จำนวน' },
    ]);
    await http.post('/api/views').set(auth())
      .send({ entity: 'impactItems', name: 'เรียงตามจำนวน', visibility: 'private', config: { sort: { key: 'qty', dir: -1 } } })
      .expect(201);
    const impact = await http.get('/api/meta/entity/impactItems/field-impact').query({ field: 'qty' }).set(auth()).expect(200);
    expect(impact.body.affected).toBe(0);
    expect(impact.body.views).toHaveLength(1);
    expect(impact.body.views[0].name).toBe('เรียงตามจำนวน');
  });

  it('converts a field type, refuses silent data loss, then archives without dropping values', async () => {
    const http = request(app.getHttpServer());
    await createModule('convItems', 'Convert items', [{ key: 'name', type: 'text', label: 'ชื่อ', required: true }]);
    for (const name of ['12', '7.5', 'abc']) {
      await http.post('/api/records/convItems').set(auth()).send({ name }).expect(201);
    }

    const refused = await http.patch('/api/meta/entity/convItems/field/name').set(auth()).send({ type: 'number' }).expect(400);
    expect(String(refused.body.message)).toContain('แปลงชนิดไม่ได้ 1 รายการ');

    const converted = await http.patch('/api/meta/entity/convItems/field/name').set(auth())
      .send({ type: 'number', confirm: true }).expect(200);
    expect(converted.body.converted).toBe(2);
    expect(converted.body.cleared).toBe(1);
    const convertedRows = await http.get('/api/records/convItems').set(auth()).expect(200);
    const values = convertedRows.body.items.map((row: { name: unknown }) => row.name).sort();
    expect(values).toEqual([12, 7.5, null].sort());

    const audit = await http.get('/api/audit').query({ limit: 10 }).set(auth()).expect(200);
    expect(audit.body.some((row: { action: string }) => row.action === 'metadata.field')).toBe(true);

    await http.patch('/api/meta/entity/convItems/field/name').set(auth()).send({ archived: true }).expect(200);
    const created = await http.post('/api/records/convItems').set(auth()).send({ name: 'ignored' }).expect(201);
    expect(created.body.name).toBeUndefined();
    await http.patch('/api/meta/entity/convItems/field/name').set(auth()).send({ archived: false }).expect(200);
  });

  it('keeps a many-to-many relation in sync on create, update, archive and restore', async () => {
    const http = request(app.getHttpServer());
    await createModule('m2mTasks', 'งานเชื่อมโยง', [{ key: 'name', type: 'text', label: 'ชื่องาน' }]);
    await createModule('m2mTags', 'แท็กเชื่อมโยง', [{ key: 'name', type: 'text', label: 'ชื่อแท็ก' }]);

    const created = await http.post('/api/meta/entity/m2mTasks/fields').set(auth()).send({
      field: { key: 'tags', label: 'แท็ก', type: 'ref', ref: 'm2mTags', multiple: true },
      backlink: { entity: 'm2mTags', key: 'tasks', label: 'งาน', multiple: true },
    }).expect(201);
    expect(created.body.backlink.field.multiple).toBe(true);

    const tagA = (await http.post('/api/records/m2mTags').set(auth()).send({ name: 'A' }).expect(201)).body;
    const tagB = (await http.post('/api/records/m2mTags').set(auth()).send({ name: 'B' }).expect(201)).body;
    const task = (await http.post('/api/records/m2mTasks').set(auth())
      .send({ name: 'งานที่ 1', tags: [tagA.id, tagB.id] }).expect(201)).body;

    const tagsAfterCreate = (await http.get('/api/records/m2mTags').set(auth()).expect(200)).body.items;
    const aAfterCreate = tagsAfterCreate.find((row: { id: string }) => row.id === tagA.id);
    expect(aAfterCreate.tasks).toEqual([task.id]);
    expect(aAfterCreate._labels.tasks).toBe('งานที่ 1');

    await http.patch(`/api/records/m2mTasks/${task.id}`).set(auth()).send({ tags: [tagB.id] }).expect(200);
    const tagsAfterUpdate = (await http.get('/api/records/m2mTags').set(auth()).expect(200)).body.items;
    expect(tagsAfterUpdate.find((row: { id: string }) => row.id === tagA.id).tasks).toEqual([]);
    expect(tagsAfterUpdate.find((row: { id: string }) => row.id === tagB.id).tasks).toEqual([task.id]);

    await http.delete(`/api/records/m2mTasks/${task.id}`).set(auth()).send({ reason: 'ทดสอบ' }).expect(200);
    const tagsAfterArchive = (await http.get('/api/records/m2mTags').set(auth()).expect(200)).body.items;
    expect(tagsAfterArchive.find((row: { id: string }) => row.id === tagB.id).tasks).toEqual([]);

    await http.post(`/api/records/m2mTasks/${task.id}/restore`).set(auth()).expect(201);
    const tagsAfterRestore = (await http.get('/api/records/m2mTags').set(auth()).expect(200)).body.items;
    expect(tagsAfterRestore.find((row: { id: string }) => row.id === tagB.id).tasks).toEqual([task.id]);
  });

  it('audits option changes and mirrors workflow labels/colors into the status field', async () => {
    const http = request(app.getHttpServer());
    await createModule('optItems', 'Option items', [
      { key: 'name', type: 'text', label: 'ชื่อ' },
      { key: 'stage', type: 'select', label: 'ขั้น', options: ['a'], optionMeta: [{ id: 'a', label: 'A', color: 'blue' }] },
    ]);
    await http.put('/api/meta/entity/optItems').set(auth()).send({
      key: 'optItems', label: 'Option items',
      fields: [
        { key: 'name', type: 'text', label: 'ชื่อ' },
        { key: 'stage', type: 'select', label: 'ขั้น', options: ['a', 'b'], optionMeta: [
          { id: 'a', label: 'A', color: 'blue' }, { id: 'b', label: 'B', color: 'green' },
        ] },
      ],
      cols: ['code', 'name', 'stage'], filters: [],
    }).expect(200);
    const audit = await http.get('/api/audit').query({ limit: 20 }).set(auth()).expect(200);
    const optionEntry = audit.body.find((row: { action: string; summary: string }) => row.action === 'metadata.options');
    expect(optionEntry?.summary).toContain('เพิ่มตัวเลือก B');

    await createModule('wfItems', 'Workflow items', [
      { key: 'name', type: 'text', label: 'ชื่อ' },
      { key: 'status', type: 'select', label: 'สถานะ', options: ['a'], optionMeta: [{ id: 'a', label: 'A', color: 'blue' }] },
    ]);
    await http.put('/api/meta/workflow/wfItems').set(auth()).send({
      statuses: [
        { key: 'a', label: 'ใหม่', color: 'blue', next: ['b'] },
        { key: 'b', label: 'ปิดงาน', color: 'green', next: [], final: true },
      ],
    }).expect(200);
    const config = await http.get('/api/meta/config').set(auth()).expect(200);
    const statusField = config.body.entities.wfItems.fields.find((field: { key: string }) => field.key === 'status');
    expect(statusField.optionMeta).toEqual([
      { id: 'a', label: 'ใหม่', color: 'blue' },
      { id: 'b', label: 'ปิดงาน', color: 'green' },
    ]);
    expect(config.body.workflows.wfItems.statuses.map((status: { label: string }) => status.label)).toEqual(['ใหม่', 'ปิดงาน']);
  });

  it('normalizes admin-editable aliases and returns them in meta', async () => {
    const http = request(app.getHttpServer());
    await http.post('/api/meta/entities').set(auth()).send({
      key: 'aliasItems', label: 'Alias items', prefix: 'ALS', title: 'name',
      fields: [{ key: 'name', type: 'text', label: 'ชื่อ' }],
      cols: ['code', 'name'], filters: [],
      aliases: ['ใบสั่งซื้อ', 'PO', 'po', '  ใบสั่งซื้อ  ', 'purchase order'],
    }).expect(201);
    const meta = await http.get('/api/meta').set(auth()).expect(200);
    expect(meta.body.entities.aliasItems.aliases).toEqual(['ใบสั่งซื้อ', 'PO', 'purchase order']);

    const many = Array.from({ length: 25 }, (_, index) => `alias ${index + 1}`);
    await http.put('/api/meta/entity/aliasItems').set(auth()).send({
      key: 'aliasItems', label: 'Alias items', prefix: 'ALS', title: 'name',
      fields: [{ key: 'name', type: 'text', label: 'ชื่อ' }],
      cols: ['code', 'name'], filters: [], aliases: many,
    }).expect(200);
    const saved = await http.get('/api/meta').set(auth()).expect(200);
    expect(saved.body.entities.aliasItems.aliases).toHaveLength(20);
  });

  it('restricts select options by role, filters them in meta and enforces on writes', async () => {
    const http = request(app.getHttpServer());
    await http.post('/api/meta/entities').set(auth()).send({
      key: 'aclItems', label: 'ACL items', prefix: 'ACL', title: 'name',
      fields: [
        { key: 'name', type: 'text', label: 'ชื่อ' },
        {
          key: 'stage', type: 'select', label: 'ขั้น', options: ['a', 'b'],
          optionMeta: [
            { id: 'a', label: 'A', color: 'blue' },
            { id: 'b', label: 'B', color: 'red', roles: ['admin'] },
          ],
        },
      ],
      cols: ['code', 'name', 'stage'], filters: [],
      roleIds: ['helpdesk'],
    }).expect(201);
    await http.post('/api/users').set(auth())
      .send({ name: 'ACL Viewer', username: 'acl.viewer', password: 'password123', roleId: 'helpdesk' })
      .expect(201);
    const login = await http.post('/api/auth/login').send({ username: 'acl.viewer', password: 'password123' }).expect(200);
    const viewer = { Authorization: `Bearer ${login.body.token}` };

    const adminMeta = await http.get('/api/meta').set(auth()).expect(200);
    expect(adminMeta.body.entities.aclItems.fields.find((field: { key: string }) => field.key === 'stage').options).toEqual(['a', 'b']);
    const viewerMeta = await http.get('/api/meta').set(viewer).expect(200);
    const viewerStage = viewerMeta.body.entities.aclItems.fields.find((field: { key: string }) => field.key === 'stage');
    expect(viewerStage.options).toEqual(['a']);
    expect(viewerStage.optionMeta.map((option: { id: string }) => option.id)).toEqual(['a']);

    await http.post('/api/records/aclItems').set(viewer).send({ name: 'ok', stage: 'a' }).expect(201);
    const denied = await http.post('/api/records/aclItems').set(viewer).send({ name: 'no', stage: 'b' }).expect(400);
    expect(String(denied.body.message)).toContain('ไม่มีสิทธิ์เลือก');
    await http.post('/api/records/aclItems').set(auth()).send({ name: 'admin', stage: 'b' }).expect(201);

    // Editing options keeps ids stable, adds a role-scoped option and refuses removing used ones.
    await http.patch('/api/meta/entity/aclItems/field/stage').set(auth()).send({
      options: ['a', 'b', 'c'],
      optionMeta: [
        { id: 'a', label: 'A', color: 'blue' },
        { id: 'b', label: 'B', color: 'red', roles: ['admin'] },
        { id: 'c', label: 'C', color: 'green', roles: ['helpdesk'] },
      ],
    }).expect(200);
    const viewerMeta2 = await http.get('/api/meta').set(viewer).expect(200);
    const stage2 = viewerMeta2.body.entities.aclItems.fields.find((field: { key: string }) => field.key === 'stage');
    expect(stage2.options).toEqual(['a', 'c']);

    const removal = await http.patch('/api/meta/entity/aclItems/field/stage').set(auth())
      .send({ options: ['a', 'c'] }).expect(400);
    expect(String(removal.body.message)).toContain('ลบตัวเลือกที่มีข้อมูลใช้งานอยู่');
  });

  it('filters relation options by a business field', async () => {
    const http = request(app.getHttpServer());
    const customerA = (await http.post('/api/records/customers').set(auth()).send({ name: 'Customer A' }).expect(201)).body;
    const customerB = (await http.post('/api/records/customers').set(auth()).send({ name: 'Customer B' }).expect(201)).body;
    const siteA = (await http.post('/api/records/sites').set(auth()).send({ name: 'Site A', customer: customerA.id }).expect(201)).body;
    const siteB = (await http.post('/api/records/sites').set(auth()).send({ name: 'Site B', customer: customerB.id }).expect(201)).body;

    const filtered = await http.get('/api/meta/options/sites').set(auth())
      .query({ filterField: 'customer', filterValue: customerA.id }).expect(200);
    expect(filtered.body.map((option: { value: string }) => option.value)).toEqual([siteA.id]);
    expect(filtered.body.some((option: { value: string }) => option.value === siteB.id)).toBe(false);

    await http.get('/api/meta/options/sites').set(auth())
      .query({ filterField: 'notAField', filterValue: customerA.id }).expect(400);
    const ticketDef = (await http.get('/api/meta/entity/tickets').set(auth()).expect(200)).body;
    const siteField = ticketDef.fields.find((field: { key: string }) => field.key === 'site');
    expect(siteField.optionFilter).toEqual({ by: 'customer', targetField: 'customer' });
  });
  it('enforces number range/decimals/currency and text length constraints', async () => {
    const http = request(app.getHttpServer());
    await createModule('priceItems', 'Price items', [{ key: 'name', type: 'text', label: 'ชื่อ' }]);
    await http.post('/api/meta/entity/priceItems/fields').set(auth())
      .send({ field: { key: 'price', label: 'ราคา', type: 'number', decimals: 2, min: 0, max: 1000, currency: 'thb' } })
      .expect(201);
    await http.post('/api/meta/entity/priceItems/fields').set(auth())
      .send({ field: { key: 'note', label: 'หมายเหตุ', type: 'text', maxLength: 5 } })
      .expect(201);
    const def = (await http.get('/api/meta/entity/priceItems').set(auth()).expect(200)).body;
    const price = def.fields.find((field: { key: string }) => field.key === 'price');
    expect(price).toMatchObject({ decimals: 2, min: 0, max: 1000, currency: 'THB' });
    const create = (body: Record<string, unknown>) => http.post('/api/records/priceItems').set(auth()).send({ name: 'x', ...body });
    await create({ price: 12.345 }).expect(400);
    await create({ price: -1 }).expect(400);
    await create({ price: 1001 }).expect(400);
    await create({ note: 'too long' }).expect(400);
    await create({ price: 12.5, note: 'ok' }).expect(201);
    await http.post('/api/meta/entity/priceItems/fields').set(auth())
      .send({ field: { key: 'bad', label: 'bad', type: 'number', min: 5, max: 1 } }).expect(400);
    await http.post('/api/meta/entity/priceItems/fields').set(auth())
      .send({ field: { key: 'bad2', label: 'bad2', type: 'number', currency: 'BAHT' } }).expect(400);
  });
});
