import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let tmpdir_: string;
let requestMod: any;

async function buildAppFixture() {
  const base = tmpdir_;
  process.env.PINGDOU_DATA_DIR = base;
  mkdirSync(resolve(base, 'images'), { recursive: true });

  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();

  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  const merchant = users.createUser({ username: 'mike', password: 'pw1234', role: 'merchant', mustChangePassword: true });

  const products = await import('../../../server/products.js');
  // seed two products so the route can filter by assignment
  const now = Date.now();
  db.runStmt(
    `INSERT INTO products (name, image, price, description, url, "order", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['A', '', 100, '', '', 1, now, now],
  );
  db.runStmt(
    `INSERT INTO products (name, image, price, description, url, "order", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['B', '', 200, '', '', 2, now, now],
  );
  db.flushNow();
  products.loadProductsCache();
  const all = products.getAllProducts();
  const idA = all.find((p: { name: string }) => p.name === 'A')!.id;

  const assignments = await import('../../../server/assignments.js');
  assignments.reconcileAssignments(merchant.id, [idA]);

  const index = await import('../../../server/index.js');
  return { app: index.app, db, users, products, assignments, idA, idB: all.find((p: { name: string }) => p.name === 'B')!.id };
}

describe('auth route integration', () => {
  beforeEach(async () => {
    tmpdir_ = mkdtempSync(join(tmpdir(), 'routes-test-'));
    requestMod = await import('supertest');
  });

  afterEach(() => {
    if (tmpdir_ && existsSync(tmpdir_)) rmSync(tmpdir_, { recursive: true, force: true });
    delete process.env.PINGDOU_DATA_DIR;
  });

  const request = () => requestMod.default ?? requestMod;

  it('login → me → logout flow for the root admin', async () => {
    const { app } = await buildAppFixture();
    const agent = request().agent(app);
    const login = await agent.post('/api/auth/login').send({ username: 'root', password: '12345678' });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe('admin');
    expect(login.body.mustChangePassword).toBe(true);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('root');

    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);

    const meAgain = await agent.get('/api/auth/me');
    expect(meAgain.status).toBe(401);
  });

  it('login with default root/12345678 sets mustChangePassword=true', async () => {
    const { app } = await buildAppFixture();
    const r = await request()(app).post('/api/auth/login').send({ username: 'root', password: '12345678' });
    expect(r.status).toBe(200);
    expect(r.body.mustChangePassword).toBe(true);
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
    const { app, idA } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    expect(login.status).toBe(200);
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const list = await request()(app).get('/api/products').set('Cookie', cookies);
    expect(list.status).toBe(200);
    const ids = list.body.map((p: { id: number }) => p.id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([idA]);
  });

  it('merchant cannot PUT a product not assigned to them', async () => {
    const { app, idB } = await buildAppFixture();
    const login = await request()(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const r = await request()(app).put(`/api/products/${idB}`).set('Cookie', cookies).send({ name: 'nope' });
    expect(r.status).toBe(403);
  });
});
