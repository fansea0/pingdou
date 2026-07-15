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

function productsJsonPath(): string {
  if (process.env.PRODUCTS_JSON_PATH) return resolve(process.env.PRODUCTS_JSON_PATH);
  return join(resolve(process.cwd(), 'public/data'), 'products.json');
}
function dataDir(): string {
  return resolve(productsJsonPath(), '..');
}
function productsDir(): string {
  if (process.env.PRODUCTS_IMAGES_DIR) return resolve(process.env.PRODUCTS_IMAGES_DIR);
  return resolve(process.cwd(), 'public/products');
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
  return ensureCache().map(p => ({ ...p }));
}

export function getProductById(id: string): Product | null {
  const p = ensureCache().find(x => x.id === id);
  return p ? { ...p } : null;
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
    image: input.image ?? '/products/placeholder.svg',
    price: input.price,
    currency: input.currency,
    description: input.description,
    url: input.url,
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
