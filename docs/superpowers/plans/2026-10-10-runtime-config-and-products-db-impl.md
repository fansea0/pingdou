# Runtime config consolidation + products DB + default root password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-required-env (3 paths + ROOT_PASSWORD) runtime configuration with a single `PINGDOU_DATA_DIR` env. Move products from a JSON file into a SQLite table (`sql.js`) with proper image lifecycle guarantees. Remove the `ROOT_PASSWORD` env in favor of a hardcoded `12345678` default that the user must change on first login.

**Architecture:** Stand up a `products` SQLite table on top of the existing `sql.js` engine (already running `events / sessions / users / auth_tokens / settings / product_assignments`). Introduce a thin `server/paths.ts` that derives every runtime path from `PINGDOU_DATA_DIR`. Rewrite `server/products.ts` keeping its external API shape identical but swapping file I/O for SQL. Add two new server functions: `cleanupOrphanImages` (startup sweep) and `reorderProducts` (transactional re-write of `1..N`). Mount two new routes: `GET /api/public/products` (anonymous) and `POST /api/admin/products/reorder` (admin only). Frontend `useProducts` now hits the new endpoint; admin `ProductsTab` gets HTML5 drag-and-drop plus a manual order input; price flows as integer cents everywhere on the wire (display `÷100`, form input `×100` on submit).

**Tech Stack:** Express 5, sql.js (existing), Node `fs`, React 18, TypeScript, Vitest (jsdom + node), @testing-library/react, native CSS, native HTML5 drag-and-drop.

**Reference Spec:** `docs/superpowers/specs/2026-10-10-runtime-config-and-products-db-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `server/paths.ts` | Create | Derive `PATHS.{dataDir,imagesDir,dbPath}` from `PINGDOU_DATA_DIR`; fail-fast if missing |
| `server/db.ts` | Modify | Replace `STATS_DB_PATH` env read with `PATHS.dbPath`; add `products` table; change `product_assignments.product_id` to INTEGER FK |
| `server/users.ts` | Modify | `seedDefaultAdminIfEmpty`: hardcoded password `'12345678'`, `mustChangePassword: true`; remove `ROOT_PASSWORD` env read |
| `server/products.ts` | Rewrite | Keep `Product` interface (now `id: number`, `price` cents, no `currency`); swap file I/O for SQL via `queryAll`/`runStmt`; add `cleanupOrphanImages` + `reorderProducts` |
| `server/index.ts` | Modify | `assertRuntimePaths` simplified; mount `GET /api/public/products` + `POST /api/admin/products/reorder`; `start()` calls `cleanupOrphanImages` after `loadProductsCache` |
| `scripts/deploy-server.sh` | Modify | Replace 3 env checks with `PINGDOU_DATA_DIR`; add WARN if old env keys still present; mkdir only `images/` (not `data/`) |
| `docs/DEPLOY.md` | Modify | Update systemd env example; remove `data/`-related lines; add "首次登录流程" section |
| `.env.example` | Rewrite | Only `PINGDOU_DATA_DIR` (required) + PORT / IP_HASH_SALT / NODE_ENV (optional) |
| `.env` | Rewrite | Same as `.env.example` (locally; prod uses `/etc/pingdou-backend.env`) |
| `src/types.ts` | Modify | `Product.id: number`; drop `currency`; add `order: number` |
| `src/api/products.ts` | Modify | Drop `currency`; add `adminReorderProducts` |
| `src/hooks/useProducts.ts` | Modify | `fetch('/api/public/products')` |
| `src/components/ProductShowcase.tsx` | Modify | `¥{(price / 100).toFixed(2)}` |
| `src/pages/admin/ProductsTab.tsx` | Modify | Drag handle + manual order input (admin only); price form yuan → cents on submit |
| `src/pages/merchant/MerchantDashboard.tsx` | Modify | Price input yuan → cents on submit; no order control |
| `src/components/ProductEditModal.tsx` | Modify | Price input yuan → cents on submit |
| `tests/unit/server/paths.test.ts` | Create | `PATHS` derivation; fail-fast when env missing |
| `tests/unit/server/db-helpers.test.ts` | Modify | env uses `PINGDOU_DATA_DIR`; assert `products` table exists |
| `tests/unit/server/products.test.ts` | Rewrite | Fixture uses `runStmt` to seed `products` table; full API coverage |
| `tests/unit/server/products-image-validation.test.ts` | Create | `normalizeProductImage`: rejects `/etc/passwd`/abs paths/non-allowed schemes; accepts `/products/x.jpg` |
| `tests/unit/server/cleanup-orphan-images.test.ts` | Create | Removes unreferenced files; keeps referenced; ignores non-images |
| `tests/unit/server/reorder-products.test.ts` | Create | reorder commits; rejects length mismatch / unknown id / duplicates |
| `tests/unit/server/users.test.ts` | Modify | Drop 3 `ROOT_PASSWORD` tests; update seed tests for new default password |
| `tests/unit/server/seed-default-admin.test.ts` | Create | Empty users → seed root/12345678/mustChange=true; non-empty noop; idempotent |
| `tests/unit/server/public-products-route.test.ts` | Create | Anonymous returns sorted list with default-image fallback |
| `tests/unit/server/routes-auth.test.ts` | Modify | env uses `PINGDOU_DATA_DIR`; add `login root/12345678 → me mustChangePassword=true` |
| `tests/unit/server/routes-settings.test.ts` | Modify | env uses `PINGDOU_DATA_DIR` |
| `src/hooks/useProducts.test.ts` | Modify | mock URL = `/api/public/products` |
| `src/components/ProductShowcase.test.tsx` | Modify | Assert price display `¥99.00` when `price: 9900` |
| `src/pages/admin/ProductsTab.test.tsx` | Modify | Assert `adminReorderProducts` called on drag end |
| `src/components/ProductEditModal.test.tsx` | Modify | Assert PUT body sends cents, accepts yuan input |

---

## Task 1: Feature branch + create `server/paths.ts`

**Files:**
- Create: `server/paths.ts`
- Modify: `.env.example`
- Modify: `.env`
- Create: `tests/unit/server/paths.test.ts`

- [ ] **Step 1: Branch**

```bash
cd /Users/Admin/code/pingdou
git checkout -b feature/runtime-config-and-products-db
```

Expected: `Switched to a new branch 'feature/runtime-config-and-products-db'`

- [ ] **Step 2: Write failing test for `server/paths.ts`**

Create `tests/unit/server/paths.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ORIG = process.env.PINGDOU_DATA_DIR;

beforeEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  vi.resetModules();
});

afterEach(() => {
  if (ORIG === undefined) delete process.env.PINGDOU_DATA_DIR;
  else process.env.PINGDOU_DATA_DIR = ORIG;
});

describe('PATHS', () => {
  it('throws when PINGDOU_DATA_DIR is missing', async () => {
    await expect(import('../../../server/paths.js?throw=1')).rejects.toThrow(
      /PINGDOU_DATA_DIR env var is required/,
    );
  });

  it('derives imagesDir and dbPath from PINGDOU_DATA_DIR', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'paths-test-'));
    try {
      process.env.PINGDOU_DATA_DIR = tmp;
      const { PATHS } = await import('../../../server/paths.js?ok=1');
      expect(PATHS.dataDir).toBe(resolve(tmp));
      expect(PATHS.imagesDir).toBe(join(resolve(tmp), 'images'));
      expect(PATHS.dbPath).toBe(join(resolve(tmp), 'stats.db'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

Run: `npx vitest run tests/unit/server/paths.test.ts`
Expected: FAIL — `Cannot find module '../../../server/paths.js'`.

- [ ] **Step 4: Implement `server/paths.ts`**

Create `server/paths.ts`:

```ts
import { resolve, join } from 'node:path';

const RAW = process.env.PINGDOU_DATA_DIR;
if (!RAW) {
  throw new Error(
    'PINGDOU_DATA_DIR env var is required (e.g. /var/lib/pingdou)\n' +
    '本地开发：先跑 npm run dev:init；生产部署：见 docs/DEPLOY.md 的「运行时数据管理」一节',
  );
}

const DATA_DIR = resolve(RAW);

export const PATHS = {
  dataDir: DATA_DIR,
  imagesDir: join(DATA_DIR, 'images'),
  dbPath: join(DATA_DIR, 'stats.db'),
} as const;
```

- [ ] **Step 5: Run test, expect PASS**

Run: `npx vitest run tests/unit/server/paths.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Rewrite `.env.example`**

Replace the entire content of `.env.example` with:

```bash
# ============================================================
#  pingdou-backend 启动必填环境变量
# ============================================================

# 运行时数据根目录（首次部署必须显式设置）
# 包含 images/ 和 stats.db，由 PINGDOU_DATA_DIR 派生：
#   - images: 商品图片（admin 上传）
#   - stats.db: SQLite（含 users / auth_tokens / settings / events / sessions / assignments / products）
PINGDOU_DATA_DIR=/var/lib/pingdou

# ============================================================
#  可选环境变量
# ============================================================

# 服务端口（默认 3000；生产环境用 systemd / nginx 反代到 80 / 443）
# PORT=3000

# IP 哈希盐（同一盐下不同 IP 哈希稳定，便于跨重启跟踪 UV）
# 未设置则启动时自动生成随机盐
# IP_HASH_SALT=your-fixed-salt

# 生产环境标记（影响 cookie secure 属性）
# NODE_ENV=production
```

- [ ] **Step 7: Rewrite `.env`**

Replace `.env` with:

```
PINGDOU_DATA_DIR=/var/lib/pingdou
NODE_ENV=production
```

- [ ] **Step 8: Commit**

```bash
git add server/paths.ts tests/unit/server/paths.test.ts .env.example .env
git commit -m "feat(paths): 单一 PINGDOU_DATA_DIR 派生 imagesDir + dbPath"
```

---

## Task 2: `server/db.ts` — switch to PATHS + add `products` table + change `product_assignments.product_id`

**Files:**
- Modify: `server/db.ts` (top env read; `db.exec` block; nothing else)
- Modify: `tests/unit/server/db-helpers.test.ts` (env fixture)

- [ ] **Step 1: Update test fixture to use `PINGDOU_DATA_DIR`**

In `tests/unit/server/db-helpers.test.ts`, replace every `process.env.STATS_DB_PATH` (in setup helpers and `beforeEach`) with code that derives from `PINGDOU_DATA_DIR`:

```ts
import { join } from 'node:path';
// in fixture helpers:
const dir = process.env.PINGDOU_DATA_DIR!;
process.env.STATS_DB_PATH = join(dir, 'stats.db');  // legacy alias for old db.ts behavior
```

Actually — the simpler approach is: **just delete the `STATS_DB_PATH` line** from the fixture, since `server/db.ts` will now import from `paths.ts`. Add the new `PINGDOU_DATA_DIR` env line at the top of `beforeEach`:

```ts
beforeEach(() => {
  process.env.PINGDOU_DATA_DIR = join(tmpdir(), `db-helpers-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  vi.resetModules();
});
```

And drop every `process.env.STATS_DB_PATH = ...` assignment elsewhere in the file. Keep all `delete process.env.STATS_DB_PATH` cleanup lines (they become harmless no-ops).

- [ ] **Step 2: Add `products` table to the failure-assertion test**

In the same file, find the `it('creates users / product_assignments / auth_tokens tables after initDb', ...)` test (or the first test that asserts table names). Append a new assertion line inside it:

```ts
expect(names).toContain('products');
```

- [ ] **Step 3: Run test, expect FAIL**

Run: `npx vitest run tests/unit/server/db-helpers.test.ts`
Expected: FAIL on the new `expect(names).toContain('products')` line.

- [ ] **Step 4: Modify `server/db.ts`**

Three edits in `server/db.ts`:

**Edit A — replace env read at top** (lines ~5–8):

```ts
// before:
const DB_PATH_RAW = process.env.STATS_DB_PATH;
if (!DB_PATH_RAW) throw new Error('STATS_DB_PATH env var is required');
const DB_PATH = resolve(DB_PATH_RAW);

// after:
import { PATHS } from './paths.js';
const DB_PATH = PATHS.dbPath;
```

(Place the `import { PATHS } from './paths.js';` at the top of the file alongside the other imports.)

**Edit B — add the `products` table** inside the existing `db.exec(\`...\`)` call (after the `product_assignments` block, before `auth_tokens`):

```sql
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL DEFAULT '',
      image       TEXT    NOT NULL DEFAULT '',
      price       INTEGER NOT NULL DEFAULT 0,
      description TEXT    NOT NULL DEFAULT '',
      url         TEXT    NOT NULL DEFAULT '',
      badge       TEXT,
      "order"     INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      CHECK ("order" >= 1)
    );
    CREATE INDEX IF NOT EXISTS idx_products_order ON products("order");
```

**Edit C — change `product_assignments.product_id`** from `TEXT NOT NULL` to:

```sql
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
```

- [ ] **Step 5: Run test, expect PASS**

Run: `npx vitest run tests/unit/server/db-helpers.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Run full suite to confirm no regression**

Run: `npm test`
Expected: every previously-green test still green. (Other tests that use `STATS_DB_PATH` env directly will fail at setup — fix in Task 3 / Task 5 as we get there, OR right now if you want to be tidy.)

Actually do NOT fix other tests yet — they belong to other tasks. Note any in passing and move on.

- [ ] **Step 7: Commit**

```bash
git add server/db.ts tests/unit/server/db-helpers.test.ts
git commit -m "feat(db): 切到 PATHS.dbPath；新增 products 表；assignments.product_id 改 INTEGER FK"
```

---

## Task 3: Rewrite `server/products.ts` (file I/O → SQL)

**Files:**
- Modify: `server/products.ts` (full rewrite of internals; external API stays)
- Rewrite: `tests/unit/server/products.test.ts` (fixture: no more JSON file)

- [ ] **Step 1: Rewrite the products test fixture**

Replace `tests/unit/server/products.test.ts` with a new version that uses `initDb` + `runStmt` to seed products instead of writing a JSON file. Keep all the same test names and assertions. Skeleton:

```ts
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
    `INSERT INTO products (id, name, image, price, description, url, "order", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['placeholder', 'ignored', '', 0, '', '', 99, now, now],
  );
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
    // AUTOINCREMENT id of first inserted row is 1 (the placeholder got id 1 because we inserted 'placeholder' explicitly... actually no: explicit text id goes to that; next inserts get 2, 3)
    // Simpler: just look up by name
    const all = products.getAllProducts();
    expect(all.find((p: any) => p.name === 'A')?.price).toBe(100);
    expect(all.find((p: any) => p.name === 'B')?.price).toBe(200);
    expect(products.getProductById(99999)).toBeNull();
  });

  // …rest of the test file follows the same fixture pattern.
  // Convert every test to: call freshFixture(), use products.getAllProducts()/getProductById()/createProduct()/updateProduct()/deleteProduct()/replaceProductImage().
  // Replace string ids like 'a'/'b' with numeric ids obtained from the seed (e.g. all[0].id, all[1].id).
  // Replace price `1` / `2` with `100` / `200` (cents).
  // Remove `id` field from createProduct input (id is now auto-generated).
});
```

To save space in the plan, only the fixture + first test are spelled out above. Apply the same pattern to all existing tests in the original file:

- `loadProductsCache + getProductById work on first load` — convert as above
- `updateProduct writes atomically and updates cache` — remove the `readFileSync` assertion (no more JSON on disk); assert via `getProductById` + `getAllProducts` only
- `createProduct + deleteProduct round-trip` — drop the `id: 'c'` input field; assert by reading back the inserted row's id
- `deleteProduct throws on missing product` — keep, just update import path
- `createProduct rejects an invalid id` — **delete this test** (no longer applicable: id is auto-generated, can't pass invalid id)
- `replaceProductImage writes a new image and updates the cache` — update filename regex to expect `${id}-<hex>.jpg` (still `${productId}-${randomBytes(6).toString('hex')}${ext}`)
- `createProduct rejects non-http(s) url` — keep, still validates url field
- `createProduct accepts empty url` — keep
- `updateProduct accepts empty url and normalizes https url` — keep, price is now int cents
- `getAllProducts replaces missing images with default-product image` — keep (uses DEFAULT_PRODUCT_IMAGE fallback)
- `getAllProducts keeps valid /products/ image if file exists` — update: use the products module's `loadProductsCache` after inserting an image file + adding a new product via `runStmt`

- [ ] **Step 2: Run rewritten tests, expect FAIL**

Run: `npx vitest run tests/unit/server/products.test.ts`
Expected: most tests FAIL — old `products.ts` still reads JSON file, `getProductById('a')` returns null because ids are now numeric.

- [ ] **Step 3: Rewrite `server/products.ts`**

Replace the entire content of `server/products.ts` with:

```ts
import { existsSync, mkdirSync, unlinkSync, statSync, readdirSync } from 'node:fs';
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

export function createProduct(input: Omit<Product, 'id' | 'order'> & { image?: string }): Product {
  const list = ensureCache();
  const nextOrder = list.reduce((m, p) => Math.max(m, p.order), 0) + 1;

  const image = normalizeProductImage(input.image ?? DEFAULT_PRODUCT_IMAGE);
  const url = normalizeProductUrl(input.url);
  const now = Date.now();

  runStmt(
    `INSERT INTO products (name, image, price, description, url, badge, "order", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.name, image, input.price, input.description, url, input.badge ?? null, nextOrder, now, now],
  );

  const created = getAllProducts().find(p => p.order === nextOrder && p.name === input.name);
  if (!created) throw new Error('createProduct: missing after insert');
  list.push(created);
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
  require('node:fs').writeFileSync(finalPath, buffer);
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
```

- [ ] **Step 4: Run rewritten tests, expect PASS**

Run: `npx vitest run tests/unit/server/products.test.ts`
Expected: all tests in the rewritten file pass.

- [ ] **Step 5: Run typecheck to catch stray imports**

Run: `npm run typecheck`
Expected: 0 errors. If `runInTransaction` isn't exported from `db.ts`, add it as per Task 2 — the helper signature is `runInTransaction<T>(fn: () => T): T`.

- [ ] **Step 6: Commit**

```bash
git add server/products.ts tests/unit/server/products.test.ts
git commit -m "feat(products): JSON 文件 → SQLite 表；加 cleanupOrphanImages + reorderProducts"
```

---

## Task 4: `server/users.ts` — hardcoded seed password, drop `ROOT_PASSWORD`

**Files:**
- Modify: `server/users.ts` (replace `seedDefaultAdminIfEmpty` body)
- Modify: `tests/unit/server/users.test.ts` (drop ROOT_PASSWORD tests; update seed tests)
- Create: `tests/unit/server/seed-default-admin.test.ts`

- [ ] **Step 1: Update `tests/unit/server/users.test.ts`**

In `tests/unit/server/users.test.ts`, remove these three tests entirely:
- `seedDefaultAdminIfEmpty throws when ROOT_PASSWORD is missing`
- `seedDefaultAdminIfEmpty throws when ROOT_PASSWORD is too short`
- `seedDefaultAdminIfEmpty is no-op when ROOT_PASSWORD missing but users already exist`

In the file's `freshDb()` helper, remove the `process.env.ROOT_PASSWORD = ...` line and the `origSeedPw` variable + its restore logic in `cleanup()`. Replace with: do nothing (no env setup needed for users tests anymore).

In the existing `seedDefaultAdminIfEmpty inserts root once and is idempotent` test, change `expect(root?.expiresAt).toBeNull();` to ALSO assert:
- `expect(root?.mustChangePassword).toBe(1);`

In the existing `seedDefaultAdminIfEmpty does nothing when another user exists` test, drop the `delete process.env.ROOT_PASSWORD;` line (no longer relevant).

- [ ] **Step 2: Create `tests/unit/server/seed-default-admin.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'seed-test-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('seedDefaultAdminIfEmpty', () => {
  it('seeds root/12345678/mustChangePassword=true on empty users table', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { seedDefaultAdminIfEmpty, getUserByUsername } = await import('../../../server/users.js');
    seedDefaultAdminIfEmpty();
    const root = getUserByUsername('root');
    expect(root).not.toBeNull();
    expect(root!.role).toBe('admin');
    expect(root!.mustChangePassword).toBe(1);
    expect(root!.expiresAt).toBeNull();
  });

  it('logs the default credentials to console on seed', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { seedDefaultAdminIfEmpty } = await import('../../../server/users.js');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedDefaultAdminIfEmpty();
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/12345678/));
    spy.mockRestore();
  });

  it('is a no-op when users table is non-empty', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { createUser, seedDefaultAdminIfEmpty, getUserByUsername } =
      await import('../../../server/users.js');
    createUser({ username: 'preset', password: 'pw1234', role: 'admin' });
    seedDefaultAdminIfEmpty();
    expect(getUserByUsername('root')).toBeNull();
  });

  it('is idempotent across repeated calls', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { seedDefaultAdminIfEmpty, getUserByUsername } = await import('../../../server/users.js');
    seedDefaultAdminIfEmpty();
    seedDefaultAdminIfEmpty();
    expect(getUserByUsername('root')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run new test, expect FAIL**

Run: `npx vitest run tests/unit/server/seed-default-admin.test.ts`
Expected: FAIL — seed uses random password, not `'12345678'`.

- [ ] **Step 4: Modify `server/users.ts`**

Replace the body of `seedDefaultAdminIfEmpty` (currently lines 140–164) with:

```ts
const DEFAULT_ADMIN_PASSWORD = '12345678';

export function seedDefaultAdminIfEmpty(): UserRow | null {
  const rows = queryAll<{ n: number }>(`SELECT COUNT(*) AS n FROM users`);
  if ((rows[0]?.n ?? 0) > 0) return null;

  const u = createUser({
    username: 'root',
    password: DEFAULT_ADMIN_PASSWORD,
    role: 'admin',
    expiresAt: null,
    mustChangePassword: true,
  });
  console.warn(
    '[pingdou-server] seeded default admin (root) — ' +
    'login with username=root, password=12345678, MUST change password on first login',
  );
  return u;
}
```

(Keep `DEFAULT_ADMIN_PASSWORD` as a top-level `const` in the same file, near the `now()` helper.)

- [ ] **Step 5: Run tests, expect PASS**

Run: `npx vitest run tests/unit/server/users.test.ts tests/unit/server/seed-default-admin.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/users.ts tests/unit/server/users.test.ts tests/unit/server/seed-default-admin.test.ts
git commit -m "feat(users): 默认 root 密码 12345678；mustChangePassword=true；丢弃 ROOT_PASSWORD env"
```

---

## Task 5: `server/index.ts` — new routes + startup calls `cleanupOrphanImages`

**Files:**
- Modify: `server/index.ts` (`assertRuntimePaths`; add 2 routes; extend `start()`)
- Modify: `tests/unit/server/routes-auth.test.ts` (env fixture)
- Modify: `tests/unit/server/routes-settings.test.ts` (env fixture)
- Create: `tests/unit/server/public-products-route.test.ts`
- Create: `tests/unit/server/reorder-products.test.ts`

- [ ] **Step 1: Update `routes-auth.test.ts` fixture**

In `tests/unit/server/routes-auth.test.ts`:
- Replace `process.env.STATS_DB_PATH = ...` and `process.env.PRODUCTS_JSON_PATH = ...` and `process.env.ROOT_PASSWORD = ...` assignments in `buildAppFixture` with:
  ```ts
  process.env.PINGDOU_DATA_DIR = base;
  ```
- Add a new test inside the `describe('auth route integration', ...)` block:
  ```ts
  it('login with default root/12345678 sets mustChangePassword=true', async () => {
    const { app } = await buildAppFixture();
    const r = await request()(app).post('/api/auth/login').send({ username: 'root', password: '12345678' });
    expect(r.status).toBe(200);
    expect(r.body.mustChangePassword).toBe(true);
  });
  ```
- In `afterEach`, drop the `delete process.env.STATS_DB_PATH / PRODUCTS_JSON_PATH / ROOT_PASSWORD` lines; replace with `delete process.env.PINGDOU_DATA_DIR`.

- [ ] **Step 2: Update `routes-settings.test.ts` fixture**

In `tests/unit/server/routes-settings.test.ts`, replace any `process.env.STATS_DB_PATH =` with `process.env.PINGDOU_DATA_DIR =` (a tmpdir). Drop the corresponding delete in cleanup.

- [ ] **Step 3: Create `tests/unit/server/public-products-route.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
```

- [ ] **Step 4: Create `tests/unit/server/reorder-products.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let tmp: string;

async function freshApp() {
  tmp = mkdtempSync(join(tmpdir(), 'reorder-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  // also seed a root user + create some products
  delete process.env.STATS_DB_PATH;
  delete process.env.PRODUCTS_JSON_PATH;
  delete process.env.ROOT_PASSWORD;
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
```

- [ ] **Step 5: Run new tests, expect FAIL**

Run:
```bash
npx vitest run tests/unit/server/public-products-route.test.ts tests/unit/server/reorder-products.test.ts
```
Expected: FAIL — routes not mounted yet.

- [ ] **Step 6: Modify `server/index.ts`**

Three edits:

**Edit A — simplify `assertRuntimePaths`** (replace the entire current body):

```ts
function assertRuntimePaths(): void {
  // PATHS 已经从 paths.ts 顶层 throw；这里只做目录兜底
  mkdirSync(PATHS.imagesDir, { recursive: true });
  // db 文件由 initDb 自己处理（如果 PINGDOU_DATA_DIR 不存在 initDb 会写不到，先建根目录兜底）
  mkdirSync(PATHS.dataDir, { recursive: true });
}
```

(Add `import { PATHS } from './paths.js';` to the imports section.)

**Edit B — add 2 routes** (anywhere near the existing products routes; after `app.delete('/api/products/:id', ...)` is fine):

```ts
app.get('/api/public/products', (_req, res) => {
  try {
    return res.json(getAllProducts());
  } catch (e) {
    console.error('[public/products]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

app.post('/api/admin/products/reorder', requireAuth, requireAdmin, (req, res) => {
  const { orderedIds } = req.body ?? {};
  if (!Array.isArray(orderedIds) || !orderedIds.every((x: unknown) => typeof x === 'number')) {
    return res.status(400).json({ error: 'orderedIds must be number[]' });
  }
  try {
    const next = reorderProducts(orderedIds);
    return res.json({ ok: true, products: next });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'reorder failed' });
  }
});
```

(Add `cleanupOrphanImages, reorderProducts` to the existing `import { ... } from './products.js';` line.)

**Edit C — extend `start()`**:

In `start()`, between `loadProductsCache();` and `const requested = PORT;`, insert:

```ts
  cleanupOrphanImages();
```

- [ ] **Step 7: Run tests, expect PASS**

Run:
```bash
npx vitest run tests/unit/server/public-products-route.test.ts tests/unit/server/reorder-products.test.ts tests/unit/server/routes-auth.test.ts tests/unit/server/routes-settings.test.ts
```
Expected: all pass.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add server/index.ts tests/unit/server/routes-auth.test.ts tests/unit/server/routes-settings.test.ts tests/unit/server/public-products-route.test.ts tests/unit/server/reorder-products.test.ts
git commit -m "feat(api): GET /api/public/products + POST /api/admin/products/reorder + cleanupOrphanImages on boot"
```

---

## Task 6: Frontend types + api client + `useProducts` URL

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api/products.ts`
- Modify: `src/hooks/useProducts.ts`
- Modify: `src/hooks/useProducts.test.ts`

- [ ] **Step 1: Update `src/types.ts`**

Find the existing `Product` interface (likely has `id: string`, includes `currency`). Replace it with:

```ts
export interface Product {
  readonly id: number;
  readonly name: string;
  readonly image: string;
  readonly price: number;        // 单位：分
  readonly description: string;
  readonly url: string;          // 外部购买链接
  readonly badge?: string;
  readonly order: number;
}
```

(If there's a separate admin `ProductListItem` or similar, update it identically. Search for other types that reference `currency` and remove the field.)

- [ ] **Step 2: Update `src/api/products.ts`**

In `src/api/products.ts`:
- Drop `currency` from any input/output types (search-and-replace).
- Add `adminReorderProducts`:
  ```ts
  export async function adminReorderProducts(orderedIds: number[]): Promise<Product[]> {
    const res = await fetch(`${BASE}/admin/products/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
      credentials: 'include',
    });
    return jsonOrThrow<Product[]>(res);
  }
  ```
  (Adjust the response extraction to match `jsonOrThrow`'s contract — likely just `await res.json() as Product[]` if the helper unwraps the data.)

- [ ] **Step 3: Update `src/hooks/useProducts.ts`**

Change line 16 from `fetch('/data/products.json')` to `fetch('/api/public/products')`. No other changes needed in this file.

- [ ] **Step 4: Update `src/hooks/useProducts.test.ts`**

In each `vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(...)` block, update the URL assertion to match `/api/public/products`. (Actually, the existing tests don't assert URL — they just check the data. So the only mandatory change is to ensure the new endpoint returns the same shape, which it does. If any test does assert URL, update it.)

Run after the change:
```bash
npx vitest run src/hooks/useProducts.test.ts
```
Expected: pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/api/products.ts src/hooks/useProducts.ts src/hooks/useProducts.test.ts
git commit -m "feat(frontend): Product.id 改 number；删 currency；useProducts 走 /api/public/products"
```

---

## Task 7: Frontend price display + form price yuan→cents

**Files:**
- Modify: `src/components/ProductShowcase.tsx` (price display)
- Modify: `src/components/ProductShowcase.test.tsx` (fixture price + assertion)
- Modify: `src/components/ProductEditModal.tsx` (yuan → cents on submit)
- Modify: `src/components/ProductEditModal.test.tsx` (assert cents in body)
- Modify: `src/pages/merchant/MerchantDashboard.tsx` (yuan → cents on submit)

- [ ] **Step 1: Update `ProductShowcase.tsx`**

Find the price render line (around line 77: `<div className="product-price">¥{product.price.toFixed(2)}</div>`) and replace with:

```tsx
<div className="product-price">¥{(product.price / 100).toFixed(2)}</div>
```

- [ ] **Step 2: Update `ProductShowcase.test.tsx`**

In each fixture product (currently uses `price: 99` and `price: 29.9`), multiply by 100:
- `price: 99` → `price: 9900`
- `price: 29.9` → `price: 2990`

In the assertion that checks the price text (search for `¥` in assertions), update to expect the divided-and-formatted string. E.g. `expect(screen.getByText('¥99.00')).toBeInTheDocument()` stays the same (the display formula still produces `¥99.00`), but the fixture input changes.

Run:
```bash
npx vitest run src/components/ProductShowcase.test.tsx
```
Expected: pass.

- [ ] **Step 3: Update `ProductEditModal.tsx`**

Find the submit handler (search for `updateProduct(` or `numericPrice`). Replace the `numericPrice` computation with:

```ts
const numericYuan = Number(price);
if (Number.isNaN(numericYuan)) throw new Error('invalid price');
const numericCents = Math.round(numericYuan * 100);
```

Pass `numericCents` (not `numericYuan`) into the patch body. Keep the input UI showing yuan (it already does).

- [ ] **Step 4: Update `ProductEditModal.test.tsx`**

Find the assertion that checks what the modal sends to `updateProduct`. Update to assert the cents value is in the body. E.g.:

```tsx
expect(updateProductMock).toHaveBeenCalledWith(expect.objectContaining({ price: 9900 }));
```

Update the test's input fixture from `price: 1` to `price: 99` (yuan) so the cents assertion `9900` is meaningful.

Run:
```bash
npx vitest run src/components/ProductEditModal.test.tsx
```
Expected: pass.

- [ ] **Step 5: Update `MerchantDashboard.tsx`**

Same pattern as `ProductEditModal.tsx`: wherever the form converts price input → API payload, multiply by 100. The merchant never edits `order` (no change needed for that part — the merchant UI does not show order controls).

Run the merchant test (if one exists) and any page-level integration test:
```bash
npx vitest run src/pages/merchant/
```
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProductShowcase.tsx src/components/ProductShowcase.test.tsx src/components/ProductEditModal.tsx src/components/ProductEditModal.test.tsx src/pages/merchant/MerchantDashboard.tsx
git commit -m "feat(frontend): 价格展示除以 100；表单输入 ×100 提交（cents 统一）"
```

---

## Task 8: Frontend admin `ProductsTab` — drag-drop + manual order + admin gate

**Files:**
- Modify: `src/pages/admin/ProductsTab.tsx`
- Modify: `src/pages/admin/ProductsTab.test.tsx`

- [ ] **Step 1: Add `order` column + drag handle in `ProductsTab.tsx`**

Three edits in `src/pages/admin/ProductsTab.tsx`:

**Edit A — extend the table with a new `<th>排序</th>` and `<td>` showing current order + a numeric input that calls `adminReorderProducts` on blur.**

**Edit B — add draggable rows** with HTML5 attributes:
```tsx
<tr
  key={p.id}
  draggable
  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(p.id))}
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => {
    e.preventDefault();
    const sourceId = Number(e.dataTransfer.getData('text/plain'));
    handleDragEnd(sourceId, p.id);
  }}
>
```

**Edit C — implement `handleDragEnd(sourceId, destId)`**:
```tsx
async function handleDragEnd(sourceId: number, destId: number) {
  if (sourceId === destId) return;
  const ids = products.map(p => p.id);
  const fromIdx = ids.indexOf(sourceId);
  const toIdx = ids.indexOf(destId);
  if (fromIdx === -1 || toIdx === -1) return;
  const next = [...products];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  setProducts(next);
  try {
    await adminReorderProducts(next.map(p => p.id));
  } catch (e) {
    setProducts(products);  // rollback
    console.error('reorder failed', e);
  }
}
```

**Edit D — implement `handleOrderChange(id, targetOrder)`** (the manual input). Same idea: rebuild the list locally with the target product at `targetOrder-1` position, optimistically update, call `adminReorderProducts`, rollback on error.

- [ ] **Step 2: Update `ProductsTab.test.tsx`**

Add tests:
- `handleDragEnd calls adminReorderProducts with new id order`
- `manual order input change calls adminReorderProducts`
- `if adminReorderProducts rejects, products list rolls back`

If the existing test file has no reorder coverage, just add a single test that verifies the integration:

```tsx
it('calls adminReorderProducts on drag end', async () => {
  // render ProductsTab, simulate dragstart + drop on two rows, expect adminReorderProducts called
});
```

Run:
```bash
npx vitest run src/pages/admin/ProductsTab.test.tsx
```
Expected: pass.

- [ ] **Step 3: Verify the `ProductsTab` is admin-only**

Open `ProductsTab.tsx` and confirm the drag UI + order input only render when the current user is admin. (Check how the tab is mounted — it's already admin-only by the dashboard tab system; just ensure no new public-merchant entry point was added accidentally.)

- [ ] **Step 4: Run full frontend test suite**

Run:
```bash
npx vitest run src/
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/ProductsTab.tsx src/pages/admin/ProductsTab.test.tsx
git commit -m "feat(admin/products): 拖拽 + 手动 order 输入；调 adminReorderProducts；失败回滚"
```

---

## Task 9: Deploy script + nginx + docs

**Files:**
- Modify: `scripts/deploy-server.sh`
- Modify: `docs/DEPLOY.md`
- (No `nginx conf` checked into repo — it's only on the prod server. The change there is documented in DEPLOY.md.)

- [ ] **Step 1: Update `scripts/deploy-server.sh`**

In the section that currently creates `/var/lib/pingdou/{data,images,db}`:

- Replace `mkdir -p /var/lib/pingdou/{data,images,db}` with `mkdir -p /var/lib/pingdou/images` (note: `stats.db` lives in the root, no separate `db/` subdir).
- Replace the `chown` and `chmod` lines to match.

In the env-validation loop:

- Replace the loop body that checks `PRODUCTS_JSON_PATH PRODUCTS_IMAGES_DIR STATS_DB_PATH` with:
  ```bash
  if ! grep -q "^PINGDOU_DATA_DIR" <<<"$ALL_CONTENT"; then
    err "systemd 配置缺少 PINGDOU_DATA_DIR（首次部署见 docs/DEPLOY.md#运行时数据管理）"
  fi
  ```
- Add a WARN block right after:
  ```bash
  for old_key in PRODUCTS_JSON_PATH PRODUCTS_IMAGES_DIR STATS_DB_PATH ROOT_PASSWORD; do
    if grep -q "^$old_key" <<<"$ALL_CONTENT"; then
      warn "检测到旧 env $old_key 仍在 systemd 配置中，新代码不再识别，请删除"
    fi
  done
  ```

- [ ] **Step 2: Update `docs/DEPLOY.md`**

Several edits:

**Edit A** — In the systemd env example, replace the `cat > /etc/pingdou-backend.env <<'EOF'` block:

```bash
cat > /etc/pingdou-backend.env <<'EOF'
PINGDOU_DATA_DIR=/var/lib/pingdou
EOF
chmod 600 /etc/pingdou-backend.env
```

(Remove the 4 old env lines.)

**Edit B** — In the "运行时数据管理" section:
- Change `/var/lib/pingdou/{data,images,db}` references to `/var/lib/pingdou/{images}` (db lives at root as `stats.db`).
- Update the table that lists env vars → only `PINGDOU_DATA_DIR`.
- Update the directory tree diagram → only `images/` + `stats.db`.
- Replace the `location /data/` nginx alias snippet with a note: "新版本不再使用 `/data/` alias；删除 nginx conf 中的 `location /data/` 块"。

**Edit C** — Add a new section "首次登录流程" right after the runtime data section:

> **首次登录流程**：
>
> 部署完成后：
>
> 1. 打开 `https://<域名>/statics`
> 2. 用户名 `root`，密码 `12345678`
> 3. 登录后弹出强制改密 modal，输入旧密码 `12345678` + 新密码（≥ 4 位）
> 4. 改密成功后才能进入业务页
>
> **不要**保留默认密码；改密后通过 admin 后台管理其他账号。

**Edit D** — In "排错速查", remove the line about `PRODUCTS_JSON_PATH env var is required`; replace with:

| 后端启动报 `PINGDOU_DATA_DIR env var is required` | systemd unit 缺 PINGDOU_DATA_DIR | 见「运行时数据管理」 |

- [ ] **Step 3: Verify nothing in DEPLOY.md still references `data/products.json`**

Run:
```bash
grep -n "data/products.json\|PRODUCTS_JSON_PATH\|PRODUCTS_IMAGES_DIR\|STATS_DB_PATH\|ROOT_PASSWORD" docs/DEPLOY.md
```
Expected: no output. If anything remains, edit it out.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy-server.sh docs/DEPLOY.md
git commit -m "docs(deploy): 切到 PINGDOU_DATA_DIR；删 data/ alias；加首次登录流程"
```

---

## Task 10: Full verification pass

**Files:** none (just run all the verifications)

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run full backend + frontend test suite**

Run: `npm test`
Expected: every test passes (existing + new ≥ 15).

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: `dist/` and `dist-server/` produced without errors.

- [ ] **Step 4: Smoke-test backend startup locally**

Run:
```bash
PINGDOU_DATA_DIR=/tmp/pingdou-smoke node dist-server/server/index.js &
SERVER_PID=$!
sleep 2
curl -s http://127.0.0.1:3000/api/health
echo
curl -s http://127.0.0.1:3000/api/public/products
echo
kill $SERVER_PID
rm -rf /tmp/pingdou-smoke
```
Expected:
- `/api/health` → `{"ok":true,"port":3000}`
- `/api/public/products` → `[]`
- No error in console about missing env

- [ ] **Step 5: Verify the 14-item acceptance checklist from spec §13**

Walk through the spec's acceptance checklist. Each item should now be satisfied. If anything is missing, write a follow-up task and do not declare success.

- [ ] **Step 6: Commit any final adjustments**

If Steps 1–5 surfaced anything to fix, commit those fixes in one final commit (do **not** amend earlier commits — preserves the audit trail). If nothing to fix, this step is a no-op.

---

## Definition of Done

All 10 tasks complete. Every commit in the `feature/runtime-config-and-products-db` branch. `npm run typecheck` + `npm test` + `npm run build` all green. Spec's acceptance checklist (spec §13) fully satisfied.

When done, push the branch and prepare to deploy per spec §11. (Deployment is out of scope for this implementation plan — it's a manual server-side activity.)