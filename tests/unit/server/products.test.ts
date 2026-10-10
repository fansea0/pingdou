import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;
let origEnv: string | undefined;

async function freshFixture() {
  tmp = mkdtempSync(join(tmpdir(), 'products-test-'));
  origEnv = process.env.PINGDOU_DATA_DIR;
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();

  mkdirSync(join(tmp, 'images'), { recursive: true });

  const db = await import('../../../server/db.js');
  await db.initDb();
  // seed two products
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

  const products = await import('../../../server/products.js');
  products.loadProductsCache();
  return { db, products };
}

function teardown() {
  if (origEnv === undefined) delete process.env.PINGDOU_DATA_DIR;
  else process.env.PINGDOU_DATA_DIR = origEnv;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
}

beforeEach(() => { /* freshFixture called inside each test */ });
afterEach(teardown);

describe('products module', () => {
  it('loadProductsCache + getProductById work on first load', async () => {
    const { products } = await freshFixture();
    const all = products.getAllProducts();
    expect(all.find((p: any) => p.name === 'A')?.price).toBe(100);
    expect(all.find((p: any) => p.name === 'B')?.price).toBe(200);
    expect(products.getProductById(99999)).toBeNull();
  });

  it('updateProduct writes atomically and updates cache', async () => {
    const { products } = await freshFixture();
    const idA = products.getAllProducts().find((p: any) => p.name === 'A')!.id;
    products.updateProduct(idA, { name: 'A renamed', price: 500 });
    const a = products.getProductById(idA);
    expect(a?.name).toBe('A renamed');
    expect(a?.price).toBe(500);
    expect(products.getAllProducts().find((p: any) => p.id === idA)?.name).toBe('A renamed');
  });

  it('createProduct + deleteProduct round-trip', async () => {
    const { products } = await freshFixture();
    const created = products.createProduct({ name: 'C', price: 0, description: '', url: '' });
    expect(created.name).toBe('C');
    expect(products.getProductById(created.id)?.name).toBe('C');
    products.deleteProduct(created.id);
    expect(products.getProductById(created.id)).toBeNull();
  });

  it('deleteProduct throws on missing product', async () => {
    const { products } = await freshFixture();
    expect(() => products.deleteProduct(99999)).toThrow(/not found/i);
  });

  // 'createProduct rejects an invalid id' — deleted (id is auto-generated, invalid-id check N/A)

  it('replaceProductImage writes a new image and updates the cache', async () => {
    const { products } = await freshFixture();
    const idA = products.getAllProducts().find((p: any) => p.name === 'A')!.id;
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const updated = products.replaceProductImage(idA, fakeJpeg, 'image/jpeg');
    expect(updated.image).toMatch(new RegExp(`^/products/${idA}-[a-f0-9]+\\.jpg$`));
    expect(products.getProductById(idA)?.image).toBe(updated.image);
    const filename = updated.image.slice('/products/'.length);
    expect(existsSync(join(tmp, 'images', filename))).toBe(true);
  });

  it('createProduct rejects non-http(s) url', async () => {
    const { products } = await freshFixture();
    expect(() => products.createProduct({ name: 'D', price: 0, description: '', url: 'taobao.com/x' })).toThrow(/http/i);
    expect(() => products.createProduct({ name: 'E', price: 0, description: '', url: 'ftp://example.com' })).toThrow(/http/i);
  });

  it('createProduct accepts empty url (= no clickable link)', async () => {
    const { products } = await freshFixture();
    const p = products.createProduct({ name: 'F', price: 0, description: '', url: '' });
    expect(p.url).toBe('');
    expect(products.getProductById(p.id)?.url).toBe('');
  });

  it('updateProduct accepts empty url and normalizes https url', async () => {
    const { products } = await freshFixture();
    const idA = products.getAllProducts().find((p: any) => p.name === 'A')!.id;
    products.updateProduct(idA, { url: '' });
    expect(products.getProductById(idA)?.url).toBe('');
    products.updateProduct(idA, { url: 'https://example.com/x' });
    expect(products.getProductById(idA)?.url).toBe('https://example.com/x');
  });

  it('getAllProducts replaces missing images with default-product image', async () => {
    const { products } = await freshFixture();
    const all = products.getAllProducts();
    // fixture 里 image 都是 '' → 应被替换为 /static-data/default-product.png
    for (const p of all) {
      expect(p.image).toBe('/static-data/default-product.png');
    }
  });

  it('getAllProducts keeps valid /products/ image if file exists', async () => {
    const { db, products } = await freshFixture();
    // 先放一张图到 images/，再加一个商品指向它
    writeFileSync(join(tmp, 'images', 'sample.jpg'), Buffer.from([0xff, 0xd8]));
    const now = Date.now();
    db.runStmt(
      `INSERT INTO products (name, image, price, description, url, "order", created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['C', '/products/sample.jpg', 100, '', '', 3, now, now],
    );
    db.flushNow();
    products.loadProductsCache();
    const g = products.getAllProducts().find((p: any) => p.name === 'C');
    expect(g?.image).toBe('/products/sample.jpg');
  });
});
