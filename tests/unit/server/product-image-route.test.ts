import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'product-image-route-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

async function bootApp() {
  const db = await import('../../../server/db.js');
  await db.initDb();
  const products = await import('../../../server/products.js');
  products.loadProductsCache();
  const paths = await import('../../../server/paths.js');
  const { app } = await import('../../../server/index.js');
  return { app, paths, db, products };
}

describe('GET /products/:filename', () => {
  it('serves a valid image file with 200 and correct mime', async () => {
    const { app, paths } = await bootApp();
    mkdirSync(paths.PATHS.imagesDir, { recursive: true });
    // 文件名必须匹配 PRODUCT_IMAGE_FILENAME_RE：<id>-<hex>.<ext>
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    writeFileSync(join(paths.PATHS.imagesDir, '1-aabbcc.png'), buf);

    const r = await request(app).get('/products/1-aabbcc.png');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/image\/png/);
    expect(r.body).toEqual(buf);
  });

  it('returns 404 when the file does not exist on disk', async () => {
    const { app, paths } = await bootApp();
    mkdirSync(paths.PATHS.imagesDir, { recursive: true });

    const r = await request(app).get('/products/1-deadbe.png');
    expect(r.status).toBe(404);
  });

  it('rejects filenames containing path traversal segments', async () => {
    const { app } = await bootApp();
    // supertest 把 ../ 编码成 ..%2F；这里直接打带 .. 的，看后端是否拒
    const r = await request(app).get('/products/..%2Fetc%2Fpasswd.png');
    expect(r.status).toBe(400);
  });

  it('rejects filenames that do not match the expected shape', async () => {
    const { app } = await bootApp();
    expect((await request(app).get('/products/not-a-valid-name')).status).toBe(400);
    expect((await request(app).get('/products/foo.txt')).status).toBe(400);
  });

  it('does not require auth', async () => {
    const { app, paths } = await bootApp();
    mkdirSync(paths.PATHS.imagesDir, { recursive: true });
    writeFileSync(join(paths.PATHS.imagesDir, '2-abcdef.jpg'), Buffer.from('jpeg'));

    const r = await request(app).get('/products/2-abcdef.jpg');
    expect(r.status).not.toBe(401);
  });
});