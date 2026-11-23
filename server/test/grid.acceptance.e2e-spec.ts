import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbPath = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '.';
  const path = `${base}/sjp-grid-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
  process.env.DATABASE_PATH = path;
  process.env.UPLOAD_DIR = `${base}/sjp-grid-uploads-${Date.now()}`;
  process.env.THROTTLE_LIMIT = '10000';
  return path;
});

const { AppModule } = await import('../src/app.module.js');
const ROWS = 100_000;
const FIELDS = 80;

describe('GRID-01 acceptance: 100,000 records and 80 fields', () => {
  let app: INestApplication<App>;
  let token = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const timed = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const value = await run();
    process.stdout.write(`GRID-01: ${label} took ${Date.now() - started} ms\n`);
    return value;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    const setup = await request(app.getHttpServer())
      .post('/api/auth/setup')
      .send({ name: 'Grid Admin', username: 'grid.admin', password: 'password123' })
      .expect(201);
    token = setup.body.token;

    const fields = [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'qty', label: 'Quantity', type: 'number' },
      { key: 'grp', label: 'Group', type: 'select', options: ['A', 'B', 'C', 'D'] },
      { key: 'note', label: 'Note', type: 'text' },
    ];
    const extraFields = FIELDS - fields.length;
    for (let index = 1; index <= extraFields; index += 1) {
      fields.push({ key: `f${String(index).padStart(2, '0')}`, label: `Field ${index}`, type: 'text' } as never);
    }
    expect(fields).toHaveLength(FIELDS);
    await request(app.getHttpServer())
      .post('/api/meta/entities')
      .set(auth())
      .send({
        key: 'gridBig', label: 'Grid big dataset', prefix: 'GRB', title: 'name',
        cols: ['code', 'name', 'qty', 'grp'], filters: ['grp'], fields,
      })
      .expect(201);

    const db = new Database(dbPath);
    const insert = db.prepare(
      'INSERT INTO records (id, entity, code, data, deleted, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
    );
    const groups = ['A', 'B', 'C', 'D'];
    const seed = db.transaction(() => {
      for (let index = 0; index < ROWS; index += 1) {
        const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)).toISOString();
        insert.run(
          `row-${String(index).padStart(6, '0')}`,
          'gridBig',
          `GR-${String(index).padStart(7, '0')}`,
          JSON.stringify({ name: `Row ${String(index).padStart(6, '0')}`, qty: index, grp: groups[index % 4], note: 'x' }),
          'grid.admin',
          stamp,
          stamp,
        );
      }
    });
    const seededAt = Date.now();
    seed();
    db.close();
    process.stdout.write(`GRID-01: seeded ${ROWS} records in ${Date.now() - seededAt} ms\n`);
  }, 300_000);

  afterAll(async () => {
    await app.close();
    if (process.env.PERF_KEEP === '1') {
      process.stdout.write(`GRID-01: kept database at ${dbPath}\n`);
      return;
    }
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    rmSync(process.env.UPLOAD_DIR ?? '', { recursive: true, force: true });
  });

  it('returns correct pages, totals and groups over the whole dataset', async () => {
    const meta = await request(app.getHttpServer()).get('/api/meta').set(auth()).expect(200);
    expect(meta.body.entities.gridBig.fields).toHaveLength(FIELDS);

    const page = await timed('list page 2 (10 per page, sort code)', async () =>
      request(app.getHttpServer()).get('/api/records/gridBig').set(auth())
        .query({ page: 2, pageSize: 10, sort: 'code' }).expect(200));
    expect(page.body.total).toBe(ROWS);
    expect(page.body.items).toHaveLength(10);
    expect(page.body.items[0].code).toBe('GR-0000010');

    const deepPage = await timed('deep page 1000 (100 per page)', async () =>
      request(app.getHttpServer()).get('/api/records/gridBig').set(auth())
        .query({ page: 1000, pageSize: 100, sort: 'code' }).expect(200));
    expect(deepPage.body.items[0].code).toBe('GR-0099900');

    const where = JSON.stringify({ field: 'qty', op: 'lt', value: 1000 });
    const filtered = await timed('filtered totals over full set', async () =>
      request(app.getHttpServer()).get('/api/records/gridBig').set(auth())
        .query({ page: 1, pageSize: 50, where, totals: 'qty', groupBy: 'grp', sort: 'code' }).expect(200));
    expect(filtered.body.total).toBe(1000);
    expect(filtered.body.items).toHaveLength(50);
    expect(filtered.body.totals.qty).toBe(499_500);
    expect(filtered.body.groups).toHaveLength(4);
    expect(filtered.body.groups.reduce((sum: number, group: { count: number }) => sum + group.count, 0)).toBe(1000);
    expect(filtered.body.groups.reduce((sum: number, group: { totals: { qty: number } }) => sum + group.totals.qty, 0)).toBe(499_500);

    const searched = await timed('search inside 100k rows', async () =>
      request(app.getHttpServer()).get('/api/records/gridBig').set(auth())
        .query({ search: 'Row 099999' }).expect(200));
    expect(searched.body.total).toBe(1);
    expect(searched.body.items[0].code).toBe('GR-0099999');
  }, 300_000);
});
