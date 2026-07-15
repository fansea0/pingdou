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
  mkdirSync(resolve(process.env.PRODUCTS_JSON_PATH, '..'), { recursive: true });
  writeFileSync(process.env.PRODUCTS_JSON_PATH, JSON.stringify([
    { id: 'p-a', name: 'A', image: '', price: 1, currency: 'CNY', description: '', url: '' },
    { id: 'p-b', name: 'B', image: '', price: 1, currency: 'CNY', description: '', url: '' },
  ]));

  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();

  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  const merchant = users.createUser({ username: 'mike', password: 'pw1234', role: 'merchant', mustChangePassword: true });

  const products = await import('../../../server/products.js');
  products.loadProductsCache();

  const assignments = await import('../../../server/assignments.js');
  assignments.reconcileAssignments(merchant.id, ['p-a']);

  const index = await import('../../../server/index.js');
  return { app: index.app, db, users, products, assignments };
}

describe('auth route integration', () => {
  beforeEach(async () => {
    tmpdir_ = mkdtempSync(join(tmpdir(), 'routes-test-'));
    process.env.STATS_DB_TMPDIR = tmpdir_;
    requestMod = await import('supertest');
  });

  afterEach(() => {
    if (tmpdir_ && existsSync(tmpdir_)) rmSync(tmpdir_, { recursive: true, force: true });
    delete process.env.STATS_DB_TMPDIR;
    delete process.env.STATS_DB_PATH;
    delete process.env.PRODUCTS_JSON_PATH;
  });

  const request = () => requestMod.default ?? requestMod;

  it('login → me → logout flow for the root admin', async () => {
    const { app } = await buildAppFixture();
    const agent = request().agent(app);
    const login = await agent.post('/api/auth/login').send({ username: 'root', password: 'fansea0117' });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe('admin');
    expect(login.body.mustChangePassword).toBe(false);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('root');

    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);

    const meAgain = await agent.get('/api/auth/me');
    expect(meAgain.status).toBe(401);
  });

  it('merchant login carries mustChangePassword=true', async () => {
    const { app } = await buildAppFixture();
    const r = await request()(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('merchant');
    expect(r.body.mustChangePassword).toBe(true);
  });

  it('wrong password → 401', async () => {
    const { app } = await buildAppFixture();
    const r = await request()(app).post('/api/auth/login').send({ username: 'root', password: 'wrong' });
    expect(r.status).toBe(401);
  });

  it('disabled user cannot log in', async () => {
    const { app, users } = await buildAppFixture();
    const u = users.createUser({ username: 'doomed', password: 'pw1234', role: 'merchant' });
    users.setUserDisabled(u.id, true);
    const r = await request()(app).post('/api/auth/login').send({ username: 'doomed', password: 'pw1234' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('account disabled');
  });

  it('GET /api/products returns only assigned products for merchants', async () => {
    const { app } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    expect(login.status).toBe(200);
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const list = await request()(app).get('/api/products').set('Cookie', cookies);
    expect(list.status).toBe(200);
    const ids = list.body.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(['p-a']);
  });

  it('merchant cannot PUT a product not assigned to them', async () => {
    const { app } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const r = await request()(app).put('/api/products/p-b').set('Cookie', cookies).send({ name: 'nope' });
    expect(r.status).toBe(403);
  });
});
