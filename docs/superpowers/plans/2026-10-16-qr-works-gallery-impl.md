# 导出二维码 + 公开作品库 + 后台上传 + 可插拔存储 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给导出的拼豆图纸右下角加一个可扫二维码（指向新作品库页），并把作品库做成公开可浏览、后台可上传、图片存储可换后端的完整子系统。

**Architecture:** 三条相对独立的改动线在 `/works` 这个页面汇合。① 构建期用 `scripts/gen-qr.mjs` 预生成一张写死参数的二维码 PNG 进 `public/brand/`，导出时 `drawImage` 贴进新预留的底部白边带——前端不引入二维码依赖。② 新增 `works` 表 + 最小 `StorageDriver` 接口（数据库只存 key 不存 URL），作品 CRUD 走该 driver，本地盘为唯一实现。③ 前端加 `matchRoute()` 纯函数路由，公开列表页 + 详情页，后台加第 4 个 tab。

**Tech Stack:** React 18 + TypeScript + Vite 5（前端）；Express 5 + `sql.js` + `multer`（后端）；vitest + supertest + @testing-library/react（测试）；构建期新增 `qrcode`（devDependency，仅 `prebuild` 使用，不进浏览器 bundle）。

**Spec:** `docs/superpowers/specs/2026-10-16-qr-works-gallery-design.md` —— 本计划的每条决策都能在该 spec 找到对应章节，实施时以 spec 为准。

## Global Constraints

- **权威域写死为** `https://www.xn--muu023g.xyz/`（punycode 形式）。新增的构建脚本一律从 `scripts/site-config.mjs` 读，不要再写第二份字面量。
- **二维码参数锁死**：内容 `https://www.xn--muu023g.xyz/works`（33 字符）、纠错等级 `L`、模块 3px、静区 4 模块 → version 3 = 29×29 → 成品 PNG **111×111**。版本号与 `scripts/gen-qr.mjs` 里的 `EXPECTED_VERSION` 不符时脚本必须非零退出。
- **数据库只存 key，绝不存 URL。** 对外地址一律 `storage.publicUrl(key)` 现算。任何时候都不要往 `works` 表加 `*_url` 列。
- **`works` 表不加 `order` / `downloads` / `slug` 列。** 排序用 `created_at DESC, id DESC`。详见 spec 3.6。
- **文件 URL 前缀是 `/media/`，key 形如 `works/<16hex>.png`**（缩略图 `works/<16hex>-t.webp`）。页面路由是 `/works`，两者故意不同前缀，见 spec 4.5。
- **`thumb_key` 为空串是合法降级态**，表示无缩略图，前端回落到用 `image_key` 当缩略图。不得因此报错。
- **二维码绘制失败一律降级，绝不阻断导出**：拿不到图 → 不留白带、不画码、导出照常成功。沿用 `watermark.ts` 的 "fail conservatively" 立场。
- **删作品时先删文件、再删 DB 记录**，文件删除失败只 `console.warn` 不阻断。理由见 spec 5.5。
- **测试命令**：单测 `npm test`；单文件 `npx vitest run tests/unit/xxx.test.ts`；类型检查 `npm run typecheck`。
- **commit message 用中文**，前缀沿用仓库惯例：`feat(...)` / `fix(...)` / `docs(...)`。
- 后端 TS 导入一律带 `.js` 后缀（`from './db.js'`）；前端用 `@/` 别名。
- `WorkSummary` / `WorkDetail` 类型在 `server/works.ts` 与 `src/api/works.ts` 各定义一份。这是仓库既有惯例（`Product` 在 `server/products.ts` 和 `src/types.ts` 也是两份），改动时两边必须同步。

---

### Task 1: 存储层（StorageDriver 接口 + LocalDiskDriver + mediaDir）

**Files:**
- Modify: `server/paths.ts:10-14`
- Create: `server/storage/types.ts`
- Create: `server/storage/localDisk.ts`
- Create: `server/storage/index.ts`
- Test: `tests/unit/storage.test.ts`

**Interfaces:**
- Consumes: 无（这是最底层的任务，不依赖其它任务）
- Produces:
  - `server/storage/types.ts`: `StoredObjectInfo { key: string; size: number; contentType: string }`、`StorageDriver { name; put; get; head; delete; publicUrl }`
  - `server/storage/localDisk.ts`: `class StorageNotFound extends Error`（`code === 'STORAGE_NOT_FOUND'`）、`class LocalDiskDriver implements StorageDriver`，构造函数 `(rootDir: string, urlPrefix: string)`
  - `server/storage/index.ts`: `export const storage: StorageDriver`（root = `PATHS.mediaDir`，urlPrefix = `'/media'`）
  - `server/paths.ts`: `PATHS.mediaDir: string`（= `join(DATA_DIR, 'media')`）

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/storage.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { LocalDiskDriver, StorageNotFound } from '../../server/storage/localDisk';

let root = '';
let driver: LocalDiskDriver;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'storage-test-'));
  driver = new LocalDiskDriver(root, '/media');
});

afterEach(() => {
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
});

const BODY = Buffer.from('hello-qr'); // 8 字节 —— 下面的 size 断言写死 8，别改成 BODY.byteLength（那样断言就自证了）

describe('LocalDiskDriver put/get 往返', () => {
  it('写入后能原样读回', async () => {
    await driver.put('works/aabbccddeeff0011.png', BODY, 'image/png');
    const back = await driver.get('works/aabbccddeeff0011.png');
    expect(back.equals(BODY)).toBe(true);
  });

  it('put 返回 key / 字节数 / contentType', async () => {
    const info = await driver.put('works/aabbccddeeff0011.png', BODY, 'image/png');
    expect(info).toEqual({ key: 'works/aabbccddeeff0011.png', size: 8, contentType: 'image/png' });
  });

  it('put 会自动创建缺失的中间目录', async () => {
    await driver.put('works/deep/nested/aabbccddeeff0011.png', BODY, 'image/png');
    expect(existsSync(join(root, 'works', 'deep', 'nested'))).toBe(true);
  });
});

describe('LocalDiskDriver get 的缺失语义', () => {
  it('读取不存在的 key 抛 StorageNotFound', async () => {
    await expect(driver.get('works/0000000000000000.png')).rejects.toBeInstanceOf(StorageNotFound);
  });

  it('StorageNotFound 带 STORAGE_NOT_FOUND code，便于调用方区分「没有」和「IO 坏了」', async () => {
    const err = await driver.get('works/0000000000000000.png').catch(e => e as StorageNotFound);
    expect((err as StorageNotFound).code).toBe('STORAGE_NOT_FOUND');
  });
});

describe('LocalDiskDriver head', () => {
  it('存在的文件返回 size', async () => {
    await driver.put('works/aabbccddeeff0011.png', BODY, 'image/png');
    const info = await driver.head('works/aabbccddeeff0011.png');
    expect(info?.size).toBe(8);
  });

  it('不存在的文件返回 null 而不是抛错', async () => {
    expect(await driver.head('works/0000000000000000.png')).toBeNull();
  });

  it('目录返回 null', async () => {
    mkdirSync(join(root, 'works'), { recursive: true });
    expect(await driver.head('works')).toBeNull();
  });
});

describe('LocalDiskDriver delete 的幂等性', () => {
  it('删除后文件不存在', async () => {
    await driver.put('works/aabbccddeeff0011.png', BODY, 'image/png');
    await driver.delete('works/aabbccddeeff0011.png');
    expect(existsSync(join(root, 'works', 'aabbccddeeff0011.png'))).toBe(false);
  });

  it('删除不存在的 key 不抛错 —— 清理路径必须幂等', async () => {
    await expect(driver.delete('works/0000000000000000.png')).resolves.toBeUndefined();
  });
});

describe('publicUrl', () => {
  it('拼接 URL 前缀和 key', () => {
    expect(driver.publicUrl('works/aabbccddeeff0011.png')).toBe('/media/works/aabbccddeeff0011.png');
  });

  it('前缀末尾多余的斜杠会被归一', () => {
    const d = new LocalDiskDriver(root, '/media/');
    expect(d.publicUrl('works/a.png')).toBe('/media/works/a.png');
  });
});

describe('路径穿越防护', () => {
  const evil = [
    '../escape.png',
    '../../etc/passwd',
    'works/../../escape.png',
    'works/./../../escape.png',
  ];
  for (const key of evil) {
    it(`拒绝 ${key}`, async () => {
      await expect(driver.put(key, BODY, 'image/png')).rejects.toThrow(/escapes root/);
    });
  }

  it('拒绝绝对路径 key', async () => {
    await expect(driver.put('/etc/passwd', BODY, 'image/png')).rejects.toThrow(/escapes root/);
  });

  it('前缀近似的兄弟目录不算通过 —— <root>-evil/ 必须被拒', async () => {
    // key 必须精确解析到刚建的 <root>-evil 本身。只有这样，裸 startsWith(rootDir)
    // 那种漏拼分隔符的实现才会误判为合法；写成 '../media-evil-x/x.png' 的话，
    // 它解析到 <root 父目录>/media-evil-x，和 <root> 毫无前缀关系，
    // 错误实现同样会拒 —— 用例就成了空转，守不住任何东西。
    const sibling = `${root}-evil`;
    mkdirSync(sibling, { recursive: true });
    try {
      await expect(driver.put(`../${basename(root)}-evil/x.png`, BODY, 'image/png'))
        .rejects.toThrow(/escapes root/);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('get / head / delete 同样受防护，不只是 put', async () => {
    await expect(driver.get('../escape.png')).rejects.toThrow(/escapes root/);
    await expect(driver.head('../escape.png')).rejects.toThrow(/escapes root/);
    await expect(driver.delete('../escape.png')).rejects.toThrow(/escapes root/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/storage.test.ts`
Expected: FAIL —— `Failed to resolve import "../../server/storage/localDisk"`

- [ ] **Step 3: 写接口定义**

创建 `server/storage/types.ts`：

```ts
/**
 * 作品图存储的最小能力集。实现者只需回答五个问题：
 * 怎么写、怎么读、存不存在、怎么删、这个 key 对外是什么地址。
 *
 * 刻意保持小 —— 每多一个方法，将来每多一个实现就多一份要维护的东西。
 */
export interface StoredObjectInfo {
  readonly key: string;
  readonly size: number;
  /** put 时传入、原样回显。本地盘不回读（无 sidecar），当前无调用方依赖该值。 */
  readonly contentType: string;
}

export interface StorageDriver {
  readonly name: string;

  put(key: string, body: Buffer, contentType: string): Promise<StoredObjectInfo>;
  get(key: string): Promise<Buffer>;
  /** 不存在返回 null（不是抛错）—— 「有没有」是查询语义，不是错误语义。 */
  head(key: string): Promise<StoredObjectInfo | null>;
  /** 删除不存在的 key 必须成功（幂等）。 */
  delete(key: string): Promise<void>;

  /**
   * key → 对外可访问 URL。本地盘返回 `/media/works/xxx.png`，S3 返回 CDN 地址。
   *
   * 这是「存储细节」和「前端拿到的地址」之间唯一的翻译层，正因为有它，
   * 数据库才只需要存 key、不存 URL（换存储时老数据一行不用洗）。
   */
  publicUrl(key: string): string;
}
```

- [ ] **Step 4: 写 LocalDiskDriver**

创建 `server/storage/localDisk.ts`：

```ts
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { StorageDriver, StoredObjectInfo } from './types.js';

/** key 在存储里查无此项。与「读文件时 IO 报错」区分开，调用方据此决定是否降级。 */
export class StorageNotFound extends Error {
  readonly code = 'STORAGE_NOT_FOUND';
  constructor(key: string) {
    super(`storage: key not found: ${key}`);
    this.name = 'StorageNotFound';
  }
}

export class LocalDiskDriver implements StorageDriver {
  readonly name = 'local-disk';

  private readonly rootDir: string;
  private readonly rootPrefix: string;
  private readonly urlPrefix: string;

  constructor(rootDir: string, urlPrefix: string) {
    this.rootDir = resolve(rootDir);
    // 比较必须用拼过分隔符的 root，否则 "<root>-evil/x.png" 会被 "<root>" 前缀误判为合法
    this.rootPrefix = this.rootDir.endsWith(sep) ? this.rootDir : this.rootDir + sep;
    this.urlPrefix = urlPrefix.replace(/\/+$/, '');
  }

  private resolveKey(key: string): string {
    const full = resolve(this.rootDir, key);
    if (!full.startsWith(this.rootPrefix)) {
      throw new Error(`storage: illegal key escapes root: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObjectInfo> {
    const full = this.resolveKey(key);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer> {
    const full = this.resolveKey(key);
    if (!existsSync(full)) throw new StorageNotFound(key);
    return readFileSync(full);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const full = this.resolveKey(key);
    try {
      const st = statSync(full);
      if (!st.isFile()) return null;
      // 本地盘的 contentType 无处可查（没存 sidecar），当前无调用方依赖它
      return { key, size: st.size, contentType: '' };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolveKey(key);
    try {
      unlinkSync(full);
    } catch (e) {
      // 幂等：删作品时原图和缩略图是两个独立调用，其中一个缺失
      // （比如缩略图当初生成失败过）不该让整个删除流程失败
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  publicUrl(key: string): string {
    return `${this.urlPrefix}/${key}`;
  }
}
```

- [ ] **Step 5: 给 PATHS 加 mediaDir**

修改 `server/paths.ts:10-14`，在 `imagesDir` 之后插入 `mediaDir`：

```ts
export const PATHS = {
  dataDir: DATA_DIR,
  imagesDir: join(DATA_DIR, 'images'),
  // 作品原图 + 缩略图。与 images/ 平级而不是塞进去：二者生命周期不同 ——
  // images/ 归商品模块所有，media/ 归 StorageDriver 所有，
  // driver 换实现时这个根目录可以整体换掉。
  mediaDir: join(DATA_DIR, 'media'),
  dbPath: join(DATA_DIR, 'stats.db'),
} as const;
```

- [ ] **Step 6: 写单例出口**

创建 `server/storage/index.ts`：

```ts
import { PATHS } from '../paths.js';
import { LocalDiskDriver } from './localDisk.js';
import type { StorageDriver } from './types.js';

/**
 * 全站唯一的存储实例。将来换 S3/OSS，改动面就是这个文件 + 新增一个 driver 实现。
 */
export const storage: StorageDriver = new LocalDiskDriver(PATHS.mediaDir, '/media');
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run tests/unit/storage.test.ts`
Expected: PASS，全部用例绿。

- [ ] **Step 8: 提交**

```bash
git add server/paths.ts server/storage/ tests/unit/storage.test.ts
git commit -m "feat(存储): 作品图 StorageDriver 接口 + LocalDiskDriver，含路径穿越防护"
```

---

### Task 2: works 表 + 作品查询层

**Files:**
- Modify: `server/db.ts:97`（`idx_products_order` 那行之后）
- Create: `server/works.ts`
- Test: `tests/unit/server/works.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `storage: StorageDriver`（`put` / `delete` / `publicUrl`）
- Produces:
  - `works` 表（DDL 见 Step 3）
  - `server/works.ts` 导出：
    - `interface WorkSummary { id: number; title: string; thumbUrl: string; width: number; height: number; createdAt: number }`
    - `interface WorkDetail extends WorkSummary { description: string; imageUrl: string; bytes: number; updatedAt: number }`
    - `interface WorkImage { body: Buffer; mime: string }`
    - `interface CreateWorkInput { title?: unknown; description?: unknown; published?: unknown; width?: unknown; height?: unknown; image: WorkImage; thumb?: WorkImage }`
    - `interface UpdateWorkMeta { title?: string; description?: string; published?: boolean }`
    - `function listPublishedWorks(limit: number, offset: number): { items: WorkSummary[]; total: number }` —— 同步
    - `function getPublishedWork(id: number): WorkDetail | null` —— 同步
    - `function listAllWorks(): WorkDetail[]` —— 同步（后台用，含草稿）
    - `function createWork(input: CreateWorkInput): Promise<WorkDetail>`
    - `function updateWorkMeta(id: number, patch: UpdateWorkMeta): Promise<WorkDetail>`
    - `function replaceWorkImage(id: number, image: WorkImage, thumb?: WorkImage): Promise<WorkDetail>`
    - `function deleteWork(id: number): Promise<void>`
    - `function normalizePublished(raw: unknown, fallback: boolean): boolean` —— 导出供路由复用

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/server/works.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp = '';

type WorksModule = typeof import('../../../server/works.js');
type PathsModule = typeof import('../../../server/paths.js');

async function freshWorks(): Promise<{ works: WorksModule; paths: PathsModule }> {
  tmp = mkdtempSync(join(tmpdir(), 'works-test-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  const paths = await import('../../../server/paths.js');
  const works = await import('../../../server/works.js');
  return { works, paths };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46]);

beforeEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('createWork', () => {
  it('写入记录并把原图落到 media/works/ 下', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({
      title: '粉色小熊',
      width: 1200, height: 1600,
      image: { body: PNG, mime: 'image/png' },
    });
    expect(w.id).toBeGreaterThan(0);
    expect(w.title).toBe('粉色小熊');
    expect(w.bytes).toBe(4);
    expect(existsSync(join(paths.PATHS.mediaDir, 'works'))).toBe(true);
    // imageUrl 由 driver 现算，不是存在 DB 里的
    expect(w.imageUrl).toMatch(/^\/media\/works\/[0-9a-f]{16}\.png$/);
  });

  it('无标题时回落为「未命名作品」', async () => {
    const { works } = await freshWorks();
    expect((await works.createWork({ title: '   ', image: { body: PNG, mime: 'image/png' } })).title)
      .toBe('未命名作品');
  });

  it('title 缺省（非 string）也回落为「未命名作品」', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ title: undefined, image: { body: PNG, mime: 'image/png' } });
    expect(w.title).toBe('未命名作品');
  });

  it('description 超 2000 字符被截断而非报错', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({
      description: 'x'.repeat(2500),
      image: { body: PNG, mime: 'image/png' },
    });
    expect(w.description).toHaveLength(2000);
  });

  it('非法 width/height 归零', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({
      width: 'abc', height: -5,
      image: { body: PNG, mime: 'image/png' },
    });
    expect(w.width).toBe(0);
    expect(w.height).toBe(0);
  });

  it('拒绝不支持的 mime', async () => {
    const { works } = await freshWorks();
    await expect(works.createWork({ image: { body: PNG, mime: 'image/gif' } }))
      .rejects.toThrow(/mime/);
  });

  it('缩略图必须是非 webp', async () => {
    const { works } = await freshWorks();
    await expect(works.createWork({
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(/webp/);
  });

  it('有缩略图时 thumbUrl 指向缩略图 key', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: WEBP, mime: 'image/webp' },
    });
    expect(w.thumbUrl).toMatch(/-t\.webp$/);
    // 原图和缩略图共享同一段随机 hex，肉眼可辨归属
    const hexOf = (u: string) => u.match(/\/([0-9a-f]{16})/)?.[1];
    expect(hexOf(w.imageUrl)).toBe(hexOf(w.thumbUrl));
  });

  it('无缩略图时 thumbUrl 回落为原图 URL', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ image: { body: PNG, mime: 'image/png' } });
    expect(w.thumbUrl).toBe(w.imageUrl);
  });

  it('published 缺省为 true，字符串 "0" 解析为 false', async () => {
    const { works } = await freshWorks();
    expect((await works.createWork({ image: { body: PNG, mime: 'image/png' } })).id).toBeGreaterThan(0);
    expect(works.listPublishedWorks(20, 0).total).toBe(1);
    const draft = await works.createWork({ published: '0', image: { body: PNG, mime: 'image/png' } });
    expect(works.listPublishedWorks(20, 0).total).toBe(1);
    expect(works.getPublishedWork(draft.id)).toBeNull();
  });
});

describe('listPublishedWorks', () => {
  it('草稿不出现在公开列表', async () => {
    const { works } = await freshWorks();
    await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    await works.createWork({ title: 'B', published: false, image: { body: PNG, mime: 'image/png' } });
    const { items, total } = works.listPublishedWorks(20, 0);
    expect(total).toBe(1);
    expect(items.map(i => i.title)).toEqual(['A']);
  });

  it('列表只暴露 summary，不含 description / imageUrl', async () => {
    const { works } = await freshWorks();
    await works.createWork({ title: 'A', description: '不该出现在列表', image: { body: PNG, mime: 'image/png' } });
    expect(works.listPublishedWorks(20, 0).items[0]).not.toHaveProperty('description');
    expect(works.listPublishedWorks(20, 0).items[0]).not.toHaveProperty('imageUrl');
  });

  it('limit 钳制到 [1,60]，offset 负数归零', async () => {
    const { works } = await freshWorks();
    for (let i = 0; i < 3; i++) {
      await works.createWork({ title: `W${i}`, image: { body: PNG, mime: 'image/png' } });
    }
    expect(works.listPublishedWorks(999, -5).items).toHaveLength(3);
    expect(works.listPublishedWorks(0, 0).items).toHaveLength(1);
  });

  it('按 created_at DESC 排序，最新在前', async () => {
    const { works } = await freshWorks();
    const a = await works.createWork({ title: 'first', image: { body: PNG, mime: 'image/png' } });
    await new Promise(r => setTimeout(r, 5));
    const b = await works.createWork({ title: 'second', image: { body: PNG, mime: 'image/png' } });
    const ids = works.listPublishedWorks(20, 0).items.map(i => i.id);
    expect(ids).toEqual([b.id, a.id]);
  });
});

describe('updateWorkMeta', () => {
  it('改标题/描述并更新 updated_at', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    const next = await works.updateWorkMeta(w.id, { title: 'B', description: 'd' });
    expect(next.title).toBe('B');
    expect(next.description).toBe('d');
    expect(next.updatedAt).toBeGreaterThanOrEqual(w.createdAt);
  });

  it('published 缺省字段不动现有值', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ published: false, image: { body: PNG, mime: 'image/png' } });
    await works.updateWorkMeta(w.id, { title: 'X' });
    expect(works.getPublishedWork(w.id)).toBeNull();
  });

  it('下架后公开详情 404', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ image: { body: PNG, mime: 'image/png' } });
    await works.updateWorkMeta(w.id, { published: false });
    expect(works.getPublishedWork(w.id)).toBeNull();
  });

  it('对不存在的 id 抛 work not found', async () => {
    const { works } = await freshWorks();
    await expect(works.updateWorkMeta(9999, { title: 'X' })).rejects.toThrow(/not found/);
  });
});

describe('listAllWorks', () => {
  it('后台列表包含草稿', async () => {
    const { works } = await freshWorks();
    await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    await works.createWork({ title: 'B', published: false, image: { body: PNG, mime: 'image/png' } });
    expect(works.listAllWorks()).toHaveLength(2);
  });
});

describe('replaceWorkImage', () => {
  it('换图后旧文件被删、URL 改变', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({ image: { body: PNG, mime: 'image/png' } });
    const oldFile = join(paths.PATHS.mediaDir, 'works', w.imageUrl.split('/').pop()!);
    expect(existsSync(oldFile)).toBe(true);

    const next = await works.replaceWorkImage(w.id, { body: WEBP, mime: 'image/webp' });
    expect(next.imageUrl).not.toBe(w.imageUrl);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(join(paths.PATHS.mediaDir, 'works', next.imageUrl.split('/').pop()!))).toBe(true);
  });

  it('换图会清掉旧缩略图', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: WEBP, mime: 'image/webp' },
    });
    const oldThumb = join(paths.PATHS.mediaDir, 'works', w.thumbUrl.split('/').pop()!);
    const next = await works.replaceWorkImage(w.id, { body: WEBP, mime: 'image/webp' });
    expect(existsSync(oldThumb)).toBe(false);
    // 没传新缩略图 → thumbKey 清空 → thumbUrl 回落为新原图
    expect(next.thumbUrl).toBe(next.imageUrl);
  });

  it('对不存在的 id 抛 work not found', async () => {
    const { works } = await freshWorks();
    await expect(works.replaceWorkImage(9999, { body: PNG, mime: 'image/png' }))
      .rejects.toThrow(/not found/);
  });
});

describe('deleteWork', () => {
  it('记录和两个文件一起消失', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: WEBP, mime: 'image/webp' },
    });
    const img = join(paths.PATHS.mediaDir, 'works', w.imageUrl.split('/').pop()!);
    const thumb = join(paths.PATHS.mediaDir, 'works', w.thumbUrl.split('/').pop()!);
    expect(existsSync(img)).toBe(true);
    expect(existsSync(thumb)).toBe(true);

    await works.deleteWork(w.id);
    expect(existsSync(img)).toBe(false);
    expect(existsSync(thumb)).toBe(false);
    expect(works.listAllWorks()).toHaveLength(0);
  });

  it('无缩略图的作品也能删', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({ image: { body: PNG, mime: 'image/png' } });
    await expect(works.deleteWork(w.id)).resolves.toBeUndefined();
    expect(existsSync(join(paths.PATHS.mediaDir, 'works'))).toBe(true); // 目录留着，不删目录
  });

  it('对不存在的 id 抛 work not found', async () => {
    const { works } = await freshWorks();
    await expect(works.deleteWork(9999)).rejects.toThrow(/not found/);
  });
});

describe('normalizePublished', () => {
  it('接受 multipart 的字符串形式', async () => {
    const { works } = await freshWorks();
    expect(works.normalizePublished('1', false)).toBe(true);
    expect(works.normalizePublished('true', false)).toBe(true);
    expect(works.normalizePublished('on', false)).toBe(true);
    expect(works.normalizePublished('0', true)).toBe(false);
    expect(works.normalizePublished('false', true)).toBe(false);
    expect(works.normalizePublished('', true)).toBe(false);
  });

  it('undefined/null 走 fallback', async () => {
    const { works } = await freshWorks();
    expect(works.normalizePublished(undefined, true)).toBe(true);
    expect(works.normalizePublished(null, false)).toBe(false);
  });

  it('接受真正的 boolean', async () => {
    const { works } = await freshWorks();
    expect(works.normalizePublished(true, false)).toBe(true);
    expect(works.normalizePublished(false, true)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/works.test.ts`
Expected: FAIL —— `Failed to resolve import "../../../server/works.js"`

- [ ] **Step 3: 建 works 表**

修改 `server/db.ts`，在 `CREATE INDEX IF NOT EXISTS idx_products_order ON products("order");` 那一行之后、`CREATE TABLE IF NOT EXISTS auth_tokens (` 之前插入：

```sql
    -- 作品库（2026-10-16）。导出图纸右下角二维码指向 /works，扫码用户在这里找图。
    -- 只存存储层 key，不存 URL：对外地址一律由 StorageDriver.publicUrl() 现算，
    -- 这样换存储实现时老数据一行都不用洗。
    -- 刻意不加 order / downloads / slug，理由见 spec 3.6。
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

这是全新表，`CREATE TABLE IF NOT EXISTS` 对新库和存量库都是同一条语句，**不需要** `ensureColumn()` 迁移。

- [ ] **Step 4: 写 works.ts**

创建 `server/works.ts`：

```ts
import { randomBytes } from 'node:crypto';
import { queryAll, runStmt, flushNow } from './db.js';
import { storage } from './storage/index.js';

/**
 * 公开列表用的摘要。注意它刻意不含 description / imageUrl ——
 * 列表页只需要一张缩略图，把大图地址塞进列表响应是白给流量。
 */
export interface WorkSummary {
  id: number;
  title: string;
  thumbUrl: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface WorkDetail extends WorkSummary {
  description: string;
  imageUrl: string;
  bytes: number;
  /** 元数据改动时间。列表不需要它，详情页和后台用得上。 */
  updatedAt: number;
}

export interface WorkImage {
  body: Buffer;
  mime: string;
}

export interface CreateWorkInput {
  title?: unknown;
  description?: unknown;
  published?: unknown;
  width?: unknown;
  height?: unknown;
  image: WorkImage;
  thumb?: WorkImage;
}

export interface UpdateWorkMeta {
  title?: string;
  description?: string;
  published?: boolean;
}

interface WorkRow {
  id: number;
  title: string;
  description: string;
  image_key: string;
  thumb_key: string;
  width: number;
  height: number;
  bytes: number;
  published: number;
  created_at: number;
  updated_at: number;
}

const MAX_DESCRIPTION = 2000;
const MAX_TITLE = 200;
const FALLBACK_TITLE = '未命名作品';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK_TITLE;
  const t = raw.trim();
  if (t.length === 0) return FALLBACK_TITLE;
  return t.slice(0, MAX_TITLE);
}

function normalizeDescription(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.slice(0, MAX_DESCRIPTION);
}

function normalizeDimension(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * multipart 的文本字段一律是字符串，JSON 接口则是真 boolean。
 * 空串 / '0' / 'false' 都算「明确的关」——未勾选的 checkbox 在 multipart 里
 * 干脆不出现（undefined），那种情况才走 fallback。
 */
export function normalizePublished(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  return raw !== '' && raw !== '0' && raw !== 'false';
}

function toSummary(row: WorkRow): WorkSummary {
  return {
    id: row.id,
    title: row.title,
    thumbUrl: storage.publicUrl(row.thumb_key || row.image_key),
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}

function toDetail(row: WorkRow): WorkDetail {
  return {
    ...toSummary(row),
    description: row.description,
    imageUrl: storage.publicUrl(row.image_key),
    bytes: row.bytes,
  };
}

function rowById(id: number): WorkRow | null {
  const rows = queryAll<WorkRow>(`SELECT * FROM works WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

function requireRow(id: number): WorkRow {
  const row = rowById(id);
  if (!row) throw new Error('work not found');
  return row;
}

function extFor(mime: string, what: string): string {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`unsupported ${what} mime type`);
  return ext;
}

export function listPublishedWorks(
  limit: number,
  offset: number
): { items: WorkSummary[]; total: number } {
  // 注意别写成 `Math.floor(limit) || 20`：0 是合法的"要 1 条"信号，
  // 被 || 当假值吞掉后会变成默认 20 条，与「limit 钳制到 [1,60]」的用例冲突。
  const lim = Math.max(1, Math.min(60, Number.isFinite(limit) ? Math.floor(limit) : 20));
  const off = Math.max(0, Math.floor(offset) || 0);
  const rows = queryAll<WorkRow>(
    `SELECT * FROM works
      WHERE published = 1
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [lim, off]
  );
  const totalRows = queryAll<{ total: number }>(
    `SELECT COUNT(*) AS total FROM works WHERE published = 1`
  );
  return { items: rows.map(toSummary), total: totalRows[0]?.total ?? 0 };
}

/** 草稿一律返回 null —— 不区分「不存在」和「未上架」，避免用状态码探测草稿。 */
export function getPublishedWork(id: number): WorkDetail | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = rowById(id);
  if (!row || row.published !== 1) return null;
  return toDetail(row);
}

/** 后台管理用：含草稿。 */
export function listAllWorks(): WorkDetail[] {
  return queryAll<WorkRow>(
    `SELECT * FROM works ORDER BY created_at DESC, id DESC`
  ).map(toDetail);
}

export async function createWork(input: CreateWorkInput): Promise<WorkDetail> {
  const ext = extFor(input.image.mime, 'image');
  if (input.thumb) {
    const thumbExt = extFor(input.thumb.mime, 'thumb');
    if (thumbExt !== '.webp') throw new Error('thumb must be image/webp');
  }

  const hex = randomBytes(8).toString('hex');
  const imageKey = `works/${hex}${ext}`;
  const thumbKey = input.thumb ? `works/${hex}-t.webp` : '';

  await storage.put(imageKey, input.image.body, input.image.mime);
  if (input.thumb) {
    // 缩略图写失败不回滚原图和记录：没有缩略图是可降级状态
    // （前端会用原图当缩略图），强行失败反而让用户白传一次大图
    await storage.put(thumbKey, input.thumb.body, input.thumb.mime).catch(e => {
      console.warn('[works] 缩略图写入失败，降级为无缩略图', e);
    });
  }

  const now = Date.now();
  runStmt(
    `INSERT INTO works
       (title, description, image_key, thumb_key, width, height, bytes, published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizeTitle(input.title),
      normalizeDescription(input.description),
      imageKey,
      thumbKey,
      normalizeDimension(input.width),
      normalizeDimension(input.height),
      input.image.body.byteLength,
      normalizePublished(input.published, true) ? 1 : 0,
      now,
      now,
    ]
  );
  // 用 last_insert_rowid() 而不是 image_key 回读：image_key 碰撞的概率极低，
  // 但真撞上会「静默返回另一条作品的数据（含它的标题）」，不报错，最难排查。
  //
  // 顺序有讲究：必须在 flushNow() 之前读。flushNow() 里的 db.export() 会把
  // 连接的 last_insert_rowid 复位成 0（sql.js 实测），先 flush 再查必然查不到行。
  const created = queryAll<WorkRow>(`SELECT * FROM works WHERE id = last_insert_rowid()`);
  if (!created[0]) throw new Error('createWork: missing after insert');
  flushNow();

  return toDetail(created[0]);
}

export async function updateWorkMeta(id: number, patch: UpdateWorkMeta): Promise<WorkDetail> {
  const row = requireRow(id);
  const next: WorkRow = { ...row };
  if (typeof patch.title === 'string') next.title = normalizeTitle(patch.title);
  if (typeof patch.description === 'string') next.description = normalizeDescription(patch.description);
  if (typeof patch.published === 'boolean') next.published = patch.published ? 1 : 0;
  next.updated_at = Date.now();

  runStmt(
    `UPDATE works SET title=?, description=?, published=?, updated_at=? WHERE id=?`,
    [next.title, next.description, next.published, next.updated_at, id]
  );
  flushNow();
  return toDetail(next);
}

export async function replaceWorkImage(
  id: number,
  image: WorkImage,
  thumb?: WorkImage
): Promise<WorkDetail> {
  const row = requireRow(id);
  const ext = extFor(image.mime, 'image');
  if (thumb) {
    const thumbExt = extFor(thumb.mime, 'thumb');
    if (thumbExt !== '.webp') throw new Error('thumb must be image/webp');
  }

  const hex = randomBytes(8).toString('hex');
  const imageKey = `works/${hex}${ext}`;
  const thumbKey = thumb ? `works/${hex}-t.webp` : '';

  await storage.put(imageKey, image.body, image.mime);
  if (thumb) {
    await storage.put(thumbKey, thumb.body, thumb.mime).catch(e => {
      console.warn('[works] 缩略图写入失败，降级为无缩略图', e);
    });
  }

  const next: WorkRow = {
    ...row,
    image_key: imageKey,
    thumb_key: thumbKey,
    bytes: image.body.byteLength,
    updated_at: Date.now(),
  };
  runStmt(
    `UPDATE works SET image_key=?, thumb_key=?, bytes=?, updated_at=? WHERE id=?`,
    [imageKey, thumbKey, next.bytes, next.updated_at, id]
  );

  // 记录指向新文件之后才删旧文件：反过来若删失败，会留下一条指向已删文件的记录
  await removeQuietly(row.image_key);
  await removeQuietly(row.thumb_key);

  flushNow();
  return toDetail(next);
}

export async function deleteWork(id: number): Promise<void> {
  const row = requireRow(id);
  // 先删文件、再删记录。反过来会在「记录已删、文件删失败」时留下永远无人引用的
  // 孤儿文件，而孤儿文件没有主键可追溯，后续清理无从下手。
  // 文件删失败只 warn 不阻断 —— 记录必须删掉，否则前台会一直显示点开 404 的卡片。
  await removeQuietly(row.image_key);
  await removeQuietly(row.thumb_key);
  runStmt(`DELETE FROM works WHERE id = ?`, [id]);
  flushNow();
}

async function removeQuietly(key: string): Promise<void> {
  if (!key) return;
  try {
    await storage.delete(key);
  } catch (e) {
    console.warn('[works] 文件删除失败（可能已是孤儿文件）', key, e);
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/works.test.ts`
Expected: PASS。

- [ ] **Step 6: 跑全量单测确认没打破既有测试**

Run: `npm test`
Expected: 全部 PASS（新增 works 用例也在内）。

- [ ] **Step 7: 提交**

```bash
git add server/db.ts server/works.ts tests/unit/server/works.test.ts
git commit -m "feat(作品库): works 表 + 作品 CRUD，DB 只存 key 不存 URL"
```

---

### Task 3: API 路由（公开 + admin + /media 静态 + nginx）

**Files:**
- Modify: `server/index.ts`（`assertRuntimePaths()` 约 36-41 行；`handleUpload` 约 74-83 行；`/products/:filename` 路由约 403-417 行之后）
- Modify: `docs/DEPLOY.md`（troubleshooting 表）
- Modify: `docs/nginx-https-setup.md`（`location /products/` 一节）
- Test: `tests/unit/server/works-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `storage`、`PATHS.mediaDir`；Task 2 的 `listPublishedWorks` / `getPublishedWork` / `listAllWorks` / `createWork` / `updateWorkMeta` / `replaceWorkImage` / `deleteWork` / `normalizePublished`
- Produces:
  - `GET /api/public/works?limit&offset` → `{ items: WorkSummary[]; total: number }`
  - `GET /api/public/works/:id` → `WorkDetail` | 404
  - `POST /api/admin/works` → `WorkDetail`
  - `PUT /api/admin/works/:id` → `WorkDetail`
  - `POST /api/admin/works/:id/image` → `WorkDetail`
  - `DELETE /api/admin/works/:id` → `{ ok: true }`
  - `GET /media/works/:filename` → 图片字节（dev-only 兜底）
  - `GET /api/admin/works` → `WorkDetail[]`（后台列表，含草稿）

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/server/works-routes.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let tmp = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'works-routes-'));
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
  const paths = await import('../../../server/paths.js');
  const works = await import('../../../server/works.js');
  const { app } = await import('../../../server/index.js');
  return { app, paths, works };
}

/** 起一个已登录的 admin 会话，拿 cookie 用 */
async function loginAdmin(app: unknown): Promise<string> {
  const db = await import('../../../server/db.js');
  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  const admin = users.getUserByUsername('root')!;
  users.setUserPassword(admin.id, 'testpass1');
  const r = await request(app as never)
    .post('/api/auth/login')
    .send({ username: 'root', password: 'testpass1' });
  expect(r.status).toBe(200);
  const cookies = r.headers['set-cookie'] as unknown as string[];
  return cookies.map(c => c.split(';')[0]).join('; ');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('GET /api/public/works', () => {
  it('无需登录即可拿到已上架作品', async () => {
    const { app, works } = await bootApp();
    await works.createWork({ title: '小熊', image: { body: PNG, mime: 'image/png' } });
    const r = await request(app).get('/api/public/works');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.items[0].title).toBe('小熊');
    expect(r.body.items[0].thumbUrl).toMatch(/^\/media\/works\/[0-9a-f]{16}\.png$/);
  });

  it('limit / offset 生效', async () => {
    const { app, works } = await bootApp();
    for (const t of ['A', 'B', 'C']) {
      await works.createWork({ title: t, image: { body: PNG, mime: 'image/png' } });
    }
    const r = await request(app).get('/api/public/works?limit=2&offset=1');
    expect(r.body.items).toHaveLength(2);
    expect(r.body.total).toBe(3);
  });
});

describe('GET /api/public/works/:id', () => {
  it('返回详情含 imageUrl', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({ title: 'A', description: 'd', image: { body: PNG, mime: 'image/png' } });
    const r = await request(app).get(`/api/public/works/${w.id}`);
    expect(r.status).toBe(200);
    expect(r.body.imageUrl).toBe(w.imageUrl);
    expect(r.body.description).toBe('d');
  });

  it('草稿返回 404（不区分不存在与未上架）', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({ published: false, image: { body: PNG, mime: 'image/png' } });
    expect((await request(app).get(`/api/public/works/${w.id}`)).status).toBe(404);
    expect((await request(app).get('/api/public/works/99999')).status).toBe(404);
  });

  it('非数字 id 返回 404 而不是 500', async () => {
    const { app } = await bootApp();
    expect((await request(app).get('/api/public/works/abc')).status).toBe(404);
  });
});

describe('GET /media/works/:filename', () => {
  it('合法文件名正常返回 PNG', async () => {
    const { app, paths } = await bootApp();
    mkdirSync(join(paths.PATHS.mediaDir, 'works'), { recursive: true });
    writeFileSync(join(paths.PATHS.mediaDir, 'works', 'aabbccddeeff0011.png'), PNG);
    const r = await request(app).get('/media/works/aabbccddeeff0011.png');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/image\/png/);
  });

  it('合法缩略图文件名正常返回', async () => {
    const { app, paths } = await bootApp();
    mkdirSync(join(paths.PATHS.mediaDir, 'works'), { recursive: true });
    writeFileSync(join(paths.PATHS.mediaDir, 'works', 'aabbccddeeff0011-t.webp'), PNG);
    const r = await request(app).get('/media/works/aabbccddeeff0011-t.webp');
    expect(r.status).toBe(200);
  });

  it('文件不存在返回 404', async () => {
    const { app } = await bootApp();
    expect((await request(app).get('/media/works/0000000000000000.png')).status).toBe(404);
  });

  it('非法文件名一律 400，不落到 sendFile', async () => {
    const { app } = await bootApp();
    for (const bad of ['..%2F..%2Fetc%2Fpasswd.png', 'nothex.png', 'aabbccddeeff0011.exe']) {
      expect((await request(app).get(`/media/works/${bad}`)).status).toBe(400);
    }
  });
});

describe('admin 作品接口', () => {
  it('未登录一律 401', async () => {
    const { app } = await bootApp();
    expect((await request(app).post('/api/admin/works')).status).toBe(401);
    expect((await request(app).get('/api/admin/works')).status).toBe(401);
  });

  it('创建作品：multipart 带 file + thumb + 文本字段', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const r = await request(app)
      .post('/api/admin/works')
      .set('Cookie', cookie)
      .field('title', '上传的作品')
      .field('description', '描述')
      .field('width', '800')
      .field('height', '600')
      .field('published', '1')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .attach('thumb', PNG, { filename: 'a.webp', contentType: 'image/webp' });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('上传的作品');
    expect(r.body.width).toBe(800);
    expect(r.body.thumbUrl).toMatch(/-t\.webp$/);
  });

  it('创建作品：只有 file 也行（无缩略图降级）', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const r = await request(app)
      .post('/api/admin/works')
      .set('Cookie', cookie)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(r.status).toBe(200);
    expect(r.body.thumbUrl).toBe(r.body.imageUrl);
  });

  it('创建作品：缺 file 返回 400', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const r = await request(app).post('/api/admin/works').set('Cookie', cookie).field('title', 'x');
    expect(r.status).toBe(400);
  });

  it('创建作品：published=0 存为草稿', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const r = await request(app)
      .post('/api/admin/works')
      .set('Cookie', cookie)
      .field('published', '0')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(r.status).toBe(200);
    expect((await request(app).get(`/api/public/works/${r.body.id}`)).status).toBe(404);
    const list = await request(app).get('/api/admin/works').set('Cookie', cookie);
    expect(list.body).toHaveLength(1);
  });

  it('改元数据 / 换图 / 删除', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const created = await request(app)
      .post('/api/admin/works')
      .set('Cookie', cookie)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });

    const put = await request(app)
      .put(`/api/admin/works/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ title: '改过的标题' });
    expect(put.status).toBe(200);
    expect(put.body.title).toBe('改过的标题');

    const img = await request(app)
      .post(`/api/admin/works/${created.body.id}/image`)
      .set('Cookie', cookie)
      .attach('file', PNG, { filename: 'b.webp', contentType: 'image/webp' });
    expect(img.status).toBe(200);
    expect(img.body.imageUrl).not.toBe(created.body.imageUrl);

    const del = await request(app).delete(`/api/admin/works/${created.body.id}`).set('Cookie', cookie);
    expect(del.status).toBe(200);
    expect((await request(app).get('/api/admin/works').set('Cookie', cookie)).body).toHaveLength(0);
  });

  it('删除不存在的作品返回 404', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    expect((await request(app).delete('/api/admin/works/99999').set('Cookie', cookie)).status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/works-routes.test.ts`
Expected: FAIL —— 路由不存在（返回 404 或 Express 默认 HTML）。

- [ ] **Step 3: 补建 mediaDir**

修改 `server/index.ts` 的 `assertRuntimePaths()`，在 `mkdirSync(PATHS.imagesDir, ...)` 之后加一行：

```ts
  mkdirSync(PATHS.mediaDir, { recursive: true });
```

- [ ] **Step 4: 加多文件上传中间件**

在 `server/index.ts` 的 `handleUpload` 函数之后、`export const app = express();` 之前插入：

```ts
/** 两个文件 + 若干文本字段的上传（如作品原图 + 浏览器端生成的缩略图）。 */
function handleUploadFields(specs: { name: string; maxCount: number }[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    upload.fields(specs)(req, res, (err: any) => {
      if (!err) return next();
      const payload = multerErrorPayload(err); // 复用现有错误映射，不新增文案
      if (payload) return res.status(payload.status).json(payload.body);
      return next(err);
    });
  };
}
```

- [ ] **Step 5: 加 import**

在 `server/index.ts` 顶部 import 区，`import { reconcileAssignments, ... } from './assignments.js';` 之后加：

```ts
import {
  listPublishedWorks, getPublishedWork, listAllWorks,
  createWork, updateWorkMeta, replaceWorkImage, deleteWork,
  normalizePublished,
  type UpdateWorkMeta,
} from './works.js';
```

- [ ] **Step 6: 加公开接口 + /media 静态路由**

在 `server/index.ts` 的 `app.get('/api/public/products', ...)` 这一整块之后插入：

```ts
app.get('/api/public/works', (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    return res.json(listPublishedWorks(limit, offset));
  } catch (e) {
    console.error('[public/works]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

app.get('/api/public/works/:id', (req, res) => {
  try {
    const work = getPublishedWork(Number(req.params.id));
    if (!work) return res.status(404).json({ error: 'not found' });
    return res.json(work);
  } catch (e) {
    console.error('[public/works/:id]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

// dev-only 兜底：把 /media/works/<file> 直读盘。生产走 nginx location 直读，性能更高。
// 文件名走严格白名单，非法名字一律 400 —— 不落到 sendFile 上给路径穿越留机会。
const MEDIA_FILENAME_RE = /^[0-9a-f]{16}\.png$/;
const MEDIA_THUMB_RE = /^[0-9a-f]{16}-t\.webp$/;
app.get('/media/works/:filename', (req, res) => {
  const filename = String(req.params.filename ?? '');
  if (!MEDIA_FILENAME_RE.test(filename) && !MEDIA_THUMB_RE.test(filename)) {
    return res.status(400).json({ error: 'invalid filename' });
  }
  const fullPath = join(PATHS.mediaDir, 'works', filename);
  res.sendFile(fullPath, (err) => {
    if (!err) return;
    if ((err as any).code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    console.error('[media/works/:filename] sendFile failed', err);
    if (!res.headersSent) res.status(500).json({ error: 'serve failed' });
  });
});
```

需要在 `server/index.ts` 顶部补 `import { join } from 'node:path';`（若尚未引入）。

- [ ] **Step 7: 加 admin 接口**

同样在 `/api/public/works/:id` 之后插入：

```ts
const WORK_IMAGE_FIELDS = [
  { name: 'file', maxCount: 1 },
  { name: 'thumb', maxCount: 1 },
];

function workImageFrom(req: express.Request, field: 'file' | 'thumb') {
  const files = (req as any).files as Record<string, Express.Multer.File[]> | undefined;
  const f = files?.[field]?.[0];
  return f ? { body: f.buffer, mime: f.mimetype } : undefined;
}

app.get('/api/admin/works', requireAuth, requireAdmin, (_req, res) => {
  try {
    return res.json(listAllWorks());
  } catch (e) {
    console.error('[admin/works]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

app.post('/api/admin/works', requireAuth, requireAdmin, handleUploadFields(WORK_IMAGE_FIELDS), async (req, res) => {
  const image = workImageFrom(req, 'file');
  if (!image) return res.status(400).json({ error: 'file required' });
  try {
    return res.json(await createWork({
      title: req.body?.title,
      description: req.body?.description,
      published: req.body?.published,
      width: req.body?.width,
      height: req.body?.height,
      image,
      thumb: workImageFrom(req, 'thumb'),
    }));
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'create failed' });
  }
});

app.put('/api/admin/works/:id', requireAuth, requireAdmin, async (req, res) => {
  const { title, description, published } = req.body ?? {};
  const patch: UpdateWorkMeta = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof description === 'string') patch.description = description;
  if (published !== undefined) patch.published = normalizePublished(published, true);
  try {
    return res.json(await updateWorkMeta(Number(req.params.id), patch));
  } catch (e: any) {
    return res.status(404).json({ error: e.message ?? 'update failed' });
  }
});

app.post('/api/admin/works/:id/image', requireAuth, requireAdmin, handleUploadFields(WORK_IMAGE_FIELDS), async (req, res) => {
  const image = workImageFrom(req, 'file');
  if (!image) return res.status(400).json({ error: 'file required' });
  try {
    return res.json(await replaceWorkImage(Number(req.params.id), image, workImageFrom(req, 'thumb')));
  } catch (e: any) {
    return res.status(404).json({ error: e.message ?? 'upload failed' });
  }
});

app.delete('/api/admin/works/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await deleteWork(Number(req.params.id));
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(404).json({ error: e.message ?? 'delete failed' });
  }
});
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/works-routes.test.ts`
Expected: PASS。

- [ ] **Step 9: 更新 nginx 与部署文档**

在 `docs/nginx-https-setup.md` 的 `### 4.4 location /products/ 的 alias` 一节之后追加：

```markdown
### 4.5 `location /media/works/` 的正则 alias

作品原图与缩略图（admin 上传，前台作品库展示）走这条：

```nginx
location ~ ^/media/works/(?<file>[0-9a-f]{16}(-t)?\.(png|webp))$ {
    alias /var/lib/pingdou/media/works/$file;
}
```

⚠️ 这里是**正则 location**（`~` 前缀），不是前缀 `location`，两者写法不能照抄。

关键在于 nginx 在正则 location 下用 `alias` 时的替换语义：**用 alias 的值替换掉
URI 中被这个正则匹配掉的那一段，剩余部分再追加在后面。** 所以正则里必须用捕获组
把文件名单独摘出来（`(?<file>...)` + alias 里的 `$file`）。

如果写成 `location ~ ^/media/works/[0-9a-f]{16}(-t)?\.(png|webp)$ { alias .../media/works/; }`
—— 正则带 `$` 锚点匹配的是**整条 URI**，剩余部分为空，拼出来只有目录没有文件名，
**恒 404**。这个失败模式很容易被误判成「alias 末尾漏了斜杠」，排查会走偏。
```

在 `docs/DEPLOY.md` 的 troubleshooting 表里追加一行：

```
| 作品图 404 / 403 | `chmod -R a+rX /var/lib/pingdou/media` + 确认 nginx 有 `location ~ ^/media/works/...` 正则 alias（不是 `/media/` 前缀 location） |
```

并在 `docs/DEPLOY.md` 的目录树示意里加上 `media/`（参照现有 `/products/` 那行）。

- [ ] **Step 10: 跑全量测试 + 类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部通过，typecheck 0 错误。

- [ ] **Step 11: 提交**

```bash
git add server/index.ts docs/DEPLOY.md docs/nginx-https-setup.md tests/unit/server/works-routes.test.ts
git commit -m "feat(作品库): 公开/后台作品 API + /media 静态兜底 + nginx 文档"
```

---

### Task 4: 构建期产物（site-config / gen-qr / sitemap / robots）

**Files:**
- Create: `scripts/site-config.mjs`
- Create: `scripts/gen-qr.mjs`
- Create: `public/brand/works-qr.png`（生成产物，**提交进仓库**）
- Modify: `scripts/gen-sitemap.mjs`
- Modify: `package.json:11`（`prebuild`）、`package.json:53`（devDependencies）
- Modify: `public/robots.txt`
- Modify: `src/seo.test.ts`
- Test: `tests/unit/gen-qr.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `scripts/site-config.mjs`: `SITE_URL: string`、`WORKS_PATH: string`、`WORKS_URL: string`
  - `scripts/gen-qr.mjs`: 写出 `public/brand/works-qr.png`（111×111）；URL 或版本不符时 `process.exit(1)`
  - `gen-sitemap.mjs` 输出新增 `/works` 条目
  - 前端后续任务可依赖的静态资源：`GET /brand/works-qr.png`

- [ ] **Step 1: 装依赖并确认 API 形状**

Run: `npm install --save-dev qrcode@^1.5.4`
然后确认导出形状（`qrcode` 是 CJS，ESM 里用 default import）：

Run: `node -e "import('qrcode').then(m=>{const q=m.default;const r=q.create('https://www.xn--muu023g.xyz/works',{errorCorrectionLevel:'L'});console.log('version',r.version,'size',r.modules.size,'toBuffer',typeof q.toBuffer);})"`
Expected: 输出 `version 3 size 29 toBuffer function`。

若 `m.default.create` 不存在，改用 `import { create, toBuffer } from 'qrcode'`，并在 Step 3 的脚本里相应调整导入形式。**以这一步的实际输出为准，不要凭记忆写。**

- [ ] **Step 2: 写失败的测试**

创建 `tests/unit/gen-qr.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');

/** 读 PNG 的 IHDR 宽高（字节 16..24） */
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * 把脚本跑在一次性目录里，避免污染真实的 public/brand。
 *
 * ⚠️ 临时目录必须建在仓库内（而不是 os.tmpdir()）：gen-qr.mjs 会
 * `import QRCode from 'qrcode'`，Node 的 ESM 解析靠逐级向上找 node_modules。
 * 放在系统临时目录下会一路找到 / 才停，解析不到仓库里的 qrcode 直接崩。
 */
function runGen(overrides: Record<string, string> = {}) {
  const tmp = mkdtempSync(join(repoRoot, '.tmp-gen-qr-'));
  const scripts = join(tmp, 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(
    join(scripts, 'site-config.mjs'),
    overrides['site-config.mjs']
      ?? "export const SITE_URL = 'https://www.xn--muu023g.xyz/';\n" +
         "export const WORKS_PATH = 'works';\n" +
         "export const WORKS_URL = `${SITE_URL}${WORKS_PATH}`;\n"
  );
  writeFileSync(
    join(scripts, 'gen-qr.mjs'),
    readFileSync(join(repoRoot, 'scripts', 'gen-qr.mjs'), 'utf8')
  );
  // gen-qr.mjs 用 import.meta.url 推导 repoRoot = scripts/ 的上一级，
  // 这里脚本就在 <tmp>/scripts/，推导结果正好是 <tmp>
  const out = join(tmp, 'public', 'brand', 'works-qr.png');
  try {
    execFileSync(process.execPath, [join(scripts, 'gen-qr.mjs')], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return { tmp, out, ok: true as const };
  } catch (e) {
    return { tmp, out, ok: false as const, err: e as any };
  }
}

const DEFAULT_SITE_CONFIG =
  "export const SITE_URL = 'https://www.xn--muu023g.xyz/';\n" +
  "export const WORKS_PATH = 'works';\n" +
  "export const WORKS_URL = `${SITE_URL}${WORKS_PATH}`;\n";

describe('gen-qr.mjs', () => {
  it('默认 URL 产出 111×111 的 PNG（version 3 + 静区 4 + 模块 3px）', () => {
    const r = runGen();
    try {
      expect(r.ok).toBe(true);
      expect(existsSync(r.out)).toBe(true);
      expect(pngSize(readFileSync(r.out))).toEqual({ width: 111, height: 111 });
    } finally {
      rmSync(r.tmp, { recursive: true, force: true });
    }
  });

  it('URL 变长到超出 version 3 时非零退出（防止静默变成大二维码）', () => {
    const longUrl =
      "export const SITE_URL = 'https://www.xn--muu023g.xyz/';\n" +
      "export const WORKS_PATH = 'works/a-very-long-path-that-pushes-past-version-three-capacity';\n" +
      "export const WORKS_URL = `${SITE_URL}${WORKS_PATH}`;\n";
    const r = runGen({ 'site-config.mjs': longUrl });
    try {
      expect(r.ok).toBe(false);
      expect(String(r.err?.stderr ?? '')).toMatch(/version/i);
      expect(existsSync(r.out)).toBe(false);
    } finally {
      rmSync(r.tmp, { recursive: true, force: true });
    }
  });

  });

describe('site-config.mjs 与 gen-qr 使用同一个 URL', () => {
  it('二维码内容等于 WORKS_URL', async () => {
    const { WORKS_URL } = await import('../../scripts/site-config.mjs');
    expect(WORKS_URL).toBe('https://www.xn--muu023g.xyz/works');
    expect(WORKS_URL).toHaveLength(33);
  });

  it('默认配置里的 WORKS_PATH 就是 works', async () => {
    const { WORKS_PATH } = await import('../../scripts/site-config.mjs');
    expect(WORKS_PATH).toBe('works');
  });
});
```

Step 6 里记得把 `.tmp-gen-qr-*` 加进 `.gitignore`（测试正常跑完会自己清掉，但中途失败可能残留）。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/unit/gen-qr.test.ts`
Expected: FAIL —— `scripts/gen-qr.mjs` 不存在。

- [ ] **Step 4: 写 site-config.mjs**

创建 `scripts/site-config.mjs`：

```js
/**
 * 全站权威域与固定路径。改域名只改这里一处。
 *
 * gen-sitemap.mjs 和 gen-qr.mjs 都从这里读，保证 sitemap 里列的 URL
 * 和二维码里编码的 URL 不可能分叉 —— 两者分叉过一次就足以让整站 SEO 失信。
 *
 * 注意 index.html 的 canonical / og:url 仍是字面量（构建产物入口，没有模板注入），
 * 所以改域名一共要动：site-config.mjs + index.html（canonical/og/twitter）+
 * src/seo.test.ts。
 */
export const SITE_URL = 'https://www.xn--muu023g.xyz/';

export const WORKS_PATH = 'works';

/** 导出图纸右下角二维码编码的内容。长度决定二维码版本，别随便改。 */
export const WORKS_URL = `${SITE_URL}${WORKS_PATH}`;
```

- [ ] **Step 5: 写 gen-qr.mjs**

创建 `scripts/gen-qr.mjs`：

```js
#!/usr/bin/env node
/**
 * 构建前生成 public/brand/works-qr.png —— 导出图纸右下角那个二维码。
 *
 * 为什么要预生成而不是运行时编码：前端 bundle 是纯浏览器端的，
 * 为了一张二维码引入编码库不划算。这里在构建期把码算好、写成 PNG，
 * 运行时只做一次 drawImage，和现有的品牌图标走同一条加载链路
 * （ensureWorksQrImage 复用 ensureWatermarkIcon 的缓存 + 超时兜底）。
 *
 * 参数与它的代价：
 *   ECC L        纠错率最低(7%) → 数据位最少 → 模块数最少。15%(M)/25%(Q) 都会升版本。
 *   33 字符 URL  在 L 级下落在 version 3（容量 53）—— version 2 容量只有 32，差 1 个字符。
 *   模块 3px     2px 能再省 44% 面积，但从「相册里已保存的图」里扫容错余量太小。
 *   静区 4 模块  QR 规范下限，不可再省。
 *   → (29 + 2*4) * 3 = 111px 方图
 *
 * 产出会提交进仓库（public/sitemap.xml 同样处理），否则首次 `npm run dev`
 * 不触发 prebuild，导出时会 404。
 *
 * 产出物是 public/ 下的静态资源，Vite 原样拷到 dist/。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WORKS_URL } from './site-config.mjs';

const ERROR_CORRECTION = 'L';
const MODULE_SIZE_PX = 3;
const QUIET_ZONE_MODULES = 4;

/**
 * 期望的二维码版本。URL 一旦变长（换域名、加路径），二维码会自动升版本、
 * 静悄悄把画面撑大。这里做硬失败让 CI 叫出来，逼人确认新版式是否可接受。
 */
const EXPECTED_VERSION = 3;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(repoRoot, 'public', 'brand', 'works-qr.png');

const qr = QRCode.create(WORKS_URL, { errorCorrectionLevel: ERROR_CORRECTION });
if (qr.version !== EXPECTED_VERSION) {
  console.error(
    `[gen-qr] 期望 version ${EXPECTED_VERSION}，实际 ${qr.version}。\n` +
      `        URL "${WORKS_URL}"（${WORKS_URL.length} 字符）已超出该版本容量，二维码会变大。\n` +
      `        请确认新版式仍可接受后，同步更新 EXPECTED_VERSION 和设计文档。`
  );
  process.exit(1);
}

mkdirSync(path.dirname(outPath), { recursive: true });
const buf = await QRCode.toBuffer(WORKS_URL, {
  errorCorrectionLevel: ERROR_CORRECTION,
  margin: QUIET_ZONE_MODULES,
  scale: MODULE_SIZE_PX,
});
writeFileSync(outPath, buf);

const px = (qr.modules.size + 2 * QUIET_ZONE_MODULES) * MODULE_SIZE_PX;
console.log(`[gen-qr] 已写入 public/brand/works-qr.png（version=${qr.version}, ${px}px, → ${WORKS_URL}）`);
```

- [ ] **Step 6: 跑脚本 + 跑测试确认通过**

Run: `node scripts/gen-qr.mjs`
Expected: 输出 `[gen-qr] 已写入 public/brand/works-qr.png（version=3, 111px, → https://www.xn--muu023g.xyz/works）`

Run: `npx vitest run tests/unit/gen-qr.test.ts`
Expected: PASS。

- [ ] **Step 7: 挂进 prebuild + sitemap 加 /works**

改 `package.json` 的 `scripts.prebuild`：

```json
"prebuild": "node scripts/gen-qr.mjs && node scripts/gen-sitemap.mjs",
```

改 `scripts/gen-sitemap.mjs`：
1. 删掉本地的 `const SITE_URL = 'https://www.xn--muu023g.xyz/';`
2. 在 `import path from 'node:path';` 之后加 `import { SITE_URL, WORKS_URL } from './site-config.mjs';`
3. 顶部注释里「只输出首页：站点是单页工具应用…」改为：

```js
 * 输出首页 + 作品库列表页。单作品详情页（/works/:id）刻意不进 sitemap：
 * 作品数量随上传实时变动，维护逐条清单的成本高于收益，且本站是纯 SPA，
 * 详情页是客户端渲染，进 sitemap 只会给爬虫一批收录质量差的 URL。
 * 它们靠 /works 里的链接被爬到。
```

4. 把输出模板的 `<urlset>` 内容改成两段：

```js
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
  <url>
    <loc>${WORKS_URL}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
</urlset>
`;
```

- [ ] **Step 8: robots.txt 加 /media/**

编辑 `public/robots.txt`，在 `Disallow: /api/` 之后、`Sitemap:` 之前插入：

```
# 作品原图 / 缩略图目录，内容价值为零，只消耗抓取预算
Disallow: /media/
```

- [ ] **Step 9: 补 SEO 测试断言**

编辑 `src/seo.test.ts`，在断言 sitemap 首页 loc 的那条用例之后追加：

```ts
  it('includes the public works gallery in sitemap', () => {
    const sitemapDocument = new DOMParser().parseFromString(
      fs.readFileSync('public/sitemap.xml', 'utf8'),
      'application/xml'
    );
    const locs = Array.from(sitemapDocument.querySelectorAll('urlset > url > loc'))
      .map(n => n.textContent);
    expect(locs).toContain(`${SITE_URL}works`);
  });
```

并追加 robots 断言（放在已有的 robots.txt 用例里）：

```ts
    expect(robotsTxt).toContain('Disallow: /media/');
```

- [ ] **Step 10: 跑测试 + 构建**

Run: `node scripts/gen-sitemap.mjs && npx vitest run src/seo.test.ts tests/unit/gen-qr.test.ts`
Expected: PASS。

Run: `npm run build`
Expected: 构建成功，`dist/brand/works-qr.png` 存在。

- [ ] **Step 11: 提交**

```bash
git add scripts/site-config.mjs scripts/gen-qr.mjs scripts/gen-sitemap.mjs package.json package-lock.json public/brand/works-qr.png public/robots.txt public/sitemap.xml src/seo.test.ts tests/unit/gen-qr.test.ts
git commit -m "feat(二维码): 构建期预生成作品库二维码 PNG（version 3 / 111px）"
```

---

### Task 5: 运行时二维码绘制 + 导出版式

**Files:**
- Create: `src/pipeline/qr.ts`
- Modify: `src/pipeline/composite.ts`（接口 8-20 行、`DEFAULT_COMPOSITE_OPTIONS` 22-33 行、`renderCompositeFromBoard` 的 `canvasH` 计算 250-258 行）
- Modify: `src/pipeline/pipeline.ts`（`exportComposite` 约 217-227 行、`exportMulti` 约 337-353 行）
- Test: `tests/unit/qr.test.ts`
- Test: `tests/unit/composite.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 4 产出的静态资源 `/brand/works-qr.png`
- Produces:
  - `src/pipeline/qr.ts`: `WORKS_QR_SRC: string`（`'/brand/works-qr.png'`）、`QR_LOAD_TIMEOUT_MS = 1500`、`ensureWorksQrImage(src?): Promise<HTMLImageElement | null>`、`drawWorksQr(canvas, img): void`
  - `composite.ts` 的 `CompositeOptions` 新增 `qrBandPx?: number`，`DEFAULT_COMPOSITE_OPTIONS.qrBandPx = 0`

- [ ] **Step 1: 写失败的测试（qr.ts）**

创建 `tests/unit/qr.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ensureWorksQrImage, drawWorksQr, WORKS_QR_SRC } from '@/pipeline/qr';

const originalImage = globalThis.Image;

afterEach(() => {
  globalThis.Image = originalImage;
  vi.useRealTimers();
});

/** 造一个可控加载结果的 Image 替身 */
function stubImage(opts: { fail?: boolean; natural?: number } = {}) {
  class FakeImage {
    naturalWidth = opts.natural ?? 0;
    naturalHeight = opts.natural ?? 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      // 同步派发，模拟资源已缓存的情况
      if (opts.fail) queueMicrotask(() => this.onerror?.());
      else queueMicrotask(() => this.onload?.());
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image;
}

/** 一个只记录调用、不碰真实像素的画布 */
function spyCanvas(width: number, height: number) {
  const calls: { fillRect: number[][]; drawImage: number[] } = { fillRect: [], drawImage: [] };
  const ctx = {
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillRect(...a: number[]) { calls.fillRect.push(a); },
    drawImage(...a: number[]) { calls.drawImage.push(a); },
    save() {}, restore() {},
  };
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('ensureWorksQrImage', () => {
  it('资源加载成功后 resolve 出图片对象', async () => {
    stubImage({ natural: 111 });
    const img = await ensureWorksQrImage('/brand/test-ok.png');
    expect(img).not.toBeNull();
    expect(img!.naturalWidth).toBe(111);
  });

  it('加载失败 resolve null 而不是 reject', async () => {
    stubImage({ fail: true });
    expect(await ensureWorksQrImage('/brand/test-fail.png')).toBeNull();
  });

  it('Image 事件永不派发时靠超时兜底，不挂起', async () => {
    vi.useFakeTimers();
    class SilentImage {
      naturalWidth = 0; naturalHeight = 0;
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(_v: string) { /* 什么都不做，模拟 jsdom 不派发事件 */ }
    }
    globalThis.Image = SilentImage as unknown as typeof Image;
    const p = ensureWorksQrImage('/brand/test-silent.png');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBeNull();
  });

  it('默认资源路径是构建期产物', () => {
    expect(WORKS_QR_SRC).toBe('/brand/works-qr.png');
  });
});

describe('drawWorksQr', () => {
  function fakeImg(size: number) {
    return { naturalWidth: size, naturalHeight: size } as HTMLImageElement;
  }

  it('按 1:1 原尺寸画在右下角，距边 = padding(20)', () => {
    const { canvas, calls } = spyCanvas(1000, 2000);
    drawWorksQr(canvas, fakeImg(111));
    // 1000 - 20 - 111 = 869 ; 2000 - 20 - 111 = 1869
    expect(calls.drawImage[0].slice(1)).toEqual([869, 1869, 111, 111]);
  });

  it('先铺不透明白底再画，保证与色卡底色不混色', () => {
    const { canvas, calls } = spyCanvas(1000, 2000);
    drawWorksQr(canvas, fakeImg(111));
    expect(calls.fillRect[0]).toEqual([869, 1869, 111, 111]);
    expect(calls.fillRect[0].length).toBe(4);
  });

  it('naturalWidth 为 0 时是 no-op', () => {
    const { canvas, calls } = spyCanvas(1000, 2000);
    drawWorksQr(canvas, fakeImg(0));
    expect(calls.drawImage).toHaveLength(0);
    expect(calls.fillRect).toHaveLength(0);
  });

  it('拿不到 2D context 时不抛错', () => {
    const canvas = {
      width: 1000, height: 2000,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    expect(() => drawWorksQr(canvas, fakeImg(111))).not.toThrow();
  });
});
```

- [ ] **Step 2: 写失败的测试（composite 新增留白带）**

在 `tests/unit/composite.test.ts` 的 `describe('renderComposite', ...)` 之后追加：

```ts
describe('qrBandPx 底部留白带', () => {
  const indices = new Uint8Array([0, 1, 2, 3]);
  const mask = new Uint8Array(4);

  // 图纸取 120×120：逐像素比对会分配 width×stripH×4 的缓冲，
  // 用 320 的话单张就是 67 万个元素，vitest 深比较会明显拖慢单测。
  function board(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 120;
    return c;
  }

  it('不传 qrBandPx 时输出与改动前一致（向后兼容）', () => {
    const a = renderCompositeFromBoard(board(), indices, 2, 2, palette, mask);
    const b = renderCompositeFromBoard(board(), indices, 2, 2, palette, mask, {});
    expect(b.height).toBe(a.height);
  });

  it('传 qrBandPx 时画布高度恰好增加该值', () => {
    const base = renderCompositeFromBoard(board(), indices, 2, 2, palette, mask);
    const withBand = renderCompositeFromBoard(board(), indices, 2, 2, palette, mask, { qrBandPx: 111 });
    expect(withBand.height - base.height).toBe(111);
  });

  it('图纸与色卡的纵向位置完全不变 —— 留白带只加在底部', () => {
    // 版心用到的第一条色卡上边：padding + headerHeight + sectionGap + beadH + sectionGap/2
    const base = renderCompositeFromBoard(board(), indices, 2, 2, palette, mask);
    const withBand = renderCompositeFromBoard(board(), indices, 2, 2, palette, mask, { qrBandPx: 111 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadH = 120;
    const legendTop =
      opts.padding + opts.headerHeight + opts.sectionGap + beadH + opts.sectionGap / 2;
    // 两张图在顶部条带内应逐像素一致 —— 证明留白带没有挤动任何既有内容
    const ctxA = base.getContext('2d')!;
    const ctxB = withBand.getContext('2d')!;
    const stripH = Math.min(legendTop + 60, base.height);
    expect(stripH).toBeGreaterThan(legendTop); // 确认比对范围真的覆盖到第一条色卡
    expect(ctxA.getImageData(0, 0, base.width, stripH).data)
      .toEqual(ctxB.getImageData(0, 0, withBand.width, stripH).data);
  });

  it('宽度不因留白带而变化', () => {
    const base = renderCompositeFromBoard(board(), indices, 2, 2, palette, mask);
    const withBand = renderCompositeFromBoard(board(), indices, 2, 2, palette, mask, { qrBandPx: 111 });
    expect(withBand.width).toBe(base.width);
  });

  it('DEFAULT_COMPOSITE_OPTIONS.qrBandPx 默认 0', () => {
    expect(DEFAULT_COMPOSITE_OPTIONS.qrBandPx).toBe(0);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/unit/qr.test.ts tests/unit/composite.test.ts`
Expected: FAIL —— `@/pipeline/qr` 不存在；`qrBandPx` 未定义。

- [ ] **Step 4: 写 qr.ts**

创建 `src/pipeline/qr.ts`：

```ts
/**
 * 导出图纸右下角的二维码。
 *
 * 码本身是构建期用 scripts/gen-qr.mjs 预生成的静态 PNG（version 3 / 111×111），
 * 运行时只负责加载和绘制 —— 前端不引入任何二维码编码依赖。
 *
 * 加载链路照搬 watermark.ts 的 ensureWatermarkIcon：模块级 Map 缓存先占位
 * （避免并发导出重复发起加载）、onload/onerror 双通道、1.5s 超时兜底
 * （jsdom 根本不派发 img 事件，没有超时会一直挂着）。
 *
 * 失败一律降级为 null，绝不抛错：二维码是锦上添花，不能因为它让导出失败。
 */

import { DEFAULT_COMPOSITE_OPTIONS } from './composite';

/** 构建期产物（scripts/gen-qr.mjs 写在 public/brand/ 下，Vite 原样拷进 dist） */
export const WORKS_QR_SRC = '/brand/works-qr.png';

/** 首屏导出时资源还没进 HTTP 缓存时可能慢；超过这个时间就放弃画码 */
export const QR_LOAD_TIMEOUT_MS = 1500;

const imageCache = new Map<string, HTMLImageElement | null>();

export function ensureWorksQrImage(src: string = WORKS_QR_SRC): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  if (typeof Image === 'undefined') {
    imageCache.set(src, null);
    return Promise.resolve(null);
  }
  const promise = new Promise<HTMLImageElement | null>(resolve => {
    const settle = (value: HTMLImageElement | null) => {
      clearTimeout(timer);
      imageCache.set(src, value);
      resolve(value);
    };
    const img = new Image();
    const timer = setTimeout(() => settle(null), QR_LOAD_TIMEOUT_MS);
    img.onload = () => settle(img);
    img.onerror = () => settle(null);
    img.src = src;
  });
  // 先占位，避免并发调用重复发起加载（和 ensureWatermarkIcon 一致）
  imageCache.set(src, null);
  return promise;
}

/**
 * 把二维码画到画布右下角。
 *
 * 尺寸读 img.naturalWidth 而不是写死常量：模块边长必须是整数 px，
 * 任何非整数缩放都会把模块糊在一起，糊了就扫不出来。想换尺寸请改
 * scripts/gen-qr.mjs 重新构建，这样运行时布局自动跟上，不存在两处数字对不上。
 */
export function drawWorksQr(canvas: HTMLCanvasElement, img: HTMLImageElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = img.naturalWidth;
  if (!size) return;

  const margin = DEFAULT_COMPOSITE_OPTIONS.padding;
  const x = canvas.width - margin - size;
  const y = canvas.height - margin - size;

  ctx.save();
  // 先铺不透明白底。这块位目前天然是导出画的纯白底，但版式一旦改动
  // 让它落到色卡浅灰底 (#fbfbfc) 上，二维码对比度会掉、扫不出来。
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}
```

- [ ] **Step 5: composite.ts 加 qrBandPx**

修改 `src/pipeline/composite.ts`：

1. 在 `CompositeOptions` 接口的 `swatchSize` 之后加：

```ts
  /** 底部为二维码预留的额外留白带高度（px）。缺省 / 0 = 不预留。 */
  readonly qrBandPx?: number;
```

2. 在 `DEFAULT_COMPOSITE_OPTIONS` 的 `swatchSize: 18,` 之后加 `qrBandPx: 0,`

3. 把 `renderCompositeFromBoard` 里的高度计算改成：

```ts
  const contentW = Math.max(beadCanvas.width, MIN_CONTENT_WIDTH);
  const lines = layoutChips(chips, contentW, opts.chipGap);
  const legendH = lines.length * opts.chipHeight + Math.max(0, lines.length - 1) * opts.chipGap;

  const canvasW = contentW + opts.padding * 2;
  // 底部边距单独算：二维码的留白带加在这里，页眉/图纸/色卡的纵向布局一律不动，
  // 所以色卡既不会被压、也不会重排。色卡折行只看 contentW（= canvasW - padding*2），
  // 与底部边距无关。
  const bottomPad = opts.padding + opts.qrBandPx;
  const canvasH =
    opts.padding +
    opts.headerHeight +
    opts.sectionGap +
    beadCanvas.height +
    opts.sectionGap +
    legendH +
    bottomPad;
```

- [ ] **Step 6: pipeline.ts 接入**

修改 `src/pipeline/pipeline.ts`：

1. 顶部 import 区加 `import { ensureWorksQrImage, drawWorksQr } from './qr';`

2. `exportComposite` 里，把

```ts
    const canvas = renderComposite(indices, outW, outH, this.palette, {
      cellPx: DEFAULT_COMPOSITE_OPTIONS.cellPx,
    }, mask);
    await drawWatermark(canvas);
```

改为

```ts
    const qrImage = await ensureWorksQrImage();
    const canvas = renderComposite(indices, outW, outH, this.palette, {
      cellPx: DEFAULT_COMPOSITE_OPTIONS.cellPx,
      qrBandPx: qrImage ? qrImage.naturalHeight : 0,
    }, mask);
    await drawWatermark(canvas);
    // 水印锚在页眉右侧、二维码锚在底部白带，相隔整个图纸高度，不会互相遮挡
    if (qrImage) drawWorksQr(canvas, qrImage);
```

3. `exportMulti` 里，把

```ts
        const compositeCanvas = renderCompositeFromBoard(
          boardCanvas,
          boardIndices,
          boardW,
          boardH,
          this.palette,
          boardMask
        );
        await drawWatermark(compositeCanvas);
```

改为

```ts
        // QR 是异步资源：先 await 拿到，才能据此决定留白带多高。
        // 拿不到就传 0 —— 版式与现状完全一致，导出照常成功。
        const qrImage = await ensureWorksQrImage();
        const compositeCanvas = renderCompositeFromBoard(
          boardCanvas,
          boardIndices,
          boardW,
          boardH,
          this.palette,
          boardMask,
          { qrBandPx: qrImage ? qrImage.naturalHeight : 0 }
        );
        await drawWatermark(compositeCanvas);
        if (qrImage) drawWorksQr(compositeCanvas, qrImage);
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run tests/unit/qr.test.ts tests/unit/composite.test.ts`
Expected: PASS。

- [ ] **Step 8: 跑全量测试 + 类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 9: 提交**

```bash
git add src/pipeline/qr.ts src/pipeline/composite.ts src/pipeline/pipeline.ts tests/unit/qr.test.ts tests/unit/composite.test.ts
git commit -m "feat(导出): 图纸右下角贴作品库二维码，底部新增 111px 留白带"
```

---

### Task 6: 前端路由 + 导航栏

**Files:**
- Create: `src/router.ts`
- Create: `src/components/SiteNav.tsx`
- Create: `src/components/SiteNav.css`
- Modify: `src/main.tsx:1-17`
- Modify: `src/App.tsx`（header 之后插入）
- Test: `tests/unit/router.test.ts`
- Test: `src/components/SiteNav.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces:
  - `src/router.ts`: `type Route = { name: 'home' } | { name: 'works-list' } | { name: 'work-detail'; id: number } | { name: 'statics' }`、`matchRoute(pathname: string): Route`
  - `src/components/SiteNav.tsx`: `<SiteNav />`（无 props）

- [ ] **Step 1: 写失败的测试（router）**

创建 `tests/unit/router.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { matchRoute } from '@/router';

describe('matchRoute', () => {
  it('首页：空串与 /', () => {
    expect(matchRoute('')).toEqual({ name: 'home' });
    expect(matchRoute('/')).toEqual({ name: 'home' });
    expect(matchRoute('//')).toEqual({ name: 'home' });
  });

  it('作品列表：/works 与 /works/', () => {
    expect(matchRoute('/works')).toEqual({ name: 'works-list' });
    expect(matchRoute('/works/')).toEqual({ name: 'works-list' });
  });

  it('作品详情：/works/<正整数>', () => {
    expect(matchRoute('/works/1')).toEqual({ name: 'work-detail', id: 1 });
    expect(matchRoute('/works/12345')).toEqual({ name: 'work-detail', id: 12345 });
  });

  it('id 为 0 或非数字时回首页，不落到作品详情', () => {
    expect(matchRoute('/works/0')).toEqual({ name: 'home' });
    expect(matchRoute('/works/abc')).toEqual({ name: 'home' });
    expect(matchRoute('/works/-1')).toEqual({ name: 'home' });
    expect(matchRoute('/works/1.5')).toEqual({ name: 'home' });
  });

  it('多级 /works 路径回首页', () => {
    expect(matchRoute('/works/1/extra')).toEqual({ name: 'home' });
  });

  it('statics 及其子路径', () => {
    expect(matchRoute('/statics')).toEqual({ name: 'statics' });
    expect(matchRoute('/statics/')).toEqual({ name: 'statics' });
    expect(matchRoute('/statics/products')).toEqual({ name: 'statics' });
  });

  it('未知路径回首页', () => {
    expect(matchRoute('/nope')).toEqual({ name: 'home' });
    expect(matchRoute('/work')).toEqual({ name: 'home' });
  });

  it('trailing slash 归一后仍能匹配', () => {
    expect(matchRoute('/works/42/')).toEqual({ name: 'work-detail', id: 42 });
  });
});
```

- [ ] **Step 2: 写失败的测试（SiteNav）**

创建 `src/components/SiteNav.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SiteNav } from './SiteNav';

describe('SiteNav', () => {
  it('有两个跳转条目', () => {
    render(<SiteNav current="/works" />);
    expect(screen.getByRole('link', { name: '生成图纸' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '作品库' })).toBeTruthy();
  });

  it('生成图纸指向 /，作品库指向 /works', () => {
    render(<SiteNav current="/works" />);
    expect(screen.getByRole('link', { name: '生成图纸' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: '作品库' }).getAttribute('href')).toBe('/works');
  });

  it('当前页高亮并带 aria-current', () => {
    render(<SiteNav current="/works" />);
    expect(screen.getByRole('link', { name: '作品库' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: '生成图纸' }).getAttribute('aria-current')).toBeNull();
  });

  it('详情页把作品库当作当前页', () => {
    render(<SiteNav current="/works/42" />);
    expect(screen.getByRole('link', { name: '作品库' }).getAttribute('aria-current')).toBe('page');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/unit/router.test.ts src/components/SiteNav.test.tsx`
Expected: FAIL —— `@/router` 与 `./SiteNav` 不存在。

- [ ] **Step 4: 写 router.ts**

创建 `src/router.ts`：

```ts
/**
 * 站点路由。站里没装 react-router —— 三个路由不值得为它加依赖，
 * 现有 /statics 已经证明 pathname 判断够用。抽成纯函数是为了能单测，
 * 顺便让「什么路径渲染什么」这件事只有一处定义。
 */

export type Route =
  | { name: 'home' }
  | { name: 'works-list' }
  | { name: 'work-detail'; id: number }
  | { name: 'statics' };

/** 去掉末尾斜杠：'' → '/', '/works/' → '/works' */
function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function matchRoute(pathname: string): Route {
  const path = normalize(pathname);

  if (path === '/') return { name: 'home' };
  if (path === '/works') return { name: 'works-list' };

  const detail = /^\/works\/(\d+)$/.exec(path);
  if (detail) {
    const id = Number(detail[1]);
    // id 必须是正整数：/works/0、/works/007 不是有效作品，回首页
    if (Number.isInteger(id) && id > 0) return { name: 'work-detail', id };
    return { name: 'home' };
  }

  if (path === '/statics' || path.startsWith('/statics/')) return { name: 'statics' };

  return { name: 'home' };
}
```

- [ ] **Step 5: 写 SiteNav**

创建 `src/components/SiteNav.tsx`（`.css` 由 Step 6 同批创建）：

```tsx
import './SiteNav.css';

interface SiteNavProps {
  /** 当前路径，用于高亮。只做前缀匹配，/works/42 也算在作品库上。 */
  current: string;
}

const ITEMS = [
  { href: '/', label: '生成图纸', match: (p: string) => p === '/' || p === '' },
  { href: '/works', label: '作品库', match: (p: string) => p === '/works' || p.startsWith('/works/') },
] as const;

export function SiteNav({ current }: SiteNavProps) {
  return (
    <nav className="site-nav" aria-label="主导航">
      {ITEMS.map(item => {
        const active = item.match(current);
        return (
          <a
            key={item.href}
            href={item.href}
            className={active ? 'site-nav-link site-nav-link--active' : 'site-nav-link'}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: 写 SiteNav.css**

创建 `src/components/SiteNav.css`：

```css
.site-nav {
  display: flex;
  gap: var(--space-2);
  justify-content: center;
  margin: var(--space-3) 0 var(--space-1);
}

.site-nav-link {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: var(--text-sm);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.site-nav-link:hover {
  color: var(--color-text);
  border-color: var(--color-border-strong);
}

.site-nav-link--active {
  color: var(--color-accent-hover);
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  font-weight: 600;
}
```

- [ ] **Step 7: main.tsx 改用 matchRoute**

把 `src/main.tsx` 整体替换为：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StaticsPage } from './pages/StaticsPage';
import { WorksListPage } from './pages/WorksListPage';
import { WorkDetailPage } from './pages/WorkDetailPage';
import { matchRoute } from './router';
import './styles/global.css';

function Root() {
  const route = matchRoute(window.location.pathname);
  if (route.name === 'works-list') return <WorksListPage />;
  if (route.name === 'work-detail') return <WorkDetailPage id={route.id} />;
  if (route.name === 'statics') return <StaticsPage />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
```

本任务先不 import 两个尚不存在的页面——把上面那两行 import 和两个分支**留到 Task 7 一起加**，否则这一步跑不起来。

即本任务 `main.tsx` 写成：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StaticsPage } from './pages/StaticsPage';
import { matchRoute } from './router';
import './styles/global.css';

function Root() {
  const route = matchRoute(window.location.pathname);
  if (route.name === 'statics') return <StaticsPage />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
```

- [ ] **Step 8: 首页挂上导航栏**

修改 `src/App.tsx`：在 `import { Disclaimer } from '@/components/Disclaimer';` 之后加 `import { SiteNav } from '@/components/SiteNav';`

在 `<SiteStats />` 之后、`</header>` 之前插入 `<SiteNav current="/" />`。注意 `App.tsx` 里有**两处** `return` 早于主渲染（paletteError / palette 加载中），只改主 return 那处。

- [ ] **Step 9: 跑测试确认通过**

Run: `npx vitest run tests/unit/router.test.ts src/components/SiteNav.test.tsx`
Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add src/router.ts src/main.tsx src/App.tsx src/components/SiteNav.tsx src/components/SiteNav.css tests/unit/router.test.ts src/components/SiteNav.test.tsx
git commit -m "feat(导航): 抽出 matchRoute 路由 + 新增站点导航栏"
```

---

### Task 7: 作品库列表页

**Files:**
- Create: `src/api/works.ts`
- Create: `src/hooks/useWorks.ts`
- Create: `src/pages/WorksListPage.tsx`
- Create: `src/pages/WorksListPage.css`
- Modify: `src/main.tsx`（接上 works-list / work-detail 分支与 import）
- Test: `src/api/works.test.ts`
- Test: `src/pages/WorksListPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `GET /api/public/works`、`GET /api/public/works/:id`；Task 6 的 `matchRoute` / `SiteNav`
- Produces:
  - `src/api/works.ts`: `WorkSummary`、`WorkDetail`、`listWorks(limit?, offset?): Promise<{ items: WorkSummary[]; total: number }>`、`fetchWork(id: number): Promise<WorkDetail>`
  - `src/hooks/useWorks.ts`: `useWorks(pageSize?): { items; total; loading; loadingMore; error; hasMore; loadMore }`
  - `src/pages/WorksListPage.tsx`: `<WorksListPage />`
  - `src/main.tsx` 接上 `/works` 与 `/works/:id` 路由

- [ ] **Step 1: 写失败的测试（api 层）**

创建 `src/api/works.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listWorks, fetchWork } from './works';

const mockFetch = vi.fn();

// ⚠️ stub 必须装在 beforeEach：装在 afterEach 的话，第一个用例跑的时候
// 还没有 fetch 替身，会真的发请求。
beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ok(body: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  });
}

describe('listWorks', () => {
  it('默认拉第一页', async () => {
    ok({ items: [], total: 0 });
    await listWorks();
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works', expect.anything());
  });

  it('带上 limit / offset', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 40);
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works?limit=20&offset=40', expect.anything());
  });

  it('失败时抛出后端 error 文案', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'query failed' }),
    });
    await expect(listWorks()).rejects.toThrow('query failed');
  });
});

describe('fetchWork', () => {
  it('拉指定 id', async () => {
    ok({ id: 7 });
    await fetchWork(7);
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works/7', expect.anything());
  });
});
```

- [ ] **Step 2: 写失败的测试（页面）**

创建 `src/pages/WorksListPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WorksListPage } from './WorksListPage';

const listWorks = vi.fn();

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return { ...actual, listWorks: (...a: unknown[]) => listWorks(...a) };
});

beforeEach(() => {
  listWorks.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function work(id: number, title: string) {
  return {
    id,
    title,
    thumbUrl: `/media/works/${String(id).padStart(16, '0')}.png`,
    width: 800,
    height: 1000,
    createdAt: 1_700_000_000_000,
  };
}

describe('WorksListPage', () => {
  it('加载中显示状态文案', () => {
    listWorks.mockReturnValue(new Promise(() => {}));
    render(<WorksListPage />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it('渲染作品卡片，标题可见', async () => {
    listWorks.mockResolvedValue({ items: [work(1, '粉色小熊')], total: 1 });
    render(<WorksListPage />);
    await waitFor(() => expect(screen.getByText('粉色小熊')).toBeTruthy());
  });

  it('卡片是跳转到 /works/:id 的链接', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A')], total: 1 });
    render(<WorksListPage />);
    const link = await screen.findByRole('link', { name: 'A' });
    expect(link.getAttribute('href')).toBe('/works/1');
  });

  it('空列表给出空状态和前往生成的入口', async () => {
    listWorks.mockResolvedValue({ items: [], total: 0 });
    render(<WorksListPage />);
    expect(await screen.findByText(/还没有作品/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /去生成第一个图纸/ }).getAttribute('href')).toBe('/');
  });

  it('加载失败给出错误与重试按钮', async () => {
    listWorks.mockRejectedValue(new Error('boom'));
    render(<WorksListPage />);
    expect(await screen.findByText(/boom/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('有剩余时点「加载更多」追加下一页并保留已有项', async () => {
    listWorks
      .mockResolvedValueOnce({ items: [work(1, 'A')], total: 2 })
      .mockResolvedValueOnce({ items: [work(2, 'B')], total: 2 });
    render(<WorksListPage />);
    await screen.findByText('A');

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(screen.getByText('B')).toBeTruthy());
    expect(screen.getByText('A')).toBeTruthy();
    expect(listWorks).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('总页数取完时不再显示「加载更多」', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A')], total: 1 });
    render(<WorksListPage />);
    await screen.findByText('A');
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/api/works.test.ts src/pages/WorksListPage.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 4: 写 api/works.ts**

创建 `src/api/works.ts`：

```ts
const BASE = '/api';

/**
 * 与 server/works.ts 的 WorkSummary / WorkDetail 一一对应。
 * 两边各定义一份是仓库既有惯例（Product 也一样），改动时必须同步。
 */
export interface WorkSummary {
  id: number;
  title: string;
  thumbUrl: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface WorkDetail extends WorkSummary {
  description: string;
  imageUrl: string;
  bytes: number;
  /** 元数据改动时间。列表不需要它，详情页和后台用得上。 */
  updatedAt: number;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // body 不是 JSON（很可能是 nginx/proxy 兜底页面），保留状态码原文
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function listWorks(
  limit = 20,
  offset = 0
): Promise<{ items: WorkSummary[]; total: number }> {
  const res = await fetch(`${BASE}/public/works?limit=${limit}&offset=${offset}`, {
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

export async function fetchWork(id: number): Promise<WorkDetail> {
  const res = await fetch(`${BASE}/public/works/${id}`, { credentials: 'include' });
  return jsonOrThrow(res);
}
```

- [ ] **Step 5: 写 useWorks.ts**

创建 `src/hooks/useWorks.ts`：

```ts
import { useCallback, useEffect, useState } from 'react';
import { listWorks, type WorkSummary } from '@/api/works';

const PAGE_SIZE = 20;

export interface UseWorksResult {
  items: WorkSummary[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * 作品库列表。分页用「加载更多」而不是无限滚动 —— 作品量级还小，
 * 按钮行为可预期、也更好测（spec 7.3）。
 */
export function useWorks(pageSize: number = PAGE_SIZE): UseWorksResult {
  const [items, setItems] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listWorks(pageSize, 0)
      .then(page => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pageSize, nonce]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore) return;
    setLoadingMore(true);
    const offset = items.length;
    listWorks(pageSize, offset)
      .then(page => {
        setItems(prev => [...prev, ...page.items]);
        setTotal(page.total);
        setLoadingMore(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoadingMore(false);
      });
  }, [items.length, loading, loadingMore, pageSize]);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  return {
    items,
    total,
    loading,
    loadingMore,
    error,
    hasMore: items.length < total,
    loadMore,
    reload,
  };
}
```

- [ ] **Step 6: 写 WorksListPage.tsx**

创建 `src/pages/WorksListPage.tsx`：

```tsx
import { SiteNav } from '@/components/SiteNav';
import { useWorks } from '@/hooks/useWorks';
import { usePageView } from '@/hooks/useTracking';
import './WorksListPage.css';

export function WorksListPage() {
  usePageView();
  const { items, total, loading, loadingMore, error, hasMore, loadMore, reload } = useWorks();

  return (
    <div className="app works-page">
      <header>
        <h1>作品库</h1>
        <p className="subtitle">站主挑好的拼豆图纸，扫码或点进来就能拿走</p>
      </header>

      <SiteNav current="/works" />

      <main className="works-main">
        {loading && <p className="works-state">加载中…</p>}

        {!loading && error && (
          <div className="works-state works-state--error">
            <p>加载失败：{error.message}</p>
            <button type="button" className="works-btn" onClick={reload}>重试</button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="works-state">
            <p>还没有作品。</p>
            <a className="works-btn" href="/">去生成第一个图纸</a>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <>
            <p className="works-count">共 {total} 件</p>
            <ul className="works-grid">
              {items.map(w => (
                <li key={w.id} className="works-card">
                  <a href={`/works/${w.id}`} className="works-card-link">
                    {/* alt 留空是刻意的：标题文字就在同一张 <a> 里，
                        再给 img 一份 alt 会让链接的可访问名变成「标题标题」，
                        屏幕阅读器读两遍，getByRole('link', {name}) 也匹配不上。 */}
                    <img
                      className="works-card-img"
                      src={w.thumbUrl}
                      alt=""
                      loading="lazy"
                      width={w.width || undefined}
                      height={w.height || undefined}
                    />
                    <span className="works-card-title">{w.title}</span>
                  </a>
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="works-more">
                <button
                  type="button"
                  className="works-btn"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? '加载中…' : '加载更多'}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>© 拼豆图生成器 · 仅作手工参考 · 颜色归各品牌所有</p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 7: 写 WorksListPage.css**

创建 `src/pages/WorksListPage.css`：

```css
.works-main {
  max-width: 1100px;
  margin: 0 auto;
  padding: var(--space-4);
}

.works-state {
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--color-text-muted);
}

.works-state--error {
  color: var(--color-error-fg);
  background: var(--color-error-bg);
  border-radius: var(--radius-md);
}

.works-count {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  margin-bottom: var(--space-3);
}

.works-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-4);
}

.works-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s, box-shadow 0.15s;
}

.works-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.works-card-link {
  display: block;
  color: inherit;
  text-decoration: none;
}

.works-card-img {
  display: block;
  width: 100%;
  /* 有 width/height 属性时按真实比例显示，避免加载完成时跳动 */
  height: auto;
  aspect-ratio: 4 / 5;
  object-fit: contain;
  background: var(--color-surface-alt);
}

.works-card-title {
  display: block;
  padding: var(--space-3);
  font-size: var(--text-sm);
  font-weight: 600;
}

.works-more {
  display: flex;
  justify-content: center;
  margin-top: var(--space-5);
}

.works-btn {
  display: inline-block;
  padding: var(--space-2) var(--space-5);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--text-sm);
  text-decoration: none;
  cursor: pointer;
}

.works-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent-hover);
}

.works-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
```

- [ ] **Step 8: main.tsx 接上路由**

在 `src/main.tsx` 的 import 区加：

```tsx
import { WorksListPage } from './pages/WorksListPage';
import { WorkDetailPage } from './pages/WorkDetailPage';
```

（`WorkDetailPage` 本任务还不存在，**Task 8 才创建**。为让本任务结束时能编译，Step 8 只加 `WorksListPage` 的 import 和分支，`WorkDetailPage` 的 import 与分支留到 Task 8。）

`Root()` 改为：

```tsx
function Root() {
  const route = matchRoute(window.location.pathname);
  if (route.name === 'works-list') return <WorksListPage />;
  if (route.name === 'statics') return <StaticsPage />;
  return <App />;
}
```

- [ ] **Step 9: 跑测试确认通过**

Run: `npx vitest run src/api/works.test.ts src/pages/WorksListPage.test.tsx tests/unit/router.test.ts`
Expected: PASS。

- [ ] **Step 10: 跑全量 + 类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 11: 提交**

```bash
git add src/api/works.ts src/hooks/useWorks.ts src/pages/WorksListPage.tsx src/pages/WorksListPage.css src/main.tsx src/api/works.test.ts src/pages/WorksListPage.test.tsx
git commit -m "feat(作品库): 公开列表页 /works，缩略图网格 + 加载更多分页"
```

---

### Task 8: 作品详情页

**Files:**
- Create: `src/pages/WorkDetailPage.tsx`
- Create: `src/pages/WorkDetailPage.css`
- Modify: `src/main.tsx`（接上 `work-detail` 分支）
- Test: `src/pages/WorkDetailPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `GET /api/public/works/:id`；Task 6 的 `SiteNav`；Task 7 的 `src/api/works.ts` 的 `fetchWork` / `WorkDetail`
- Produces: `src/pages/WorkDetailPage.tsx`: `<WorkDetailPage id={number} />`

- [ ] **Step 1: 写失败的测试**

创建 `src/pages/WorkDetailPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WorkDetailPage } from './WorkDetailPage';

const fetchWork = vi.fn();

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return { ...actual, fetchWork: (...a: unknown[]) => fetchWork(...a) };
});

beforeEach(() => {
  fetchWork.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

const detail = {
  id: 42,
  title: '粉色小熊',
  description: '100×120 · 18 色',
  thumbUrl: '/media/works/000000000000002a.png',
  imageUrl: '/media/works/000000000000002a.png',
  width: 1240,
  height: 1560,
  bytes: 245_760,
  createdAt: 1_700_000_000_000,
};

describe('WorkDetailPage', () => {
  it('加载中显示状态文案', () => {
    fetchWork.mockReturnValue(new Promise(() => {}));
    render(<WorkDetailPage id={42} />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it('渲染标题与大图', async () => {
    fetchWork.mockResolvedValue(detail);
    render(<WorkDetailPage id={42} />);
    expect(await screen.findByRole('heading', { name: '粉色小熊' })).toBeTruthy();
    const img = screen.getByRole('img', { name: '粉色小熊' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(detail.imageUrl);
  });

  it('按传入 id 拉数据', async () => {
    fetchWork.mockResolvedValue(detail);
    render(<WorkDetailPage id={42} />);
    await waitFor(() => expect(fetchWork).toHaveBeenCalledWith(42));
  });

  it('「下载原图」是带 download 属性的同源链接', async () => {
    fetchWork.mockResolvedValue(detail);
    render(<WorkDetailPage id={42} />);
    const a = (await screen.findByRole('link', { name: '下载原图' })) as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(detail.imageUrl);
    // 微信外浏览器直接下载；微信内置浏览器会拦截这条，届时靠长按提示兜底
    expect(a.getAttribute('download')).toBe('粉色小熊.png');
  });

  it('「长按保存」提示常驻，不是弹窗', async () => {
    fetchWork.mockResolvedValue(detail);
    render(<WorkDetailPage id={42} />);
    expect(await screen.findByText(/长按图片保存/)).toBeTruthy();
  });

  it('展示体积元信息', async () => {
    fetchWork.mockResolvedValue(detail);
    render(<WorkDetailPage id={42} />);
    expect(await screen.findByText(/1240 × 1560/)).toBeTruthy();
    expect(screen.getByText(/240 KB/)).toBeTruthy();
  });

  it('404 / 下架给出提示和回列表入口', async () => {
    fetchWork.mockRejectedValue(new Error('not found'));
    render(<WorkDetailPage id={42} />);
    expect(await screen.findByText(/不存在或已下架/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回作品库' }).getAttribute('href')).toBe('/works');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/pages/WorkDetailPage.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写 WorkDetailPage.tsx**

创建 `src/pages/WorkDetailPage.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { SiteNav } from '@/components/SiteNav';
import { fetchWork, type WorkDetail } from '@/api/works';
import { usePageView } from '@/hooks/useTracking';
import './WorkDetailPage.css';

interface WorkDetailPageProps {
  id: number;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function WorkDetailPage({ id }: WorkDetailPageProps) {
  usePageView();
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWork(id)
      .then(w => {
        if (cancelled) return;
        setWork(w);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="app works-detail">
        <SiteNav current={`/works/${id}`} />
        <p className="works-detail-state">加载中…</p>
      </div>
    );
  }

  // 404 和「已下架」返回同样的文案：区分开等于告诉访客这个 id 曾经存在过
  if (error || !work) {
    return (
      <div className="app works-detail">
        <SiteNav current={`/works/${id}`} />
        <div className="works-detail-state works-detail-state--error">
          <p>作品不存在或已下架</p>
          <a className="works-detail-btn" href="/works">返回作品库</a>
        </div>
      </div>
    );
  }

  return (
    <div className="app works-detail">
      <header>
        <h1>{work.title}</h1>
      </header>

      <SiteNav current={`/works/${id}`} />

      <main className="works-detail-main">
        <figure className="works-detail-figure">
          <img
            className="works-detail-img"
            src={work.imageUrl}
            alt={work.title}
            width={work.width || undefined}
            height={work.height || undefined}
          />
          <figcaption className="works-detail-tip">长按图片保存到手机相册</figcaption>
        </figure>

        <section className="works-detail-meta">
          {work.description && <p className="works-detail-desc">{work.description}</p>}
          <dl className="works-detail-facts">
            <div>
              <dt>成品尺寸</dt>
              <dd>{work.width > 0 && work.height > 0 ? `${work.width} × ${work.height}` : '未知'}</dd>
            </div>
            <div>
              <dt>文件体积</dt>
              <dd>{formatBytes(work.bytes)}</dd>
            </div>
          </dl>

          {/*
            同一个 URL 承担两种用途，这是刻意设计：
              被 <img> 引用 → 浏览器内联渲染 → 可长按保存（微信内置浏览器唯一可行路径）
              被带 download 的 <a> 引用 → 浏览器直接下载（微信外浏览器 / Safari / Chrome 桌面）
            所以不需要 Content-Disposition，也不需要 dev 路由与 nginx 各写一套 ?dl=1 分支。
          */}
          <a className="works-detail-btn" href={work.imageUrl} download={`${work.title}.png`}>
            下载原图
          </a>
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: 写 WorkDetailPage.css**

创建 `src/pages/WorkDetailPage.css`：

```css
.works-detail {
  padding-bottom: var(--space-6);
}

.works-detail-state {
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--color-text-muted);
}

.works-detail-state--error {
  color: var(--color-error-fg);
  background: var(--color-error-bg);
  border-radius: var(--radius-md);
}

.works-detail-main {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--space-4);
  display: grid;
  gap: var(--space-5);
}

@media (min-width: 760px) {
  .works-detail-main {
    grid-template-columns: minmax(0, 3fr) minmax(240px, 2fr);
    align-items: start;
  }
}

.works-detail-figure {
  margin: 0;
}

.works-detail-img {
  display: block;
  width: 100%;
  height: auto;
  background: var(--color-surface-alt);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.works-detail-tip {
  margin-top: var(--space-2);
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.works-detail-desc {
  margin: 0 0 var(--space-4);
  color: var(--color-text);
  line-height: 1.7;
}

.works-detail-facts {
  margin: 0 0 var(--space-4);
  display: grid;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.works-detail-facts > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.works-detail-facts dt {
  color: var(--color-text-muted);
}

.works-detail-facts dd {
  margin: 0;
}

.works-detail-btn {
  display: inline-block;
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-sm);
  background: var(--color-accent);
  color: #fff;
  font-size: var(--text-sm);
  text-decoration: none;
  text-align: center;
}

.works-detail-btn:hover {
  background: var(--color-accent-hover);
}
```

- [ ] **Step 5: main.tsx 接上详情路由**

在 `src/main.tsx` 的 import 区加 `import { WorkDetailPage } from './pages/WorkDetailPage';`，`Root()` 改为：

```tsx
function Root() {
  const route = matchRoute(window.location.pathname);
  if (route.name === 'works-list') return <WorksListPage />;
  if (route.name === 'work-detail') return <WorkDetailPage id={route.id} />;
  if (route.name === 'statics') return <StaticsPage />;
  return <App />;
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/pages/WorkDetailPage.test.tsx tests/unit/router.test.ts`
Expected: PASS。

- [ ] **Step 7: 跑全量 + 类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 8: 提交**

```bash
git add src/pages/WorkDetailPage.tsx src/pages/WorkDetailPage.css src/pages/WorkDetailPage.test.tsx src/main.tsx
git commit -m "feat(作品库): 作品详情页，长按保存 + 同源 download 双路径下载"
```

---

### Task 9: 后台「作品」tab + README

**Files:**
- Create: `src/pages/admin/WorksTab.tsx`
- Create: `src/pages/admin/WorksTab.css`
- Modify: `src/pages/admin/AdminDashboard.tsx:1-24`
- Modify: `README.md`
- Test: `src/pages/admin/WorksTab.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 admin API（`GET /api/admin/works`、`POST /api/admin/works`、`PUT /api/admin/works/:id`、`DELETE /api/admin/works/:id`）
- Produces: `src/pages/admin/WorksTab.tsx`: `<WorksTab />`；`AdminDashboard` 新增第 4 个 tab

- [ ] **Step 1: 在 api/works.ts 补 admin 方法**

在 `src/api/works.ts` 末尾追加：

```ts
// ---- admin ----

export interface WorkMetaPatch {
  title?: string;
  description?: string;
  published?: boolean;
}

/**
 * 上传作品。缩略图由调用方在浏览器里用 canvas 生成（见 WorksTab），
 * 服务端不装 sharp —— 保持服务端纯 JS 依赖。
 */
export async function adminCreateWork(
  file: File,
  opts: {
    thumb?: Blob | null;
    title?: string;
    description?: string;
    published?: boolean;
    width?: number;
    height?: number;
  } = {}
): Promise<WorkDetail> {
  const fd = new FormData();
  fd.append('file', file);
  if (opts.thumb) fd.append('thumb', opts.thumb, 'thumb.webp');
  fd.append('title', opts.title ?? '');
  fd.append('description', opts.description ?? '');
  fd.append('published', opts.published === false ? '0' : '1');
  if (opts.width != null) fd.append('width', String(opts.width));
  if (opts.height != null) fd.append('height', String(opts.height));
  const res = await fetch(`${BASE}/admin/works`, { method: 'POST', body: fd, credentials: 'include' });
  return jsonOrThrow<WorkDetail>(res);
}

export async function adminListWorks(): Promise<WorkDetail[]> {
  const res = await fetch(`${BASE}/admin/works`, { credentials: 'include' });
  return jsonOrThrow<WorkDetail[]>(res);
}

export async function adminUpdateWork(id: number, patch: WorkMetaPatch): Promise<WorkDetail> {
  const res = await fetch(`${BASE}/admin/works/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    credentials: 'include',
  });
  return jsonOrThrow<WorkDetail>(res);
}

export async function adminDeleteWork(id: number): Promise<{ ok: true }> {
  const res = await fetch(`${BASE}/admin/works/${id}`, { method: 'DELETE', credentials: 'include' });
  return jsonOrThrow(res);
}
```

- [ ] **Step 2: 写失败的测试**

创建 `src/pages/admin/WorksTab.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WorksTab } from './WorksTab';

const adminListWorks = vi.fn();
const adminCreateWork = vi.fn();
const adminUpdateWork = vi.fn();
const adminDeleteWork = vi.fn();

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    adminListWorks: () => adminListWorks(),
    adminCreateWork: (...a: unknown[]) => adminCreateWork(...a),
    adminUpdateWork: (...a: unknown[]) => adminUpdateWork(...a),
    adminDeleteWork: (...a: unknown[]) => adminDeleteWork(...a),
  };
});

/** jsdom 没有 canvas.toBlob；缩略图生成失败在真机上也会降级，这里直接覆盖该路径 */
beforeEach(() => {
  adminListWorks.mockReset().mockResolvedValue([]);
  adminCreateWork.mockReset().mockResolvedValue({
    id: 1, title: '新作品', description: '', thumbUrl: '/media/works/x.png',
    imageUrl: '/media/works/x.png', width: 0, height: 0, bytes: 1, createdAt: 1,
  });
  adminUpdateWork.mockReset();
  adminDeleteWork.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeFile(name = 'a.png', type = 'image/png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type });
}

describe('WorksTab', () => {
  it('渲染已上架和草稿作品', async () => {
    adminListWorks.mockResolvedValue([
      { id: 1, title: '已上架', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
        width: 0, height: 0, bytes: 1, createdAt: 1 },
      { id: 2, title: '草稿作品', description: '', thumbUrl: '/b.png', imageUrl: '/b.png',
        width: 0, height: 0, bytes: 1, published: false, createdAt: 2 },
    ] as never);
    render(<WorksTab />);
    expect(await screen.findByText('已上架')).toBeTruthy();
    expect(screen.getByText('草稿作品')).toBeTruthy();
  });

  it('空列表给出提示', async () => {
    render(<WorksTab />);
    expect(await screen.findByText(/还没有上传作品/)).toBeTruthy();
  });

  it('选图 + 填标题后上传走 adminCreateWork', async () => {
    render(<WorksTab />);
    await screen.findByText(/还没有上传作品/);

    const input = screen.getByLabelText(/选择图片/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '我的新作品' } });

    fireEvent.click(screen.getByRole('button', { name: '上传' }));

    await waitFor(() => expect(adminCreateWork).toHaveBeenCalled());
    const [file, opts] = adminCreateWork.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(opts.title).toBe('我的新作品');
    expect(opts.published).toBe(true);
  });

  it('取消「立即上架」时传 published=false', async () => {
    render(<WorksTab />);
    await screen.findByText(/还没有上传作品/);

    const input = screen.getByLabelText(/选择图片/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByLabelText(/立即上架/));
    fireEvent.click(screen.getByRole('button', { name: '上传' }));

    await waitFor(() => expect(adminCreateWork).toHaveBeenCalled());
    expect(adminCreateWork.mock.calls[0][1].published).toBe(false);
  });

  it('切换上架状态调 adminUpdateWork', async () => {
    adminListWorks.mockResolvedValue([
      { id: 5, title: 'A', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
        width: 0, height: 0, bytes: 1, createdAt: 1, published: true },
    ] as never);
    adminUpdateWork.mockResolvedValue({} as never);
    render(<WorksTab />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    await waitFor(() => expect(adminUpdateWork).toHaveBeenCalledWith(5, { published: false }));
  });

  it('删除前确认，确认后调 adminDeleteWork', async () => {
    adminListWorks.mockResolvedValue([
      { id: 7, title: 'B', description: '', thumbUrl: '/b.png', imageUrl: '/b.png',
        width: 0, height: 0, bytes: 1, createdAt: 1, published: true },
    ] as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<WorksTab />);
    await screen.findByText('B');
    fireEvent.click(screen.getByRole('button', { name: '删除 B' }));
    await waitFor(() => expect(adminDeleteWork).toHaveBeenCalledWith(7));
    confirmSpy.mockRestore();
  });

  it('取消确认则不删除', async () => {
    adminListWorks.mockResolvedValue([
      { id: 7, title: 'B', description: '', thumbUrl: '/b.png', imageUrl: '/b.png',
        width: 0, height: 0, bytes: 1, createdAt: 1, published: true },
    ] as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<WorksTab />);
    await screen.findByText('B');
    fireEvent.click(screen.getByRole('button', { name: '删除 B' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(adminDeleteWork).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/pages/admin/WorksTab.test.tsx`
Expected: FAIL —— `WorksTab` 不存在。

- [ ] **Step 4: 写 WorksTab.tsx**

创建 `src/pages/admin/WorksTab.tsx`：

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminCreateWork,
  adminDeleteWork,
  adminListWorks,
  adminUpdateWork,
  type WorkDetail,
} from '@/api/works';
import './WorksTab.css';

/** 缩略图长边目标像素 */
const THUMB_MAX = 480;
const THUMB_QUALITY = 0.82;

/**
 * 在浏览器里把图缩到 480px 并转 WebP。
 *
 * 放前端而不是服务端 sharp：上传本来就发生在浏览器里，原图必然已经解码过一次，
 * 再缩一次没有额外 I/O；而服务端目前是纯 JS 依赖（sql.js / ip2region / express），
 * 引入 sharp 会带来原生模块编译，拖慢 npm ci 和 CI 部署。
 *
 * 失败返回 null（不阻断上传），服务端会把 thumb_key 留空、前端回落用原图当缩略图。
 */
async function makeThumb(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close?.(); return null; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/webp', THUMB_QUALITY)
    );
    if (!blob) return null;
    return { blob, width: bmp.width, height: bmp.height };
  } catch (e) {
    console.warn('[works] 缩略图生成失败，降级为无缩略图', e);
    return null;
  }
}

export function WorksTab() {
  const [works, setWorks] = useState<WorkDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [published, setPublished] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    setLoading(true);
    adminListWorks()
      .then(w => { setWorks(w); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleUpload = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const thumb = await makeThumb(file);
      await adminCreateWork(file, { thumb: thumb?.blob ?? null, title, description, published });
      setFile(null);
      setTitle('');
      setDescription('');
      setPublished(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
      reload();
    } catch (e: {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async (work: WorkDetail) => {
    try {
      const next = await adminUpdateWork(work.id, { published: !isPublished(work) });
      setWorks(prev => prev.map(w => (w.id === next.id ? next : w)));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const remove = async (work: WorkDetail) => {
    if (!window.confirm(`删除「${work.title}」？图片文件会一并删掉，无法恢复。`)) return;
    try {
      await adminDeleteWork(work.id);
      setWorks(prev => prev.filter(w => w.id !== work.id));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const saveMeta = async (work: WorkDetail, patch: { title?: string; description?: string }) => {
    try {
      const next = await adminUpdateWork(work.id, patch);
      setWorks(prev => prev.map(w => (w.id === next.id ? next : w)));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  return (
    <div className="works-admin">
      <h2 className="works-admin-title">作品管理</h2>

      <section className="works-admin-upload">
        <h3>上传作品</h3>
        <label className="works-admin-label">
          选择图片
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="works-admin-label">
          标题
          <input
            type="text"
            value={title}
            placeholder="留空则显示「未命名作品」"
            onChange={e => setTitle(e.target.value)}
          />
        </label>
        <label className="works-admin-label">
          描述
          <textarea value={description} rows={2} onChange={e => setDescription(e.target.value)} />
        </label>
        <label className="works-admin-check">
          <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />
          立即上架
        </label>
        <button
          type="button"
          className="works-admin-btn"
          disabled={!file || busy}
          onClick={handleUpload}
        >
          {busy ? '上传中…' : '上传'}
        </button>
        <p className="works-admin-hint">
          上传原图会自动生成 480px WebP 缩略图；作品库列表只加载缩略图，下载仍是原始 PNG。
        </p>
      </section>

      {error && <p className="works-admin-error">操作失败：{error.message}</p>}
      {loading && <p className="works-admin-hint">加载中…</p>}

      {!loading && works.length === 0 && (
        <p className="works-admin-hint">还没有上传作品。</p>
      )}

      <ul className="works-admin-list">
        {works.map(work => (
          <li key={work.id} className="works-admin-item">
            <img className="works-admin-thumb" src={work.thumbUrl} alt="" />
            <div className="works-admin-fields">
              <input
                type="text"
                defaultValue={work.title}
                aria-label={`${work.title} 标题`}
                onBlur={e => {
                  if (e.target.value !== work.title) saveMeta(work, { title: e.target.value });
                }}
              />
              <textarea
                rows={2}
                defaultValue={work.description}
                aria-label={`${work.title} 描述`}
                onBlur={e => {
                  if (e.target.value !== work.description) {
                    saveMeta(work, { description: e.target.value });
                  }
                }}
              />
            </div>
            <div className="works-admin-actions">
              <label className="works-admin-check">
                <input
                  type="checkbox"
                  checked={isPublished(work)}
                  onChange={() => togglePublished(work)}
                />
                {work.title}
              </label>
              <button
                type="button"
                className="works-admin-btn works-admin-btn--danger"
                onClick={() => remove(work)}
              >
                删除 {work.title}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 公开响应里没有 published 字段（列表本来就只含已上架的），
 *  后台列表直接带 published，用一个宽松的读法兜住两种形状。 */
function isPublished(work: WorkDetail): boolean {
  return (work as WorkDetail & { published?: boolean }).published !== false;
}
```

- [ ] **Step 5: 写 WorksTab.css**

创建 `src/pages/admin/WorksTab.css`：

```css
.works-admin {
  display: grid;
  gap: var(--space-4);
}

.works-admin-title {
  margin: 0;
  font-size: var(--text-lg);
}

.works-admin-upload {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.works-admin-upload h3 {
  margin: 0;
  font-size: var(--text-base);
}

.works-admin-label {
  display: grid;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.works-admin-label input[type='text'],
.works-admin-label textarea {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--text-sm);
}

.works-admin-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.works-admin-btn {
  justify-self: start;
  padding: var(--space-2) var(--space-5);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  background: var(--color-accent);
  color: #fff;
  font-size: var(--text-sm);
  cursor: pointer;
}

.works-admin-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.works-admin-btn--danger {
  background: transparent;
  border-color: var(--color-border-strong);
  color: var(--color-error-fg);
}

.works-admin-btn--danger:hover {
  border-color: var(--color-error-fg);
}

.works-admin-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.works-admin-error {
  margin: 0;
  padding: var(--space-3);
  background: var(--color-error-bg);
  color: var(--color-error-fg);
  border-radius: var(--radius-sm);
}

.works-admin-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.works-admin-item {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.works-admin-thumb {
  width: 72px;
  height: 90px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--color-surface-alt);
}

.works-admin-fields {
  display: grid;
  gap: var(--space-2);
}

.works-admin-fields input,
.works-admin-fields textarea {
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.works-admin-actions {
  display: grid;
  gap: var(--space-2);
  justify-items: end;
}
```

- [ ] **Step 6: AdminDashboard 加第 4 个 tab**

把 `src/pages/admin/AdminDashboard.tsx` 整体替换为：

```tsx
import { useState } from 'react';
import { StatsTab } from './StatsTab';
import { UsersTab } from './UsersTab';
import { ProductsTab } from './ProductsTab';
import { WorksTab } from './WorksTab';

type Tab = 'stats' | 'users' | 'products' | 'works';

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('stats');

  return (
    <>
      <div className="statics-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>统计</button>
        <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>账号</button>
        <button role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>商品</button>
        <button role="tab" aria-selected={tab === 'works'} className={tab === 'works' ? 'active' : ''} onClick={() => setTab('works')}>作品</button>
      </div>
      {tab === 'stats' && <StatsTab role="admin" />}
      {tab === 'users' && <UsersTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'works' && <WorksTab />}
    </>
  );
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run src/pages/admin/WorksTab.test.tsx`
Expected: PASS。

- [ ] **Step 8: README 加「作品库」章节**

在 `README.md` 的 `## 统计功能` 一节之前插入：

```markdown
## 作品库

导出图纸的**右下角有一个二维码**（111×111，构建期由 `scripts/gen-qr.mjs` 预生成），
扫码直接进入公开作品库 `/works`。

- **导出图二维码**：`/brand/works-qr.png`，由 `scripts/gen-qr.mjs` 在 `prebuild` 阶段生成
  （version 3 / ECC L / 模块 3px / 静区 4 模块），产出物**提交进仓库**，
  这样首次 `npm run dev`（不跑 prebuild）也不会 404。
- **二维码落位**：`composite.ts` 的 `qrBandPx` 只把底部边距加宽，页眉 / 图纸 / 色卡
  的纵向布局一行不动 —— 色卡既不会被压也不会重排。画不出二维码时（资源 404 /
  被拦截 / jsdom）自动降级为「不画码」，导出照常成功。
- **作品库页面**：`/works` 列表（缩略图网格 + 加载更多）、`/works/:id` 详情
  （大图 + 「长按图片保存」提示 + 「下载原图」按钮）。
  同一个图片 URL 承担两种用途：被 `<img>` 引用是内联渲染（可长按），
  被带 `download` 的 `<a>` 引用是直接下载 —— 不需要 `Content-Disposition`。
- **后台上传**：后台第 4 个 tab「作品」。上传原图时浏览器用 canvas 生成 480px WebP
  缩略图一起提交，服务端不引入 `sharp`。列表页只加载缩略图，下载仍是原始 PNG。
- **存储**：`works` 表只存 key（`works/<16hex>.png`），不存 URL，对外地址一律由
  `server/storage/` 里的 `StorageDriver.publicUrl()` 现算。换 S3/OSS 只需新增一个
  driver 实现文件 + 改 `server/storage/index.ts` 一行，老数据一行不用洗。
- **文件位置**：`<PINGDOU_DATA_DIR>/media/works/`；生产由 nginx 直读（见
  `docs/nginx-https-setup.md` 的 `location ~ ^/media/works/`）。

API：
- `GET /api/public/works?limit&offset` — 公开列表（无需登录）
- `GET /api/public/works/:id` — 公开详情（草稿返回 404）
- `GET /api/admin/works` / `POST /api/admin/works` / `PUT /api/admin/works/:id` /
  `POST /api/admin/works/:id/image` / `DELETE /api/admin/works/:id` — 后台（需 admin）
```

- [ ] **Step 9: 跑全量测试 + 类型检查 + 构建**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全部通过。

- [ ] **Step 10: 端到端手测（`npm run dev:full`）**

按顺序验证，每步都要看到预期结果再进下一步：

1. 打开 `http://localhost:5173/`，传一张图，导出 → 打开下载的 PNG，确认**右下角有可扫二维码**，且**底部色卡区完整未被遮挡**（多导出几张不同色数的图确认）
2. 手机扫该二维码 → 落到 `http://localhost:5173/works`，作品库能打开
3. `/statics` 用 admin 登录 → 「作品」tab → 选一张 PNG → 填标题 → 上传
4. 回到 `/works` → 该作品出现在列表，缩略图加载正常（Network 面板确认请求的是 `-t.webp`，不是原图）
5. 点进 `/works/:id` → 手机长按能存图；桌面点「下载原图」能下载
6. 后台取消「立即上架」→ `/works` 不再显示；直连 `/works/:id` 显示「不存在或已下架」
7. 后台删除 → 刷新 `/works` 不再显示；`ls $PINGDOU_DATA_DIR/media/works/` 确认文件被删
8. 降级验证：`mv public/brand/works-qr.png /tmp/` → 重新导出 → **仍能成功导出**（只是没有二维码），控制台有 warn
9. 恢复 QR 文件

- [ ] **Step 11: 提交**

```bash
git add src/api/works.ts src/pages/admin/WorksTab.tsx src/pages/admin/WorksTab.css src/pages/admin/WorksTab.test.tsx src/pages/admin/AdminDashboard.tsx README.md
git commit -m "feat(后台): 作品管理 tab，浏览器端生成 WebP 缩略图"
```

---

## 收尾自检

全部 9 个任务完成后逐条核对：

- [ ] `npm test` 全绿，`npm run typecheck` 0 错误，`npm run build` 成功
- [ ] `dist/brand/works-qr.png` 存在且为 111×111
- [ ] `public/sitemap.xml` 含 `https://www.xn--muu023g.xyz/works`
- [ ] `public/robots.txt` 含 `Disallow: /media/`
- [ ] DB 里 `works` 表的 `image_key` / `thumb_key` 列没有任何 URL（只有 `works/<16hex>.*`）
- [ ] 磁盘 `media/works/` 下没有孤儿文件（每个文件都被某行记录引用）
- [ ] 导出的 PNG 右下角二维码可扫，色卡区未被遮挡
- [ ] `/works`、`/works/:id`、后台「作品」tab 三个入口均可用
- [ ] 删掉 QR 资源后导出仍成功（降级路径有效）
- [ ] `docs/DEPLOY.md` troubleshooting 含 `/media/` 条目
