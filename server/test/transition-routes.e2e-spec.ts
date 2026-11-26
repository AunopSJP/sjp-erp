import { rmSync } from 'node:fs';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbPath = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '.';
  const path = `${base}/sjp-transition-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  process.env.DATABASE_PATH = path;
  process.env.UPLOAD_DIR = `${base}/sjp-transition-uploads-${Date.now()}`;
  process.env.THROTTLE_LIMIT = '10000';
  return path;
});

const { AppModule } = await import('../src/app.module.js');

describe('the generic transition route applies the same rules as the dedicated ones', () => {
  let app: INestApplication<App>;
  let admin = '';
  let buyer = '';
  let exec = '';
  let vendor = '';
  let item = '';
  let workflow: { statuses: Record<string, unknown>[] };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());
  const generic = (entity: string, id: string, to: string) =>
    http().post(`/api/records/${entity}/${id}/transition`).set(auth(buyer)).send({ to });
  const dedicated = (id: string, to: string) =>
    http().post(`/api/purchase-orders/${id}/status`).set(auth(buyer)).send({ to });
  const read = async (entity: string, id: string) =>
    (await http().get(`/api/records/${entity}/${id}`).set(auth(admin)).expect(200)).body;
  const makePo = async (unitPrice: number) => {
    const po = await http().post('/api/records/purchaseOrders').set(auth(buyer))
      .send({ vendor, lines: [{ item, qty: 1, unitPrice }] }).expect(201);
    return po.body.id as string;
  };
  const savePoWorkflow = (changes: Record<string, Record<string, unknown>> = {}) =>
    http().put('/api/meta/workflow/po').set(auth(admin))
      .send({
        ...workflow,
        statuses: workflow.statuses.map((status) => ({ ...status, ...changes[String(status['key'])] })),
        // Test-only threshold: orders up to this amount need an executive.
        limits: [{ upTo: 1000, approverRole: 'exec' }],
      })
      .expect(200);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    const setup = await http().post('/api/auth/setup')
      .send({ name: 'Route Admin', username: 'route.admin', password: 'password123' }).expect(201);
    admin = setup.body.token;
    const makeUser = async (roleId: string) => {
      const username = `route.${roleId}`;
      await http().post('/api/users').set(auth(admin))
        .send({ name: username, username, password: 'password123', roleId }).expect(201);
      const login = await http().post('/api/auth/login').send({ username, password: 'password123' }).expect(200);
      return login.body.token as string;
    };
    buyer = await makeUser('buyer');
    exec = await makeUser('exec');

    vendor = (await http().post('/api/records/vendors').set(auth(admin)).send({ name: 'V' }).expect(201)).body.id;
    item = (await http().post('/api/records/items').set(auth(admin))
      .send({ name: 'I', sku: 'ROUTE-1', unit: 'ชิ้น', type: 'อุปกรณ์', category: 'อื่นๆ' }).expect(201)).body.id;
    const config = await http().get('/api/meta/config').set(auth(admin)).expect(200);
    workflow = config.body.workflows.po;
    await savePoWorkflow();
  });

  afterAll(async () => {
    await app.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    rmSync(process.env.UPLOAD_DIR ?? '', { recursive: true, force: true });
  });

  it('asks for the amount-limit approval, and applies it when approved', async () => {
    const id = await makePo(500);
    const res = await generic('purchaseOrders', id, 'ordered').expect(201);
    expect(res.body._pendingApproval).toBeTruthy();
    expect((await read('purchaseOrders', id)).status).toBe('draft');

    await http().post(`/api/approvals/${res.body._pendingApproval.id}/decide`).set(auth(exec))
      .send({ approve: true }).expect(201);
    expect((await read('purchaseOrders', id)).status).toBe('ordered');
  });

  it('refuses to order a purchase order worth nothing', async () => {
    const id = await makePo(0);
    await generic('purchaseOrders', id, 'ordered').expect(400);
    expect((await read('purchaseOrders', id)).status).toBe('draft');
  });

  it('records ticket response time', async () => {
    const customer = (await http().post('/api/records/customers').set(auth(admin)).send({ name: 'C' }).expect(201)).body.id;
    const site = (await http().post('/api/records/sites').set(auth(admin)).send({ name: 'S', customer }).expect(201)).body.id;
    const ticket = await http().post('/api/tickets').set(auth(admin))
      .send({
        title: 't', reportedBy: 'r', receivedAt: '2026-01-01T09:00:00.000Z',
        customer, site, category: 'Network', priority: 'ปกติ', symptom: 's',
      })
      .expect(201);
    await http().post(`/api/records/tickets/${ticket.body.id}/transition`).set(auth(admin))
      .send({ to: 'triage' }).expect(201);
    expect((await read('tickets', ticket.body.id)).respondedAt).toBeTruthy();
  });

  it('refuses a disabled purchase order status on both routes', async () => {
    await savePoWorkflow({ cancelled: { enabled: false } });
    const id = await makePo(500);
    await generic('purchaseOrders', id, 'cancelled').expect(400);
    await dedicated(id, 'cancelled').expect(400);
    expect((await read('purchaseOrders', id)).status).toBe('draft');
    await savePoWorkflow();
  });

  it('enforces required fields of a purchase order status on both routes', async () => {
    await savePoWorkflow({ cancelled: { requiredFields: ['note'] } });
    const id = await makePo(500);
    await generic('purchaseOrders', id, 'cancelled').expect(400);
    await dedicated(id, 'cancelled').expect(400);
    expect((await read('purchaseOrders', id)).status).toBe('draft');
    await savePoWorkflow();
  });
});
