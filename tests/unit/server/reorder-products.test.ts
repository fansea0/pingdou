import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let tmp: string;

async function freshApp() {
  tmp = mkdtempSync(join(tmpdir(), 'reorder-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  const products = await import('../../../server/products.js');
  products.loadProductsCache();
  products.createProduct({ name: 'A', price: 100, description: '', url: '', image: '' });
  products.createProduct({ name: 'B', price: 200, description: '', url: '', image: '' });
  products.createProduct({ name: 'C', price: 300, description: '', url: '', image: '' });
  const { app } = await import('../../../server/index.js');
  return { app, db, products };
}

beforeEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('POST /api/admin/products/reorder', () => {
  it('requires admin auth (401 without cookie)', async () => {
    const { app } = await freshApp();
    const r = await request(app).post('/api/admin/products/reorder').send({ orderedIds: [1, 2, 3] });
    expect(r.status).toBe(401);
  });

  it('admin can reorder; writes 1..N to products."order"', async () => {
    const { app, db } = await freshApp();
    // login as root / 12345678
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ username: 'root', password: '12345678' });
    expect(login.status).toBe(200);
    // reverse order
    const ids = db.queryAll<{ id: number; order: number; name: string }>(
      `SELECT id, "order", name FROM products WHERE name IN ('A','B','C') ORDER BY id ASC`,
    );
    const orderedIds = ids.map(r => r.id).reverse();
    const r = await agent.post('/api/admin/products/reorder').send({ orderedIds });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const after = db.queryAll<{ name: string; order: number }>(
      `SELECT name, "order" FROM products WHERE name IN ('A','B','C') ORDER BY "order" ASC`,
    );
    expect(after.map(a => a.name)).toEqual(['C', 'B', 'A']);
  });

  it('rejects when orderedIds length mismatches product count', async () => {
    const { app } = await freshApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'root', password: '12345678' });
    const r = await agent.post('/api/admin/products/reorder').send({ orderedIds: [1, 2] });
    expect(r.status).toBe(400);
  });

  it('rejects when orderedIds contains unknown id', async () => {
    const { app } = await freshApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'root', password: '12345678' });
    const r = await agent.post('/api/admin/products/reorder').send({ orderedIds: [1, 2, 99999] });
    expect(r.status).toBe(400);
  });

  it('rejects when orderedIds contains duplicate', async () => {
    const { app } = await freshApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'root', password: '12345678' });
    const r = await agent.post('/api/admin/products/reorder').send({ orderedIds: [1, 1, 2] });
    expect(r.status).toBe(400);
  });
});
