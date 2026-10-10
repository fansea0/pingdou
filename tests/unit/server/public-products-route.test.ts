import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'public-products-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('GET /api/public/products', () => {
  it('returns 200 with empty array when no products exist', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const products = await import('../../../server/products.js');
    products.loadProductsCache();
    const { app } = await import('../../../server/index.js');

    const r = await request(app).get('/api/public/products');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('returns products sorted by order ASC, id ASC', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const now = Date.now();
    db.runStmt(
      `INSERT INTO products (name, image, price, description, url, "order", created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['Second', '', 100, '', '', 2, now, now],
    );
    db.runStmt(
      `INSERT INTO products (name, image, price, description, url, "order", created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['First', '', 200, '', '', 1, now, now],
    );
    const products = await import('../../../server/products.js');
    products.loadProductsCache();
    const { app } = await import('../../../server/index.js');

    const r = await request(app).get('/api/public/products');
    expect(r.status).toBe(200);
    expect(r.body.map((p: { name: string }) => p.name)).toEqual(['First', 'Second']);
  });

  it('does not require auth', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const products = await import('../../../server/products.js');
    products.loadProductsCache();
    const { app } = await import('../../../server/index.js');

    const r = await request(app).get('/api/public/products');
    expect(r.status).not.toBe(401);
  });
});
