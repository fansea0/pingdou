import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let tmpdir_: string;
let requestMod: any;

async function buildAppFixture() {
  const base = tmpdir_;
  process.env.STATS_DB_PATH = join(base, 'stats.db');
  process.env.PRODUCTS_JSON_PATH = join(base, 'public/data/products.json');
  process.env.ROOT_PASSWORD = 'test-seed-password-1234';
  mkdirSync(resolve(process.env.PRODUCTS_JSON_PATH, '..'), { recursive: true });
  writeFileSync(process.env.PRODUCTS_JSON_PATH, JSON.stringify([
    { id: 'p-a', name: 'A', image: '', price: 1, currency: 'CNY', description: '', url: '' },
  ]));

  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  const merchant = users.createUser({ username: 'mike', password: 'pw1234', role: 'merchant', mustChangePassword: true });
  const products = await import('../../../server/products.js');
  products.loadProductsCache();
  const index = await import('../../../server/index.js');
  return { app: index.app, db, users, merchant };
}

describe('site config routes', () => {
  beforeEach(async () => {
    tmpdir_ = mkdtempSync(join(tmpdir(), 'site-config-test-'));
    requestMod = await import('supertest');
  });

  afterEach(() => {
    if (tmpdir_ && existsSync(tmpdir_)) rmSync(tmpdir_, { recursive: true, force: true });
    delete process.env.STATS_DB_PATH;
    delete process.env.PRODUCTS_JSON_PATH;
    delete process.env.ROOT_PASSWORD;
  });

  const request = () => requestMod.default ?? requestMod;

  it('GET /api/config is public and defaults to showProducts=true', async () => {
    const { app } = await buildAppFixture();
    const r = await request()(app).get('/api/config');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ showProducts: true });
  });

  it('GET /api/admin/settings requires auth (401 unauthenticated)', async () => {
    const { app } = await buildAppFixture();
    const r = await request()(app).get('/api/admin/settings');
    expect(r.status).toBe(401);
  });

  it('GET /api/admin/settings is forbidden for merchant (403)', async () => {
    const { app } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const r = await request()(app).get('/api/admin/settings').set('Cookie', cookies);
    expect(r.status).toBe(403);
  });

  it('GET /api/admin/settings returns list including showProducts for admin', async () => {
    const { app } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'root', password: process.env.ROOT_PASSWORD });
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const r = await request()(app).get('/api/admin/settings').set('Cookie', cookies);
    expect(r.status).toBe(200);
    const showProducts = r.body.settings.find((s: any) => s.key === 'showProducts');
    expect(showProducts?.value).toBe('true');
  });

  it('PUT /api/admin/settings flips showProducts and reflects in /api/config', async () => {
    const { app } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'root', password: process.env.ROOT_PASSWORD });
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const put = await request()(app).put('/api/admin/settings').set('Cookie', cookies).send({ key: 'showProducts', value: 'false' });
    expect(put.status).toBe(200);
    expect(put.body.setting.value).toBe('false');
    expect(put.body.setting.updatedBy).toBe('root');

    const pub = await request()(app).get('/api/config');
    expect(pub.body).toEqual({ showProducts: false });
  });

  it('PUT /api/admin/settings rejects unknown keys (400)', async () => {
    const { app } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'root', password: process.env.ROOT_PASSWORD });
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const r = await request()(app).put('/api/admin/settings').set('Cookie', cookies).send({ key: 'anything-else', value: 'true' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('unknown setting key');
  });

  it('PUT /api/admin/settings rejects missing fields (400)', async () => {
    const { app } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'root', password: process.env.ROOT_PASSWORD });
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const r = await request()(app).put('/api/admin/settings').set('Cookie', cookies).send({ key: 'showProducts' });
    expect(r.status).toBe(400);
  });

  it('PUT /api/admin/settings is forbidden for merchant (403)', async () => {
    const { app } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const r = await request()(app).put('/api/admin/settings').set('Cookie', cookies).send({ key: 'showProducts', value: 'false' });
    expect(r.status).toBe(403);
  });
});