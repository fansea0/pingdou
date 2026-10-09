import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;
let dataPath: string;
let imgDir: string;
let origEnvJson: string | undefined;
let origEnvImg: string | undefined;

function fixture() {
  tmp = mkdtempSync(join(tmpdir(), 'products-test-'));
  origEnvJson = process.env.PRODUCTS_JSON_PATH;
  origEnvImg = process.env.PRODUCTS_IMAGES_DIR;

  const dataDir = join(tmp, 'data');
  mkdirSync(dataDir, { recursive: true });
  dataPath = join(dataDir, 'products.json');
  imgDir = join(tmp, 'products');
  mkdirSync(imgDir, { recursive: true });

  writeFileSync(
    dataPath,
    JSON.stringify([
      { id: 'a', name: 'A', image: '', price: 1, currency: 'CNY', description: '', url: '' },
      { id: 'b', name: 'B', image: '', price: 2, currency: 'CNY', description: '', url: '' },
    ])
  );

  process.env.PRODUCTS_JSON_PATH = dataPath;
  process.env.PRODUCTS_IMAGES_DIR = imgDir;
  vi.resetModules();
}

function teardown() {
  if (origEnvJson === undefined) delete process.env.PRODUCTS_JSON_PATH;
  else process.env.PRODUCTS_JSON_PATH = origEnvJson;
  if (origEnvImg === undefined) delete process.env.PRODUCTS_IMAGES_DIR;
  else process.env.PRODUCTS_IMAGES_DIR = origEnvImg;
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

    const onDisk = JSON.parse(readFileSync(dataPath, 'utf-8'));
    expect(onDisk.find((p: { id: string }) => p.id === 'a').name).toBe('A renamed');

    expect(existsSync(`${dataPath}.tmp`)).toBe(false);
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
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const updated = replaceProductImage('a', fakeJpeg, 'image/jpeg');
    expect(updated.image.startsWith('/products/a-')).toBe(true);
    expect(getProductById('a')?.image).toBe(updated.image);
    const filename = updated.image.slice('/products/'.length);
    expect(existsSync(join(imgDir, filename))).toBe(true);
  });

  it('createProduct rejects non-http(s) url', async () => {
    const { loadProductsCache, createProduct } = await import('../../../server/products.js');
    loadProductsCache();
    expect(() => createProduct({ id: 'd', name: 'D', image: '', price: 0, currency: 'CNY', description: '', url: 'taobao.com/x' })).toThrow(/http/i);
    expect(() => createProduct({ id: 'e', name: 'E', image: '', price: 0, currency: 'CNY', description: '', url: 'ftp://example.com' })).toThrow(/http/i);
  });

  it('createProduct accepts empty url (= no clickable link)', async () => {
    const { loadProductsCache, createProduct, getProductById } = await import('../../../server/products.js');
    loadProductsCache();
    const p = createProduct({ id: 'f', name: 'F', image: '', price: 0, currency: 'CNY', description: '', url: '' });
    expect(p.url).toBe('');
    expect(getProductById('f')?.url).toBe('');
  });

  it('updateProduct accepts empty url and normalizes https url', async () => {
    const { loadProductsCache, updateProduct, getProductById } = await import('../../../server/products.js');
    loadProductsCache();
    updateProduct('a', { url: '' });
    expect(getProductById('a')?.url).toBe('');
    updateProduct('a', { url: 'https://example.com/x' });
    expect(getProductById('a')?.url).toBe('https://example.com/x');
  });

  it('getAllProducts replaces missing images with default-product image', async () => {
    const { loadProductsCache, getAllProducts } = await import('../../../server/products.js');
    loadProductsCache();
    const all = getAllProducts();
    // fixture 里 image 都是 '' → 应被替换为 /static-data/default-product.png
    for (const p of all) {
      expect(p.image).toBe('/static-data/default-product.png');
    }
  });

  it('getAllProducts keeps valid /products/ image if file exists', async () => {
    // 先放一张图到 imgDir，再让某个商品指向它
    writeFileSync(join(imgDir, 'sample.jpg'), Buffer.from([0xff, 0xd8]));
    // 在 fixture 的 products.json 里加一个商品
    const arr = JSON.parse(readFileSync(dataPath, 'utf-8'));
    arr.push({ id: 'g', image: '/products/sample.jpg', name: 'G', currency: 'CNY', price: 1, description: '', url: '' });
    writeFileSync(dataPath, JSON.stringify(arr));

    const { loadProductsCache, getAllProducts } = await import('../../../server/products.js');
    loadProductsCache();
    const g = getAllProducts().find(p => p.id === 'g');
    expect(g?.image).toBe('/products/sample.jpg');
  });
});