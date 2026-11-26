import { rmSync } from 'node:fs';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbPath = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '.';
  const path = `${base}/sjp-sla-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  process.env.DATABASE_PATH = path;
  process.env.UPLOAD_DIR = `${base}/sjp-sla-uploads-${Date.now()}`;
  process.env.THROTTLE_LIMIT = '10000';
  return path;
});

const { AppModule } = await import('../src/app.module.js');

describe('SLA alerts from sample numbers can be switched off', () => {
  let app: INestApplication<App>;
  let adminToken = '';
  let helpdeskToken = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());
  const notificationTypes = async () => {
    const res = await http().get('/api/notifications').set(auth(adminToken)).expect(200);
    return (res.body.items as { type: string }[]).map((item) => item.type);
  };
  const ticketHelp = async () => {
    const res = await http().get('/api/meta').set(auth(adminToken)).expect(200);
    return (res.body.entities.tickets.fields as { help?: string }[]).map((field) => field.help ?? '').join(' | ');
  };
  const saveCompany = (body: Record<string, unknown>, token = adminToken) =>
    http().put('/api/company').set(auth(token)).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    const setup = await http().post('/api/auth/setup')
      .send({ name: 'SLA Admin', username: 'sla.admin', password: 'password123' })
      .expect(201);
    adminToken = setup.body.token;
    await http().post('/api/users').set(auth(adminToken))
      .send({ name: 'SLA Helpdesk', username: 'sla.helpdesk', password: 'password123', roleId: 'helpdesk' })
      .expect(201);
    const login = await http().post('/api/auth/login')
      .send({ username: 'sla.helpdesk', password: 'password123' })
      .expect(200);
    helpdeskToken = login.body.token;

    const customer = await http().post('/api/records/customers').set(auth(adminToken))
      .send({ name: 'SLA Co' }).expect(201);
    const site = await http().post('/api/records/sites').set(auth(adminToken))
      .send({ name: 'SLA Site', customer: customer.body.id }).expect(201);
    // Received long ago, so it is past every sample target.
    await http().post('/api/tickets').set(auth(adminToken))
      .send({
        title: 'เคสเก่า', reportedBy: 'ผู้แจ้ง', receivedAt: '2020-01-01T09:00:00.000Z',
        customer: customer.body.id, site: site.body.id, category: 'Network', priority: 'ปกติ', symptom: 'ใช้งานไม่ได้',
      })
      .expect(201);
    // A second notification type that must survive the switch.
    const vehicle = await http().post('/api/records/vehicles').set(auth(adminToken))
      .send({ name: 'รถทดสอบ', plateNo: 'ทด 1', type: 'รถตู้', status: 'พร้อมใช้' }).expect(201);
    await http().post('/api/records/vehicleBookings').set(auth(adminToken))
      .send({
        title: 'เข้าหน้างาน', vehicle: vehicle.body.id, requester: 'ผู้จอง', destination: 'ไซต์',
        startAt: '2030-01-01T09:00:00.000Z', endAt: '2030-01-01T12:00:00.000Z', status: 'รออนุมัติ',
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    rmSync(process.env.UPLOAD_DIR ?? '', { recursive: true, force: true });
  });

  it('is on by default', async () => {
    const company = await http().get('/api/company').set(auth(adminToken)).expect(200);
    expect(company.body.slaSampleAlerts).toBe(true);
    expect(await notificationTypes()).toContain('ticket');
    expect(await ticketHelp()).toContain('SLA');
  });

  it('removes ticket SLA alerts and the sample numbers when off, and restores them when on', async () => {
    const before = await notificationTypes();
    await saveCompany({ name: 'SJP', slaSampleAlerts: false }).expect(200);
    expect(await notificationTypes()).toEqual(before.filter((type) => type !== 'ticket'));
    expect(await ticketHelp()).not.toContain('SLA');

    await saveCompany({ name: 'SJP', slaSampleAlerts: true }).expect(200);
    expect(await notificationTypes()).toEqual(before);
    expect(await ticketHelp()).toContain('SLA');
  });

  it('keeps the current value when other company fields are saved without it', async () => {
    await saveCompany({ name: 'SJP', slaSampleAlerts: false }).expect(200);
    const saved = await saveCompany({ name: 'SJP Renamed' }).expect(200);
    expect(saved.body.slaSampleAlerts).toBe(false);
    expect(await notificationTypes()).not.toContain('ticket');
  });

  it('rejects a non-boolean value', async () => {
    await saveCompany({ name: 'SJP', slaSampleAlerts: 'false' }).expect(400);
  });

  it('does not let a user without settings permission change it', async () => {
    await saveCompany({ name: 'SJP', slaSampleAlerts: true }, helpdeskToken).expect(403);
    const company = await http().get('/api/company').set(auth(adminToken)).expect(200);
    expect(company.body.slaSampleAlerts).toBe(false);
  });

  it('records the change in the audit trail', async () => {
    await saveCompany({ name: 'SJP', slaSampleAlerts: true }).expect(200);
    const audit = await http().get('/api/audit').set(auth(adminToken)).expect(200);
    expect(JSON.stringify(audit.body)).toContain('เปิดการเตือน SLA จากตัวเลขตัวอย่าง');
  });
});
