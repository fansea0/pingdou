# 拼豆图：导出图二维码 + 公开作品库 + 后台上传 + 可插拔存储

- **日期**: 2026-10-16
- **作者**: 通过 brainstorming 流程生成（Mavis / MiniMax Code）
- **状态**: 待 review → writing-plans → 实施
- **分支**: `feat/qr-download-gallery`
- **依赖**: 现有导出流水线（`composite.ts` / `watermark.ts` / `pipeline.ts`）、现有 `sql.js` engine + `flushNow()` 写盘模型、现有 `multer` 上传管线、现有 `requireAuth` / `requireAdmin` 鉴权

## 一、需求文档

### 1.1 背景

1. **导出的图纸是死图**：用户拿到 PNG 之后，它上面只有「拼豆.xyz」文字水印，没有任何回到站点的路径。分享到社交平台之后，传播链条到此为止。
2. **作品没有承载页**：用户做出来的图纸散落在各自手机相册和聊天记录里，站方手里没有任何可展示、可统计的「作品集」。
3. **图片存在两套互不相干的地盘**：商品图片走 `server/products.ts` 里硬编码的 `writeFileSync` + `/products/` URL，换存储方式要挨个改调用点。

目标是让「扫码 → 落地页 → 下载」这条链路成立，同时不把存储实现焊死在本地盘上。

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| W-1 | 作为导出图纸的用户，右下角有一个二维码，扫码直接进入作品库页面 | 导出 PNG 右下角有可扫二维码；微信/相机扫出后落到 `https://www.xn--muu023g.xyz/works` |
| W-2 | 作为关注画面观感的使用者，二维码不喧宾夺主、不遮挡图纸内容 | 二维码 111×111，占成品图面积 < 2%；色卡区零遮挡（版式只多一条底部白边） |
| W-3 | 作为扫码进来的访客，能浏览到站方上架的拼豆作品 | `GET /api/public/works` 无需登录即可拿到列表 |
| W-4 | 作为手机端访客（微信内置浏览器），能把作品图存下来 | 详情页有「长按保存图片」提示，`<img>` 内联渲染可长按 |
| W-5 | 作为桌面端访客，能一键下载原始 PNG | 详情页有「下载原图」按钮，`<a download>` 触发保存 |
| W-6 | 作为访客，列表页加载轻快，不被大图拖慢 | 列表页只加载 WebP 缩略图（480px 长边），单张几十 KB |
| W-7 | 作为 admin，能在后台「作品」tab 上传作品图并填写标题/描述 | 上传后 `/works` 列表立即出现该作品 |
| W-8 | 作为 admin，能下架（草稿）、改标题、删除作品 | 下架后公开接口不再返回；删除时磁盘文件一并清理 |
| W-9 | 作为未来的运维，要把图片换成 S3/OSS，只需新增一个实现文件 | DB 只存 key 不存 URL；新增 driver 不触碰任何调用点 |
| W-10 | 作为访客，从首页能跳到作品库 | 首页有导航栏，含「生成图纸」「作品库」两个条目 |

### 1.3 范围 / 非目标

**范围内**：

- `server/db.ts` 新增 `works` 表
- 新增 `server/storage/`：`StorageDriver` 接口 + `LocalDiskDriver` + 单例出口
- 新增 `server/works.ts`：作品 CRUD（query 直读，无内存 cache）
- `server/index.ts` 新增公开 API + admin API + `/media/*` dev 兜底路由 + 双文件上传中间件
- `server/paths.ts` 新增 `mediaDir`
- 新增 `scripts/site-config.mjs`；新增 `scripts/gen-qr.mjs` 挂进 `prebuild`；`gen-sitemap.mjs` 改为 import 共享常量并新增 `/works`
- 前端新增 `src/pipeline/qr.ts`；`composite.ts` 新增 `qrBandPx`；`pipeline.ts` 两条导出路径接入
- 前端新增 `src/router.ts`、`src/components/SiteNav.tsx`、`src/pages/WorksListPage.tsx`、`src/pages/WorkDetailPage.tsx`、`src/api/works.ts`、`src/hooks/useWorks.ts`
- 后台新增 `src/pages/admin/WorksTab.tsx`；`AdminDashboard` 新增第 4 个 tab
- 文档：`README.md` 加「作品库」章节；`docs/DEPLOY.md` + `docs/nginx-https-setup.md` 加 `/media/` 正则 location；`public/robots.txt` 把 `/media/` 加进 Disallow

**非目标（明确不做）**：

- ❌ **下载量统计**：要动 `events` 表的 kind 白名单校验和统计查询，属于统计子系统的改动，本次不碰。`works` 表不加 `downloads` 列。
- ❌ **作品排序（`order` 列 + 拖拽）**：`products` 有排序是因为商品要按顺序成交；作品库先用 `created_at DESC`（最新在前），排序需求出现时再加。
- ❌ **作品分类 / 标签 / 搜索**
- ❌ **单作品页 SEO 预渲染**：本项目是纯 SPA（只有 `index.html` 预渲染），单个 `/works/:id` 对百度的收录质量天然弱。要真正做好需要预渲染或 SSG，属于独立课题，本次不承诺。
- ❌ **S3 / OSS driver 的实际实现**：只定义接口 + 本地盘实现，不预写任何云厂商代码。
- ❌ **作品分页 UI 的无限滚动**：API 预留 `limit`/`offset`，前端先做「加载更多」按钮。
- ❌ **导出图里的二维码可点击 / 可配置**：全站一个码，指向 `/works`，用户不可改。
- ❌ **对抗平台识别的二维码混淆**：二维码已经做到 version 3（该 URL 的最小可能值）、面积占比 < 2%，但不做人眼不可见、色彩伪装之类的手法 —— 那会直接损伤可扫性，且平台识别规则随时会变，做出来也不可靠。
- ❌ **把 `products` 图片迁移到新 StorageDriver**：老代码保持原样，避免把一个功能改动变成一次数据迁移。

### 1.4 成功标准

- `npm test` 现有全部通过 + ≥18 个新增测试通过
- `npm run typecheck` 0 错误；`npm run build` 通过（`prebuild` 正常产出 QR 与 sitemap）
- 导出 PNG 可被微信「扫一扫」和系统相机识别；连续 3 次导出尺寸均正常且色卡区未被压
- 断网 / 拦截 QR 资源时，导出仍然成功（只是没有二维码），不抛错
- admin 上传一张 3MB PNG → 磁盘出现原图 + WebP 缩略图各一份 → `/works` 列表 3 秒内可浏览
- admin 删除作品 → DB 记录消失 + 两个文件都被删掉
- 恶意 key（`../../etc/passwd`）被 LocalDiskDriver 拒绝

## 二、整体架构

### 2.1 数据流

```
                    ┌──────────── 构建期 ────────────┐
SITE_URL ──> site-config.mjs ──> gen-qr.mjs ──> public/brand/works-qr.png
        └──> gen-sitemap.mjs ──> public/sitemap.xml（含 /works）
                                                  │
                    ┌──────────── 运行时 ──────────┴───────────┐
                    │                                          │
浏览器导出：canvas ← renderCompositeFromBoard(qrBandPx)      │
                    │        + drawWatermark(header-right)    │
                    │        + drawWorksQr(底部白带)           │
                    ↓                                          │
              triggerDownload(PNG)                            │
                                                                │
admin 上传：File ──> 浏览器 canvas 480px/WebP ──┐              │
              原图 File ─────────────────────────┴─> POST /api/admin/works (multipart)
                                                                ↓
                                                    works.ts ──> storage.put(key)
                                                                ↓
                                                  LocalDiskDriver ──> <DATA_DIR>/media/works/
                                                                ↓
访客访问：/works ──> GET /api/public/works ──> thumbUrl/imageUrl (storage.publicUrl)
              └─> /works/:id ──> GET /api/public/works/:id
                                   └─> <img src=imageUrl>  长按保存
                                   └─> <a download href=imageUrl>  直接下载
```

### 2.2 新增 / 改动文件清单

**新增**：

| 文件 | 职责 |
|------|------|
| `server/storage/types.ts` | `StorageDriver` / `StoredObjectInfo` 接口 |
| `server/storage/localDisk.ts` | `LocalDiskDriver`：本地盘实现 + 路径穿越防护 |
| `server/storage/index.ts` | 导出单例 `storage` |
| `server/works.ts` | 作品 CRUD + 公开查询 |
| `scripts/site-config.mjs` | 共享 `SITE_URL` |
| `scripts/gen-qr.mjs` | 生成 `public/brand/works-qr.png` |
| `public/brand/works-qr.png` | 生成产物，**提交进仓库**（否则首次 `npm run dev` 不触发 `prebuild`，会 404） |
| `src/pipeline/qr.ts` | QR 资源加载 + 绘制 |
| `src/router.ts` | `matchRoute()` |
| `src/components/SiteNav.tsx` | 导航栏 |
| `src/pages/WorksListPage.tsx` + `.css` | 作品库列表页 |
| `src/pages/WorkDetailPage.tsx` + `.css` | 作品详情页 |
| `src/api/works.ts` | 作品 API 客户端 |
| `src/hooks/useWorks.ts` | 作品数据 hook |
| `src/pages/admin/WorksTab.tsx` + `.test.tsx` | 后台作品管理 |
| `tests/unit/storage.test.ts` | LocalDiskDriver 单测 |
| `tests/unit/server/works.test.ts` | 作品 CRUD 单测 |
| `tests/unit/router.test.ts` | 路由匹配单测 |
| `tests/unit/gen-qr.test.ts` | QR 生成脚本单测 |

**改动**：

| 文件 | 改动 |
|------|------|
| `server/db.ts` | 新增 `works` 表 DDL |
| `server/paths.ts` | 新增 `mediaDir` |
| `server/index.ts` | 新增路由 + `handleUploadFields()`；`assertRuntimePaths()` 补建 `mediaDir` |
| `src/main.tsx` | 改用 `matchRoute()` |
| `src/App.tsx` | 页眉下方插入 `<SiteNav />` |
| `src/pipeline/composite.ts` | `CompositeOptions` 新增 `qrBandPx` |
| `src/pipeline/pipeline.ts` | `exportMulti()` / `exportComposite()` 接入 QR |
| `src/pages/admin/AdminDashboard.tsx` | 新增 `works` tab |
| `scripts/gen-sitemap.mjs` | import 共享 `SITE_URL`；新增 `/works` |
| `public/robots.txt` | `/media/` 加进 Disallow |
| `src/seo.test.ts` | 断言 sitemap 含 `/works` |
| `package.json` | `prebuild` 加 `gen-qr.mjs`；新增 devDependency `qrcode` |
| `README.md` / `docs/DEPLOY.md` / `docs/nginx-https-setup.md` | 补文档 |

### 2.3 运行时目录布局

```
/var/lib/pingdou/
├── images/                 ← 商品图片（现有，不动）
│   ├── 123-a1b2c3.jpg
├── media/                  ← 新增：作品原图 + 缩略图
│   └── works/
│       ├── <hex>.png       ← 原图（admin 上传的成品图）
│       └── <hex>-t.webp    ← 缩略图（浏览器生成）
└── stats.db                ← SQLite（含现有 7 张表 + 新增 works）
```

新增 `PATHS.mediaDir = join(DATA_DIR, 'media')`。与 `images/` 平级而不是塞进去，理由是二者生命周期不同：`images/` 归商品模块所有，`media/` 归 StorageDriver 所有，driver 换实现时根目录可以整体换掉。

## 三、数据库设计

### 3.1 DDL

在 `server/db.ts` 的 `db.exec()` 块中，紧跟现有 `products` 表之后新增：

```sql
CREATE TABLE IF NOT EXISTS works (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  image_key   TEXT    NOT NULL,
  thumb_key   TEXT    NOT NULL DEFAULT '',
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  bytes       INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK (published IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_works_published_created
  ON works(published, created_at DESC);
```

### 3.2 字段语义

| 字段 | 类型 | 可空 | 语义与约束 |
|------|------|------|-----------|
| `id` | INTEGER | 否 | 主键，自增。作品详情页用 `/works/:id`。 |
| `title` | TEXT | 否 | 作品标题，卡片和详情页主标题。空串合法（允许只传图不填标题，前端回落成「未命名作品」）。 |
| `description` | TEXT | 否 | 自由文本描述，最长 2000 字符，超长在写入前截断而非报错。 |
| `image_key` | TEXT | NOT NULL | **原图的存储 key**，形如 `works/3f2a….png`。存 key 不存 URL —— 见 3.5。 |
| `thumb_key` | TEXT | 否 | WebP 缩略图的存储 key，形如 `works/3f2a…-t.webp`。**空串是合法状态**：表示缩略图缺失（浏览器端生成失败、或将来出现非浏览器上传端），此时前端用 `image_key` 当缩略图降级。 |
| `width` | INTEGER | 否 | 原图像素宽。由上传端在生成缩略图时顺便读出，用于列表页预留正确长宽比、避免加载时布局跳动（CLS）。未知填 0，前端收到 0 时不预留比例。 |
| `height` | INTEGER | 否 | 同上，像素高。 |
| `bytes` | INTEGER | 否 | 原图字节数，详情页展示「体积」。未知填 0。 |
| `published` | INTEGER | 否 | SQLite 无 BOOLEAN，用 0/1。`1` = 已上架（公开可见），`0` = 草稿。CHECK 约束兜住非法值。 |
| `created_at` | INTEGER | 否 | 创建时间戳（ms），列表默认排序键。 |
| `updated_at` | INTEGER | 否 | 最后修改时间戳（ms），改元数据/换图时更新。 |

### 3.3 索引与查询模式

`idx_works_published_created (published, created_at DESC)` 精确匹配唯一的两条查询路径：

```sql
-- 列表页（公开 + 后台列表共用）
SELECT id, title, thumb_key, image_key, width, height, created_at
  FROM works
 WHERE published = 1
 ORDER BY created_at DESC
 LIMIT ? OFFSET ?;

-- 计数（分页用）
SELECT COUNT(*) AS total FROM works WHERE published = 1;
```

后台管理列表额外需要看草稿（`WHERE published IN (0,1)`），此时走不了这个索引的左前缀 + 排序，但作品量级在几百到几千，全表扫描完全可接受 —— 不为它建第二个索引。

单条详情 `WHERE id = ?` 走主键，无额外开销。

### 3.4 迁移策略

**无需迁移**。`CREATE TABLE IF NOT EXISTS` 对新库和存量库都是同一条语句：存量库里根本不存在 `works` 表，所以是「建表」而非「改表」。这跟 2026-10-10 那次给 `events` 加 `province`/`city` 列的情况不同 —— 那次改的是已有表，必须走 `ensureColumn()` 的 PRAGMA 检查再 `ALTER TABLE ADD COLUMN` 的幂等路径；本次是全新表，不碰 `ensureColumn`。

表结构一旦落地，未来若要加字段，走 `ensureColumn('works', '新列', 'TYPE')` 的既有幂等模式即可。

### 3.5 关键决策：只存 key，绝不存 URL

`image_key` / `thumb_key` 存的是**存储层抽象 key**（`works/<hex>.png`），不是可直接访问的 URL。对外 URL 一律在响应构造时现算：

```ts
// server/works.ts
const thumbUrl = storage.publicUrl(w.thumb_key || w.image_key);
```

这样做的收益是可量化的：将来从本地盘换到 S3/OSS，只需新增一个 driver 实现 + 在 `server/storage/index.ts` 改一行构造，**`works` 表里每一个字节的数据都不用动**，也不用写迁移脚本。如果存 URL，就得全表 `UPDATE works SET image_url = ...`，而且以后每换一次后端都要再洗一次。

### 3.6 不设计的字段

| 字段 | 为何不加 |
|------|----------|
| `order` | `products.order` 存在是因为商品要排序成交。作品库先用 `created_at DESC`，排序需求出现时再加列 + 加拖拽 UI，届时是纯追加。 |
| `downloads` | 需要动 `events` 表的 kind 白名单和统计查询，属于统计子系统改动。作品下载走 `<a download>` 直接命中 nginx/Express，压根不经过应用层，要统计得单独设计。 |
| `slug` | `/works/123` 已经够短且够稳。为 SEO 做 slug 会给每次改名引入唯一约束冲突和重定向链，收益不抵复杂度。 |

## 四、存储抽象

### 4.1 接口

`server/storage/types.ts`：

```ts
export interface StoredObjectInfo {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
}

/**
 * 作品图存储的最小能力集。实现者只需回答五个问题：
 * 怎么写、怎么读、存不存在、怎么删、这个 key 对外是什么地址。
 *
 * 刻意保持小 —— 每多一个方法，将来每多一个实现就多一份要维护的东西。
 */
export interface StorageDriver {
  readonly name: string;

  put(key: string, body: Buffer, contentType: string): Promise<StoredObjectInfo>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<StoredObjectInfo | null>;
  delete(key: string): Promise<void>;

  /** key → 对外可访问 URL。本地盘返回 `/media/works/xxx.png`，S3 返回 CDN 地址。 */
  publicUrl(key: string): string;
}
```

`publicUrl` 是接口里最容易被低估的方法：它是「存储细节」和「前端拿到的地址」之间唯一的翻译层，正因为有它，DB 才不需要存 URL（见 3.5）。

### 4.2 LocalDiskDriver

`server/storage/localDisk.ts`，根目录 `PATHS.mediaDir`，URL 前缀 `/media`：

```ts
export class LocalDiskDriver implements StorageDriver {
  readonly name = 'local-disk';

  constructor(private readonly rootDir: string, private readonly urlPrefix: string) {}

  put(key, body, contentType) { /* mkdir -p + writeFile，contentType 仅记录不回读 */ }
  get(key)                { /* readFile，ENOENT 抛 StorageNotFound */ }
  head(key)               { /* statSync，ENOENT 返回 null */ }
  delete(key)             { /* 不存在时静默成功 —— 清理路径必须幂等 */ }
  publicUrl(key)          { return `${this.urlPrefix}/${key}`; }
}
```

**路径穿越防护**（`resolve` 之后断言仍在 root 内）：

```ts
private resolveKey(key: string): string {
  const full = resolve(this.rootDir, key);
  const rootWithSep = this.rootDir.endsWith(sep) ? this.rootDir : this.rootDir + sep;
  if (!full.startsWith(rootWithSep)) {
    throw new Error(`storage: illegal key escapes root: ${key}`);
  }
  return full;
}
```

`startsWith` 比较用的是拼过分隔符的 root，避免 `/var/lib/pingdou/media-evil/x.png` 这类前缀误判通过。Windows 平台的 `C:\` 与 `c:\` 大小写差异当前不处理 —— 部署目标是 Linux，引入 `pathToFileURL` 之类的方案属于过度设计。

`delete` 对不存在的文件静默成功：删除作品时原图和缩略图是两个独立调用，其中一个缺失（比如缩略图生成失败过）不该让整个删除流程失败。

### 4.3 单例出口

`server/storage/index.ts`：

```ts
import { PATHS } from '../paths.js';
import { LocalDiskDriver } from './localDisk.js';

export const storage: StorageDriver = new LocalDiskDriver(PATHS.mediaDir, '/media');
```

将来加 S3 的改动面就是这一个文件加一个 `s3.ts`。

### 4.4 key 命名

`<prefix>-<random>.<ext>`，`<prefix>` = `randomBytes(8).toString('hex')`。原图 `works/3f2a….png`，缩略图 `works/3f2a…-t.webp`（同一次上传共用随机前缀，admin 后台肉眼可辨归属）。

扩展名由 mime 映射得到，白名单与现有商品上传一致（`jpg` / `png` / `webp`），缩略图固定 `webp`。

### 4.5 URL 前缀为什么是 `/media/` 而不是 `/works/`

作品库的页面路由是 `/works`。如果文件也挂在 `/works/` 下，`GET /works`（页面）和 `GET /works/xxx.png`（文件）会挤在同一个前缀里 —— dev 下 Express 路由和 prod 下 nginx `location` 都要靠尾斜杠和正则做脆弱的区分，`/works` 页面路由还得写成 `/works\/` 并额外处理无尾斜杠的重定向。

用 `/media/` 做文件前缀、页面留在 `/works`，两者彻底分离。将来若要存视频等其他媒体，也自然落在同一个 alias 下。

## 五、API 设计

### 5.1 响应类型

```ts
// src/api/works.ts（与后端 shape 一一对应）
export interface WorkSummary {
  id: number;
  title: string;
  thumbUrl: string;      // storage.publicUrl(thumb_key || image_key)
  width: number;
  height: number;
  createdAt: number;
}

export interface WorkDetail extends WorkSummary {
  description: string;
  imageUrl: string;      // storage.publicUrl(image_key)
  bytes: number;
}
```

标题为空时在**服务端**就回落成「未命名作品」，前端不做这层判断，避免列表和详情两处各写一遍。

### 5.2 公开接口（无需鉴权）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/public/works?limit=20&offset=0` | `{ items: WorkSummary[], total: number }`。`limit` 钳制到 `[1, 60]`，`offset` 负数归零。只返回 `published = 1`。 |
| `GET` | `/api/public/works/:id` | `WorkDetail`。`published = 0` 的作品一律 404（不区分「不存在」和「未上架」，避免通过状态码探测草稿）。 |
| `GET` | `/media/works/:filename` | **dev-only** 静态兜底。生产走 nginx `alias`。文件名严格白名单正则，照抄现有 `/products/:filename` 的实现。 |

路径是两级而非一级：`storage.publicUrl('works/3f2a….png')` 产出 `/media/works/3f2a….png`（`/media` 是 driver 的 URL 前缀，`works` 是 key 的一部分）。所以 dev 路由写 `/media/works/:filename`，只把最后一段交给正则校验，和 `/products/:filename` 是同一个结构。

```ts
const MEDIA_FILENAME_RE = /^[0-9a-f]{16}\.png$/;        // 原图 works/<16hex>.png
const MEDIA_THUMB_RE    = /^[0-9a-f]{16}-t\.webp$/;     // 缩略图 works/<16hex>-t.webp
```

两个正则都必须测：`/media/works/not-hex.png` 一律 400，不落到 `sendFile` 上给路径穿越留机会。nginx 侧同样建议加一条：

```nginx
location ~ ^/media/works/[0-9a-f]{16}(-t)?\.(png|webp)$ {
    alias /var/lib/pingdou/media/works/;
}
```

用正则而非前缀 `location`，让 nginx 层也把非法文件名挡在门外。

### 5.3 后台接口（`requireAuth` + `requireAdmin`）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/admin/works` | multipart：`file`（原图，必填）+ `thumb`（WebP，可选）+ 文本字段 `title` / `description` / `published` |
| `PUT` | `/api/admin/works/:id` | JSON：改 `title` / `description` / `published` |
| `POST` | `/api/admin/works/:id/image` | multipart：换图，删旧的两个文件 |
| `DELETE` | `/api/admin/works/:id` | 删记录 + 删原图 + 删缩略图 |

### 5.4 双文件上传中间件

现有 `handleUpload(fieldName)` 是 `upload.single()`，只能接一个文件。本次需要两个文件 + 若干文本字段，故在 `server/index.ts` 并列新增：

```ts
function handleUploadFields(specs: { name: string; maxCount: number }[]) {
  return (req, res, next) => {
    upload.fields(specs)(req, res, (err: any) => {
      if (!err) return next();
      const payload = multerErrorPayload(err);   // 复用现有错误映射
      if (payload) return res.status(payload.status).json(payload.body);
      return next(err);
    });
  };
}
```

`limits.fileSize` 在 multer 里是**每文件**上限，所以 5MB 限制对原图和缩略图分别生效，缩略图当然远低于此。错误映射（413 超大 / 400 mime 不支持）复用现有 `multerErrorPayload()`，不新增文案。

### 5.5 删除的文件清理顺序

删除作品时**先删文件、再删记录**。反过来会在「记录已删、文件删失败」时留下永远无人引用的孤儿文件，而孤儿文件没有主键可追溯，后续清理无从下手。文件删除失败只记 `console.warn` 不阻断 —— 记录必须删掉，否则前端会一直显示一张点开 404 的卡片。

## 六、导出二维码

### 6.1 构建期生成

**`scripts/site-config.mjs`**（新增）：

```js
export const SITE_URL = 'https://www.xn--muu023g.xyz/';
export const WORKS_PATH = 'works';
export const WORKS_URL = `${SITE_URL}${WORKS_PATH}`;
```

`gen-sitemap.mjs` 删掉本地的 `SITE_URL` 定义，改为 `import { SITE_URL, WORKS_URL } from './site-config.mjs'`。二维码和 sitemap 因此不可能指向两个不同的域名。

> 诚实说明：域名硬编码从 4 处（`index.html` 的 canonical/og/twitter、`src/seo.test.ts`、`gen-sitemap.mjs`）收到 3 处。`index.html` 收不动是因为它是构建产物入口、没有模板注入机制；要彻底解决需要引入 HTML 模板化，属于构建流程改造，不在本次范围。

**`scripts/gen-qr.mjs`**（新增，挂进 `prebuild`）：

```js
const TARGET_URL = WORKS_URL;                    // https://www.xn--muu023g.xyz/works
const ERROR_CORRECTION = 'L';                    // 纠错最低 → 数据位最少 → 模块数最少
const MODULE_SIZE_PX = 3;
const QUIET_ZONE_MODULES = 4;
const EXPECTED_VERSION = 3;

const qr = QRCode.create(TARGET_URL, { errorCorrectionLevel: ERROR_CORRECTION });
if (qr.version !== EXPECTED_VERSION) {
  console.error(`[gen-qr] 期望 version ${EXPECTED_VERSION}，实际 ${qr.version}：` +
                `URL 变长了。二维码会变大，请确认后同步更新 EXPECTED_VERSION 与设计文档。`);
  process.exit(1);
}
await QRCode.toFile(outPath, TARGET_URL, {
  errorCorrectionLevel: ERROR_CORRECTION,
  margin: QUIET_ZONE_MODULES,
  scale: MODULE_SIZE_PX,
});
```

参数推导：

| 项 | 值 | 依据 |
|----|----|------|
| URL 长度 | 33 字符 | `https://` (8) + `www.xn--muu023g.xyz` (19) + `/works` (6) |
| 纠错等级 | **L**（7% 恢复） | 15% (M) 和 25% (Q) 会多出数据位，推高版本号 → 模块数变多 |
| 版本 | **3** = 29×29 模块 | L 级下 byte 模式容量 53 字符，33 字符落在版本 2（容量 32，刚好差 1）的上一档 |
| 模块像素 | 3 px | 2 px 能再省 44% 面积，但在手机上从「已保存的相册图」里扫，容错余量太小 |
| 静区 | 4 模块 | QR 规范下限，不可再省 |
| 成品 PNG | **111 × 111** | (29 + 2×4) × 3 |

**版本自检是硬失败**：URL 将来若变长（比如换更长的子域），二维码会自动升到版本 4（33×33 = 148px），静悄悄地把画面撑大。脚本在版本不符时非零退出，让 CI 叫出来。

产出 `public/brand/works-qr.png` **提交进仓库**，与 `public/sitemap.xml` 同样处理 —— 否则首次 `npm run dev`（不触发 `prebuild`）会 404。

`qrcode` 作为 **devDependency** 引入：它只在构建期跑，不会进前端 bundle，前端依赖树保持干净。

### 6.2 运行时绘制

`src/pipeline/qr.ts`，结构刻意对齐现有的 `watermark.ts`：

```ts
export const WORKS_QR_SRC = '/brand/works-qr.png';
export const QR_LOAD_TIMEOUT_MS = 1500;

export function ensureWorksQrImage(src = WORKS_QR_SRC): Promise<HTMLImageElement | null>;
export function drawWorksQr(canvas: HTMLCanvasElement, img: HTMLImageElement): void;
```

`ensureWorksQrImage` 照搬 `ensureWatermarkIcon` 的三件套：模块级 `Map` 缓存（先占位避免并发重复加载）、`onload`/`onerror` 双通道、1.5s 超时兜底（jsdom 根本不派发 img 事件，没有超时会一直挂着）。

`drawWorksQr` 的两个关键决定：

```ts
export function drawWorksQr(canvas: HTMLCanvasElement, img: HTMLImageElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1:1 原尺寸绘制。模块边长必须是整数 px，任何非整数缩放都会把模块糊在一起，
  // 糊了就扫不出来 —— 想换尺寸请改 scripts/gen-qr.mjs 重新构建。
  const size = img.naturalWidth;
  if (!size) return;

  const margin = DEFAULT_COMPOSITE_OPTIONS.padding;
  const x = canvas.width - margin - size;
  const y = canvas.height - margin - size;

  ctx.save();
  // 先铺不透明白底。即使将来版式改动让这块不再天然是白，也不会和色卡卡片
  // 的浅灰底 (#fbfbfc) 或边框混色 —— 二维码对底色对比度敏感。
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}
```

尺寸不写死在代码里，而是读 `img.naturalWidth`。构建期改 `MODULE_SIZE_PX` 后，运行时布局自动跟上，不存在两处数字对不上的可能。

### 6.3 版式改动

`src/pipeline/composite.ts`：

```ts
export interface CompositeOptions {
  // ... 现有字段
  /** 底部为二维码预留的额外留白带高度（px）。0 / 缺省 = 不预留。 */
  readonly qrBandPx?: number;
}

export const DEFAULT_COMPOSITE_OPTIONS = {
  // ... 现有字段
  qrBandPx: 0,
} as const;
```

`renderCompositeFromBoard` 里唯一改动是把尾部边距算宽：

```ts
const bottomPad = opts.padding + opts.qrBandPx;   // 原来是 opts.padding
const canvasH =
  opts.padding +
  opts.headerHeight +
  opts.sectionGap +
  beadCanvas.height +
  opts.sectionGap +
  legendH +
  bottomPad;
```

页眉 y、图纸 y、色卡的 y 和折行逻辑**一行都不动** —— 色卡的可用宽度仍由 `contentW` 决定，与 `padding` 无关，所以底部加宽不会引发色卡重排。

`renderCompositeFromBoard` 的现有调用方（测试、`renderComposite` 包装）不传该字段时行为完全不变，向后兼容。

### 6.4 接入点

`src/pipeline/pipeline.ts` 两条导出路径都接上：

```ts
async exportMulti(src, exportCellPx, selectedGridSize, extraGridSizes, ...) {
  for (...) {
    // ... 采样 / 量化 / 去背景 / 简化 / 裁剪（不变）

    // QR 是异步资源：先 await 拿到，再据此决定留白带高度。拿不到就 0，
    // 版式与现状完全一致，导出照常成功。
    const qrImage = await ensureWorksQrImage();

    const compositeCanvas = renderCompositeFromBoard(
      boardCanvas, boardIndices, boardW, boardH, this.palette, boardMask,
      { qrBandPx: qrImage ? qrImage.naturalHeight : 0 },
    );
    await drawWatermark(compositeCanvas);
    if (qrImage) drawWorksQr(compositeCanvas, qrImage);

    const blob = await canvasToBlob(compositeCanvas);
    triggerDownload(blob, `pingdou-${boardW}x${boardH}.png`);
  }
}
```

`exportComposite(result)`（单图导出路径）做同样处理，保证两条路径的成品图一致。

水印锚在 `header-right`（`watermarkPlacement()`），二维码锚在底部白带，两者垂直方向相隔整个图纸高度，**不存在互相遮挡的可能**。

### 6.5 降级矩阵

| 情况 | 行为 |
|------|------|
| QR 资源 404（漏跑 prebuild） | `ensureWorksQrImage` 1.5s 后返回 null → 不留白带、不画码、导出成功 |
| QR 资源被扩展/网络拦截 | 同上 |
| jsdom 单测环境 | 靠超时兜底返回 null，不挂起 |
| 二维码本身无法解码（构建期已自检） | 不会发生；构建期非零退出 |

## 七、前端页面与导航

### 7.1 路由

`src/router.ts`：

```ts
export type Route =
  | { name: 'home' }
  | { name: 'works-list' }
  | { name: 'work-detail'; id: number }
  | { name: 'statics' };

export function matchRoute(pathname: string): Route;
```

匹配规则（顺序即优先级）：

| pathname | Route |
|----------|-------|
| `` / `/` | `home` |
| `/works` `/works/` | `works-list` |
| `/works/123`（正整数） | `work-detail` id=123 |
| `/statics` 及其子路径 | `statics` |
| 其它 | `home` |

`main.tsx` 改为：

```tsx
const route = matchRoute(window.location.pathname);
if (route.name === 'works-list')     return <WorksListPage />;
if (route.name === 'work-detail')    return <WorkDetailPage id={route.id} />;
if (route.name === 'statics')        return <StaticsPage />;
return <App />;
```

站点的路由匹配是纯 pathname 判断（无 react-router），保持一致。**不引入 react-router** —— 为了三个路由加 ~12KB 依赖不划算，且现有 `/statics` 已经证明这个模式够用。抽成 `matchRoute` 而非继续堆 `startsWith` 链，是因为这是纯函数、极易单测，能把「什么路径渲染什么」这件事一次性钉死。

### 7.2 导航栏

`src/components/SiteNav.tsx`：两个条目 —— 「生成图纸」→ `/`，「作品库」→ `/works`。当前页高亮（`aria-current="page"`）。移动端收起为纯文字横排，不做汉堡菜单（两个条目不值得）。

挂在：首页 `<App>` 页眉下方、`WorksListPage`、`WorkDetailPage`。**不挂 `/statics`** —— 后台不需要往回跳，加了反而让后台界面变花。

### 7.3 `/works` 列表页

- 响应式网格（`repeat(auto-fill, minmax(220px, 1fr))`），卡片 = WebP 缩略图 + 标题
- 卡片长宽比用 `width` / `height` 预留（为 0 时不预留），缩略图加载完成不引起跳动
- `loading="lazy"`
- 点击整卡 → `/works/:id`
- 分页：`limit=20`，滚到底出现「加载更多」按钮（不做无限滚动，作品量级还小，按钮更省事也更好测）
- 加载中：骨架占位；加载失败：可重试的错误块；空列表：空状态文案 + 「去生成第一个图纸」入口
- 每页 `usePageView()` 已有实现，作品库复用

### 7.4 `/works/:id` 详情页

- 大图：`<img src={imageUrl} loading="eager">`（单图页没必要懒加载）
- 元信息：标题、描述、发布时间、原图尺寸与体积
- **「长按保存图片」提示**：常驻文案，不是弹窗。微信内置浏览器会拦截 `<a download>`，长按存相册是那里唯一可行的路径
- **「下载原图」按钮**：`<a href={imageUrl} download="{title}.png">`

**同一 URL 承担两种用途** —— 这是刻意设计，不需要额外路由：同一个 `/media/works/x.png` 被 `<img>` 引用时浏览器内联渲染（可长按保存），被带 `download` 属性的 `<a>` 引用时浏览器直接下载（微信外浏览器、Safari、Chrome 桌面端均生效）。因此**不需要** `Content-Disposition: attachment`，也**不需要** dev 路由 / nginx 各写一套 `?dl=1` 分支。iOS Safari 对 `download` 属性支持有限，所以 7.4 的长按提示是必须的兜底而非可选项。

- 无效 id 或 404：显示「作品不存在或已下架」+ 回列表的链接
- 「上一张 / 下一张」：本次不做。作品列表顺序会随上传变化，导航语义不稳，等列表页确定有稳定排序后再加

### 7.5 后台「作品」tab

`AdminDashboard` 的 `Tab` 联合类型加 `'works'`，按钮顺序放在「商品」之后。

`src/pages/admin/WorksTab.tsx`：

- **上传区**：复用 `UploadZone` 的拖拽 + 点选样式
  - 选图后**浏览器内**用 canvas 缩到长边 480px，`canvas.toBlob('image/webp', 0.82)` 得到缩略图
  - 原图与缩略图一起塞进同一个 `FormData`（字段名 `file` / `thumb`）POST
  - 同一张 `FormData` 里带上 `title` / `description` / `published`
  - 缩略图生成失败（如极端内存压力）不阻断上传，退化成「无缩略图」状态，服务端 `thumb_key` 留空
- **列表**：缩略图 + 标题 + 发布时间 + 「已上架/草稿」切换开关 + 删除按钮（删除前 `confirm`）
- **编辑**：行内改标题 / 描述，PUT 提交

缩略图放在浏览器生成，理由：服务端目前是纯 JS 依赖（`sql.js` / `ip2region` / `express`），加 `sharp` 会引入原生模块编译，拖慢 `npm ci` 和 CI 部署；而上传本来就发生在浏览器里，原图必然已经解码过一次，再缩一次没有额外 I/O。代价是将来若有非浏览器上传端，缩略图会缺失 —— 已在 3.2 定义了 `thumb_key` 为空的降级路径。

## 八、SEO 与部署

### 8.1 sitemap

`gen-sitemap.mjs` 在现有首页 `<url>` 之后追加：

```xml
<url>
  <loc>https://www.xn--muu023g.xyz/works</loc>
  <lastmod>${lastmod}</lastmod>
</url>
```

`lastmod` 沿用现有的「最近一次 git 提交日期」策略。

**单个 `/works/:id` 详情页不进 sitemap**，两条理由：作品数量随上传实时变动，维护一份逐条清单的成本高于收益；本项目是纯 SPA，详情页是客户端渲染，进 sitemap 反而给爬虫一批收录质量差的 URL。它们靠 `/works` 列表页内的链接被爬到。

### 8.2 robots.txt

`public/robots.txt` 现有规则不需要改：`/works` 是公开内容页，应当被索引。新增的 `/media/` 是图片资源目录 —— 被索引本身无害，但加进 Disallow 更干净，会一并更新（`.css` / `.js` 等扩展名同样处理）。

### 8.3 nginx

`docs/DEPLOY.md` 与 `docs/nginx-https-setup.md` 各补一段：

```nginx
location ~ ^/media/works/[0-9a-f]{16}(-t)?\.(png|webp)$ {
    alias /var/lib/pingdou/media/works/;
}
```

用正则 `location` 而不是 `/media/` 前缀匹配，让 nginx 层也把非法文件名挡在门外，与 dev 路由的严格度对齐。

注意这条是**正则 location**（`~` 前缀），alias 里的路径要跟着去掉正则捕获到的那段前缀 `works/`，这是 `alias` 在正则 location 下最常见的配错点 —— 写错会 404，而症状和「alias 末尾斜杠漏了」一模一样，排查时容易走偏。`/products/` 那条用的是普通前缀 location，两者写法不能照抄。

`assertRuntimePaths()` 补 `mkdirSync(PATHS.mediaDir, { recursive: true })`，与现有 `imagesDir` 兜底并列。

## 九、测试计划

| 测试文件 | 覆盖 |
|----------|------|
| `tests/unit/storage.test.ts` | `put`/`get`/`head`/`delete` 往返；`head` 对不存在文件返回 null；`delete` 对不存在文件静默成功；**`../../etc/passwd` 等穿越 key 被拒绝**；`publicUrl` 前缀拼接 |
| `tests/unit/server/works.test.ts` | 创建（含/不含缩略图）→ 公开列表只返 `published=1`；草稿走详情接口返回 404；改元数据；删除后文件确实从磁盘消失；`title` 空串回落「未命名作品」；`description` 超 2000 字符被截断 |
| `tests/unit/router.test.ts` | `matchRoute` 全分支：空串、`/`、`/works`、`/works/`、`/works/0`、`/works/abc`、`/works/12/x`、`/statics`、`/statics/sub`、未知路径 |
| `tests/unit/gen-qr.test.ts` | `execSync('node scripts/gen-qr.mjs')` 到临时目录；断言产出 PNG 的 IHDR 宽高 = 111；断言 `QRCode.create(WORKS_URL, {errorCorrectionLevel:'L'}).version === 3` |
| `tests/unit/composite.test.ts`（补） | 传 `qrBandPx: 111` 时 `canvasH` 比不传时恰好多 111；色卡首行 y 坐标与不传时**完全相同**；不传该字段时输出与改动前逐像素一致 |
| `tests/unit/qr.test.ts` | `ensureWorksQrImage` 加载失败/超时均 resolve `null`；`drawWorksQr` 在 `naturalWidth = 0` 时是 no-op；绘制位置 = `canvas.width - padding - size` |
| `src/pages/admin/WorksTab.test.tsx` | 渲染列表；上传走 FormData 且两个文件字段都在；切换 `published` 调 PUT；删除前弹 confirm |
| `src/pages/WorksListPage.test.tsx` | 加载态 / 空态 / 错误态；分页「加载更多」追加并保留已有项 |
| `src/pages/WorkDetailPage.test.tsx` | 渲染元信息；「下载原图」是带 `download` 属性的 `<a>` 指向 `imageUrl`；长按保存提示常驻；404 态 |

**端到端手测**（`npm run dev:full` + `npm run test:e2e`）：

1. 导出图纸 → 手机扫右下角二维码 → 落到 `/works`
2. 点卡片进详情 → 手机长按存图；桌面点「下载原图」
3. admin 后台上传一张图 → `/works` 立刻出现
4. 后台下架 → `/works` 不再显示；直连 `/works/:id` 返回「已下架」
5. 后台删除 → 磁盘上两个文件都没了
6. 删掉 `public/brand/works-qr.png` 后导出 → 仍能成功导出（无二维码），控制台有 warn

## 十、风险与开放问题

| 风险 | 影响 | 应对 |
|------|------|------|
| 微信扫一扫对 `xn--` punycode 域名的处理 | 若被识别成异常链接会拦 | 域名已上线且是权威域，风险低；内容也已在裸域 `拼豆.xyz` 可达 |
| iOS Safari `<a download>` 支持有限 | 桌面/移动 Safari 上「下载原图」可能变成新标签预览 | 已用「长按保存图片」提示兜底，两条路径都保留 |
| 作品库页面为 CSR，单页 SEO 弱 | 百度收录量可能低于预期 | 已列入非目标。若后续要做，走预渲染专项 |
| `/media/` 是新前缀，prod nginx 未同步 | 图片 404 | 部署清单已包含 nginx 改动；`DEPLOY.md` troubleshooting 表补一行「作品图 403/404 → 检查 `/media/` alias」 |
| `qrcode` 引入构建期依赖 | `npm ci` 多装一个包 | devDependency，不进生产 bundle；版本锁 `^1.5.4` |
| `qrcode` 引入构建期依赖 | `npm run build` 多了 prebuild 一步，若生产用 `npm ci --omit=dev` 会缺包 | 当前部署脚本与 GitHub Actions 都跑完整 `npm ci`（见 README「部署」与 `.github/workflows/main.yml`），不受影响。若将来改成 `--omit=dev`，需把 `gen-qr.mjs` 挪到独立 CI 步骤或直接提交产物（产物本来就要提交进仓库，删掉 `prebuild` 里那一行也能工作，只是换域名时要手动重跑脚本） |
| 浏览器生成缩略图时超大图占内存 | 低内存设备上传失败 | `MAX_IMAGE_BYTES = 5MB` 已在闸口前拦住；缩略图生成失败不阻断上传 |
