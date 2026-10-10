import { existsSync, mkdirSync, unlinkSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PATHS } from './paths.js';
import { queryAll, runStmt, runInTransaction, flushNow } from './db.js';

export const DEFAULT_PRODUCT_IMAGE = '/static-data/default-product.png';

export interface Product {
  id: number;
  name: string;
  image: string;
  price: number;        // 单位：分
  description: string;
  url: string;
  badge?: string;
  order: number;
}

const PRODUCT_IMAGE_RE = /^\/products\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/;

function normalizeProductImage(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('image must be a string');
  if (raw === '') return '';
  if (!PRODUCT_IMAGE_RE.test(raw)) {
    throw new Error('image must be empty or match /products/<file>.(jpg|jpeg|png|webp)');
  }
  return raw;
}

function normalizeProductUrl(url: unknown): string {
  if (typeof url !== 'string') throw new Error('url must be a string');
  if (url === '') return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('url must start with http:// or https://');
    }
  } catch {
    throw new Error('url must start with http:// or https://');
  }
  return url;
}

function isImageMissing(imageUrl: string): boolean {
  if (!imageUrl) return true;
  if (!imageUrl.startsWith('/products/')) return false;
  const filename = imageUrl.slice('/products/'.length);
  if (!filename || filename.includes('..') || filename.includes('/')) return true;
  try {
    return !existsSync(join(PATHS.imagesDir, filename));
  } catch {
    return true;
  }
}

function rowToProduct(row: Record<string, unknown>): Product {
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    image: String(row.image ?? ''),
    price: Number(row.price ?? 0),
    description: String(row.description ?? ''),
    url: String(row.url ?? ''),
    badge: row.badge == null ? undefined : String(row.badge),
    order: Number(row.order ?? 1),
  };
}

let cache: Product[] | null = null;

export function loadProductsCache(): Product[] {
  const rows = queryAll<Record<string, unknown>>(
    `SELECT * FROM products ORDER BY "order" ASC, id ASC`,
  );
  cache = rows.map(rowToProduct);
  return cache;
}

function ensureCache(): Product[] {
  if (!cache) loadProductsCache();
  return cache!;
}

export function getAllProducts(): Product[] {
  return ensureCache().map(p => ({
    ...p,
    image: isImageMissing(p.image) ? DEFAULT_PRODUCT_IMAGE : p.image,
  }));
}

export function getProductById(id: number): Product | null {
  const p = ensureCache().find(x => x.id === id);
  if (!p) return null;
  return { ...p, image: isImageMissing(p.image) ? DEFAULT_PRODUCT_IMAGE : p.image };
}

export function createProduct(input: Omit<Product, 'id' | 'order' | 'image'> & { image?: string }): Product {
  const list = ensureCache();
  const nextOrder = list.reduce((m, p) => Math.max(m, p.order), 0) + 1;

  const image = normalizeProductImage(input.image ?? '');
  const url = normalizeProductUrl(input.url);
  const now = Date.now();

  runStmt(
    `INSERT INTO products (name, image, price, description, url, badge, "order", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.name, image, input.price, input.description, url, input.badge ?? null, nextOrder, now, now],
  );

  const refreshed = loadProductsCache();
  const created = refreshed.find(p => p.order === nextOrder && p.name === input.name);
  if (!created) throw new Error('createProduct: missing after insert');
  flushNow();
  return { ...created };
}

export function updateProduct(id: number, patch: Partial<Omit<Product, 'id'>>): Product {
  const list = ensureCache();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('product not found');

  const old = list[idx];
  const next: Product = { ...old };

  if (typeof patch.name === 'string') next.name = patch.name;
  if (typeof patch.description === 'string') next.description = patch.description;
  if (typeof patch.price === 'number') next.price = patch.price;
  if (typeof patch.url === 'string') next.url = normalizeProductUrl(patch.url);
  if (typeof patch.image === 'string') next.image = normalizeProductImage(patch.image);
  if (patch.badge === null) next.badge = undefined;
  else if (typeof patch.badge === 'string') next.badge = patch.badge;
  // NOTE: order cannot be patched here — use reorderProducts
  if (typeof patch.order === 'number') {
    throw new Error('order cannot be changed via updateProduct; use /api/admin/products/reorder');
  }

  next.id = id;
  const now = Date.now();
  next.order = old.order;

  runStmt(
    `UPDATE products SET name=?, image=?, price=?, description=?, url=?, badge=?, updated_at=? WHERE id=?`,
    [next.name, next.image, next.price, next.description, next.url, next.badge ?? null, now, id],
  );

  // image 字段值变了 + 旧值是 /products/... + 新旧不同 → 删旧文件
  if (
    typeof patch.image === 'string' &&
    old.image !== patch.image &&
    old.image.startsWith('/products/')
  ) {
    removeOldImageFile(old.image);
  }

  list[idx] = next;
  flushNow();
  return { ...next };
}

export function deleteProduct(id: number): void {
  const list = ensureCache();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('product not found');
  const removed = list[idx];
  list.splice(idx, 1);
  runStmt(`DELETE FROM products WHERE id=?`, [id]);
  flushNow();
  try {
    if (removed.image && removed.image.startsWith('/products/')) {
      const onDisk = join(PATHS.imagesDir, removed.image.slice('/products/'.length));
      if (existsSync(onDisk) && statSync(onDisk).isFile()) unlinkSync(onDisk);
    }
  } catch (e) {
    console.warn('[products] failed to remove image file', e);
  }
}

const IMG_EXTS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export interface SavedImage { image: string; }

export function saveImageFile(productId: number, buffer: Buffer, mime: string): SavedImage {
  const ext = IMG_EXTS[mime];
  if (!ext) throw new Error('unsupported image mime type');
  mkdirSync(PATHS.imagesDir, { recursive: true });
  const filename = `${productId}-${randomBytes(6).toString('hex')}${ext}`;
  const finalPath = join(PATHS.imagesDir, filename);
  writeFileSync(finalPath, buffer);
  return { image: `/products/${filename}` };
}

export function removeOldImageFile(imagePath: string): void {
  try {
    if (!imagePath || !imagePath.startsWith('/products/')) return;
    const onDisk = join(PATHS.imagesDir, imagePath.slice('/products/'.length));
    if (existsSync(onDisk) && statSync(onDisk).isFile()) unlinkSync(onDisk);
  } catch (e) {
    console.warn('[products] failed to remove old image file', e);
  }
}

export function replaceProductImage(productId: number, buffer: Buffer, mime: string): Product {
  const product = getProductById(productId);
  if (!product) throw new Error('product not found');
  const { image } = saveImageFile(productId, buffer, mime);
  const oldImage = product.image;
  const updated = updateProduct(productId, { image });
  if (oldImage && oldImage !== image) removeOldImageFile(oldImage);
  return updated;
}

export function cleanupOrphanImages(): { removed: string[] } {
  const referenced = new Set(
    getAllProducts()
      .map(p => p.image)
      .filter(u => u.startsWith('/products/'))
      .map(u => u.slice('/products/'.length)),
  );
  const onDisk = readdirSync(PATHS.imagesDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  const removed: string[] = [];
  for (const file of onDisk) {
    if (!referenced.has(file)) {
      try {
        unlinkSync(join(PATHS.imagesDir, file));
        removed.push(file);
      } catch (e) {
        console.warn('[products] failed to remove orphan image', file, e);
      }
    }
  }
  if (removed.length > 0) {
    console.warn(`[products] cleanupOrphanImages removed ${removed.length} orphan file(s)`);
  }
  return { removed };
}

export function reorderProducts(orderedIds: number[]): Product[] {
  if (orderedIds.length === 0) return [];
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error('orderedIds must be unique');
  }
  const current = getAllProducts();
  if (orderedIds.length !== current.length) {
    throw new Error(
      `orderedIds length (${orderedIds.length}) must equal current product count (${current.length})`,
    );
  }
  const knownIds = new Set(current.map(p => p.id));
  for (const id of orderedIds) {
    if (!knownIds.has(id)) throw new Error(`unknown product id: ${id}`);
  }
  const now = Date.now();
  runInTransaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      runStmt(
        `UPDATE products SET "order" = ?, updated_at = ? WHERE id = ?`,
        [i + 1, now, orderedIds[i]],
      );
    }
  });
  cache = null;
  ensureCache();
  flushNow();
  return getAllProducts();
}
