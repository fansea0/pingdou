import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;
let origCwd: string;
let origEnv: string | undefined;

function fixture() {
  tmp = mkdtempSync(join(tmpdir(), 'products-test-'));
  origCwd = process.cwd();
  origEnv = process.env.PRODUCTS_JSON_PATH;
  process.chdir(tmp);
  const dataDir = join(tmp, 'public', 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'products.json'),
    JSON.stringify([
      { id: 'a', name: 'A', image: '', price: 1, currency: 'CNY', description: '', url: '' },
      { id: 'b', name: 'B', image: '', price: 2, currency: 'CNY', description: '', url: '' },
    ])
  );
  vi.resetModules();
}

function teardown() {
  process.chdir(origCwd);
  if (origEnv === undefined) delete process.env.PRODUCTS_JSON_PATH;
  else process.env.PRODUCTS_JSON_PATH = origEnv;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
}

beforeEach(fixture);
afterEach(teardown);

describe('products module', () => {
  it('loadProductsCache + getProductById work on first load', async () => {
    const { loadProductsCache, getProductById } = await import('../../../server/products.js');
    loadProductsCache();
    expect(getProductById('a')?.name).toBe('A');
    expect(getProductById('does-not-exist')).toBeNull();
  });

  it('updateProduct writes atomically and updates cache', async () => {
    const { loadProductsCache, updateProduct, getProductById } = await import('../../../server/products.js');
    loadProductsCache();
    updateProduct('a', { name: 'A renamed', price: 5 });
    const a = getProductById('a');
    expect(a?.name).toBe('A renamed');
    expect(a?.price).toBe(5);

    const onDisk = JSON.parse(readFileSync(join(tmp, 'public/data/products.json'), 'utf-8'));
    expect(onDisk.find((p: { id: string }) => p.id === 'a').name).toBe('A renamed');

    expect(existsSync(join(tmp, 'public/data/products.json.tmp'))).toBe(false);
  });

  it('createProduct + deleteProduct round-trip', async () => {
    const { loadProductsCache, createProduct, deleteProduct, getProductById } = await import('../../../server/products.js');
    loadProductsCache();
    createProduct({ id: 'c', name: 'C', image: '', price: 3, currency: 'CNY', description: '', url: '' });
    expect(getProductById('c')?.name).toBe('C');
    deleteProduct('c');
    expect(getProductById('c')).toBeNull();
  });

  it('deleteProduct throws on missing product', async () => {
    const { loadProductsCache, deleteProduct } = await import('../../../server/products.js');
    loadProductsCache();
    expect(() => deleteProduct('does-not-exist')).toThrow(/not found/i);
  });

  it('createProduct rejects an invalid id', async () => {
    const { loadProductsCache, createProduct } = await import('../../../server/products.js');
    loadProductsCache();
    expect(() => createProduct({ id: 'BAD ID!', name: 'X', image: '', price: 0, currency: 'CNY', description: '', url: '' })).toThrow(/invalid product id/i);
  });

  it('replaceProductImage writes a new image and updates the cache', async () => {
    const { loadProductsCache, replaceProductImage, getProductById } = await import('../../../server/products.js');
    loadProductsCache();
    mkdirSync(join(tmp, 'public/products'), { recursive: true });
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const updated = replaceProductImage('a', fakeJpeg, 'image/jpeg');
    expect(updated.image.startsWith('/products/a-')).toBe(true);
    expect(getProductById('a')?.image).toBe(updated.image);
    const filename = updated.image.slice('/products/'.length);
    expect(existsSync(join(tmp, 'public/products', filename))).toBe(true);
  });
});
