# 拼豆图：运行时配置合并 + 商品入库 + 默认 root 密码

- **日期**: 2026-10-10
- **作者**: 通过 brainstorming 流程生成（Mavis / MiniMax Code）
- **状态**: 待 review → writing-plans → 实施
- **依赖**: 已存在的 MVP + 现有 `sql.js` engine + 现有 `must_change_password` 字段

## 一、需求文档

### 1.1 背景

三个独立但同源的痛点：

1. **部署 env 配置过多**：当前 `.env.example` 强制要求 3 个路径 env（`PRODUCTS_JSON_PATH` / `PRODUCTS_IMAGES_DIR` / `STATS_DB_PATH`）+ 1 个密码 env（`ROOT_PASSWORD`），全部指向 `/var/lib/pingdou/` 这个根；新人首次部署要记 4 个变量，漏一个进程直接 fail。
2. **商品 JSON 文件维护体验差**：`public/data/products.json` 是 JSON 文件，admin 编辑需要直接改文件 → rebuild → deploy；并发写有 `.tmp` rename 的竞态；JSON 损坏直接 fail 启动。
3. **root 密码策略不安全 + 不顺手**：必须配 `ROOT_PASSWORD` 才能首次启动 → seed 完之后这个 env 留在配置文件里 = 明文长期挂在文件系统上；改密要靠 root 手动从配置文件删 env。

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| RC-1 | 作为运维，首次部署只需配 1 个 env：`PINGDOU_DATA_DIR=/var/lib/pingdou` | 进程启动正常，README/.env.example 清楚说明 |
| RC-2 | 作为运维，prod 上 `/var/lib/pingdou/` 目录结构清晰：images + stats.db 两类 | 文件树只含 images/ + stats.db，不再有 data/products.json |
| RC-3 | 作为 admin，商品 CRUD 走 admin 后台，写入即时生效，无需 rebuild | admin 改商品 → 访客侧列表立即拿到（前端再请求一次即可） |
| RC-4 | 作为 admin，可以用拖拽或手动改值两种方式调整商品顺序，order 字段只在 admin 可控 | merchant 的 PATCH 不接受 order；reorder 接口 `requireAdmin` |
| RC-5 | 作为首次部署的 root 用户，登录用 `root` + `12345678`，登录后被强制改密 | 改密前不能进任何业务页 |
| RC-6 | 作为运维，部署后磁盘上的图片文件数 = 当前有图的商品数（不堆积孤儿文件） | admin 改图片 → 旧文件被删；admin 删商品 → 图片被删；启动时扫盘清理意外残留 |
| RC-7 | 作为访客（未登录），仍能看到商品列表（公开访问） | `GET /api/public/products` 无需 auth |

### 1.3 范围 / 非目标

**范围内**：

- `server/products.ts` 完全重写（JSON 文件 → SQLite 表），保持外部 API shape 不变
- `server/db.ts` 新增 `products` 表 + 改 `product_assignments.product_id` 为 INTEGER
- `server/users.ts` 的 `seedDefaultAdminIfEmpty` 重写：硬编码 `12345678` + `mustChangePassword: true`
- `server/paths.ts` 新文件：集中派生所有运行时路径
- `server/index.ts` 删旧 env 校验、加 `/api/public/products`、`/api/admin/products/reorder`
- `scripts/deploy-server.sh` 改 env 校验 + 目录创建
- `docs/DEPLOY.md` 改 systemd env 例子 + 删 `/data/` alias 说明
- 前端：`src/hooks/useProducts.ts` fetch 路径改 `/api/public/products`；`src/pages/admin/ProductsTab.tsx` 加拖拽 + 手动 order 调整；`src/components/ProductShowcase.tsx` 价格显示改 `¥{price/100}`；admin/merchant 表单 `price` 输入元 → 提交时转分
- `.env.example` / `.env`：只保留 `PINGDOU_DATA_DIR`

**非目标（明确不做）**：

- ❌ 多币种（`currency` 字段删除，全部 CNY）
- ❌ 商品详情页（仍只展示卡 + 外链跳转）
- ❌ 购物车 / 订单 / 库存
- ❌ 图片 CDN / WebP 转换 / 缩略图生成
- ❌ 商品导入 / 导出 / 批量编辑
- ❌ 拖拽手势动画库（原生 HTML5 drag-and-drop，不加 dnd-kit）
- ❌ 商品分类 / 标签系统（`badge` 字段保留为自由文本短标签）
- ❌ 多 root 账号 / 权限分级

### 1.4 成功标准

- `PINGDOU_DATA_DIR` env 不设 → 进程启动 fail-fast，错误信息明确指向 docs/DEPLOY.md
- `npm test` 现有 + ≥15 个新增测试全部通过
- `npm run build` 通过；`npm run typecheck` 0 错误
- nginx conf 删除 `location /data/` alias 后前端列表仍能展示（依赖 `/api/public/products`）
- 部署到 prod (`120.26.57.141`) 后：root / 12345678 登录 → 强制改密 → admin 后台可 CRUD 商品 + 改 order
- `/var/lib/pingdou/` 目录最终只含 `images/` + `stats.db`

## 二、整体架构

### 2.1 新运行时布局

```
/var/lib/pingdou/
├── images/                 ← 商品图片（admin 上传）
│   ├── 123-a1b2c3.jpg
│   └── 456-d4e5f6.png
└── stats.db                ← SQLite（含 6 张表 + 新增 products）
```

所有派生路径从 `PINGDOU_DATA_DIR` 一处派生：

```ts
// server/paths.ts（新建）
import { resolve, join } from 'node:path';
const RAW = process.env.PINGDOU_DATA_DIR;
if (!RAW) {
  throw new Error(
    'PINGDOU_DATA_DIR env var is required (e.g. /var/lib/pingdou)\n' +
    '本地开发：先跑 npm run dev:init；生产部署：见 docs/DEPLOY.md 的「运行时数据管理」一节'
  );
}
const DATA_DIR = resolve(RAW);
export const PATHS = {
  dataDir:   DATA_DIR,
  imagesDir: join(DATA_DIR, 'images'),
  dbPath:    join(DATA_DIR, 'stats.db'),
};
```

### 2.2 数据流

```
admin (浏览器)
  ├─ POST /api/products          → server/products.ts → runStmt INSERT INTO products
  ├─ PUT  /api/products/:id      → runStmt UPDATE products
  ├─ POST /api/products/:id/image → saveImageFile + UPDATE products.image
  └─ POST /api/admin/products/reorder → runInTransaction 重写 1..N

访客 (浏览器，未登录)
  └─ GET  /api/public/products   → queryAll SELECT * FROM products ORDER BY "order" ASC, id ASC
                                   ↑ 返回的 image 字段经过 isImageMissing 兜底替换为默认图
```

### 2.3 文件清单

| 路径 | 动作 | 责任 |
|------|------|------|
| `server/paths.ts` | 新建 | 派生运行时路径 |
| `server/db.ts` | 修改 | 新增 products 表；改 product_assignments.product_id 为 INTEGER |
| `server/products.ts` | 重写 | 保持外部 API；内部从 file I/O 改 SQL；加 `cleanupOrphanImages` + `reorderProducts` |
| `server/users.ts` | 修改 | `seedDefaultAdminIfEmpty` 硬编码 12345678 + mustChange=true；删 `ROOT_PASSWORD` 校验 |
| `server/index.ts` | 修改 | `assertRuntimePaths` 改只校验 `PINGDOU_DATA_DIR`；加 2 个新路由；启动序列加 `cleanupOrphanImages` |
| `scripts/deploy-server.sh` | 修改 | 改 env 校验；改目录创建；加旧 env 残留 WARN |
| `docs/DEPLOY.md` | 修改 | 改 systemd env 例子；删 `/data/` alias；加"首次登录流程"段 |
| `.env.example` / `.env` | 修改 | 只剩 `PINGDOU_DATA_DIR` + 可选 PORT/IP_HASH_SALT/NODE_ENV |
| `src/types.ts` | 修改 | `Product.id: number`；删 `currency` 字段 |
| `src/api/products.ts` | 修改 | 类型同步；加 `adminReorderProducts` |
| `src/hooks/useProducts.ts` | 修改 | fetch URL `/data/products.json` → `/api/public/products` |
| `src/components/ProductShowcase.tsx` | 修改 | `¥{price.toFixed(2)}` → `¥{(price/100).toFixed(2)}` |
| `src/pages/admin/ProductsTab.tsx` | 修改 | 加拖拽手柄 + order 输入框；表单 price 元 → 分；admin 才有 order 控件 |
| `src/pages/merchant/MerchantDashboard.tsx` | 修改 | 调整 price 输入转换；不动 order（merchant 不可改） |
| `src/components/ProductEditModal.tsx` | 修改 | 表单 price 元 → 分 |
| `tests/unit/server/products.test.ts` | 重写 fixture | 不再写 JSON；改 initDb + 预填 products 表 |
| `tests/unit/server/users.test.ts` | 修改 | 删 ROOT_PASSWORD 相关 3 条用例；改 seed 默认值断言 |
| `tests/unit/server/routes-auth.test.ts` | 修改 | fixture 改 PINGDOU_DATA_DIR；新加 mustChangePassword 行为 |
| `tests/unit/server/routes-settings.test.ts` | 修改 | env fixture 改 PINGDOU_DATA_DIR |
| `tests/unit/server/db-helpers.test.ts` | 修改 | 同上 |
| `tests/unit/server/public-products-route.test.ts` | 新建 | `/api/public/products` 行为 |
| `tests/unit/server/reorder-products.test.ts` | 新建 | `reorderProducts` + `/api/admin/products/reorder` 路由 |
| `tests/unit/server/cleanup-orphan-images.test.ts` | 新建 | 启动清理孤儿图片 |
| `tests/unit/server/seed-default-admin.test.ts` | 新建 | 默认密码 + mustChangePassword=true 端到端 |
| `src/hooks/useProducts.test.ts` | 修改 | mock URL 改 `/api/public/products` |

## 三、数据模型

### 3.1 新表：`products`

```sql
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL DEFAULT '',
  image       TEXT    NOT NULL DEFAULT '',         -- 空 或 /products/<file>.(jpg|jpeg|png|webp)
  price       INTEGER NOT NULL DEFAULT 0,          -- 单位：分（1 元 = 100 分）
  description TEXT    NOT NULL DEFAULT '',
  url         TEXT    NOT NULL DEFAULT '',         -- 空 或 http(s)://...
  badge       TEXT,                                -- 可选标签（"新品"/"热卖"/"限时"...）
  "order"     INTEGER NOT NULL DEFAULT 1,          -- 排序权重（>= 1，越小越靠前）
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK ("order" >= 1)
);
CREATE INDEX IF NOT EXISTS idx_products_order ON products("order");
```

**不变量**：

- `id` 自动生成，调用方不可传
- `image` 字段值必须满足正则 `/^\/products\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/` 或为空字符串（由 `server/products.ts:normalizeProductImage` 校验；写入时拒非法值）
- `url` 字段值必须满足 `http://` / `https://` 前缀或为空字符串（沿用现有 `normalizeProductUrl`）
- `"order"` ≥ 1；reorder 时系统自动重写 1..N（见 §5.3）

### 3.2 改表：`product_assignments.product_id` TEXT → INTEGER

```sql
-- 原: product_id TEXT NOT NULL
-- 新: product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE
```

**注**：products.id 是 INTEGER 自增主键，assignments 通过 INTEGER 外键引用。删除 product 时级联删除 assignment（已存在的 ON DELETE CASCADE 行为）。

### 3.3 其他表不变

`events` / `sessions` / `users` / `auth_tokens` / `settings` 全部保持现有 schema。`users.must_change_password` 字段已经在用（schema 已有），这一轮只是改变 `seedDefaultAdminIfEmpty` 的默认值策略。

## 四、Env 配置

### 4.1 删掉

| env | 原因 |
|---|---|
| `PRODUCTS_JSON_PATH` | 商品不再用 JSON 文件，路径由 `PATHS.imagesDir` 同根派生 |
| `PRODUCTS_IMAGES_DIR` | 同上 |
| `STATS_DB_PATH` | DB 路径由 `PATHS.dbPath` 派生 |
| `ROOT_PASSWORD` | 默认密码硬编码为 `12345678`（seed 用），不再通过 env 注入 |

### 4.2 保留 / 新增

| env | 必填 | 默认 | 用途 |
|---|---|---|---|
| `PINGDOU_DATA_DIR` | ✅ | （无默认；不设就 fail-fast） | 运行时数据根目录 |
| `PORT` | ❌ | 3000 | 后端监听端口 |
| `IP_HASH_SALT` | ❌ | 随机生成 | UV 哈希盐（生产建议固定） |
| `NODE_ENV` | ❌ | — | `production` 时 cookie 强制 secure |

### 4.3 `.env.example` 新版

```bash
# ============================================================
#  pingdou-backend 启动必填环境变量
# ============================================================

# 运行时数据根目录（首次部署必须显式设置）
# 包含 images/ 和 stats.db 两个子项，由 PINGDOU_DATA_DIR 派生：
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

### 4.4 首次部署指引

```
首次登录：admin 后台地址：`http://localhost:3000/statics`
默认账号：root
默认密码：12345678
⚠️ 登录后会被强制改密，请立刻改为你自己的密码。
```

后端启动日志会打印这一段（见 §5.5）。

## 五、API 设计

### 5.1 删除

无 endpoint 被删除。`/api/products` / `/api/products/:id` / `/api/products/:id` (PUT/DELETE/POST image) 全部保留。

### 5.2 新增

#### `GET /api/public/products`

**认证**：无
**返回**：`Product[]`，按 `"order" ASC, id ASC` 排序；`image` 字段经过 `isImageMissing` 兜底（缺失替换为 `/static-data/default-product.png`）

```ts
// 响应
[
  { id: 1, name: '128 色套装', image: '/products/1-a1b2c3.jpg', price: 9900,
    description: '...', url: 'https://taobao.com/...', badge: '新品',
    order: 1 },
  ...
]
```

**注**：DB 内部存 `created_at` / `updated_at`，但不通过此 API 暴露（admin 不需要看，访客更不需要）。`order` 暴露是因为 admin 后台拖拽/手填需要显示当前排序值。

#### `POST /api/admin/products/reorder`

**认证**：admin only（双重门：`requireAuth` + `requireAdmin`）
**Body**：`{ orderedIds: number[] }` —— 期望的完整 id 顺序
**行为**：

1. 校验 `orderedIds` 是 `number[]`、unique、长度等于当前商品数、所有 id 都存在
2. `runInTransaction` 内对每个 id 写新 `"order"` = `i + 1`
3. 同步刷 in-memory cache + 落盘（`flushNow()`）
4. 返回 `{ ok: true, products: Product[] }`

**失败模式**：返回 `400 { error: '<message>' }`，不修改 DB。

```ts
// 成功响应
{ ok: true, products: Product[] }
```

### 5.3 修改

#### `PUT /api/products/:id`

**权限**：admin 全部字段；merchant 只能改 name/description/price/url/badge（image 字段不在 PUT 接受范围，必须走专用 `/image` endpoint）
**Body**（admin）：
```ts
{
  name?: string;
  description?: string;
  price?: number;       // 整数分
  url?: string;         // 外链
  badge?: string | null;
  // 注意：order 不在此接口接受；要改 order 走 reorder endpoint
  // 注意：image 不在此接口接受；要换图走 /image endpoint
}
```
**Body**（merchant）：同 admin 字段范围（name/description/price/url/badge）。当前行为允许 merchant 改 url（他们最清楚自家淘宝/京东链接），保留。

> **新行为**：当 `image` 字段在内部被替换时（仅 `replaceProductImage` 路径） + 旧值是 `/products/<file>` + 新旧值不相等 → 自动删除旧图片文件（`removeOldImageFile`）。这是图片数量守恒的关键补丁。注意：admin 通过别的方式（手动 SQL、未来接口）改 image 不在自动清理覆盖范围，由启动时 `cleanupOrphanImages` 兜底。

#### `POST /api/products/:id/image`

不变。上传新图 + 删旧图（旧行为已正确）。

### 5.4 auth/login 行为

**响应不变**：
```ts
{ ok: true, role, username, mustChangePassword, expiresAt }
```

**变化在 server/users.ts 的 seed 行为**：
- 空 users 表 → 创建 `root` / 密码 = `'12345678'` / `mustChangePassword: true`
- 启动日志打印：
  ```
  [pingdou-server] seeded default admin (root) — login with username=root, password=12345678, MUST change password on first login
  ```

### 5.5 `/api/auth/me` 行为不变

仍然返回 `{ id, username, role, mustChangePassword, expiresAt }`。前端 `ChangePasswordModal` 已经监听 `mustChangePassword=true` 强制改密（`pages/StaticsPage.tsx:171`），无需新代码。

## 六、`server/products.ts` 重写

外部 API（函数名 + 参数 shape）**保持不变**：

```ts
export const DEFAULT_PRODUCT_IMAGE = '/static-data/default-product.png';
export interface Product { ... }
export function loadProductsCache(): Product[]
export function getAllProducts(): Product[]
export function getProductById(id: number): Product | null
export function createProduct(input: Omit<Product, 'id'> & { image?: string }): Product
export function updateProduct(id: number, patch: Partial<Omit<Product, 'id'>>): Product
export function deleteProduct(id: number): void
export function replaceProductImage(productId: number, buffer: Buffer, mime: string): Product
export function saveImageFile(productId: number, buffer: Buffer, mime: string): SavedImage
export function removeOldImageFile(imagePath: string): void
// 新增：
export function cleanupOrphanImages(): { removed: string[] }
export function reorderProducts(orderedIds: number[]): Product[]
```

**内部实现变化**：

| 旧行为 | 新行为 |
|---|---|
| `readFileSync(PRODUCTS_JSON_PATH)` + `JSON.parse` | `queryAll('SELECT * FROM products ORDER BY "order" ASC, id ASC')` |
| `writeAtomic()`（`.tmp` + rename） | `runStmt()` + `runInTransaction()`（for reorder）|
| `id: string` | `id: number`（INTEGER 主键） |
| `price: number` (REAL) | `price: number` (INTEGER cents) |
| `currency: string` | **删除** |
| 启动 `loadProductsCache()` 同步预读 | 启动 `loadProductsCache()` 走 SQL，但保留 in-memory cache（避免每请求 SQL） |

### 6.1 字段校验

```ts
// 取代原 normalizeProductUrl 的 image 字段版本
const PRODUCT_IMAGE_RE = /^\/products\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/;

function normalizeProductImage(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('image must be a string');
  if (raw === '') return '';
  if (!PRODUCT_IMAGE_RE.test(raw)) {
    throw new Error('image must be empty or match /products/<file>.(jpg|jpeg|png|webp)');
  }
  return raw;
}

// url 字段沿用原 normalizeProductUrl（http/https 前缀或空）
```

### 6.2 createProduct 的 order 默认值 = `MAX(order) + 1`

```ts
export function createProduct(input: Omit<Product, 'id'> & { image?: string }): Product {
  const list = ensureCache();
  const nextOrder = list.reduce((m, p) => Math.max(m, p.order), 0) + 1;

  const product: Product = {
    name: input.name,
    image: normalizeProductImage(input.image ?? DEFAULT_PRODUCT_IMAGE),
    price: input.price,
    description: input.description,
    url: normalizeProductUrl(input.url),
    badge: input.badge,
    order: nextOrder,
  };

  runStmt(
    `INSERT INTO products (name, image, price, description, url, badge, "order", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [product.name, product.image, product.price, product.description,
     product.url, product.badge, product.order, Date.now(), Date.now()]
  );

  // 从 DB 读回新行（拿到自增 id）
  const created = getAllProducts().find(p => p.order === nextOrder);
  if (!created) throw new Error('createProduct: missing after insert');

  // 同步 cache
  list.push(created);
  flushNow();

  return { ...created };
}
```

### 6.3 updateProduct 改 image 字段时删旧文件

```ts
export function updateProduct(id: number, patch: Partial<Omit<Product, 'id'>>): Product {
  const list = ensureCache();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('product not found');
  
  const old = list[idx];
  const normalized: Record<string, unknown> = {};
  if (typeof patch.name === 'string') normalized.name = patch.name;
  if (typeof patch.description === 'string') normalized.description = patch.description;
  if (typeof patch.price === 'number') normalized.price = patch.price;
  if (typeof patch.url === 'string') normalized.url = normalizeProductUrl(patch.url);
  if (typeof patch.image === 'string') normalized.image = normalizeProductImage(patch.image);
  if (patch.badge === null) normalized.badge = null;
  else if (typeof patch.badge === 'string') normalized.badge = patch.badge;
  // 注意：不接受 patch.order；要改 order 必须走 reorderProducts
  
  const next = { ...old, ...normalized, id, updatedAt: Date.now() };
  list[idx] = next;
  
  // SQL 更新
  runStmt(
    `UPDATE products SET name=?, image=?, price=?, description=?, url=?, badge=?, updated_at=? WHERE id=?`,
    [next.name, next.image, next.price, next.description, next.url, next.badge, next.updatedAt, id]
  );
  
  // 图片清理：image 字段变化 + 旧值是 /products/... + 新值 ≠ 旧值 → 删旧文件
  if (
    typeof patch.image === 'string' &&
    old.image !== patch.image &&
    old.image.startsWith('/products/')
  ) {
    removeOldImageFile(old.image);
  }
  
  flushNow();
  return { ...next };
}
```

### 6.4 cleanupOrphanImages

```ts
import { readdirSync } from 'node:fs';

export function cleanupOrphanImages(): { removed: string[] } {
  const referenced = new Set(
    getAllProducts()
      .map(p => p.image)
      .filter(u => u.startsWith('/products/'))
      .map(u => u.slice('/products/'.length))
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
```

调用时机：`server/index.ts:start()` 内 `loadProductsCache()` 之后、`app.listen()` 之前。

### 6.5 reorderProducts

```ts
export function reorderProducts(orderedIds: number[]): Product[] {
  if (orderedIds.length === 0) return [];
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error('orderedIds must be unique');
  }
  
  const current = getAllProducts();
  if (orderedIds.length !== current.length) {
    throw new Error(`orderedIds length (${orderedIds.length}) must equal current product count (${current.length})`);
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
        [i + 1, now, orderedIds[i]]
      );
    }
  });
  
  // 强制刷新 cache
  cache = null;
  ensureCache();
  flushNow();
  
  return getAllProducts();
}
```

## 七、`server/index.ts` 改动

### 7.1 启动序列

```ts
export async function start(): Promise<void> {
  // 旧 assertRuntimePaths(PRODUCTS_JSON_PATH / PRODUCTS_IMAGES_DIR / STATS_DB_PATH)
  //   改为：只校验 PINGDOU_DATA_DIR + 自动 mkdirSync(PATHS.imagesDir) + 父目录
  assertRuntimePaths();
  
  await initDb();
  seedDefaultAdminIfEmpty();
  loadProductsCache();
  cleanupOrphanImages();   // ← 新增
  
  const requested = PORT;
  const actual = await findFreePort(requested);
  // ... (其余不变)
}
```

### 7.2 assertRuntimePaths 新版

```ts
function assertRuntimePaths(): void {
  // PINGDOU_DATA_DIR 已经在 paths.ts 顶层 throw；这里只做目录兜底
  mkdirSync(PATHS.imagesDir, { recursive: true });
  // db 的父目录由 initDb 负责（先 initDb 再断言也行；这里留给 db.ts 处理）
}
```

### 7.3 新路由

```ts
// 公开商品列表（无 auth）
app.get('/api/public/products', (_req, res) => {
  try {
    return res.json(getAllProducts());
  } catch (e) {
    console.error('[public/products]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

// admin 排序（requireAdmin）
app.post('/api/admin/products/reorder', requireAuth, requireAdmin, (req, res) => {
  const { orderedIds } = req.body ?? {};
  if (!Array.isArray(orderedIds) || !orderedIds.every((x: unknown) => typeof x === 'number')) {
    return res.status(400).json({ error: 'orderedIds must be number[]' });
  }
  try {
    const products = reorderProducts(orderedIds);
    return res.json({ ok: true, products });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'reorder failed' });
  }
});
```

## 八、前端改动

### 8.1 `src/types.ts`

```ts
export interface Product {
  readonly id: number;             // 改：number
  readonly name: string;
  readonly image: string;          // 留：图片相对路径
  readonly price: number;          // 改：单位 = 分
  readonly description: string;
  readonly url: string;            // 留：外部购买链接
  readonly badge?: string;
  readonly order: number;          // 排序权重（admin 后台展示用；访客端无感）
}
```

删 `currency` 字段。不暴露 `created_at` / `updated_at`。

### 8.2 `src/hooks/useProducts.ts`

```ts
fetch('/api/public/products')   // 旧：fetch('/data/products.json')
```

### 8.3 `src/components/ProductShowcase.tsx`

```tsx
<div className="product-price">¥{(product.price / 100).toFixed(2)}</div>
```

### 8.4 `src/pages/admin/ProductsTab.tsx`

**新增**：
- 每行加拖拽手柄（HTML5 drag-and-drop，`draggable` 属性）
- 每行加 order 输入框（`<input type="number" min="1">`）
- `handleDragEnd(fromIdx, toIdx)` → 客户端计算新 orderedIds → 乐观更新 UI → `POST /api/admin/products/reorder`
- `handleOrderChange(id, newOrder)` → 客户端计算新 orderedIds（把该商品插入到位置 newOrder-1） → 同上

**改 price 表单**：输入仍是元（`29.9`），提交时 `Math.round(Number(price) * 100)` 转分。

### 8.5 `src/pages/merchant/MerchantDashboard.tsx` + `src/components/ProductEditModal.tsx`

- price 表单：元 → 分转换
- 不显示 order 控件（merchant 不可改）

### 8.6 `src/api/products.ts`

```ts
export type Product = { id: number; ... };  // 同步
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

## 九、Nginx + 部署

### 9.1 nginx conf 改动

**删除**：
```nginx
location /data/ { alias /var/lib/pingdou/data/; }
```

**保留**：
```nginx
location /products/ { alias /var/lib/pingdou/images/; }
```

**注意**：如果运维修改 `PINGDOU_DATA_DIR`（如改为 `/data/pingdou`），必须同步修改 nginx conf 的两处硬编码路径。DEPLOY.md 会写清楚。

### 9.2 `scripts/deploy-server.sh` 改动

```bash
# 旧：
mkdir -p /var/lib/pingdou/{data,images,db}
# 新：
mkdir -p /var/lib/pingdou/{images}    # db 不需要单独建目录，stats.db 直接放根

# 旧：
for key in PRODUCTS_JSON_PATH PRODUCTS_IMAGES_DIR STATS_DB_PATH; do
  if ! grep -q "$key" <<<"$ALL_CONTENT"; then
    err "..."
  fi
done
# 新：
if ! grep -q "^PINGDOU_DATA_DIR" <<<"$ALL_CONTENT"; then
  err "systemd 配置缺少 PINGDOU_DATA_DIR..."
fi

# 新增：检测旧 env 残留（仅 WARN，不报错；首次升级时给运维明确指引）
for old_key in PRODUCTS_JSON_PATH PRODUCTS_IMAGES_DIR STATS_DB_PATH ROOT_PASSWORD; do
  if grep -q "^$old_key" <<<"$ALL_CONTENT"; then
    warn "检测到旧 env $old_key 仍在 systemd 配置中，新代码不再识别，请删除"
  fi
done
```

### 9.3 `docs/DEPLOY.md` 改动

- 删所有 `data/products.json` 引用
- 改 systemd env 例子为单行 `PINGDOU_DATA_DIR=/var/lib/pingdou`
- nginx conf 段删除 `location /data/` 行
- 新增"首次部署流程"段：

> **首次部署后登录步骤**：
>
> 1. 打开 `https://<域名>/statics`
> 2. 用户名 `root`，密码 `12345678`
> 3. 登录后弹出强制改密 modal，输入旧密码 `12345678` + 新密码（≥ 4 位）
> 4. 改密成功后才能进入业务页

- 排错速查里：删 `PRODUCTS_JSON_PATH env var is required` 那条（换成 `PINGDOU_DATA_DIR env var is required`）

## 十、测试策略

### 10.1 新增测试

| 文件 | 覆盖 |
|---|---|
| `tests/unit/server/public-products-route.test.ts` | `GET /api/public/products`：无 auth、返回正确排序、image 缺失兜底 |
| `tests/unit/server/reorder-products.test.ts` | `reorderProducts`：基础排序、长度不匹配报错、id 不存在报错、unique 校验、事务回滚 |
| `tests/unit/server/cleanup-orphan-images.test.ts` | `cleanupOrphanImages`：删除未被引用的图、保留被引用的、不误删非图片文件 |
| `tests/unit/server/seed-default-admin.test.ts` | 空 users 表 → seed root/12345678/mustChange=true；非空 noop；幂等 |
| `tests/unit/server/products-image-validation.test.ts` | `normalizeProductImage`：拒绝 `/etc/passwd`、绝对路径、外链；接受 `/products/x.jpg` |

### 10.2 修改测试

| 文件 | 改动 |
|---|---|
| `tests/unit/server/products.test.ts` | fixture 改为"通过 `initDb` + 直接 `runStmt` 预填 products 表"，不再写 products.json |
| `tests/unit/server/users.test.ts` | 删 3 条 ROOT_PASSWORD 相关用例（"throws when missing"/"throws when too short"/"is no-op when missing but users exist"）；保留 seed 行为测试，改默认值断言 |
| `tests/unit/server/routes-auth.test.ts` | fixture 改 PINGDOU_DATA_DIR；新加 `login with default password → me returns mustChangePassword=true` |
| `tests/unit/server/routes-settings.test.ts` | env fixture 改 PINGDOU_DATA_DIR |
| `tests/unit/server/db-helpers.test.ts` | env fixture 改 PINGDOU_DATA_DIR |
| `src/hooks/useProducts.test.ts` | mock URL 改 `/api/public/products` |

### 10.3 期望结果

`npm test` 现有 + 新增 ≥ 15 个测试全部通过。

## 十一、生产部署步骤

1. **部署新代码 + 改 env**：
   ```bash
   # 服务器上
   cd /root/project/pingdou
   bash scripts/deploy-server.sh    # 检测到旧 env 会打印 WARN，但因 PINGDOU_DATA_DIR 没设会报错退出
   ```
   deploy 脚本失败后手动改 env：
   ```bash
   cat > /etc/pingdou-backend.env <<'EOF'
   PINGDOU_DATA_DIR=/var/lib/pingdou
   EOF
   systemctl daemon-reload
   bash scripts/deploy-server.sh     # 这次会成功
   ```

2. **首次启动**：
   - 后端检测 users 表为空 → seed root / `12345678` / `mustChangePassword=true`
   - 控制台 / journalctl 打印：
     ```
     [pingdou-server] seeded default admin (root) — login with username=root, password=12345678, MUST change password on first login
     ```

3. **首次登录 + 强制改密**：
   - 打开 `https://<域名>/statics`
   - 用户名 `root` / 密码 `12345678`
   - 强制改密 modal 弹出 → 输入旧密码 `12345678` + 新密码（≥ 4 位） → 提交
   - 改密成功 → 进入 admin 仪表盘

4. **清理（可选）**：
   ```bash
   rm -rf /var/lib/pingdou/data/    # 旧目录，新代码不再使用
   # nginx reload 让 /data/ alias 失效
   nginx -t && systemctl reload nginx
   ```

## 十二、风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 运维忘记改 env | 进程起不来 | fail-fast + 报错信息明确指向 DEPLOY.md |
| nginx 仍有 `location /data/` alias 但后端不再写 products.json | 访客 `/data/products.json` 404 | frontend 已切到 `/api/public/products`，404 不影响；DEPLOY.md 提示 reload nginx 删 alias |
| `seedDefaultAdminIfEmpty` 把 `12345678` 打到 journalctl | journalctl 不外暴露可接受；外暴露等于公开默认密码 | 接受 trade-off（用户已确认硬编码），建议生产环境通过其他方式（firewall）限制 journalctl 访问 |
| 旧 prod `data/products.json` 真实商品数据丢失 | 用户已确认不迁移、不备份 | 不做备份；运维在首次部署后通过 admin 后台重新录入 |
| sql.js `flushNow` 500ms 防抖：商品写入后未立即落盘 → 进程崩溃可能丢 | 跟现有其他表一样的保证 | 不算新问题 |
| 多副本部署未来扩展时 SQLite 文件并发写坑 | 当前单进程不引入 | DEPLOY.md 注释一句 |
| `order` 字段在 SQL 是关键字需转义 | 语法错误 | 全部用 `"order"` 双引号包起来；测试覆盖 |
| merchant 用户通过前端表单手动塞 `order` 字段到 PUT body | 服务端必须拒绝 | `PUT /api/products/:id` 路由里**不接受** `order` 字段；即使客户端传也直接被 destructuring 忽略 |
| admin 拖拽时其他 admin 同时拖 | 第二次写入覆盖第一次 | 接受 last-write-wins；如果需要严格并发，加版本号字段（YAGNI） |
| 旧 prod 中已有 `product_assignments.product_id` 为 TEXT 引用 string slug id | 升级后 references 全部失效（schema 改了类型） | 用户已确认不迁移、不备份；升级后 stats.db 等同于清空重建 |

## 十三、验收清单

- [ ] `PINGDOU_DATA_DIR` env 不设 → 后端启动 fail-fast + 错误信息明确
- [ ] `npm run typecheck` 0 错误
- [ ] `npm test` 全部通过（含新增 ≥ 15 个）
- [ ] `npm run build` 通过
- [ ] admin 登录 root/12345678 → 强制改密 modal 弹出 → 改密成功 → 进入仪表盘
- [ ] admin 创建商品 → 访客侧 `GET /api/public/products` 立即返回新商品
- [ ] admin 上传商品图 → 旧图被删；磁盘图片文件数 = 有图商品数
- [ ] admin 拖拽改 order → DB 内 1..N 重写、frontend 列表顺序立即变化
- [ ] admin 手动输入 order 值（如把 id=5 的商品 order 改成 2）→ 系统重排 1..N
- [ ] merchant 调用 `PUT /api/products/:id` 带 `order` 字段 → 服务端忽略 `order` 字段
- [ ] merchant 调用 `POST /api/admin/products/reorder` → 403 admin only
- [ ] 后端启动日志含 `seeded default admin (root)` + 12345678 提示
- [ ] nginx conf 删除 `/data/` alias 后 frontend 列表仍能展示
- [ ] `/var/lib/pingdou/` 目录最终只含 `images/` + `stats.db`
- [ ] 文档：`docs/DEPLOY.md` 已更新，旧 env 名已替换为 `PINGDOU_DATA_DIR`