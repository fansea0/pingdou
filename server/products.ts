import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Product {
  id: string;
  name: string;
  image: string;
  price: number;
  currency: string;
  description: string;
  url: string;
  badge?: string;
}

export const DEFAULT_PRODUCT_IMAGE = '/static-data/default-product.png';

function productsJsonPath(): string {
  const p = process.env.PRODUCTS_JSON_PATH;
  if (!p) throw new Error('PRODUCTS_JSON_PATH env var is required');
  return resolve(p);
}
function dataDir(): string {
  return resolve(productsJsonPath(), '..');
}
function productsDir(): string {
  const p = process.env.PRODUCTS_IMAGES_DIR;
  if (!p) throw new Error('PRODUCTS_IMAGES_DIR env var is required');
  return resolve(p);
}

// 空值 / 路径指向文件不存在 → 返回 true（需要替换为默认图）
function isImageMissing(imageUrl: string): boolean {
  if (!imageUrl) return true;
  // 仅检查以 /products/ 开头的本地文件；外部 URL、default-image、其他不检查
  if (!imageUrl.startsWith('/products/')) return false;
  const filename = imageUrl.slice('/products/'.length);
  if (!filename || filename.includes('..') || filename.includes('/')) return true;
  try {
    return !existsSync(join(productsDir(), filename));
  } catch {
    // productsDir() 必填校验抛错时，保守当作"缺失"
    return true;
  }
}

// 校验 URL：空字符串允许（表示不跳转），非空必须是 http(s) URL
function normalizeProductUrl(url: unknown): string {
  if (typeof url !== 'string') throw new Error('url must be a string');
  if (url === '') return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('url must start with http:// or https://');
    }
  } catch {
    // new URL 抛错（缺协议头、非法字符等）也归到这一类
    throw new Error('url must start with http:// or https://');
  }
  return url;
}

let cache: Product[] | null = null;

export function loadProductsCache(): Product[] {
  const path = productsJsonPath();
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as Product[];
  cache = parsed;
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

export function getProductById(id: string): Product | null {
  const p = ensureCache().find(x => x.id === id);
  if (!p) return null;
  return { ...p, image: isImageMissing(p.image) ? DEFAULT_PRODUCT_IMAGE : p.image };
}

function writeAtomic(products: Product[]): void {
  mkdirSync(dataDir(), { recursive: true });
  const finalPath = productsJsonPath();
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(products, null, 2), 'utf-8');
  renameSync(tmpPath, finalPath);
  cache = products;
}

export function updateProduct(id: string, patch: Partial<Omit<Product, 'id'>>): Product {
  const list = ensureCache();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('product not found');
  if (typeof patch.url === 'string') {
    patch.url = normalizeProductUrl(patch.url);
  }
  const next = { ...list[idx], ...patch, id };
  list[idx] = next;
  writeAtomic(list);
  return { ...next };
}

export function createProduct(input: Omit<Product, 'image'> & { image?: string }): Product {
  const list = ensureCache();
  if (!/^[a-z0-9-]+$/.test(input.id)) throw new Error('invalid product id');
  if (list.find(p => p.id === input.id)) throw new Error('product id already exists');
  const product: Product = {
    id: input.id,
    name: input.name,
    image: input.image ?? DEFAULT_PRODUCT_IMAGE,
    price: input.price,
    currency: input.currency,
    description: input.description,
    url: normalizeProductUrl(input.url),
    badge: input.badge,
  };
  list.push(product);
  writeAtomic(list);
  return { ...product };
}

export function deleteProduct(id: string): void {
  const list = ensureCache();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('product not found');
  const removed = list[idx];
  list.splice(idx, 1);
  writeAtomic(list);
  try {
    if (removed.image && removed.image.startsWith('/products/')) {
      const onDisk = join(productsDir(), removed.image.slice('/products/'.length));
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

export function saveImageFile(productId: string, buffer: Buffer, mime: string): SavedImage {
  const ext = IMG_EXTS[mime];
  if (!ext) throw new Error('unsupported image mime type');
  mkdirSync(productsDir(), { recursive: true });
  const filename = `${productId}-${randomBytes(6).toString('hex')}${ext}`;
  const finalPath = join(productsDir(), filename);
  writeFileSync(finalPath, buffer);
  return { image: `/products/${filename}` };
}

export function removeOldImageFile(imagePath: string): void {
  try {
    if (!imagePath || !imagePath.startsWith('/products/')) return;
    const onDisk = join(productsDir(), imagePath.slice('/products/'.length));
    if (existsSync(onDisk) && statSync(onDisk).isFile()) unlinkSync(onDisk);
  } catch (e) {
    console.warn('[products] failed to remove old image file', e);
  }
}

export function replaceProductImage(productId: string, buffer: Buffer, mime: string): Product {
  const product = getProductById(productId);
  if (!product) throw new Error('product not found');
  const { image } = saveImageFile(productId, buffer, mime);
  const oldImage = product.image;
  const updated = updateProduct(productId, { image });
  if (oldImage && oldImage !== image) removeOldImageFile(oldImage);
  return updated;
}
