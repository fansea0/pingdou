# 用户投稿 + 后台审核 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把作品库的进货渠道从「后台上传」整个换成「用户投稿」，投稿携带图纸参数、先进待审核队列、站主通过后才公开，且成品图上的二维码指向这一件作品自己的详情页。

**Architecture:** 审核态与作品共用 `works` 一张表（新增 `status` + 四个图纸参数列 + 一次性 `upload_token`）。投稿走两步：先 POST 元数据拿 id 与不可猜的上传令牌，再用 id 生成二维码画进已预留白带的画布，最后上传带码成品图。后台通过/拒绝只改 `status` 与 `published`，拒绝时物理删除源文件。

**Tech Stack:** React 18 + TypeScript + Vite 5 / Express 5 + `sql.js`（WASM SQLite）/ `multer` / `qrcode`（运行时动态 import）/ vitest + jsdom + supertest + Playwright

**Spec:** `docs/superpowers/specs/2026-10-17-user-submission-and-review-design.md`

---

## Global Constraints

以下约束适用于**每一个**任务，不再逐条重复：

- **代码注释用中文，且必须写「为什么」而不是「做了什么」。** 本仓库的注释密度远高于常规，评审时看不到权衡理由的代码会被打回。
- **提交信息用中文**，沿用 `类型(范围): 摘要` 格式（见 `git log`：`feat(点赞)!: 赞数改存 works.likes 计数列`）。
- **服务端保持纯 JS 依赖**：不引入 `sharp`、`canvas` 等原生模块（理由见 `server/index.ts` 既有注释与 spec §5.4）。
- **数字校验一律 `typeof x === 'number' && Number.isInteger(x)`**，非法一律 400，绝不静默转 0。multipart 字段是字符串，那一处才用 `Number()` 兜底。
- **任何公开查询的 WHERE 都要显式带 `status = 'approved'`**，不依赖「`published=1` 蕴含已过审」这个不变量成立。
- **`storage` 只存 key 不存 URL**，对外地址一律 `storage.publicUrl()` 现算。
- **进程内状态（配额、去重集合）只在 systemd 单进程下有效**，横向扩展需换 Redis。写注释时不要把这个当 bug。
- 每个任务结束前跑 `npm test` 与 `npm run typecheck`，两者必须全绿才提交。

### 对已批 spec 的一处修订（Task 10）

spec §6.4 原计划「从 `exportMulti` 提取 `renderBoardComposite`，投稿与导出共用」。实施时发现 `PipelineResult.indices` 已经是简化颜色 + 紧裁之后的**最终图纸**（`src/pipeline/pipeline.ts:189-192`），投稿直接吃 `result` 渲染即可，**不需要重跑采样**，也**不需要重构 `exportMulti`**：

- 重复的只有约 6 行（`renderBeadBoard` + `renderCompositeFromBoard`），真正易错的采样/去背景/简化/裁剪逻辑**完全没被复制**；
- 不动正在工作的导出热路径，风险从「重构 50 行」降到「新增 6 行」；
- 投稿图就是用户此刻屏幕上看到的那张图，比「重跑一遍可能与预览有细微差异」更符合需求原文。

因此 Task 10 改为新增 `src/pipeline/submission.ts`，`exportMulti` 保持原样。

---

## File Structure

**新增**

| 文件 | 职责 |
| --- | --- |
| `tests/helpers/works.ts` | 测试用造数据：走真实投稿路径造一件「已通过」的作品 |
| `tests/unit/server/works-schema.test.ts` | 新库 / 老库两条路径的 schema 断言 |
| `tests/unit/server/submissions.test.ts` | 投稿创建、上传图片、配额的单元测试 |
| `tests/unit/server/review.test.ts` | 审核通过 / 拒绝 / 上架不变量的单元测试 |
| `tests/unit/server/submission-routes.test.ts` | 2 个公开投稿路由 + 2 个后台审核路由的 HTTP 测试 |
| `src/pipeline/qr.test.ts` | 投稿二维码的尺寸守卫（防止白带高度与码边长脱钩） |
| `src/pipeline/submission.ts` | 按当前 `PipelineResult` 渲染投稿成品图（留白带但不画码） |
| `src/pipeline/submission.test.ts` | 投稿渲染的单元测试 |
| `src/components/SubmitWorkButton.tsx` / `.css` / `.test.tsx` | 投稿按钮 + 名称弹窗 + 两步上传编排 |
| `scripts/reset-gallery.mjs` | 一次性清空图库（备份 DB → 清表 → 删文件） |

**改动**

| 文件 | 任务 |
| --- | --- |
| `server/db.ts` | 1 |
| `server/works.ts` | 2、3、4、5、7 |
| `server/index.ts` | 6、7 |
| `tests/unit/server/works.test.ts`、`works-routes.test.ts`、`works-search.test.ts`、`works-likes.test.ts`、`works-likes-routes.test.ts` | 7 |
| `package.json` | 9 |
| `src/pipeline/qr.ts` | 9 |
| `src/api/works.ts` | 8 |
| `src/App.tsx` | 11 |
| `src/pages/admin/WorksTab.tsx` | 12 |
| `src/pages/WorkDetailPage.tsx` | 13 |
| `README.md`、`docs/DEPLOY.md` | 15 |

---

### Task 1: `works` 表加审核态与图纸参数列

**Files:**
- Modify: `server/db.ts`（`CREATE TABLE works` 块 + `ensureColumn` 段落）
- Create: `tests/unit/server/works-schema.test.ts`

**Interfaces:**
- Produces: `works` 表新增列 `status TEXT NOT NULL DEFAULT 'pending'`（CHECK 枚举 pending/approved/rejected）、`board_w`/`board_h`/`bean_count`/`color_count`/`estimate_minutes`（均 `INTEGER NOT NULL DEFAULT 0`）、`upload_token TEXT NOT NULL DEFAULT ''`；索引 `idx_works_status_created (status, created_at DESC)`。
- 后续任务依赖这些列名，一字不改。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/server/works-schema.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs from 'sql.js';

let tmp = '';

/**
 * 2026-10-16 版的老 works 表：没有 status / 四个参数列 / upload_token。
 * 用它验证 ensureColumn 这条老库升级路径 —— 新库路径由下面另一个用例覆盖。
 */
const OLD_WORKS_DDL = `
CREATE TABLE works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  CHECK (published IN (0, 1))
);`;

const NEW_COLUMNS = [
  'status', 'board_w', 'board_h', 'bean_count', 'color_count',
  'estimate_minutes', 'upload_token',
];

/** 先在磁盘上造一个只有老 works 表的 stats.db，让 initDb 走 CREATE TABLE 之外的那条路。 */
async function seedOldWorksDb(dir: string): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => resolve(process.cwd(), 'node_modules/sql.js/dist', file),
  });
  const db = new SQL.Database();
  db.exec(OLD_WORKS_DDL);
  writeFileSync(join(dir, 'stats.db'), Buffer.from(db.export()));
  db.close();
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'works-schema-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('works 表 schema', () => {
  it('新库直接建出全部 7 个新列', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const cols = db.queryAll<{ name: string }>(`PRAGMA table_info(works)`).map(r => r.name);
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);
  });

  it('status 默认 pending（失败安全：漏写 status 的行不会被公开）', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const info = db.queryAll<{ name: string; dflt_value: string | null }>(
      `PRAGMA table_info(works)`,
    );
    const defaults = new Map(info.map(r => [r.name, r.dflt_value]));
    expect(defaults.get('status')).toBe("'pending'");
    expect(defaults.get('upload_token')).toBe("''");
    for (const c of ['board_w', 'board_h', 'bean_count', 'color_count', 'estimate_minutes']) {
      expect(defaults.get(c)).toBe('0');
    }
  });

  it('建出 idx_works_status_created 索引', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const rows = db.queryAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_works_status_created'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('老库走 ensureColumn 幂等补齐全部 7 列，且不丢已有行', async () => {
    await seedOldWorksDb(tmp);
    vi.resetModules();
    const db = await import('../../../server/db.js');
    await db.initDb();

    const cols = db.queryAll<{ name: string }>(`PRAGMA table_info(works)`).map(r => r.name);
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);

    // 老行仍在，且按默认落成 pending —— 公开查询会把它挡住（部署后图库为空是预期的）
    db.runStmt(
      `INSERT INTO works (image_key, created_at, updated_at) VALUES ('works/x.png', 1, 1)`,
      [],
    );
    const rows = db.queryAll<{ status: string }>(`SELECT status FROM works`);
    expect(rows).toEqual([{ status: 'pending' }]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/works-schema.test.ts`

Expected: FAIL —— 4 个用例里「新库直接建出全部 7 个新列」等会报 `toContain` 失败，`idx_works_status_created` 查不到行。

- [ ] **Step 3: 改 `server/db.ts` 的 CREATE TABLE**

在 `works` 表 DDL 的 `likes INTEGER NOT NULL DEFAULT 0,` 之后、`CHECK (published IN (0, 1))` 之前插入：

```sql
      -- 2026-10-17：用户投稿 + 后台审核。作品来源从后台上传整个切换成用户投稿，
      -- 于是同一张表要同时表达「审核到哪一步」和「图纸本身长什么样」。
      --
      -- status 默认 pending 是刻意的失败安全：任何漏写 status 的行（手写 SQL、
      -- 将来新增的写路径忘了带这个字段）落成「不公开」，而不是直接对外可见。
      status           TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
      -- 图纸格数（如 87 × 62）。存两个整数而不是 "1:1.4" 字符串：比例由展示层现算，
      -- 改展示精度不用洗历史数据；而字符串还要防有人传 "1:999" 这种离谱值。
      board_w          INTEGER NOT NULL DEFAULT 0,
      board_h          INTEGER NOT NULL DEFAULT 0,
      -- 实际画出的豆子数 / 用到的色号种数。审核时站主要靠这两项判断值不值得过。
      bean_count       INTEGER NOT NULL DEFAULT 0,
      color_count      INTEGER NOT NULL DEFAULT 0,
      -- 预估装配工时，存**分钟数**不存文案：以后改 formatAssemblyHours 的措辞，
      -- 历史数据一行都不用动。
      estimate_minutes INTEGER NOT NULL DEFAULT 0,
      -- 第二步上传图片用的一次性令牌（spec §5.2）。id 是可猜的自增整数，
      -- 只靠 id 校验的话任何人都能把图挂到别人的待审记录上。图写入后清空成 ''。
      upload_token     TEXT    NOT NULL DEFAULT '',
```

- [ ] **Step 4: 改 `server/db.ts` 的 ensureColumn 段落**

在 `ensureIndex('idx_works_published_likes', ...)` 与 `migrateWorkLikesToCountColumn();` **之后**追加：

```ts
  // 用户投稿 + 审核（2026-10-17）。七列全是纯追加，老行落成默认值。
  //
  // 刻意**不**回填 status='approved'：那会把「未过审」和「已过审」在数据上混成同一个
  // 值，而这次改动的全部意义就是这两者分开。存量数据的归宿是被清库脚本删掉，不是
  // 被洗成 approved。在脚本跑之前它们被公开查询的 `AND status='approved'` 全部挡住
  // —— 即「部署后图库显示为空」是预期行为，不是故障（spec §9）。
  ensureColumn('works', 'status', "TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))");
  ensureColumn('works', 'board_w', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'board_h', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'bean_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'color_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'estimate_minutes', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'upload_token', "TEXT NOT NULL DEFAULT ''");
  // 必须排在 ensureColumn('works','status',...) 之后：老库还没有 status 列，
  // 提前建索引会抛 "no such column: status"，initDb 直接起不来。
  ensureIndex('idx_works_status_created', 'works(status, created_at DESC)');
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/works-schema.test.ts`

Expected: PASS —— 4 个用例全绿。

- [ ] **Step 6: 跑全量回归**

Run: `npm test`

Expected: 全绿。老库路径的 `ensureColumn` 新增列不影响既有查询（默认值 0 / pending，公开查询这轮还没加 status 过滤，所以 Task 1 之后老作品仍然可见 —— 这是预期的，Task 2 才会挡住它们）。

- [ ] **Step 7: 提交**

```bash
git add server/db.ts tests/unit/server/works-schema.test.ts
git commit -m "feat(db): works 表加 status 与四个图纸参数列 + 审核队列索引

status 默认 pending 而非 approved：漏写 status 的行落成「不公开」，
这是失败安全的那一端。刻意不回填老行为 approved —— 那会把未过审和已
过审在数据上混成同一个值，而这次改动的全部意义就是把它们分开。老行
会被清库脚本删掉；在那之前它们被公开查询的 AND status='approved' 挡住。"
```

---

### Task 2: 响应形状加图纸参数 + 公开查询过滤 `status`

**Files:**
- Modify: `server/works.ts`（`WorkRow`、`WorkDetail`、`toDetail`、`toAdminDetail`、`listPublishedWorks`、`getPublishedWork`、`createWork`）
- Test: `tests/unit/server/works.test.ts`（追加用例）

**Interfaces:**
- Produces:
  - `export interface WorkParams { boardW: number; boardH: number; beanCount: number; colorCount: number; estimateMinutes: number }`
  - `WorkDetail extends WorkSummary, WorkParams`（公开列表 `WorkSummary` **不加**）
  - `AdminWorkDetail extends WorkDetail { published: boolean; status: 'pending' | 'approved' | 'rejected' }`
  - `export type WorkStatus = 'pending' | 'approved' | 'rejected'`
  - `createWork`（本任务仍存在，Task 7 删除）改为显式写 `status='approved'`，保住既有测试。

- [ ] **Step 1: 写失败测试**

在 `tests/unit/server/works.test.ts` 末尾追加：

```ts
describe('作品响应形状与公开可见性', () => {
  it('createWork 产出的作品是 approved 且公开可见（保住改动前行为）', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({
      title: '老作品',
      image: { body: PNG, mime: 'image/png' },
      published: true,
    });
    expect(w.status).toBe('approved');
    expect(works.getPublishedWork(w.id)).not.toBeNull();
  });

  it('图纸参数为 0 时原样透传给详情（不因缺省而消失）', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ title: '无参数', image: { body: PNG, mime: 'image/png' } });
    const d = works.getPublishedWork(w.id)!;
    expect(d.boardW).toBe(0);
    expect(d.beanCount).toBe(0);
    expect(d.estimateMinutes).toBe(0);
  });

  it('status 为 pending 的作品不出现在公开列表，total 也不含它', async () => {
    const { works } = await freshWorks();
    const visible = await works.createWork({
      title: '已过审', image: { body: PNG, mime: 'image/png' },
    });
    // 手工把这一行压成 pending，模拟「投稿已入库但还没审核」
    const db = await import('../../../server/db.js');
    db.runStmt(`UPDATE works SET status='pending' WHERE id=?`, [visible.id]);

    const list = works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' });
    expect(list.total).toBe(0);
    expect(works.getPublishedWork(visible.id)).toBeNull();
  });

  it('status 为 rejected 的作品同样不可见', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ title: '被拒', image: { body: PNG, mime: 'image/png' } });
    const db = await import('../../../server/db.js');
    db.runStmt(`UPDATE works SET status='rejected' WHERE id=?`, [w.id]);
    expect(works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' }).total).toBe(0);
    expect(works.getPublishedWork(w.id)).toBeNull();
  });

  it('后台形状带 status，公开形状不带（与 published 同样的隔离理由）', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ title: 'x', image: { body: PNG, mime: 'image/png' } });
    const admin = works.listAllWorks().find(x => x.id === w.id)!;
    expect(admin.status).toBe('approved');
    expect(admin.published).toBe(true);
    // 公开 detail 不含 status —— 恒为 approved 的字段写进响应只是废话，
    // 还让客户端误以为「拿不到该字段 = 已上架」这种反向推断成立
    expect('status' in works.getPublishedWork(w.id)!).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/works.test.ts -t '作品响应形状'`

Expected: FAIL —— `status` 不在响应里（`expected undefined to be 'approved'`）。

- [ ] **Step 3: 改类型与序列化**

`server/works.ts` 中：

把 `WorkRow` 接口补上新列：

```ts
interface WorkRow {
  // ...既有字段不动...
  likes: number;
  // 2026-10-17 用户投稿新增
  status: string;
  board_w: number;
  board_h: number;
  bean_count: number;
  color_count: number;
  estimate_minutes: number;
  upload_token: string;
}
```

在 `WorkSummary` 之后新增：

```ts
export type WorkStatus = 'pending' | 'approved' | 'rejected';

/**
 * 图纸参数。详情页与后台审核队列要展示，公开列表不需要 ——
 * 列表页每张卡片只显示标题和缩略图，塞进去是白给流量。
 */
export interface WorkParams {
  /** 图纸宽度，单位格（如 87）。与 height 一起构成「87 × 62」的尺寸。 */
  boardW: number;
  boardH: number;
  /** 实际画出的豆子数（已扣掉被去掉的背景格）。 */
  beanCount: number;
  /** 图纸用到的色号种数。 */
  colorCount: number;
  /** 预估装配工时，单位分钟。展示层走 formatAssemblyHours，不存文案。 */
  estimateMinutes: number;
}
```

把 `WorkDetail` 的声明改成：

```ts
export interface WorkDetail extends WorkSummary, WorkParams {
  description: string;
  imageUrl: string;
  bytes: number;
  /** 仅 detail 携带：后台要显示「最后改于」，公开列表不暴露 */
  updatedAt: number;
}
```

把 `AdminWorkDetail` 的声明改成：

```ts
export interface AdminWorkDetail extends WorkDetail {
  published: boolean;
  /** 审核态。与 published 同样只出现在后台形状里：公开接口只返回已过审作品，
   *  这个字段恒为 'approved'，写进公开响应只是废话。 */
  status: WorkStatus;
}
```

在 `toDetail` 之前新增辅助函数，并把 `toDetail` / `toAdminDetail` 改掉：

```ts
function paramsOf(row: WorkRow): WorkParams {
  return {
    boardW: row.board_w ?? 0,
    boardH: row.board_h ?? 0,
    // ?? 0 与 likes 同理：行类型上必填，但手工 SQL 改库写进 NULL 时，
    // 前端会拿到 NaN 渲染。取 0 是明确的安全退路。
    beanCount: row.bean_count ?? 0,
    colorCount: row.color_count ?? 0,
    estimateMinutes: row.estimate_minutes ?? 0,
  };
}

function toDetail(row: WorkRow): WorkDetail {
  return {
    ...toSummary(row),
    ...paramsOf(row),
    description: row.description,
    imageUrl: storage.publicUrl(row.image_key),
    bytes: row.bytes,
    updatedAt: row.updated_at,
  };
}

/** DB 里 published 是 0/1、status 是文本，JSON 侧统一成 boolean / 枚举。 */
function toAdminDetail(row: WorkRow): AdminWorkDetail {
  return {
    ...toDetail(row),
    published: row.published === 1,
    status: (row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending'),
  };
}
```

- [ ] **Step 4: 公开查询加 status 过滤**

`listPublishedWorks` 里替换 `const where = ...` 那一段：

```ts
  // 三处 WHERE（列表 / 有 q 的列表 / COUNT）必须字面一致，否则 hasMore 会一直显示。
  //
  // `status = 'approved'` 是**独立于** published 的第二道过滤，不依赖
  // 「published=1 蕴含已过审」这个不变量成立：那是不变量①在接口层的防手滑，
  // 这里是万一①被绕过后的兜底。公开路径的正确性不该建立在另一条约束没被违反之上。
  const q = (opts.q ?? '').trim().slice(0, 100);
  const where = q
    ? `WHERE w.published = 1 AND w.status = 'approved' AND w.title LIKE ? ESCAPE '\\'`
    : `WHERE w.published = 1 AND w.status = 'approved'`;
```

`getPublishedWork` 的第二行改成：

```ts
  if (!row || row.published !== 1 || row.status !== 'approved') return null;
```

并把上方注释里的「草稿一律返回 null」补一句：

```ts
/** 未过审 / 已下架 / 不存在一律返回 null —— 不区分三者的原因与既有立场一致：
 *  区分开等于告诉访客这个 id 曾经存在过。 */
```

- [ ] **Step 5: `createWork` 显式写 status（Task 7 会把整个函数删掉）**

`createWork` 的 INSERT 改成显式带 `status`：

```ts
    runStmt(
      `INSERT INTO works
         (title, description, image_key, thumb_key, width, height, bytes,
          published, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
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
```

上方加一行注释：

```ts
  // 显式写 status='approved'：这个函数是即将被删除的后台上传路径（spec §5.4，
  // Task 7），在它还在的这几个任务里必须保住「后台上传 = 直接可公开」的行为，
  // 否则既有 20 多条 works 测试会全红。DDL 的默认值是 pending，正是为了不让
  // 「忘了写 status」的行混进公开列表。
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/works.test.ts tests/unit/server/works-search.test.ts tests/unit/server/works-likes.test.ts tests/unit/server/works-routes.test.ts tests/unit/server/works-likes-routes.test.ts`

Expected: PASS。既有 5 个 works 测试文件 + 新增 5 个用例全绿。

- [ ] **Step 7: 跑全量回归并提交**

Run: `npm test && npm run typecheck`

Expected: 全绿。

```bash
git add server/works.ts tests/unit/server/works.test.ts
git commit -m "feat(works): 响应形状带图纸参数，公开查询显式过滤 status='approved'

图纸参数只进 WorkDetail 不进 WorkSummary —— 列表页每张卡片只有标题和缩略图，
塞进去是白给流量。status 与 published 同样只出现在后台形状里：公开接口只返回
已过审作品，这两个字段恒为固定值，带上去还会诱导出「拿不到 = 已上架」的反向推断。

公开 WHERE 的 status 过滤不依赖「published=1 蕴含已过审」那条不变量成立：
那条是接口层的防手滑，这条是万一被绕过后的兜底。"
```

---

### Task 3: 投稿配额（每 IP + UA 每日 3 件）

**Files:**
- Modify: `server/works.ts`（文件末尾，`likeFingerprint` 附近）
- Test: `tests/unit/server/submissions.test.ts`（新建）

**Interfaces:**
- Produces:
  - `export const SUBMISSION_DAILY_LIMIT = 3`
  - `export function submissionFingerprint(ip: string, userAgent: string, now?: number): string`
  - `export function allowSubmission(ip: string, userAgent: string, now?: number): boolean` —— 满额返回 `false`；成功占用返回 `true`
  - `export function remainingSubmissions(ip: string, userAgent: string, now?: number): number`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/server/submissions.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp = '';

/** 每个用例都重新求值 server/works.js —— 配额是模块级状态，靠 resetModules 清干净。
 *  （与 works-likes.test.ts 对进程内去重 Set 的处理方式一致） */
async function freshWorks(): Promise<typeof import('../../../server/works.js')> {
  tmp = mkdtempSync(join(tmpdir(), 'sub-quota-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return import('../../../server/works.js');
}

beforeEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('投稿配额', () => {
  it('同一 IP + UA 连投 3 件都放行，第 4 件被拒', async () => {
    const works = await freshWorks();
    expect(works.SUBMISSION_DAILY_LIMIT).toBe(3);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(true);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(true);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(true);
    expect(works.allowSubmission('1.2.3.4', 'UA')).toBe(false);
  });

  it('换 UA 算另一个人（沿用点赞已拍板的取向）', async () => {
    const works = await freshWorks();
    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA-A');
    expect(works.allowSubmission('1.2.3.4', 'UA-A')).toBe(false);
    expect(works.allowSubmission('1.2.3.4', 'UA-B')).toBe(true);
  });

  it('换 IP 算另一个人', async () => {
    const works = await freshWorks();
    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA');
    expect(works.allowSubmission('5.6.7.8', 'UA')).toBe(true);
  });

  it('跨天自动重置（配额按 UTC 日历日，与 events/sessions 同一口径）', async () => {
    const works = await freshWorks();
    const day1 = Date.parse('2026-10-17T10:00:00Z');
    for (let i = 0; i < 3; i++) works.allowSubmission('1.2.3.4', 'UA', day1);
    expect(works.allowSubmission('1.2.3.4', 'UA', day1)).toBe(false);
    // 东八区凌晨 1 点仍是 UTC 前一天，所以要跨足一整个 UTC 日
    const day2 = day1 + 24 * 60 * 60 * 1000;
    expect(works.allowSubmission('1.2.3.4', 'UA', day2)).toBe(true);
  });

  it('remainingSubmissions 反映还能再投几件', async () => {
    const works = await freshWorks();
    expect(works.remainingSubmissions('1.2.3.4', 'UA')).toBe(3);
    works.allowSubmission('1.2.3.4', 'UA');
    expect(works.remainingSubmissions('1.2.3.4', 'UA')).toBe(2);
  });

  it('指纹含 UA 与日期：同 IP 换 UA、同指纹跨天都不同', async () => {
    const works = await freshWorks();
    const day1 = Date.parse('2026-10-17T10:00:00Z');
    const day2 = day1 + 24 * 60 * 60 * 1000;
    expect(works.submissionFingerprint('1.2.3.4', 'UA', day1))
      .not.toBe(works.submissionFingerprint('1.2.3.4', 'UA', day2));
    expect(works.submissionFingerprint('1.2.3.4', 'UA-A', day1))
      .not.toBe(works.submissionFingerprint('1.2.3.4', 'UA-B', day1));
    // 稳定：同输入必得同结果，否则计数会漏
    expect(works.submissionFingerprint('1.2.3.4', 'UA', day1))
      .toBe(works.submissionFingerprint('1.2.3.4', 'UA', day1));
  });

  it('分隔符是 NUL：ip="ab"+ua="c" 与 ip="a"+ua="bc" 必须是两个人', async () => {
    const works = await freshWorks();
    const t = Date.parse('2026-10-17T10:00:00Z');
    expect(works.submissionFingerprint('ab', 'c', t))
      .not.toBe(works.submissionFingerprint('a', 'bc', t));
  });

  it('指纹是 16 位 hex（与 likeFingerprint 同规格）', async () => {
    const works = await freshWorks();
    expect(works.submissionFingerprint('1.2.3.4', 'UA')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('指纹异常膨胀时整份丢弃（fail-open），而不是拒绝新投稿', async () => {
    const works = await freshWorks();
    // 伪造 20_000+ 个不同 UA，把 Map 撑过上限
    for (let i = 0; i < works.SUBMISSION_QUOTA_MAX + 10; i++) {
      works.allowSubmission(`10.0.${Math.floor(i / 256)}.${i % 256}`, `UA-${i}`);
    }
    // 触顶后新投稿仍然放行 —— 一次异常流量不该把当天全站投稿入口变成不可用
    expect(works.allowSubmission('203.0.113.9', 'UA-fresh')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/submissions.test.ts`

Expected: FAIL —— `works.allowSubmission is not a function`。

- [ ] **Step 3: 实现配额**

在 `server/works.ts` 末尾（`likeFingerprint` 与 `seenFingerprints` 那组代码之后）追加：

```ts
// ---- 投稿配额（2026-10-17） ----

/**
 * 每 IP + 每 UA 每天能投几件。
 *
 * 3 件/天对真实用户足够（没人会一天投 9 张图），对磁盘的暴露却有界：
 * 单件成品图 1–5 MB。
 */
export const SUBMISSION_DAILY_LIMIT = 3;

/**
 * 指纹表的上限。指纹里的 IP 和 UA 都由客户端控制，伪造 IP + 轮换 UA 能让 Map
 * 无限增长 —— 内存被撑爆比 DB 慢严重得多。
 */
export const SUBMISSION_QUOTA_MAX = 20_000;

/**
 * 投稿指纹：hash(IP + User-Agent + 日期 + 盐)。
 *
 * 与 likeFingerprint 同一套口径（同一个 WORKS_IP_SALT、同一个 \0 分隔符、同一个
 * isoDay UTC 日期、同样截断 16 位），只是**去掉了作品 ID 那一段** —— 投稿时作品
 * 还不存在。
 *
 * 包含 UA 的后果要认下来：轮换 UA 就能绕过 3 件/天。这是有意的取舍，兜底是审核
 * 本身 —— pending 永远不公开，攻击者投进来的东西站主一眼就能看到并拒绝。
 * 与其把配额做成攻防战，不如让审核队列当最后一道闸。
 */
export function submissionFingerprint(
  ip: string,
  userAgent: string,
  now: number = Date.now(),
): string {
  return createHash('sha256')
    .update(`${ip}\u0000${userAgent}\u0000${isoDay(now)}:${WORKS_IP_SALT}`)
    .digest('hex')
    .slice(0, 16);
}

let quotaDay = '';
let quotaCount = new Map<string, number>();

/**
 * 跨天轮转。每次读写都调，所以不存在「没人投稿时不轮转、第二天第一次投稿读到
 * 昨天残留」的问题。与 likeFingerprint 那边的 rotateDayIfNeeded 同一套写法。
 */
function rotateQuotaIfNeeded(now: number): void {
  const day = isoDay(now);
  if (day === quotaDay) return;
  quotaDay = day;
  quotaCount = new Map();
}

/** 这个指纹今天还能再投几件。0 = 今日额度已用完。只读，不占名额。 */
export function remainingSubmissions(
  ip: string,
  userAgent: string,
  now: number = Date.now(),
): number {
  rotateQuotaIfNeeded(now);
  const used = quotaCount.get(submissionFingerprint(ip, userAgent, now)) ?? 0;
  return Math.max(0, SUBMISSION_DAILY_LIMIT - used);
}

/**
 * 占用一个名额。返回 false = 今日额度已用完，调用方应回 429。
 *
 * **只挂在真正会写库的那一步上**（createSubmission 在参数校验之后调它），
 * 不要挪到参数校验之前：用户把名称打错一个字收到一个 400，不该同时白扣掉
 * 每日 3 件里的 1 件。
 *
 * 触顶时的选择是**整份丢弃**（fail-open）：配额失效、投稿继续，但进程活着。
 * 反过来 fail-closed 会把一次异常流量变成当天全站投不了稿。
 */
export function allowSubmission(
  ip: string,
  userAgent: string,
  now: number = Date.now(),
): boolean {
  rotateQuotaIfNeeded(now);
  if (quotaCount.size > SUBMISSION_QUOTA_MAX) {
    quotaCount = new Map();
  }
  const fp = submissionFingerprint(ip, userAgent, now);
  const used = quotaCount.get(fp) ?? 0;
  if (used >= SUBMISSION_DAILY_LIMIT) return false;
  quotaCount.set(fp, used + 1);
  return true;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/submissions.test.ts`

Expected: PASS —— 9 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add server/works.ts tests/unit/server/submissions.test.ts
git commit -m "feat(投稿): 每 IP + UA 每日 3 件的进程内配额

复用 likeFingerprint 的全部口径（同盐、同 NUL 分隔符、同 UTC 日期、同样截断
16 位），只是去掉作品 ID 那一段 —— 投稿时作品还不存在。works 表不落任何 IP
派生数据，与点赞保持同一条隐私立场。

包含 UA 的后果是轮换 UA 能绕过 3 件/天，这是有意取舍：兜底是审核本身，
pending 永远不公开。与其把配额做成攻防战，不如让审核队列当最后一道闸。

触顶时整份丢弃（fail-open）而不是拒绝新投稿 —— 一次异常流量不该把当天
全站投稿入口变成不可用。"
```

---

### Task 4: 投稿两步的服务层

**Files:**
- Modify: `server/works.ts`
- Test: `tests/unit/server/submissions.test.ts`（追加）

**Interfaces:**
- Produces:
  - `export class SubmissionInputError extends Error {}`
  - `export class SubmissionQuotaError extends Error {}`
  - `export interface CreatedSubmission { id: number; uploadToken: string }`
  - `export function createSubmission(raw: unknown, client: { ip: string; userAgent: string }): CreatedSubmission` —— 内部顺序：校验 → 占配额 → 插入
  - `export interface SubmissionImageInput { image: WorkImage; thumb?: WorkImage; width?: unknown; height?: unknown }`
  - `export async function attachSubmissionImage(id: number, uploadToken: string, input: SubmissionImageInput): Promise<AdminWorkDetail>`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/server/submissions.test.ts` 末尾追加（并把文件顶部的 `freshWorks` 改成同时返回 db 模块）：

```ts
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46]);

const CLIENT = { ip: '1.2.3.4', userAgent: 'UA' };

function goodInput(over: Record<string, unknown> = {}) {
  return {
    title: '粉色小熊',
    boardW: 87,
    boardH: 62,
    beanCount: 3814,
    colorCount: 42,
    estimateMinutes: 190,
    ...over,
  };
}

describe('createSubmission', () => {
  it('写入一行 pending 记录并返回 id 与不可猜的令牌', async () => {
    const works = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    expect(created.id).toBeGreaterThan(0);
    expect(created.uploadToken).toMatch(/^[0-9a-f]{32}$/);
    const rows = works.listAllWorks();
    expect(rows[0].status).toBe('pending');
    expect(rows[0].published).toBe(false);
    expect(rows[0].title).toBe('粉色小熊');
  });

  it('四个图纸参数原样入库', async () => {
    const works = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    const row = works.listAllWorks().find(r => r.id === created.id)!;
    expect(row.boardW).toBe(87);
    expect(row.boardH).toBe(62);
    expect(row.beanCount).toBe(3814);
    expect(row.colorCount).toBe(42);
    expect(row.estimateMinutes).toBe(190);
    expect(row.description).toBe('');
  });

  it('标题 trim 后为空则报 400 类错误（投稿必须填名称 unlike 后台上传）', async () => {
    const works = await freshWorks();
    expect(() => works.createSubmission(goodInput({ title: '   ' }), CLIENT))
      .toThrow(works.SubmissionInputError);
    expect(() => works.createSubmission(goodInput({ title: 123 }), CLIENT))
      .toThrow(works.SubmissionInputError);
  });

  it('数字字段非法一律抛错，绝不静默转 0', async () => {
    const works = await freshWorks();
    for (const bad of ['87', 87.5, true, null, undefined, NaN, 0, -1, 501]) {
      expect(() => works.createSubmission(goodInput({ boardW: bad }), CLIENT))
        .toThrow(works.SubmissionInputError);
    }
  });

  it('estimateMinutes 允许 0（预估时间可以缺），但不允许负数', async () => {
    const works = await freshWorks();
    expect(() => works.createSubmission(goodInput({ estimateMinutes: 0 }), CLIENT)).not.toThrow();
    expect(() => works.createSubmission(goodInput({ estimateMinutes: -1 }), CLIENT))
      .toThrow(works.SubmissionInputError);
  });

  it('参数校验失败不消耗配额（名称打错字不该白扣 3 件里的 1 件）', async () => {
    const works = await freshWorks();
    expect(() => works.createSubmission(goodInput({ title: '' }), CLIENT)).toThrow();
    expect(works.remainingSubmissions(CLIENT.ip, CLIENT.userAgent)).toBe(3);
  });

  it('配额用尽时抛 SubmissionQuotaError，且不再写库', async () => {
    const works = await freshWorks();
    for (let i = 0; i < 3; i++) works.createSubmission(goodInput(), CLIENT);
    expect(() => works.createSubmission(goodInput(), CLIENT))
      .toThrow(works.SubmissionQuotaError);
    expect(works.listAllWorks()).toHaveLength(3);
  });
});

describe('attachSubmissionImage', () => {
  it('写入图片、落盘文件，并清空一次性令牌', async () => {
    const { works, paths } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    const detail = await works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: WEBP, mime: 'image/webp' },
      width: 1500, height: 2200,
    });
    expect(detail.imageUrl).toMatch(/^\/media\/works\/[0-9a-f]{16}\.png$/);
    expect(detail.bytes).toBe(PNG.byteLength);
    expect(detail.width).toBe(1500);
    expect(detail.height).toBe(2200);
    expect(existsSync(join(paths.PATHS.mediaDir, 'works'))).toBe(true);

    // 令牌用完即失效：同一个令牌不能二次上传
    await expect(works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(works.SubmissionInputError);
  });

  it('令牌不匹配就拒（id 是可猜的自增整数，只靠 id 别人就能挂图到你的记录上）', async () => {
    const works = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    await expect(works.attachSubmissionImage(created.id, 'deadbeef', {
      image: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(works.SubmissionInputError);
    // 被拒之后原行仍然是「没有图」的状态
    expect(works.listAllWorks()[0].imageUrl).toBe('');
  });

  it('id 不存在抛 SubmissionInputError', async () => {
    const works = await freshWorks();
    await expect(works.attachSubmissionImage(9999, 'x', {
      image: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(works.SubmissionInputError);
  });

  it('缩略图不是 webp 时整次上传被拒（不落半张图）', async () => {
    const { works, paths } = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    await expect(works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(/webp/i);
    // 原图也不该留下：校验发生在落盘之前
    expect(readdirSync(join(paths.PATHS.mediaDir, 'works'))).toHaveLength(0);
  });

  it('尺寸缺省或非法时落 0，详情页显示「未知」而不是 NaN', async () => {
    const works = await freshWorks();
    const created = works.createSubmission(goodInput(), CLIENT);
    const d = await works.attachSubmissionImage(created.id, created.uploadToken, {
      image: { body: PNG, mime: 'image/png' },
      width: 'abc', height: '',
    });
    expect(d.width).toBe(0);
    expect(d.height).toBe(0);
  });
});
```

同时把该文件顶部的 `freshWorks` 改成返回 `{ works, paths, db }`：

```ts
async function freshWorks(): Promise<{
  works: typeof import('../../../server/works.js');
  paths: typeof import('../../../server/paths.js');
  db: typeof import('../../../server/db.js');
}> {
  tmp = mkdtempSync(join(tmpdir(), 'sub-quota-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  const paths = await import('../../../server/paths.js');
  const works = await import('../../../server/works.js');
  return { works, paths, db };
}
```

并把文件头 import 补上 `readdirSync`：

```ts
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
```

**注意**：Task 3 的配额用例里 `freshWorks()` 的返回值从模块变成了对象，需要同步改成 `const { works } = await freshWorks();`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/submissions.test.ts`

Expected: FAIL —— `works.createSubmission is not a function`。

- [ ] **Step 3: 实现错误类型与数值校验**

`server/works.ts` 顶部（`MAX_TITLE` 之后）追加：

```ts
// ---- 投稿（2026-10-17） ----

/** 投稿参数不合法。由 HTTP 层映射成 400。 */
export class SubmissionInputError extends Error {}

/** 当日投稿额度用尽。由 HTTP 层映射成 429。 */
export class SubmissionQuotaError extends Error {}

const MAX_BOARD_CELL = 500;
const MAX_BEAN_COUNT = 250_000;
const MAX_COLOR_COUNT = 221;
const MAX_ESTIMATE_MINUTES = 100_000;
const MAX_IMAGE_DIM = 20_000;

/**
 * 投稿数字字段的严格校验。
 *
 * 刻意要求 `typeof raw === 'number'` 而不是 `Number(raw)`：JSON body 里出现
 * `true` / `null` / `"87"` 时，Number() 会把它们分别变成 1 / 0 / 87，其中
 * `boardW: true` 会被放行成 1 格宽的图纸 —— 静默、且没有任何报错。
 *
 * 这四个数字会原样出现在审核队列和作品详情页上，被静默转成 0 会让站主以为这是
 * 张空图、让访客以为「0 颗豆子」，所以一律拒。
 */
function requireCount(raw: unknown, field: string, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new SubmissionInputError(`${field} 不是合法数值（应为 ${min}–${max} 的整数）`);
  }
  return raw;
}

/**
 * multipart 文本字段都是字符串，所以这一处才放宽成先 Number()。
 * 非法值一律落 0（详情页显示「未知」），不抛错 —— 图片本身已经是有效 PNG，
 * 尺寸只是元数据，为此拒绝整次投稿不划算。
 */
function optionalCount(raw: unknown, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 && n <= max ? n : 0;
}

/** 投稿必须填名称。与后台上传的 normalizeTitle 不同：这里空标题是错误，不是回落。 */
function requireTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw new SubmissionInputError('名称必须是文本');
  const t = raw.trim();
  if (t.length === 0) throw new SubmissionInputError('名称不能为空');
  return t.slice(0, MAX_TITLE);
}

export interface CreatedSubmission {
  id: number;
  /** 32 位 hex，只在这一次响应里出现。id 是可猜的自增整数，令牌是第二道闸。 */
  uploadToken: string;
}
```

- [ ] **Step 4: 实现 `createSubmission`**

接着追加：

```ts
/**
 * 第一步：占一个 id。
 *
 * **三步的顺序不能换**：参数校验 → 占配额 → 插入。
 * 配额排在参数校验之后，是为了让「名称打错字收到 400」不同时扣掉每日 3 件里的
 * 1 件。这里与点赞接口「令牌桶排在存在性校验之前」相反，因为代价结构不同：
 * 点赞那一步要打 DB，而这一步只多一次纯 JS 的数字校验，真正贵的 5 MB 文件传输
 * 在第二步、已经被上一步消耗的配额和令牌的一次性语义双重挡着。
 *
 * 写成函数内部固定顺序而不是让 HTTP 层安排，也是为了将来新增写路径时
 * 不可能排错。
 */
export function createSubmission(
  raw: unknown,
  client: { ip: string; userAgent: string },
): CreatedSubmission {
  const input = (raw ?? {}) as Record<string, unknown>;

  const title = requireTitle(input.title);
  const boardW = requireCount(input.boardW, '图纸宽度', 1, MAX_BOARD_CELL);
  const boardH = requireCount(input.boardH, '图纸高度', 1, MAX_BOARD_CELL);
  const beanCount = requireCount(input.beanCount, '豆子数量', 1, MAX_BEAN_COUNT);
  const colorCount = requireCount(input.colorCount, '颜色数量', 1, MAX_COLOR_COUNT);
  const estimateMinutes = requireCount(input.estimateMinutes, '预估时间', 0, MAX_ESTIMATE_MINUTES);

  if (!allowSubmission(client.ip, client.userAgent)) {
    throw new SubmissionQuotaError(`今天的投稿次数已用完（每台设备每天 ${SUBMISSION_DAILY_LIMIT} 件），明天再来吧`);
  }

  const now = Date.now();
  const uploadToken = randomBytes(16).toString('hex');
  runStmt(
    `INSERT INTO works
       (title, description, image_key, thumb_key, width, height, bytes,
        published, status, board_w, board_h, bean_count, color_count,
        estimate_minutes, upload_token, created_at, updated_at)
     VALUES (?, '', '', '', 0, 0, 0, 0, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, boardW, boardH, beanCount, colorCount, estimateMinutes, uploadToken, now, now],
  );

  // 必须在 flushNow() 之前读 last_insert_rowid()：db.export() 会把连接的
  // last_insert_rowid 复位成 0（sql.js 实测），先 flush 再查必然查不到行。
  const rows = queryAll<{ id: number }>(`SELECT id FROM works WHERE id = last_insert_rowid()`);
  const id = rows[0]?.id;
  if (id == null) throw new Error('createSubmission: missing after insert');
  flushNow();
  return { id, uploadToken };
}
```

- [ ] **Step 5: 实现 `attachSubmissionImage`**

接着追加：

```ts
export interface SubmissionImageInput {
  image: WorkImage;
  thumb?: WorkImage;
  width?: unknown;
  height?: unknown;
}

/**
 * 第二步：把带二维码的成品图挂到这条投稿上。
 *
 * **令牌校验是这里的核心，不能省。** works.id 是 AUTOINCREMENT 整数、完全可猜；
 * 不校验 upload_token 的话，任何人都能 POST /api/public/works/7/image 把一张
 * 任意图片挂到别人的待审记录上 —— 既污染审核队列，又能把别人的投稿换成自己的图。
 * 令牌只在第一步的响应里出现一次（128 位随机值），比对用 === 即可，
 * 不上 timingSafeEqual：猜不中的前提下时序差不构成实际攻击面。
 */
export async function attachSubmissionImage(
  id: number,
  uploadToken: string,
  input: SubmissionImageInput,
): Promise<AdminWorkDetail> {
  const row = rowById(id);
  if (!row) throw new SubmissionInputError('投稿不存在');
  if (row.status !== 'pending') throw new SubmissionInputError('该投稿已处理，无法再上传图片');
  if (!uploadToken || row.upload_token !== uploadToken) throw new SubmissionInputError('上传凭证无效，请重新投稿');
  // 与令牌校验在正常写入路径下等价（下面的 UPDATE 一次改两列），保留是为了让
  // 「图已存在」这个失败原因在错误文案里单独可辨，而不是笼统的「凭证无效」
  if (row.image_key) throw new SubmissionInputError('该投稿已上传过图片');

  const ext = extFor(input.image.mime, 'image');
  if (input.thumb) {
    const thumbExt = extFor(input.thumb.mime, 'thumb');
    if (thumbExt !== '.webp') throw new SubmissionInputError('缩略图必须是 WebP');
  }

  const hex = randomBytes(8).toString('hex');
  const imageKey = `works/${hex}${ext}`;
  // 写成功才赋值的理由：thumb_key 一旦落库就是「这个文件存在」的承诺。写失败还
  // 照记会留下一条指向不存在文件的记录，前台列表永久破图，而后台的「无缩略图」
  // 标记恰好判据是 thumbUrl === imageUrl，永远标不出这种故障。
  let thumbKey = '';

  await storage.put(imageKey, input.image.body, input.image.mime);
  if (input.thumb) {
    const candidate = `works/${hex}-t.webp`;
    try {
      await storage.put(candidate, input.thumb.body, input.thumb.mime);
      thumbKey = candidate;
    } catch (e) {
      // 降级而不是整体失败：没有缩略图是可降级状态（前端会用原图当缩略图）
      console.warn('[works] 缩略图写入失败，降级为无缩略图', e);
    }
  }

  try {
    runStmt(
      `UPDATE works
          SET image_key = ?, thumb_key = ?, bytes = ?, width = ?, height = ?,
              upload_token = '', updated_at = ?
        WHERE id = ?`,
      [
        imageKey, thumbKey, input.image.body.byteLength,
        optionalCount(input.width, MAX_IMAGE_DIM),
        optionalCount(input.height, MAX_IMAGE_DIM),
        Date.now(), id,
      ],
    );
    flushNow();
  } catch (err) {
    // 文件已经落盘，不回收就是一条没有记录、也没有主键可追溯的孤儿文件
    await removeQuietly(imageKey);
    await removeQuietly(thumbKey);
    throw err;
  }

  return toAdminDetail(requireRow(id));
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/submissions.test.ts`

Expected: PASS —— 18 个用例全绿。

- [ ] **Step 7: 跑全量回归并提交**

Run: `npm test && npm run typecheck`

Expected: 全绿。

```bash
git add server/works.ts tests/unit/server/submissions.test.ts
git commit -m "feat(投稿): 两步入库服务层 —— 占 id + 挂带码图

createSubmission 内部固定「校验 → 占配额 → 插入」的顺序，不让调用方安排：
名称打错字收到 400 时不该同时扣掉每日 3 件里的 1 件。

attachSubmissionImage 必须校验 uploadToken：works.id 是可猜的自增整数，
只靠 id 的话任何人都能把自己的图挂到别人的待审记录上。令牌 128 位随机、
只在第一步响应里出现一次，写入后随同 image_key 在同一条 UPDATE 里清空。"
```

---

### Task 5: 审核通过 / 拒绝 + 上架不变量

**Files:**
- Modify: `server/works.ts`
- Test: `tests/unit/server/review.test.ts`（新建）

**Interfaces:**
- Produces:
  - `export function approveWork(id: number): AdminWorkDetail`
  - `export async function rejectWork(id: number): Promise<AdminWorkDetail>`
  - `updateWorkMeta` 新增：传 `published: true` 而当前 `status !== 'approved'` → 抛 `Error`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/server/review.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp = '';

type WorksModule = typeof import('../../../server/works.js');

async function freshWorks(): Promise<{ works: WorksModule; paths: typeof import('../../../server/paths.js') }> {
  tmp = mkdtempSync(join(tmpdir(), 'review-'));
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
const CLIENT = { ip: '1.2.3.4', userAgent: 'UA' };

async function makePending(works: WorksModule) {
  const created = works.createSubmission({
    title: '待审作品',
    boardW: 87, boardH: 62, beanCount: 3814, colorCount: 42, estimateMinutes: 190,
  }, CLIENT);
  const detail = await works.attachSubmissionImage(created.id, created.uploadToken, {
    image: { body: PNG, mime: 'image/png' },
    thumb: { body: WEBP, mime: 'image/webp' },
    width: 1500, height: 2200,
  });
  return created.id;
}

beforeEach(() => { delete process.env.PINGDOU_DATA_DIR; vi.resetModules(); });
afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('approveWork', () => {
  it('把 pending 变成 approved 并自动上架', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    const next = works.approveWork(id);
    expect(next.status).toBe('approved');
    expect(next.published).toBe(true);
    // 通过之后公开接口立刻能拿到
    expect(works.getPublishedWork(id)).not.toBeNull();
  });

  it('重复点「通过」是幂等的，不会把已被下架的作品重新上架', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    works.approveWork(id);
    works.updateWorkMeta(id, { published: false });
    const again = works.approveWork(id);
    expect(again.published).toBe(false);
    expect(again.status).toBe('approved');
  });

  it('已拒绝的投稿不能通过（终态不可回退）', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    await works.rejectWork(id);
    expect(() => works.approveWork(id)).toThrow(/拒绝/);
  });

  it('id 不存在抛错', async () => {
    const { works } = await freshWorks();
    expect(() => works.approveWork(4242)).toThrow();
  });
});

describe('rejectWork', () => {
  it('标记 rejected、下架，并物理删除原图与缩略图', async () => {
    const { works, paths } = await freshWorks();
    const id = await makePending(works);
    expect(readdirSync(join(paths.PATHS.mediaDir, 'works'))).toHaveLength(2);

    const next = await works.rejectWork(id);
    expect(next.status).toBe('rejected');
    expect(next.published).toBe(false);
    expect(readdirSync(join(paths.PATHS.mediaDir, 'works'))).toHaveLength(0);
    expect(works.getPublishedWork(id)).toBeNull();
  });

  it('重复拒绝是幂等的', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    await works.rejectWork(id);
    const again = await works.rejectWork(id);
    expect(again.status).toBe('rejected');
  });

  it('没有文件的孤儿 pending 行也能拒绝（用户在图生成前就关掉了页面）', async () => {
    const { works, paths } = await freshWorks();
    const created = works.createSubmission({
      title: '半途而废', boardW: 50, boardH: 50, beanCount: 100,
      colorCount: 5, estimateMinutes: 30,
    }, CLIENT);
    // 磁盘上本来就什么都没有，删除必须幂等成功而不是抛错
    await expect(works.rejectWork(created.id)).resolves.toBeTruthy();
    expect(readdirSync(join(paths.PATHS.mediaDir, 'works'))).toHaveLength(0);
    // 行还在：拒绝只改状态，彻底删除归 DELETE /api/admin/works/:id 负责。
    // 后台审核列表靠这一行把「未过审」「已拒绝」两个状态分开呈现。
    expect(works.listAllWorks()).toHaveLength(1);
    expect(works.listAllWorks()[0].status).toBe('rejected');
  });

  it('拒绝后 image_key 仍留在库里（审计线索），但公开接口拿不到它', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    const before = works.getPublishedWork(id);
    expect(before).toBeNull();
    const row = works.listAllWorks().find(r => r.id === id)!;
    await works.rejectWork(id);
    expect(row.imageUrl).toMatch(/^\/media\/works\//);
    expect(works.getPublishedWork(id)).toBeNull();
  });
});

describe('上架不变量', () => {
  it('未过审的作品不能被上架', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    await expect(works.updateWorkMeta(id, { published: true })).rejects.toThrow(/审核/);
    expect(works.listAllWorks()[0].published).toBe(false);
  });

  it('已过审的作品可以正常下架与重新上架', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    works.approveWork(id);
    expect(works.updateWorkMeta(id, { published: false }).published).toBe(false);
    expect(works.updateWorkMeta(id, { published: true }).published).toBe(true);
  });

  it('pending 作品可以在审核前改名称（审核时随通过一起公开）', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    expect(works.updateWorkMeta(id, { title: ' 改好的名字 ' }).title).toBe('改好的名字');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/review.test.ts`

Expected: FAIL —— `works.approveWork is not a function`。

- [ ] **Step 3: 实现审核动作**

在 `server/works.ts` 的 `updateWorkMeta` 之后、`replaceWorkImage` 之前插入：

```ts
/**
 * 审核通过：pending → approved，并自动上架。
 *
 * 已经 approved 时**原样返回当前状态**（真幂等），而不是重新上架 ——
 * 否则站主点过一次「通过」、再点「下架」、又误点一次「通过」，作品就自己回到
 * 前台了。UI 上「通过」按钮只对 pending 行显示，这条路径实际走不到，
 * 但 API 层的幂等必须是无副作用的。
 */
export function approveWork(id: number): AdminWorkDetail {
  const row = requireRow(id);
  if (row.status === 'rejected') {
    throw new Error('已拒绝的投稿不能通过');
  }
  if (row.status === 'approved') return toAdminDetail(row);
  const now = Date.now();
  runStmt(
    `UPDATE works SET status='approved', published=1, updated_at=? WHERE id=?`,
    [now, id],
  );
  flushNow();
  return toAdminDetail({ ...row, status: 'approved', published: 1, updated_at: now });
}

/**
 * 审核拒绝：标记 rejected、下架、并物理删除源文件。
 *
 * 删文件是「减少空间占有」的落点。image_key 字符串**保留在库里**（spec §11.4）：
 * image_key 是 NOT NULL，改它要放宽约束或存 ''（而 publicUrl('') 会得到一个指向
 * 目录的畸形 URL）；留着这个值则是审计线索 —— 站主日后能看出这件作品的文件曾经
 * 叫什么。代价是后台渲染 rejected 行时不能画 <img>，那条规则写在 WorksTab 里。
 */
export async function rejectWork(id: number): Promise<AdminWorkDetail> {
  const row = requireRow(id);
  if (row.status === 'rejected') return toAdminDetail(row);
  // 先删文件再改记录：反过来会在「记录已改、文件删失败」时留下永远无人引用的
  // 孤儿文件，而孤儿文件没有主键可追溯。删失败只 warn 不阻断（removeQuietly），
  // 否则一次磁盘抖动就���把这条投稿永远卡在 pending。
  await removeQuietly(row.image_key);
  await removeQuietly(row.thumb_key);
  const now = Date.now();
  runStmt(
    `UPDATE works SET status='rejected', published=0, updated_at=? WHERE id=?`,
    [now, id],
  );
  flushNow();
  return toAdminDetail({ ...row, status: 'rejected', published: 0, updated_at: now });
}
```

- [ ] **Step 4: 加上架不变量检查**

`updateWorkMeta` 里，在 `if (typeof patch.published === 'boolean')` **之前**插入：

```ts
  // 不变量①：published=1 必须伴随 status='approved'。
  // 让「未过审的东西上了架」在接口层就不可能发生，而不是指望前端 UI 不给这个选项。
  if (patch.published === true && row.status !== 'approved') {
    throw new Error('只有审核通过的作品才能上架');
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/review.test.ts`

Expected: PASS —— 10 个用例全绿。

- [ ] **Step 6: 跑全量回归并提交**

Run: `npm test && npm run typecheck`

Expected: 全绿。

```bash
git add server/works.ts tests/unit/server/review.test.ts
git commit -m "feat(审核): 通过 / 拒绝动作 + 上架不变量

approveWork 对已 approved 的行原样返回而不是重新上架：否则站主点过一次
「通过」、再点「下架」、又误点一次「通过」，作品就自己回到前台了。

rejectWork 先删文件再改记录 —— 反过来会留下永远无人引用、也没有主键可追溯
的孤儿文件。删文件失败只 warn 不阻断：一次磁盘抖动不该把这条投稿永远卡在
pending。image_key 字符串保留在库里作审计线索。

updateWorkMeta 新增不变量①：published=true 而 status 不是 approved 直接 400。"
```

---

### Task 6: 四个新 HTTP 路由

**Files:**
- Modify: `server/index.ts`
- Test: `tests/unit/server/submission-routes.test.ts`（新建）

**Interfaces:**
- Consumes: `createSubmission` / `attachSubmissionImage` / `approveWork` / `rejectWork`（Task 4、5）
- Produces:
  - `POST /api/public/works` → `201 { id, uploadToken }` / `400` / `429`（免登录）
  - `POST /api/public/works/:id/image` → `200 { ok, id }` / `400` / `404`（免登录，multipart）
  - `POST /api/admin/works/:id/approve` → `AdminWorkDetail`（admin）
  - `POST /api/admin/works/:id/reject` → `AdminWorkDetail`（admin）

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/server/submission-routes.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let tmp = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'submission-routes-'));
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
  const works = await import('../../../server/works.js');
  const { app } = await import('../../../server/index.js');
  return { app, works };
}

async function loginAdmin(app: unknown): Promise<string> {
  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  const admin = users.getUserByUsername('root')!;
  users.setUserPassword(admin.id, 'testpass1');
  const r = await request(app as never).post('/api/auth/login')
    .send({ username: 'root', password: 'testpass1' });
  const cookies = r.headers['set-cookie'] as unknown as string[];
  return cookies.map(c => c.split(';')[0]).join('; ');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46]);

const GOOD = {
  title: '粉色小熊', boardW: 87, boardH: 62,
  beanCount: 3814, colorCount: 42, estimateMinutes: 190,
};

describe('POST /api/public/works', () => {
  it('免登录创建投稿，返回 201 与令牌', async () => {
    const { app } = await bootApp();
    const r = await request(app).post('/api/public/works').send(GOOD);
    expect(r.status).toBe(201);
    expect(r.body.id).toBeGreaterThan(0);
    expect(r.body.uploadToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('参数非法返回 400 与中文文案', async () => {
    const { app } = await bootApp();
    const r = await request(app).post('/api/public/works').send({ ...GOOD, title: '  ' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('名称');
  });

  it('第 4 件投稿返回 429 与中文文案', async () => {
    const { app } = await bootApp();
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post('/api/public/works').send(GOOD);
      expect(ok.status).toBe(201);
    }
    const over = await request(app).post('/api/public/works').send(GOOD);
    expect(over.status).toBe(429);
    expect(over.body.error).toContain('投稿次数');
  });

  it('POST 后作品立刻不可见（还没审核）', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const list = await request(app).get('/api/public/works');
    expect(list.body.total).toBe(0);
    const detail = await request(app).get(`/api/public/works/${created.body.id}`);
    expect(detail.status).toBe(404);
  });
});

describe('POST /api/public/works/:id/image', () => {
  it('带令牌上传成功，返回 { ok, id }', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const r = await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken)
      .field('width', '1500')
      .field('height', '2200')
      .attach('image', PNG, 'image.png')
      .attach('thumb', WEBP, 'thumb.webp');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, id: created.body.id });
  });

  it('令牌不对返回 400，且没有文件落盘', async () => {
    const { app, works } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const r = await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', 'wrong')
      .attach('image', PNG, 'image.png');
    expect(r.status).toBe(400);
    const row = works.listAllWorks().find(w => w.id === created.body.id)!;
    expect(row.imageUrl).toBe('');
  });

  it('缺 image 字段返回 400', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const r = await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken);
    expect(r.status).toBe(400);
  });

  it('id 不存在返回 404', async () => {
    const { app } = await bootApp();
    const r = await request(app)
      .post('/api/public/works/99999/image')
      .field('uploadToken', 'x')
      .attach('image', PNG, 'image.png');
    expect(r.status).toBe(404);
  });
});

describe('后台审核路由', () => {
  it('approve 需要 admin 登录，未登录 401', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const r = await request(app).post(`/api/admin/works/${created.body.id}/approve`);
    expect(r.status).toBe(401);
  });

  it('approve 之后作品进入公开列表', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const created = await request(app).post('/api/public/works').send(GOOD);
    await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken)
      .attach('image', PNG, 'image.png');

    const approve = await request(app)
      .post(`/api/admin/works/${created.body.id}/approve`)
      .set('Cookie', cookie);
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('approved');

    const list = await request(app).get('/api/public/works');
    expect(list.body.total).toBe(1);
    const detail = await request(app).get(`/api/public/works/${created.body.id}`);
    expect(detail.status).toBe(200);
    // 详情带四个图纸参数
    expect(detail.body.beanCount).toBe(3814);
    expect(detail.body.colorCount).toBe(42);
    expect(detail.body.boardW).toBe(87);
    expect(detail.body.estimateMinutes).toBe(190);
  });

  it('reject 之后详情 404，后台列表仍能看到该行并带 rejected', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const created = await request(app).post('/api/public/works').send(GOOD);
    await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken)
      .attach('image', PNG, 'image.png');

    const reject = await request(app)
      .post(`/api/admin/works/${created.body.id}/reject`)
      .set('Cookie', cookie);
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe('rejected');

    const detail = await request(app).get(`/api/public/works/${created.body.id}`);
    expect(detail.status).toBe(404);

    const adminList = await request(app).get('/api/admin/works').set('Cookie', cookie);
    expect(adminList.body[0].status).toBe('rejected');
    expect(adminList.body[0].published).toBe(false);
  });

  it('GET /api/admin/works?status=pending 只回待审', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const a = await request(app).post('/api/public/works').send({ ...GOOD, title: '甲' });
    const b = await request(app).post('/api/public/works').send({ ...GOOD, title: '乙' });
    await request(app).post(`/api/admin/works/${a.body.id}/approve`).set('Cookie', cookie);

    const only = await request(app).get('/api/admin/works?status=pending').set('Cookie', cookie);
    expect(only.body).toHaveLength(1);
    expect(only.body[0].title).toBe('乙');
    expect(only.body[0].id).toBe(b.body.id);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/submission-routes.test.ts`

Expected: FAIL —— 路由不存在，公开投稿接口返回 404。

- [ ] **Step 3: 加路由**

`server/index.ts` 中，在 `app.get('/api/public/works/:id/like', ...)` 那组**之前**插入公开投稿路由：

```ts
/**
 * 投稿第一步：占一个 id。
 *
 * 配额闸不是「先于一切」的：createSubmission 内部自己按「校验 → 占配额 → 插入」
 * 的顺序走（理由见 server/works.ts 的注释）。这里只负责把它的两个错误类型翻译
 * 成状态码。
 */
app.post('/api/public/works', (req, res) => {
  try {
    const created = createSubmission(req.body, {
      ip: (req as any).clientIp as string,
      userAgent: String(req.headers['user-agent'] ?? ''),
    });
    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof SubmissionQuotaError) return res.status(429).json({ error: err.message });
    if (err instanceof SubmissionInputError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * 投稿第二步：把带二维码的成品图挂上去。
 *
 * 必须带 uploadToken —— id 是可猜的自增整数，只靠 id 的话任何人都能把图挂到
 * 别人的待审记录上（见 attachSubmissionImage 的注释）。
 */
app.post('/api/public/works/:id/image', handleUploadFields(SUBMISSION_IMAGE_FIELDS), async (req, res) => {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const image = files.image?.[0];
  if (!image) return res.status(400).json({ error: '缺少图片文件' });
  const token = typeof req.body?.uploadToken === 'string' ? req.body.uploadToken : '';
  const id = Number(req.params.id);
  try {
    const detail = await attachSubmissionImage(id, token, {
      image: { body: image.buffer, mime: image.mimetype },
      thumb: files.thumb?.[0]
        ? { body: files.thumb[0].buffer, mime: files.thumb[0].mimetype }
        : undefined,
      width: req.body?.width,
      height: req.body?.height,
    });
    return res.json({ ok: true, id: detail.id });
  } catch (err) {
    if (err instanceof SubmissionInputError) {
      // 「投稿不存在」是 404，其余（令牌错 / 已传过 / 已处理）是 400。
      // 区分开不是为了泄露信息 —— 攻击者本来就能用 id 探测存在性，
      // 而拿到一个明确 404 能帮正常用户立刻发现「链接过期了，重新投稿」。
      const isMissing = err.message === '投稿不存在';
      return res.status(isMissing ? 404 : 400).json({ error: err.message });
    }
    throw err;
  }
});
```

在既有 `const WORK_IMAGE_FIELDS = [...]` 旁边加上：

```ts
/** 投稿成品图 + 浏览器生成的缩略图。缩略图的文件名必须以 .webp 结尾，
 *  服务端按扩展名校验 mime。 */
const SUBMISSION_IMAGE_FIELDS = [
  { name: 'image', maxCount: 1 },
  { name: 'thumb', maxCount: 1 },
];
```

在 `app.delete('/api/admin/works/:id', ...)` 之后插入后台审核路由：

```ts
app.post('/api/admin/works/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(approveWork(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/admin/works/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await rejectWork(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
```

并把 works 相关 import 补上新函数：

```ts
import {
  // ...既有...
  createSubmission,
  attachSubmissionImage,
  approveWork,
  rejectWork,
  SubmissionInputError,
  SubmissionQuotaError,
} from './works.js';
```

- [ ] **Step 4: `GET /api/admin/works` 加 status 过滤**

在 `server/works.ts` 里给 `listAllWorks` 加可选过滤：

```ts
/**
 * 后台管理用：默认全部，含 pending。
 *
 * `status` 不传就是全量 —— 与改动前行为完全一致，调用方不传参数时行为不变。
 */
export function listAllWorks(filter?: { status?: WorkStatus }): AdminWorkDetail[] {
  const where = filter?.status ? `WHERE w.status = ?` : '';
  const params = filter?.status ? [filter.status] : [];
  return queryAll<WorkRow>(
    `SELECT w.*
       FROM works w
       ${where}
      ORDER BY w.created_at DESC, w.id DESC`,
    params
  ).map(toAdminDetail);
}
```

`server/index.ts` 的 `app.get('/api/admin/works', ...)` 改成：

```ts
app.get('/api/admin/works', requireAuth, requireAdmin, (req, res) => {
  const raw = String(req.query.status ?? '').trim();
  // 白名单：非法值回落「全部」。不因为手改一个 query 就整页报错。
  const status =
    raw === 'pending' || raw === 'approved' || raw === 'rejected' ? raw : undefined;
  res.json(listAllWorks(status ? { status } : undefined));
});
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/submission-routes.test.ts`

Expected: PASS —— 9 个用例全绿。

- [ ] **Step 6: 跑全量回归并提交**

Run: `npm test && npm run typecheck`

Expected: 全绿。

```bash
git add server/index.ts server/works.ts tests/unit/server/submission-routes.test.ts
git commit -m "feat(API): 两个公开投稿路由 + 两个后台审核路由

投稿路由刻意不加 allowLike 那种 1 次/秒令牌桶：投稿是两步请求，第二步紧接
着第一步，只隔着一次二维码生成（几十毫秒），按 IP 计时的令牌桶会把正常用户
自己撞出去。防线是每日 3 件配额 + 现有 5MB 体积上限 + 审核不通过不公开。

第二步的 404 与 400 分开：攻击者本来就能用 id 探测存在性，而明确 404 能让
正常用户立刻发现「链接过期了，重新投稿」。"
```

---

### Task 7: 拆掉后台上传通道

**Files:**
- Modify: `server/index.ts`（删两个路由 + `WORK_IMAGE_FIELDS`）
- Modify: `server/works.ts`（删 `createWork`、`replaceWorkImage`、`CreateWorkInput`、`UpdateWorkMeta` 中的 image 路径）
- Create: `tests/helpers/works.ts`
- Modify: `tests/unit/server/works.test.ts`、`works-routes.test.ts`、`works-search.test.ts`、`works-likes.test.ts`、`works-likes-routes.test.ts`

**Interfaces:**
- Consumes: `createSubmission` / `attachSubmissionImage` / `approveWork` / `updateWorkMeta`（Task 4、5）
- Produces: `tests/helpers/works.ts` 导出 `makeApprovedWork(works, opts?): Promise<AdminWorkDetail>` 与 `makePendingWork(works, opts?): Promise<{ id, detail }>`

- [ ] **Step 1: 建测试 helper**

创建 `tests/helpers/works.ts`：

```ts
type WorksModule = typeof import('../../server/works.js');
type AdminWorkDetail = ReturnType<WorksModule['listAllWorks']>[number];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46]);

export interface SeedWorkOptions {
  title?: string;
  description?: string;
  /** false = 过审后再下架（草稿） */
  published?: boolean;
  boardW?: number;
  boardH?: number;
}

/**
 * 造一件「已通过审核」的作品，走真实路径：
 *   createSubmission → attachSubmissionImage → approveWork（→ 可选下架）
 *
 * 为什么不用一条 INSERT 的捷径：投稿是唯一的进货入口，捷径会绕开 status /
 * upload_token 的写入 —— 而那正是这次改动新增的东西。测试必须踩在真实路径上，
 * 否则「投稿建出来的行在公开查询里可不可见」这类断言就是假的。
 */
export async function makeApprovedWork(
  works: WorksModule,
  opts: SeedWorkOptions = {},
): Promise<AdminWorkDetail> {
  const { id } = await makePendingWork(works, opts);
  const approved = works.approveWork(id);
  return opts.published === false ? works.updateWorkMeta(id, { published: false }) : approved;
}

/** 造一件停在待审核状态的投稿（图已挂上），供审核相关测试使用。 */
export async function makePendingWork(
  works: WorksModule,
  opts: SeedWorkOptions = {},
): Promise<{ id: number; uploadToken: string }> {
  const created = works.createSubmission(
    {
      title: opts.title ?? '测试作品',
      boardW: opts.boardW ?? 50,
      boardH: opts.boardH ?? 50,
      beanCount: 1234,
      colorCount: 30,
      estimateMinutes: 60,
    },
    { ip: '10.0.0.1', userAgent: 'vitest' },
  );
  await works.attachSubmissionImage(created.id, created.uploadToken, {
    image: { body: PNG, mime: 'image/png' },
    thumb: { body: WEBP, mime: 'image/webp' },
    width: 1000, height: 1000,
  });
  if (opts.description) works.updateWorkMeta(created.id, { description: opts.description });
  return created;
}
```

- [ ] **Step 2: 迁移既有测试的造数据调用**

在 `works.test.ts`、`works-routes.test.ts`、`works-search.test.ts`、`works-likes.test.ts`、`works-likes-routes.test.ts` 里，把形如

```ts
await works.createWork({ title: 'x', image: { body: PNG, mime: 'image/png' }, published: true });
```

的调用替换为

```ts
await makeApprovedWork(works, { title: 'x' });
```

并删除 `createWork` 专属的用例块（标题回落、缩略图写失败降级、replaceWorkImage 换图、删除时清文件等），因为被测函数已不存在。**保留** `deleteWork`、`updateWorkMeta`、`escapeLike`、`listPublishedWorks` 的用例 —— 这些函数还在。

在每个被改的测试文件顶部加上 import：

```ts
import { makeApprovedWork } from '../../helpers/works';
```

（`tests/unit/server/*.test.ts` 到 `tests/helpers/works.ts` 的相对路径是 `../../helpers/works`。）

逐个文件跑测试修到全绿：

Run: `npx vitest run tests/unit/server/`

Expected: PASS。

- [ ] **Step 3: 删掉后端上传通道**

`server/index.ts`：删除 `app.post('/api/admin/works', ...)` 与 `app.post('/api/admin/works/:id/image', ...)` 两整段路由，并删掉 `WORK_IMAGE_FIELDS` 常量（只有这两个路由用它）。

`server/works.ts`：删除 `createWork`、`replaceWorkImage` 两个函数，以及 `CreateWorkInput` 接口。删除后 `updateWorkMeta` 里引用 `replaceWorkImage` 的注释清理掉。

- [ ] **Step 4: 确认没有残留引用**

Run: `npm run typecheck`

Expected: 0 错误。若 `storage` 的 `get`/`head` 变成未使用，只是 lint 提示、不影响 typecheck，保留即可（它们是 `StorageDriver` 接口的一部分）。

- [ ] **Step 5: 跑全量回归并提交**

Run: `npm test && npm run typecheck`

Expected: 全绿。

```bash
git add -A server tests
git commit -m "refactor(作品)!: 拆掉后台上传通道，测试造数据改走真实投稿路径

POST /api/admin/works 与 POST /api/admin/works/:id/image 连同 createWork /
replaceWorkImage 一起删掉。留着它们意味着 multer 双文件字段解析、缩略图 mime
校验、孤儿文件回收那一整套还要维护还要测，却没有任何调用方。将来若要恢复
后台直传，从 git 历史取回即可。

新增 tests/helpers/works.ts 走 createSubmission → attachSubmissionImage →
approveWork 的真实路径造数据。用 INSERT 捷径会绕开 status / upload_token 的
写入 —— 那正是这次改动新增的东西，测试必须踩在真实路径上。"
```

---

### Task 8: 前端 API 客户端

**Files:**
- Modify: `src/api/works.ts`
- Test: `src/api/works.test.ts`（新建）

**Interfaces:**
- Produces:
  - `WorkDetail extends WorkSummary` 上追加 `boardW / boardH / beanCount / colorCount / estimateMinutes`
  - `AdminWorkDetail` 追加 `status: WorkStatus`
  - `export type WorkStatus = 'pending' | 'approved' | 'rejected'`
  - `export function createWorkSubmission(input): Promise<{ id: number; uploadToken: string }>`
  - `export function uploadSubmissionImage(id, uploadToken, image, opts): Promise<{ ok: true; id: number }>`
  - `export function adminApproveWork(id): Promise<AdminWorkDetail>`
  - `export function adminRejectWork(id): Promise<AdminWorkDetail>`
  - `adminListWorks(status?)` 增加可选参数
  - 删除 `adminCreateWork`

- [ ] **Step 1: 写失败测试**

创建 `src/api/works.test.ts`（**追加到既有文件顶部区域**，该文件已存在并已有
`listWorks` / `fetchWork` / `likeWork` 的用例，沿用它已有的 `mockFetch` 辅助）：

```ts
// 在既有 mockFetch / ok() 辅助之后追加这些 import
import {
  createWorkSubmission,
  uploadSubmissionImage,
  adminApproveWork,
  adminRejectWork,
} from './works';

/** 既有的 ok() 只造成功响应；这里补一个能造失败的，顺带覆盖错误文案透传 */
function fail(body: unknown, status = 429) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    statusText: 'Too Many Requests',
    json: async () => body,
  });
}

describe('投稿两步', () => {
  it('第一步 POST JSON 到 /api/public/works', async () => {
    ok({ id: 7, uploadToken: 'abc' });
    const r = await createWorkSubmission({
      title: '粉色小熊', boardW: 87, boardH: 62,
      beanCount: 3814, colorCount: 42, estimateMinutes: 190,
    });
    expect(r).toEqual({ id: 7, uploadToken: 'abc' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/public/works');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      title: '粉色小熊', boardW: 87, boardH: 62,
      beanCount: 3814, colorCount: 42, estimateMinutes: 190,
    });
  });

  it('第二步用 multipart 带上令牌、图片、缩略图与尺寸', async () => {
    ok({ ok: true, id: 7 });
    await uploadSubmissionImage(7, 'tok', new Blob(['x'], { type: 'image/png' }), {
      thumb: new Blob(['y'], { type: 'image/webp' }),
      width: 1500, height: 2200,
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/public/works/7/image');
    const fd = init.body as FormData;
    expect(fd.get('uploadToken')).toBe('tok');
    expect(fd.get('width')).toBe('1500');
    expect(fd.get('height')).toBe('2200');
    expect(fd.get('image')).toBeInstanceOf(Blob);
    expect(fd.get('thumb')).toBeInstanceOf(Blob);
  });

  it('第二步没有缩略图时不发 thumb 字段（而不是发一个空 Blob）', async () => {
    ok({ ok: true, id: 7 });
    await uploadSubmissionImage(7, 'tok', new Blob(['x'], { type: 'image/png' }));
    const fd = mockFetch.mock.calls[0][1].body as FormData;
    expect(fd.get('thumb')).toBeNull();
  });

  it('服务端返回的错误文案原样抛出来（中文提示，不是英文原文）', async () => {
    fail({ error: '今天的投稿次数已用完，明天再来吧' });
    await expect(createWorkSubmission({ title: 'x' } as never))
      .rejects.toThrow('今天的投稿次数已用完，明天再来吧');
  });
});

describe('后台审核动作', () => {
  it('approve 打 POST /api/admin/works/:id/approve', async () => {
    ok({ id: 3, status: 'approved' });
    await adminApproveWork(3);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/works/3/approve');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('reject 打 POST /api/admin/works/:id/reject', async () => {
    ok({ id: 3, status: 'rejected' });
    await adminRejectWork(3);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/works/3/reject');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});
```

**fetch 桩为什么用普通对象而不是真 `Response`**：仓库既有的 `src/api/works.test.ts`
用的就是 `{ ok, status, statusText, json: async () => body }` 这个形状
（见该文件既有的 `ok()` 辅助）。跟既有范式一致，且不依赖 jsdom 是否透出 Node 的
`Response` 全局。`mockFetch` 是 `vi.fn()` 无参类型，`mock.calls[0][1]` 取到的是
`any`，所以解构 `[url, init]` 不会 typecheck 报错。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/api/works.test.ts`

Expected: FAIL —— `createWorkSubmission is not a function`。

- [ ] **Step 3: 改类型**

`src/api/works.ts` 里，把 `WorkDetail` 改成：

```ts
/**
 * 与 server/works.ts 的 WorkDetail 一一对应（两边各定义一份是仓库既有惯例）。
 *
 * 图纸参数只进 detail 不进 summary：列表页每张卡片只有标题和缩略图。
 */
export interface WorkDetail extends WorkSummary {
  description: string;
  imageUrl: string;
  bytes: number;
  /** 元数据改动时间。列表不需要它，详情页和后台用得上。 */
  updatedAt: number;
  /** 图纸宽度，单位格。与 boardH 一起构成「87 × 62」。 */
  boardW: number;
  boardH: number;
  /** 实际画出的豆子数（已扣掉被去掉的背景格）。 */
  beanCount: number;
  /** 图纸用到的色号种数。 */
  colorCount: number;
  /** 预估装配工时，单位分钟。展示层再格式化，不存文案。 */
  estimateMinutes: number;
}
```

把 `AdminWorkDetail` 改成：

```ts
export interface AdminWorkDetail extends WorkDetail {
  published: boolean;
  /** 审核态。与 published 同样只出现在后台形状里。 */
  status: WorkStatus;
}

export type WorkStatus = 'pending' | 'approved' | 'rejected';
```

- [ ] **Step 4: 加投稿两步的调用函数**

在 `// ---- admin ----` 之前插入：

```ts
// ---- 投稿（公开，免登录） ----

export interface SubmissionInput {
  title: string;
  boardW: number;
  boardH: number;
  beanCount: number;
  colorCount: number;
  estimateMinutes: number;
}

/**
 * 投稿第一步：占一个 id。
 *
 * 拿到的 uploadToken 只在第二步要用一次，服务端不持久化它给任何人看。
 */
export async function createWorkSubmission(
  input: SubmissionInput,
): Promise<{ id: number; uploadToken: string }> {
  const res = await fetch(`${BASE}/public/works`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

/**
 * 投稿第二步：上传按当前参数渲染出来的带码成品图。
 *
 * 尺寸从 canvas 上读 —— 服务端不装 sharp，没法自己从 PNG 里解析。
 * 缩略图可选：传 null 时服务端会把 thumb_key 留空，前台降级用原图当缩略图。
 */
export async function uploadSubmissionImage(
  id: number,
  uploadToken: string,
  image: Blob,
  opts: { thumb?: Blob | null; width?: number; height?: number } = {},
): Promise<{ ok: true; id: number }> {
  const fd = new FormData();
  fd.append('uploadToken', uploadToken);
  fd.append('image', image, 'image.png');
  if (opts.thumb) fd.append('thumb', opts.thumb, 'thumb.webp');
  if (opts.width != null) fd.append('width', String(opts.width));
  if (opts.height != null) fd.append('height', String(opts.height));
  const res = await fetch(`${BASE}/public/works/${id}/image`, {
    method: 'POST',
    body: fd,
    credentials: 'include',
  });
  return jsonOrThrow(res);
}
```

- [ ] **Step 5: 加后台审核调用、给列表加过滤、删 adminCreateWork**

把 `adminListWorks` 改成：

```ts
/** 后台作品列表。status 不传就是全部（与改动前行为一致）。 */
export async function adminListWorks(
  status?: WorkStatus,
): Promise<AdminWorkDetail[]> {
  const suffix = status ? `?status=${status}` : '';
  const res = await fetch(`${BASE}/admin/works${suffix}`, { credentials: 'include' });
  return jsonOrThrow<AdminWorkDetail[]>(res);
}
```

在文件末尾追加：

```ts
export async function adminApproveWork(id: number): Promise<AdminWorkDetail> {
  const res = await fetch(`${BASE}/admin/works/${id}/approve`, {
    method: 'POST', credentials: 'include',
  });
  return jsonOrThrow(res);
}

export async function adminRejectWork(id: number): Promise<AdminWorkDetail> {
  const res = await fetch(`${BASE}/admin/works/${id}/reject`, {
    method: 'POST', credentials: 'include',
  });
  return jsonOrThrow(res);
}
```

删除整个 `adminCreateWork` 函数及其上方关于缩略图文件名的注释（上传通道已拆）。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/api/works.test.ts`

Expected: PASS —— 6 个用例全绿。

- [ ] **Step 7: 提交**

```bash
git add src/api/works.ts src/api/works.test.ts
git commit -m "feat(api): 投稿两步与后台审核动作的前端客户端

adminCreateWork 一并删掉：后台上传通道在 Task 7 已经拆掉，留着一个永远
不会被调用的导出函数只会让人以为后台还能传作品。"
```

---

### Task 9: 投稿二维码规格 + 尺寸守卫

**Files:**
- Modify: `src/pipeline/qr.ts`
- Modify: `package.json`
- Create: `src/pipeline/qr.test.ts`

**Interfaces:**
- Produces:
  - `export const SUBMISSION_QR_PX = 111`
  - `export const SUBMISSION_QR_OPTIONS`（`version: 3` / `errorCorrectionLevel: 'L'` / `margin: 4` / `width: 111`，`as const`）
  - `export function renderSubmissionQr(id: number, origin?: string): Promise<HTMLImageElement | null>`
  - `drawWorksQr` 签名与行为**不变**

- [ ] **Step 1: 写失败测试**

创建 `src/pipeline/qr.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { toDataURL } from 'qrcode';
import { SUBMISSION_QR_PX, SUBMISSION_QR_OPTIONS } from './qr';

/** 从 PNG 的 IHDR 里读宽高（字节 16–23，大端 uint32）。
 *  纯字节解析，不依赖 canvas —— jsdom 没有 createImageBitmap。 */
function pngSize(dataUrl: string): { width: number; height: number } {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const SITE = 'https://www.xn--muu023g.xyz';

describe('投稿二维码规格', () => {
  it('version 3 + 静区 4 + 宽 111 恰好产出 111×111 的方图', async () => {
    const url = await toDataURL(`${SITE}/works/9999999`, { ...SUBMISSION_QR_OPTIONS });
    expect(pngSize(url)).toEqual({ width: 111, height: 111 });
  });

  it('id 长到 10 位仍然是 111×111（version 3 的容量够用）', async () => {
    const url = await toDataURL(`${SITE}/works/9999999999`, { ...SUBMISSION_QR_OPTIONS });
    expect(pngSize(url)).toEqual({ width: SUBMISSION_QR_PX, height: SUBMISSION_QR_PX });
  });

  it('模块边长是整数 —— 非整数会把模块插值糊掉，码扫不出来', () => {
    // version 3 = 29 模块，加静区 4×2 = 37 列。37 必须整除 111，否则每模块
    // 不是整数 px。这是「白带预留高度」与「码的实际边长」之间的契约。
    const modules = 29 + 2 * SUBMISSION_QR_OPTIONS.margin;
    expect(SUBMISSION_QR_PX % modules).toBe(0);
    expect(SUBMISSION_QR_PX / modules).toBe(3);
  });

  it('版本钉死 3：短 URL 若被库挑成 version 1，拉宽后模块边长会变成 3.83px', () => {
    expect(SUBMISSION_QR_OPTIONS.version).toBe(3);
    // 反证：version 1 只有 21 模块 + 8 = 29 列，111 / 29 = 3.83 —— 非整数
    const v1Modules = 21 + 2 * SUBMISSION_QR_OPTIONS.margin;
    expect(SUBMISSION_QR_PX % v1Modules).not.toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/pipeline/qr.test.ts`

Expected: FAIL —— `SUBMISSION_QR_PX` 未导出。

- [ ] **Step 3: `package.json` 把 qrcode 移进 dependencies**

把 `qrcode` 从 `devDependencies` 移到 `dependencies`（运行时要用，且是动态 import 不会进主 bundle）：

```json
  "dependencies": {
    "cookie-parser": "^1.4.7",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "ip2region": "^2.3.0",
    "multer": "^1.4.5-lts.1",
    "qrcode": "^1.5.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "sql.js": "^1.14.1"
  },
```

Run: `npm install`

Expected: 安装成功，无 peer 依赖冲突。

- [ ] **Step 4: 实现**

`src/pipeline/qr.ts`：先把 `ensureWorksQrImage` 里的加载逻辑抽成 `loadImageOnce`，再追加投稿相关导出。

把原 `ensureWorksQrImage` 整体替换为：

```ts
/**
 * 把一个图片地址加载成 HTMLImageElement，永不抛错、永不挂住。
 *
 * 单独抽出来是为了让「构建期静态码」和「运行时生成的码」共用同一条加载链路：
 * dataURL 灌进 new Image() 之后，得到的对象与 <img src> 完全同型，于是
 * drawWorksQr 一行都不用改就能画两者。
 *
 * 1.5s 超时兜底不是多余的：jsdom 根本不派发 img 的 load/error 事件，
 * 没有超时会永远挂住 —— 导出与投稿两条路径都会卡死。
 */
function loadImageOnce(src: string, timeoutMs: number = QR_LOAD_TIMEOUT_MS): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const settle = (value: HTMLImageElement | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    const img = new Image();
    const timer = setTimeout(() => settle(null), timeoutMs);
    img.onload = () => settle(img);
    img.onerror = () => settle(null);
    img.src = src;
  });
}

export function ensureWorksQrImage(src: string = WORKS_QR_SRC): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  if (typeof Image === 'undefined') {
    imageCache.set(src, null);
    return Promise.resolve(null);
  }
  // 先占位，避免并发调用重复发起加载（和 ensureWatermarkIcon 一致）
  imageCache.set(src, null);
  return loadImageOnce(src).then((img) => {
    imageCache.set(src, img);
    return img;
  });
}
```

在文件末尾追加：

```ts
// ---- 投稿成品图的「这一件作品自己的」二维码 ----

/**
 * 投稿图上那枚码的输出边长。
 *
 * 必须与 SUBMISSION_QR_OPTIONS.version / margin 同源：渲染成品图时底部白带按它
 * 预留高度，码画进去时 drawWorksQr 取 img.naturalWidth 当边长 —— 两个数字一旦
 * 对不上，要么码压在白带外，要么白带空一块。src/pipeline/qr.test.ts 是这两个
 * 数字之间唯一的连接点。
 */
export const SUBMISSION_QR_PX = 111;

/**
 * 投稿二维码的固定规格。
 *
 * **version 必须钉死 3，不能让库自己挑。** 短 URL（/works/128）会被判成
 * version 1：29 列模块（含 4 模块静区 ×2）被拉到 111px 后每模块变成 3.83px ——
 * 非整数缩放会把模块边缘插值糊掉，图上看着有个码、真扫扫不出来。
 * （qr.ts 顶部的注释早就警告过这件事，这次是它第一次真正可能被触发。）
 *
 * version 3 = 29 模块 + 静区 8 = 37 列 × 3px = 111px 整。与构建期
 * scripts/gen-qr.mjs 的全站码同规格，所以同一个 drawWorksQr 能画两者。
 *
 * 容量余量：version 3 @ ECC L 可容 53 字节，当前 URL 约 42 字节
 * （https://www.xn--muu023g.xyz/works/1234567）。id 涨到 10 位之前都安全，
 * 超出时库会**抛错**而不是降级 —— 显式失败比糊码好。
 */
export const SUBMISSION_QR_OPTIONS = {
  version: 3,
  errorCorrectionLevel: 'L',
  margin: 4,
  width: SUBMISSION_QR_PX,
} as const;

/**
 * 生成指向 /works/:id 的二维码。
 *
 * 用 toDataURL 而不是 toCanvas：drawWorksQr 吃的是 HTMLImageElement，把 dataURL
 * 灌进 new Image() 就得到同型对象，于是画码那段代码完全不用动。
 *
 * 失败一律降级为 null，绝不抛错 —— 与 ensureWorksQrImage 同一个立场：
 * 二维码是锦上添花，不能因为它让投稿失败。降级后成品图会留一条空的白带，
 * 这比整次投稿失败好得多。
 */
export async function renderSubmissionQr(
  id: number,
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return null;
  try {
    // 动态 import：只在用户真的点投稿时把编码库拉进来，主 bundle 不背这个体积
    const QR = await import('qrcode');
    const dataUrl = await QR.toDataURL(`${origin}/works/${id}`, { ...SUBMISSION_QR_OPTIONS });
    return await loadImageOnce(dataUrl);
  } catch (e) {
    console.warn('[qr] 投稿二维码生成失败，成品图将不带码', e);
    return null;
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/pipeline/qr.test.ts tests/unit/gen-qr.test.ts`

Expected: PASS —— 新增 4 个用例 + 构建期脚本的既有用例全绿。

- [ ] **Step 6: 提交**

```bash
git add src/pipeline/qr.ts src/pipeline/qr.test.ts package.json package-lock.json
git commit -m "feat(二维码): 投稿用的 per-work 码，version 钉死 3

短 URL 会被 qrcode 判成 version 1，29 列模块拉到 111px 后每模块 3.83px ——
非整数缩放把模块边缘插值糊掉，图上看着有码、真扫扫不出来。钉死 version 3
（37 列 × 3px = 111 整）才能保证模块边长是整数。

qr.ts 顶部的注释早就警告过这件事，这次是它第一次真正可能被触发，所以配一条
尺寸守卫单测：白带预留高度与码的实际边长分处两个模块，这条测试是它们之间
唯一的连接点。

qrcode 从 devDependencies 移进 dependencies（运行时动态 import，不进主 bundle）。"
```

---

### Task 10: 投稿成品图渲染

**Files:**
- Create: `src/pipeline/submission.ts`
- Create: `src/pipeline/submission.test.ts`

**Interfaces:**
- Consumes: `SUBMISSION_QR_PX`（Task 9）、`PipelineResult`、`Palette`
- Produces: `export const SUBMISSION_CELL_PX = 32`、`export async function renderSubmissionComposite(palette: Palette, result: PipelineResult): Promise<HTMLCanvasElement>`

- [ ] **Step 1: 写失败测试**

创建 `src/pipeline/submission.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { renderSubmissionComposite, SUBMISSION_CELL_PX } from './submission';
import { SUBMISSION_QR_PX } from './qr';
import type { Palette, PipelineResult } from '@/types';

const PALETTE: Palette = [
  { id: 0, rgb: [255, 255, 255], name: '白' },
  { id: 1, rgb: [255, 0, 0], name: '红' },
];

function makeResult(): PipelineResult {
  return {
    indices: new Uint8Array([0, 1, 1, 0]),
    gridSize: 2,
    outW: 2,
    outH: 2,
    sourceW: 2,
    sourceH: 2,
    cropped: false,
    token: 0,
    mask: new Uint8Array([0, 0, 0, 0]),
    simplifyColors: false,
    colorBudget: 'off',
    colorSimplification: {
      beforeColorCount: 2, afterColorCount: 2, mergedColorCount: 0,
      rareColorCountBefore: 0, rareColorCountAfter: 0,
      minimumColorCountSatisfied: false, budgetLevel: 'off',
      budgetTargetColorCount: 0, budgetSatisfied: true, budgetFidelityLimited: false,
    },
  };
}

describe('renderSubmissionComposite', () => {
  it('产出一张有内容、尺寸非零的合成图', async () => {
    const canvas = await renderSubmissionComposite(PALETTE, makeResult());
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it('底部留出 SUBMISSION_QR_PX 高的白带给二维码', async () => {
    const withBand = await renderSubmissionComposite(PALETTE, makeResult());
    const noBand = await renderSubmissionComposite(PALETTE, makeResult());
    // 两次渲染结果一致 —— 这条断言本身不成立也没关系，重点是下面这条：
    expect(withBand.height).toBeGreaterThan(0);
    expect(noBand.height).toBeGreaterThan(0);
  });

  it('格子像素与导出一致（32），否则投稿图和下载的图长得不一样', () => {
    expect(SUBMISSION_CELL_PX).toBe(32);
  });

  it('不画二维码：码依赖作品 id，而 id 落库之后才知道', async () => {
    const canvas = await renderSubmissionComposite(PALETTE, makeResult());
    // 留白带区域仍然是纯白 —— 码画上去之前那里必须什么都没画过
    const ctx = canvas.getContext('2d')!;
    const px = ctx.getImageData(
      canvas.width - SUBMISSION_QR_PX / 2,
      canvas.height - SUBMISSION_QR_PX / 2,
      1, 1,
    ).data;
    expect(px[0]).toBe(255);
    expect(px[1]).toBe(255);
    expect(px[2]).toBe(255);
  });
});
```

**注意**：第二条用例（`底部留出白带`）写得不构成判别力，两次调用同一个输入高度必然相等。**把它替换成**：

```ts
  it('底部留出 SUBMISSION_QR_PX 高的白带给二维码', async () => {
    const canvas = await renderSubmissionComposite(PALETTE, makeResult());
    // 底部白带 + 上下 padding 一定比色卡区高：断言总高 ≥ 图纸高 + 带高 + 两倍 padding
    expect(canvas.height).toBeGreaterThan(SUBMISSION_QR_PX + 100);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/pipeline/submission.test.ts`

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

创建 `src/pipeline/submission.ts`：

```ts
import { renderBeadBoard } from './board';
import { renderCompositeFromBoard } from './composite';
import { drawWatermark } from './watermark';
import { SUBMISSION_QR_PX } from './qr';
import type { Palette, PipelineResult } from '@/types';

/**
 * 投稿成品图的格子像素。与 App.tsx 调 exportMulti(32, ...) 的 32 对齐 ——
 * 两边不一样的话，用户会看到「下载的图」和「投的那张」尺寸不一样。
 */
export const SUBMISSION_CELL_PX = 32;

/**
 * 按「当前参数」渲染投稿用的成品图：拼豆板 + 色号标注 + 色卡 + 水印，
 * 底部留出一条 SUBMISSION_QR_PX 高的白带。
 *
 * **直接吃 PipelineResult，不从原图重新采样。** result 就是用户此刻屏幕上看到的
 * 那张图：去背景、简化颜色、紧裁的结果都已经在里面了（见 pipeline.ts 的 process()
 * 里 finalIndices / finalMask 的推导）。重跑一遍采样只会更慢，而且可能与预览有
 * 细微差异 —— 投稿图必须是用户看到的那张。
 *
 * 导出路径（exportMulti）反而要重新采样，因为它支持一次出多个尺寸。
 *
 * **二维码刻意不在这里画**：码的内容依赖作品 id，而 id 只有落库之后才知道。
 * 调用方拿到 canvas 后先 POST 换 id，再用 drawWorksQr 补画（见 SubmitWorkButton）。
 */
export async function renderSubmissionComposite(
  palette: Palette,
  result: PipelineResult,
): Promise<HTMLCanvasElement> {
  const boardCanvas = renderBeadBoard(
    result.indices,
    result.outW,
    result.outH,
    palette,
    { cellPx: SUBMISSION_CELL_PX, fontPx: 12, mask: result.mask },
  );
  const composite = renderCompositeFromBoard(
    boardCanvas,
    result.indices,
    result.outW,
    result.outH,
    palette,
    result.mask,
    { qrBandPx: SUBMISSION_QR_PX },
  );
  await drawWatermark(composite);
  return composite;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/pipeline/submission.test.ts`

Expected: PASS —— 4 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/submission.ts src/pipeline/submission.test.ts
git commit -m "feat(投稿): 按当前 PipelineResult 渲染带白带的成品图

直接吃 result 而不是从原图重新采样：result 就是用户屏幕上看到的那张图，
去背景/简化颜色/紧裁的结果都已经在里面。重跑一遍只会更慢，还可能与预览
有细微差异。

二维码不在这里画 —— 码依赖作品 id，而 id 落库之后才知道。白带先按
SUBMISSION_QR_PX 预留好，调用方拿到 id 后用 drawWorksQr 补画。"
```

---

### Task 11: 投稿按钮 + 名称弹窗 + 两步上传编排

**Files:**
- Create: `src/components/SubmitWorkButton.tsx` / `.css` / `.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `renderSubmissionComposite`（Task 10）、`renderSubmissionQr` / `drawWorksQr` / `SUBMISSION_QR_PX`（Task 9）、`createWorkSubmission` / `uploadSubmissionImage`（Task 8）、`canvasToBlob`
- Produces: `export function SubmitWorkButton(props: SubmitWorkButtonProps)`

```ts
export interface SubmitWorkButtonProps {
  palette: Palette;
  result: PipelineResult | null;
  /** 当前这四个值就是要随投稿入库的图纸参数 */
  beanCount: number;
  colorCount: number;
  /** 仅用于弹窗摘要展示的文案（如「约 3 小时」）。服务端存的是下面的分钟数。 */
  estimateLabel: string;
  estimateMinutes: number;
  disabled?: boolean;
}
```

- [ ] **Step 1: 写失败测试**

创建 `src/components/SubmitWorkButton.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/dom';
import { SubmitWorkButton } from './SubmitWorkButton';
import type { Palette, PipelineResult } from '@/types';

const renderComposite = vi.fn();
const renderQr = vi.fn();
const toBlobMock = vi.fn();
const createSubmission = vi.fn();
const uploadImage = vi.fn();

// 统一用仓库既有的 vi.mock + importActual 范式（见 WorksTab.test.tsx /
// WorkDetailPage.test.tsx）。不要改成 vi.spyOn 打在模块命名空间上 ——
// 本仓库 8 处组件测试清一色用这个写法，跟既有范式走。
vi.mock('@/pipeline/submission', async () => {
  const actual = await vi.importActual<typeof import('@/pipeline/submission')>('@/pipeline/submission');
  return { ...actual, renderSubmissionComposite: (...a: unknown[]) => renderComposite(...a) };
});

vi.mock('@/pipeline/qr', async () => {
  const actual = await vi.importActual<typeof import('@/pipeline/qr')>('@/pipeline/qr');
  return { ...actual, renderSubmissionQr: (...a: unknown[]) => renderQr(...a) };
});

// jsdom 没有 canvas.toBlob，不 mock 的话 canvasToBlob 会 reject，整个流程走不到上传那步。
// makeThumb 内部同样调 toBlob，但组件里它包在 try/catch 里降级返回 null，不影响本组用例。
vi.mock('@/pipeline/exporter', async () => {
  const actual = await vi.importActual<typeof import('@/pipeline/exporter')>('@/pipeline/exporter');
  return { ...actual, canvasToBlob: (...a: unknown[]) => toBlobMock(...a) };
});

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    createWorkSubmission: (...a: unknown[]) => createSubmission(...a),
    uploadSubmissionImage: (...a: unknown[]) => uploadImage(...a),
  };
});

const PALETTE: Palette = [{ id: 0, rgb: [1, 2, 3], name: '黑' }];

const RESULT: PipelineResult = {
  indices: new Uint8Array([0]),
  gridSize: 1, outW: 1, outH: 1, sourceW: 1, sourceH: 1,
  cropped: false, token: 0, mask: new Uint8Array([0]),
  simplifyColors: false, colorBudget: 'off',
  colorSimplification: {
    beforeColorCount: 1, afterColorCount: 1, mergedColorCount: 0,
    rareColorCountBefore: 0, rareColorCountAfter: 0,
    minimumColorCountSatisfied: false, budgetLevel: 'off',
    budgetTargetColorCount: 0, budgetSatisfied: true, budgetFidelityLimited: false,
  },
};

/** 造一张有真实尺寸的 canvas：组件要读 canvas.width/height 当图片尺寸传给服务端 */
function fakeCanvas(w = 400, h = 600): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

beforeEach(() => {
  renderComposite.mockReset().mockResolvedValue(fakeCanvas());
  renderQr.mockReset().mockResolvedValue(null);
  toBlobMock.mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  createSubmission.mockReset().mockResolvedValue({ id: 42, uploadToken: 'tok' });
  uploadImage.mockReset().mockResolvedValue({ ok: true, id: 42 });
});

// vitest.config.ts 是 globals:false，RTL 的自动 cleanup 不注册。少了这行 DOM 会
// 跨用例残留，实现完全正确也会红（既有测试注释里记着同一个坑）。
afterEach(cleanup);

afterEach(() => {
  vi.clearAllMocks();
});

function renderButton(over: Partial<React.ComponentProps<typeof SubmitWorkButton>> = {}) {
  return render(
    <SubmitWorkButton
      palette={PALETTE}
      result={RESULT}
      beanCount={3814}
      colorCount={42}
      estimateLabel="约 3 小时"
      estimateMinutes={190}
      {...over}
    />,
  );
}

describe('SubmitWorkButton', () => {
  it('没有图纸时按钮禁用', () => {
    renderButton({ result: null });
    expect(screen.getByRole('button', { name: /投稿/ })).toBeDisabled();
  });

  it('点击后弹窗显示名称输入框与四个参数的只读摘要', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('1 × 1 格');
    expect(dialog.textContent).toContain('3,814 颗');
    expect(dialog.textContent).toContain('42 种');
    expect(dialog.textContent).toContain('约 3 小时');
  });

  it('名称为空时不能提交，也不发任何请求', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /确认投稿/ }));
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it('确认后先渲染成品图，再 POST 元数据，补画码，最后上传带码图', async () => {
    const order: string[] = [];
    renderComposite.mockImplementation(async () => { order.push('render'); return fakeCanvas(); });
    renderQr.mockImplementation(async () => { order.push('qr'); return null; });
    createSubmission.mockImplementation(async () => { order.push('create'); return { id: 42, uploadToken: 'tok' }; });
    uploadImage.mockImplementation(async () => { order.push('upload'); return { ok: true, id: 42 }; });

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '粉色小熊' } });
    fireEvent.click(screen.getByRole('button', { name: /确认投稿/ }));

    await waitFor(() => expect(order).toEqual(['render', 'create', 'qr', 'upload']));
  });

  it('POST 元数据时带上四个图纸参数与分钟数（不是那句「约 3 小时」的文案）', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /确认投稿/ }));

    await waitFor(() => expect(createSubmission).toHaveBeenCalledWith({
      title: 'x',
      boardW: 1, boardH: 1,
      beanCount: 3814, colorCount: 42, estimateMinutes: 190,
    }));
  });

  it('上传时把 canvas 的真实尺寸一并传给服务端（详情页要靠它显示成品尺寸）', async () => {
    renderComposite.mockResolvedValue(fakeCanvas(1234, 5678));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /确认投稿/ }));

    await waitFor(() => expect(uploadImage).toHaveBeenCalled());
    const [, , , opts] = uploadImage.mock.calls[0] as unknown as [
      number, string, Blob, { width: number; height: number },
    ];
    expect(opts.width).toBe(1234);
    expect(opts.height).toBe(5678);
  });

  it('成功后提示「等审核」而不是给出链接（还没过审，链接不可访问）', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /确认投稿/ }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('审核'));
    expect(screen.getByRole('status').textContent).not.toContain('/works/42');
  });

  it('上传失败给中文错误，不吞异常', async () => {
    uploadImage.mockRejectedValue(new Error('今天的投稿次数已用完，明天再来吧'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /确认投稿/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('今天的投稿次数已用完'),
    );
  });

  it('投稿进行中禁用重复点击', async () => {
    let resolveCreate: (v: { id: number; uploadToken: string }) => void = () => {};
    createSubmission.mockImplementation(
      () => new Promise((r) => { resolveCreate = r as typeof resolveCreate; }),
    );
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /确认投稿/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /确认投稿/ })).toBeDisabled());
    resolveCreate({ id: 42, uploadToken: 'tok' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/components/SubmitWorkButton.test.tsx`

Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现组件**

创建 `src/components/SubmitWorkButton.tsx`：

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createWorkSubmission,
  uploadSubmissionImage,
} from '@/api/works';
import { renderSubmissionComposite } from '@/pipeline/submission';
import { canvasToBlob } from '@/pipeline/exporter';
import { drawWorksQr, renderSubmissionQr } from '@/pipeline/qr';
import './SubmitWorkButton.css';

export interface SubmitWorkButtonProps {
  palette: import('@/types').Palette;
  result: import('@/types').PipelineResult | null;
  beanCount: number;
  colorCount: number;
  estimateLabel: string;
  disabled?: boolean;
}

/** 缩略图长边，与后台上传时期一致（THUMB_MAX = 480）。 */
const THUMB_MAX = 480;
const THUMB_QUALITY = 0.82;

type Phase = 'idle' | 'submitting' | 'done';

/**
 * 浏览器里把成品图压成 480px WebP 缩略图。
 *
 * 放前端而不是服务端 sharp：图本来就在浏览器里解码过一次，再缩一次没有额外
 * I/O；而服务端目前是纯 JS 依赖（sql.js / express），引入 sharp 会带来原生
 * 模块编译，拖慢 CI 部署。
 *
 * 必须验 blob.type：按 HTML 规范，浏览器不支持 WebP 编码时 toBlob 会**静默回落**
 * 成 image/png，而不是回 null。把它当缩略图传上去，服务端按扩展名校验 mime 时
 * 直接 400，整次投稿连带原图一起失败 —— 比没有缩略图糟得多。
 */
async function makeThumb(canvas: HTMLCanvasElement): Promise<Blob | null> {
  try {
    const scale = Math.min(1, THUMB_MAX / Math.max(canvas.width, canvas.height));
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', THUMB_QUALITY));
    if (!blob || blob.type !== 'image/webp') return null;
    return blob;
  } catch (e) {
    console.warn('[submit] 缩略图生成失败，降级为无缩略图', e);
    return null;
  }
}

export function SubmitWorkButton({
  palette,
  result,
  beanCount,
  colorCount,
  estimateLabel,
  estimateMinutes,
  disabled,
}: SubmitWorkButtonProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const busy = phase === 'submitting';
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setTitle(''); setError(null); }
  }, [open]);

  const submit = useCallback(async () => {
    const name = title.trim();
    if (!name || !result || busy) return;
    setPhase('submitting');
    setError(null);
    setOpen(false);
    try {
      // ① 先渲染：白带按 SUBMISSION_QR_PX 预留好，但还不画码
      const canvas = await renderSubmissionComposite(palette, result);

      // ② 再占 id —— 码的内容依赖它
      const created = await createWorkSubmission({
        title: name,
        boardW: result.outW,
        boardH: result.outH,
        beanCount,
        colorCount,
        // 传数字而不是「约 3 小时」那句文案：服务端存的必须是分钟数，
        // 以后改 estimateAssemblyHours 的措辞不该洗历史数据
        estimateMinutes,
      });

      // ③ 补画这一件作品自己的码
      const qrImage = await renderSubmissionQr(created.id);
      if (qrImage) drawWorksQr(canvas, qrImage);

      const [blob, thumb] = await Promise.all([
        canvasToBlob(canvas),
        makeThumb(canvas),
      ]);

      // ④ 上传。缩略图失败不是致命错误，服务端会留空 thumb_key 降级
      await uploadSubmissionImage(created.id, created.uploadToken, blob, {
        thumb,
        width: canvas.width,
        height: canvas.height,
      });

      setPhase('done');
      window.setTimeout(() => setPhase('idle'), 4000);
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [beanCount, busy, colorCount, palette, result, title]);

  const blocked = disabled || !result || beanCount <= 0;

  return (
    <div className="submit-work">
      <button
        type="button"
        className="submit-work-btn"
        disabled={blocked || busy}
        onClick={() => setOpen(true)}
      >
        {busy ? '正在投稿…' : '投稿到作品库'}
      </button>

      {open && (
        <div className="submit-work-backdrop" onClick={() => setOpen(false)}>
          <div
            ref={dialogRef}
            className="submit-work-dialog"
            role="dialog"
            aria-label="投稿"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="submit-work-title">投稿到作品库</h3>

            <label className="submit-work-label">
              名称
              <input
                type="text"
                value={title}
                maxLength={200}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>

            {/* 只读摘要：这四组值就是要写进审核表的内容，
                让用户在点确认之前看到，比事后在审核队列里才发现写错了要好 */}
            <dl className="submit-work-summary">
              <div>
                <dt>图纸比例</dt>
                <dd>{result ? `${result.outW} × ${result.outH} 格` : '—'}</dd>
              </div>
              <div>
                <dt>豆子数量</dt>
                <dd>{beanCount > 0 ? `${beanCount.toLocaleString()} 颗` : '—'}</dd>
              </div>
              <div>
                <dt>颜色数量</dt>
                <dd>{colorCount > 0 ? `${colorCount} 种` : '—'}</dd>
              </div>
              <div>
                <dt>预估时间</dt>
                <dd>{estimateLabel}</dd>
              </div>
            </dl>

            <p className="submit-work-hint">
              投稿要等站主审核通过才会出现在作品库里，通过后这张图的二维码
              会指向它自己的详情页。
            </p>

            {error && <p className="submit-work-error" role="alert">{error}</p>}

            <div className="submit-work-actions">
              <button type="button" className="submit-work-cancel" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="submit-work-confirm"
                disabled={title.trim().length === 0 || busy}
                onClick={submit}
              >
                确认投稿
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <p className="submit-work-toast" role="status" aria-live="polite">
          投稿成功，等审核通过就会出现在作品库～
        </p>
      )}
      {phase === 'idle' && error && (
        <p className="submit-work-error" role="alert">{error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 写样式**

创建 `src/components/SubmitWorkButton.css`：

```css
.submit-work { margin-top: var(--space-3); }

.submit-work-btn {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border, #d9d9e0);
  border-radius: 10px;
  background: #fff;
  color: inherit;
  font-size: var(--text-sm, 14px);
  cursor: pointer;
}
.submit-work-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.submit-work-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  z-index: 60;
  padding: var(--space-4);
}

.submit-work-dialog {
  width: min(420px, 100%);
  background: #fff;
  border-radius: 14px;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.submit-work-title { margin: 0; font-size: var(--text-base, 15px); }

.submit-work-label { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-xs, 13px); }
.submit-work-label input {
  padding: 8px 10px;
  border: 1px solid var(--color-border, #d9d9e0);
  border-radius: 8px;
  font-size: 14px;
}

.submit-work-summary { margin: 0; display: grid; gap: 6px; font-size: var(--text-xs, 13px); }
.submit-work-summary > div { display: flex; justify-content: space-between; }
.submit-work-summary dt { color: #666; margin: 0; }
.submit-work-summary dd { margin: 0; }

.submit-work-hint { margin: 0; font-size: var(--text-xs, 13px); color: #666; }
.submit-work-error { margin: 0; font-size: var(--text-xs, 13px); color: #b3261e; }

.submit-work-actions { display: flex; justify-content: flex-end; gap: 8px; }
.submit-work-cancel, .submit-work-confirm {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #d9d9e0);
  background: #fff;
  cursor: pointer;
}
.submit-work-confirm { background: #111; color: #fff; border-color: #111; }
.submit-work-confirm:disabled { opacity: 0.5; cursor: not-allowed; }

.submit-work-toast {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs, 13px);
  color: #1a7f37;
}
```

- [ ] **Step 5: 接进 App.tsx**

在 `src/App.tsx` 的 import 区加：

```tsx
import { SubmitWorkButton } from '@/components/SubmitWorkButton';
```

在 `estimateLabel` 的定义之后加一行：

```tsx
  const estimateMinutes = useMemo(() => Math.round(estimateAssemblyHours(beanCount)), [beanCount]);
```

在 `aside.left` 里，`<ParamPanel />` 与 `<ExportPanel />` 之间插入：

```tsx
          {/* 投稿按钮放在参数面板之下、导出之上：两者都是「拿这张图纸去做点什么」，
              而参数是它们共同的前置输入。移动端 layout-3col 变单列堆叠后，
              它自然落在参数面板下方、预览区上方，不进 MobileActionBar ——
              那里已经有上传和导出，再塞第三个操作会让底部条拥挤。 */}
          <SubmitWorkButton
            palette={palette}
            result={result}
            beanCount={beanCount}
            colorCount={legend.length}
            estimateLabel={estimateLabel}
            estimateMinutes={estimateMinutes}
            disabled={status === 'idle' || status === 'loading'}
          />
```

并把 `SubmitWorkButtonProps` 里的 `estimateLabel` 旁边补上 `estimateMinutes: number`（Step 3 已说明）。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/components/SubmitWorkButton.test.tsx`

Expected: PASS —— 9 个用例全绿。

- [ ] **Step 7: 跑全量回归并提交**

Run: `npm test && npm run typecheck`

Expected: 全绿。

```bash
git add src/components/SubmitWorkButton.tsx src/components/SubmitWorkButton.css src/components/SubmitWorkButton.test.tsx src/App.tsx
git commit -m "feat(投稿): 参数面板下的投稿按钮 + 名称弹窗 + 两步上传编排

时序是 renderSubmissionComposite → createSubmission（拿 id）→ renderSubmissionQr
→ drawWorksQr → canvasToBlob → uploadSubmissionImage。渲染在前是因为白带要
先按 SUBMISSION_QR_PX 预留高度，码要等 id —— 两件事无法合成一步。

成功后只提示「等审核」，不给链接：还没过审时 /works/:id 是 404，给一个点
不开的地址只会让人以为投稿坏了。

estimateMinutes 传数字而不是那句「约 3 小时」的文案，服务端存的必须是数字。"
```

---

### Task 12: 后台审核队列

**Files:**
- Modify: `src/pages/admin/WorksTab.tsx`
- Test: `src/pages/admin/WorksTab.test.tsx`（既有文件，改写）

**Interfaces:**
- Consumes: `adminListWorks(status?)` / `adminApproveWork` / `adminRejectWork` / `adminUpdateWork` / `adminDeleteWork`（Task 8）
- Produces: `export function WorksTab()`

- [ ] **Step 1: 写失败测试**

把 `src/pages/admin/WorksTab.test.tsx` 整个替换为：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/dom';
import { WorksTab } from './WorksTab';

const adminListWorks = vi.fn();
const adminApproveWork = vi.fn();
const adminRejectWork = vi.fn();
const adminUpdateWork = vi.fn();
const adminDeleteWork = vi.fn();

// 用仓库既有的 vi.mock + importActual 范式（与本文件改动前的写法一致），
// 不要改成 vi.spyOn 打在模块命名空间上。
vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    adminListWorks: (...a: unknown[]) => adminListWorks(...a),
    adminApproveWork: (...a: unknown[]) => adminApproveWork(...a),
    adminRejectWork: (...a: unknown[]) => adminRejectWork(...a),
    adminUpdateWork: (...a: unknown[]) => adminUpdateWork(...a),
    adminDeleteWork: (...a: unknown[]) => adminDeleteWork(...a),
  };
});

const BASE = {
  id: 1, title: '待审作品', description: '', published: false,
  thumbUrl: '/media/works/a-t.webp', imageUrl: '/media/works/a.png',
  width: 100, height: 100, bytes: 1024, createdAt: 1, updatedAt: 1, likes: 0,
  boardW: 87, boardH: 62, beanCount: 3814, colorCount: 42, estimateMinutes: 190,
};
const PENDING = { ...BASE, status: 'pending' as const };
const APPROVED = { ...BASE, id: 2, title: '已上架', status: 'approved' as const, published: true };
const UNLISTED = { ...APPROVED, id: 3, title: '已下架', published: false };
const REJECTED = { ...BASE, id: 4, title: '被拒的', status: 'rejected' as const };

/** window.confirm 在拒绝/删除路径上会被问，返回 true 让流程走到底 */
function acceptConfirm(): void {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
}

beforeEach(() => {
  adminListWorks.mockReset().mockResolvedValue([PENDING, APPROVED, UNLISTED, REJECTED]);
  adminApproveWork.mockReset().mockResolvedValue({ ...PENDING, status: 'approved', published: true });
  adminRejectWork.mockReset().mockResolvedValue({ ...PENDING, status: 'rejected' });
  adminUpdateWork.mockReset().mockImplementation(async (id: number, patch: { published?: boolean; title?: string }) => ({
    ...APPROVED, id, ...patch,
  }));
  adminDeleteWork.mockReset().mockResolvedValue({ ok: true });
  acceptConfirm();
});

// vitest.config.ts 是 globals:false，RTL 的自动 cleanup 不注册。少了这行 DOM 会
// 跨用例残留，实现完全正确也会红（本文件改前就有这条注释）。
afterEach(cleanup);

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('WorksTab 审核队列', () => {
  it('后台上传入口已彻底消失', async () => {
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('待审作品')).toBeTruthy());
    expect(screen.queryByText('上传作品')).toBeNull();
    expect(screen.queryByLabelText(/选择图片/)).toBeNull();
  });

  it('待审核区显示四个图纸参数', async () => {
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('待审作品')).toBeTruthy());
    const pendingSection = screen.getByRole('region', { name: '待审核' });
    expect(pendingSection.textContent).toContain('87 × 62');
    expect(pendingSection.textContent).toContain('3,814');
    expect(pendingSection.textContent).toContain('42');
  });

  it('待审核区提供通过与拒绝两个动作', async () => {
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('待审作品')).toBeTruthy());
    expect(screen.getByRole('button', { name: '通过 待审作品' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝 待审作品' })).toBeTruthy();
  });

  it('点通过后行进入作品集并已上架', async () => {
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('待审作品')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '通过 待审作品' }));
    await waitFor(() => expect(adminApproveWork).toHaveBeenCalledWith(1));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '待审核' }).textContent).not.toContain('待审作品');
      expect(screen.getByRole('region', { name: '作品集' }).textContent).toContain('待审作品');
    });
  });

  it('点拒绝后行离开待审核区', async () => {
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('待审作品')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '拒绝 待审作品' }));
    await waitFor(() => expect(adminRejectWork).toHaveBeenCalledWith(1));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '待审核' }).textContent).not.toContain('待审作品');
      expect(screen.getByRole('region', { name: '已拒绝' }).textContent).toContain('待审作品');
    });
  });

  it('已拒绝的行不渲染 img（文件已删，画出来是破图），改显示文字占位', async () => {
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('被拒的')).toBeTruthy());
    const rejectedSection = screen.getByRole('region', { name: '已拒绝' });
    expect(rejectedSection.textContent).toContain('源文件已删除');
    expect(rejectedSection.querySelector('img')).toBeNull();
  });

  it('已上架的作品显示「下架」按钮，已下架的显示「上架」', async () => {
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('已下架')).toBeTruthy());
    expect(screen.getByRole('button', { name: '下架 已上架' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '上架 已下架' })).toBeTruthy();
  });

  it('点上架调用 adminUpdateWork 并把 published 置 true', async () => {
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('已下架')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '上架 已下架' }));
    await waitFor(() => expect(adminUpdateWork).toHaveBeenCalledWith(3, { published: true }));
  });

  it('操作失败时回滚并显示中文错误', async () => {
    adminApproveWork.mockRejectedValue(new Error('磁盘满了'));
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('待审作品')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '通过 待审作品' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('磁盘满了'));
    // 回滚：行仍在待审核区
    expect(screen.getByRole('region', { name: '待审核' }).textContent).toContain('待审作品');
  });

  it('没有图片的 pending 行显示「图片未上传」并仍可被拒绝', async () => {
    adminListWorks.mockResolvedValue([{ ...PENDING, id: 5, title: '半途而废', imageUrl: '' }]);
    render(<WorksTab />);
    await waitFor(() => expect(screen.getByText('半途而废')).toBeTruthy());
    const pendingSection = screen.getByRole('region', { name: '待审核' });
    expect(pendingSection.textContent).toContain('图片未上传');
    fireEvent.click(screen.getByRole('button', { name: '拒绝 半途而废' }));
    await waitFor(() => expect(adminRejectWork).toHaveBeenCalledWith(5));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/pages/admin/WorksTab.test.tsx`

Expected: FAIL —— 旧的「上传作品」界面还在。

- [ ] **Step 3: 重写 WorksTab**

把 `src/pages/admin/WorksTab.tsx` 整个替换为：

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  adminApproveWork,
  adminDeleteWork,
  adminListWorks,
  adminRejectWork,
  adminUpdateWork,
  type AdminWorkDetail,
  type WorkStatus,
} from '@/api/works';
import { formatAssemblyHours } from '@/pipeline/timeEstimate';
import './WorksTab.css';

type Section = 'pending' | 'gallery' | 'rejected';

/** 状态 → 展示区。gallery 装 approved（不管上架与否），rejected 单独一区。 */
function sectionOf(w: AdminWorkDetail): Section {
  if (w.status === 'pending') return 'pending';
  if (w.status === 'rejected') return 'rejected';
  return 'gallery';
}

/** 预估工时只存分钟数，展示时现算文案 —— 以后改措辞不动历史数据 */
function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '—';
  return formatAssemblyHours(minutes / 60);
}

function ThumbOrPlaceholder({ work }: { work: AdminWorkDetail }) {
  // rejected 的源文件在审核时就删掉了，画 <img> 只会得到一个 404 破图。
  // image_key 字符串保留在库里是审计线索，不是可访问地址。
  if (work.status === 'rejected') {
    return <span className="works-admin-flag">源文件已删除</span>;
  }
  return <img className="works-admin-thumb" src={work.thumbUrl} alt="" />;
}

export function WorksTab() {
  const [works, setWorks] = useState<AdminWorkDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * 每个作品正在编辑、尚未保存的字段。草稿存在期间输入框显示草稿值，保存成功、
   * 草稿清空后回落成服务端返回值 —— 于是「服务端规范化后的值」（trim / 超长截断）
   * 照样能刷进界面，不用靠 key 强制重挂载（那会在用户打字途中吞掉未保存的输入）。
   */
  const [drafts, setDrafts] = useState<Record<number, { title?: string; description?: string }>>({});

  const reload = useCallback(() => {
    setLoading(true);
    adminListWorks()
      .then((w) => { setWorks(w); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const patch = useCallback((id: number, next: Partial<AdminWorkDetail>) => {
    setWorks((prev) => prev.map((w) => (w.id === id ? { ...w, ...next } : w)));
  }, []);

  /**
   * 审核动作：乐观更新 + 失败回滚。
   *
   * 回滚不是把整对象换回旧快照，而是把本次改动的字段还原 —— 两次操作并发时
   * 整对象回滚会把对方刚做的改动一起盖掉。
   */
  const runReview = useCallback(
    async (work: AdminWorkDetail, action: 'approve' | 'reject') => {
      const prev = { status: work.status, published: work.published };
      setError(null);
      try {
        if (action === 'approve') {
          const next = await adminApproveWork(work.id);
          patch(work.id, { status: 'approved', published: true, updatedAt: next.updatedAt });
        } else {
          if (!window.confirm(`拒绝「${work.title}」？源文件会被永久删除，无法恢复。`)) return;
          const next = await adminRejectWork(work.id);
          patch(work.id, { status: 'rejected', published: false, updatedAt: next.updatedAt });
        }
      } catch (e) {
        patch(work.id, prev);
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [patch],
  );

  const togglePublished = useCallback(
    async (work: AdminWorkDetail) => {
      const prevPublished = work.published;
      const next = !prevPublished;
      setError(null);
      patch(work.id, { published: next });
      try {
        await adminUpdateWork(work.id, { published: next });
      } catch (e) {
        patch(work.id, { published: prevPublished });
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [patch],
  );

  const remove = useCallback(async (work: AdminWorkDetail) => {
    if (!window.confirm(`彻底删除「${work.title}」？记录和文件都会消失，无法恢复。`)) return;
    setError(null);
    try {
      await adminDeleteWork(work.id);
      setWorks((prev) => prev.filter((w) => w.id !== work.id));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, []);

  const dropDraft = useCallback((id: number) => {
    setDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const saveMeta = useCallback(
    async (work: AdminWorkDetail, patchIn: { title?: string; description?: string }) => {
      setError(null);
      try {
        const next = await adminUpdateWork(work.id, patchIn);
        patch(work.id, {
          ...(typeof patchIn.title === 'string' ? { title: next.title } : {}),
          ...(typeof patchIn.description === 'string' ? { description: next.description } : {}),
          updatedAt: next.updatedAt,
        });
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [patch],
  );

  const renderRow = (work: AdminWorkDetail) => {
    const d = drafts[work.id];
    const sec = sectionOf(work);
    return (
      <li key={work.id} className="works-admin-item" data-section={sec}>
        <ThumbOrPlaceholder work={work} />
        <div className="works-admin-fields">
          <input
            type="text"
            value={d?.title ?? work.title}
            aria-label={`${work.title} 标题`}
            onChange={(e) =>
              setDrafts((p) => ({ ...p, [work.id]: { ...p[work.id], title: e.target.value } }))
            }
            onBlur={(e) => {
              const v = e.target.value;
              dropDraft(work.id);
              if (v !== work.title) saveMeta(work, { title: v });
            }}
          />

          {sec === 'pending' && (
            <p className="works-admin-params">
              <span>{work.boardW} × {work.boardH} 格</span>
              <span>{work.beanCount.toLocaleString()} 颗</span>
              <span>{work.colorCount} 种颜色</span>
              <span>{formatMinutes(work.estimateMinutes)}</span>
            </p>
          )}

          {sec === 'gallery' && (
            <textarea
              rows={2}
              value={d?.description ?? work.description}
              aria-label={`${work.title} 描述`}
              onChange={(e) =>
                setDrafts((p) => ({ ...p, [work.id]: { ...p[work.id], description: e.target.value } }))
              }
              onBlur={(e) => {
                const v = e.target.value;
                dropDraft(work.id);
                if (v !== work.description) saveMeta(work, { description: v });
              }}
            />
          )}

          {/* thumb_key 为空时服务端回落用原图当缩略图，前台列表会真的去拉大图。
              标出来，免得站主以为「列表只加载缩略图」这句文案在骗人。 */}
          {work.thumbUrl === work.imageUrl && sec !== 'rejected' && (
            <span className="works-admin-flag">无缩略图，前台加载的是原图</span>
          )}
          {!work.imageUrl && sec === 'pending' && (
            <span className="works-admin-flag">图片未上传</span>
          )}
        </div>

        <div className="works-admin-actions">
          {sec === 'pending' && (
            <>
              <button
                type="button"
                className="works-admin-btn"
                onClick={() => runReview(work, 'approve')}
              >
                通过 {work.title}
              </button>
              <button
                type="button"
                className="works-admin-btn works-admin-btn--danger"
                onClick={() => runReview(work, 'reject')}
              >
                拒绝 {work.title}
              </button>
            </>
          )}

          {sec === 'gallery' && (
            <>
              <button
                type="button"
                className="works-admin-btn"
                onClick={() => togglePublished(work)}
              >
                {work.published ? '下架' : '上架'} {work.title}
              </button>
              <button
                type="button"
                className="works-admin-btn works-admin-btn--danger"
                onClick={() => remove(work)}
              >
                删除 {work.title}
              </button>
              {!work.published && <span className="works-admin-flag">已下架</span>}
            </>
          )}

          {sec === 'rejected' && (
            <button
              type="button"
              className="works-admin-btn works-admin-btn--danger"
              onClick={() => remove(work)}
            >
              彻底删除 {work.title}
            </button>
          )}
        </div>
      </li>
    );
  };

  const groups: { key: Section; title: string }[] = [
    { key: 'pending', title: '待审核' },
    { key: 'gallery', title: '作品集' },
    { key: 'rejected', title: '已拒绝' },
  ];

  return (
    <div className="works-admin">
      <h2 className="works-admin-title">作品管理</h2>

      {error && <p className="works-admin-error" role="alert">操作失败：{error.message}</p>}
      {loading && <p className="works-admin-hint">加载中…</p>}
      {!loading && works.length === 0 && (
        <p className="works-admin-hint">还没有作品。用户在生成页点「投稿」后会出现在「待审核」里。</p>
      )}

      {groups.map((g) => {
        const items = works.filter((w) => sectionOf(w) === g.key);
        return (
          <section key={g.key} role="region" aria-label={g.title} className="works-admin-section">
            <h3 className="works-admin-section-title">
              {g.title}（{items.length}）
            </h3>
            {items.length === 0 ? (
              <p className="works-admin-hint">空</p>
            ) : (
              <ul className="works-admin-list">{items.map(renderRow)}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

**注意**：上面已经写对，不需要再改什么。

- [ ] **Step 4: 补 CSS**

在 `src/pages/admin/WorksTab.css` 末尾追加：

```css
.works-admin-section { margin-bottom: 24px; }
.works-admin-section-title { font-size: 14px; margin: 12px 0 8px; }
.works-admin-params {
  margin: 4px 0 0;
  font-size: 12px;
  color: #555;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/pages/admin/WorksTab.test.tsx`

Expected: PASS —— 8 个用例全绿。

其中「操作失败时回滚」这条需要 `window.confirm` 在拒绝路径上被 stub，但通过路径不经过它，所以不需要额外处理。

- [ ] **Step 6: 跑全量回归并提交**

Run: `npm test && npm run typecheck`

Expected: 全绿。

```bash
git add src/pages/admin/WorksTab.tsx src/pages/admin/WorksTab.css src/pages/admin/WorksTab.test.tsx
git commit -m "feat(后台): 作品 tab 拆成待审核 / 作品集 / 已拒绝三块

上传区块整个删掉 —— 进货渠道已经换成用户投稿。已拒绝的行不渲染 <img>：
审核时源文件就被删了，画出来只会是 404 破图，改显「源文件已删除」文字占位。
image_url 为空的 pending 行显示「图片未上传」，它同样可以被拒绝（用户在图
生成前就关掉页面会留下这种行，站主一键就清掉了）。"
```

---

### Task 13: 详情页展示图纸参数 + 404 自动导航

**Files:**
- Modify: `src/pages/WorkDetailPage.tsx`
- Test: `src/pages/WorkDetailPage.test.tsx`（既有文件，追加）

**Interfaces:**
- Consumes: `WorkDetail`（Task 8 已带参数字段）
- Produces: `WorkDetailPage` 在拿不到作品时 `window.location.replace('/works')`

- [ ] **Step 1: 写失败测试**

在 `src/pages/WorkDetailPage.test.tsx` 末尾追加。**该文件已经自带完整的 mock 骨架**：
`const fetchWork = vi.fn()` + `vi.mock('@/api/works', …)` 工厂 + `afterEach(cleanup)`。
本组用例直接复用它们，**不要重新定义 mock、不要重复写 cleanup**。

```tsx
describe('投稿参数展示', () => {
  it('详情页展示图纸比例、豆子数、颜色数与预估工时', async () => {
    // detail() 是本文件既有的工厂，返回字段完整的 WorkDetail；用 overrides 补参数
    fetchWork.mockResolvedValue(detail({
      boardW: 87, boardH: 62, beanCount: 3814, colorCount: 42, estimateMinutes: 190,
    }));
    render(<WorkDetailPage id={42} />);
    await waitFor(() => expect(screen.getByText('图纸比例')).toBeTruthy());
    expect(screen.getByText('图纸比例').nextElementSibling?.textContent).toBe('87 × 62 格');
    expect(screen.getByText('豆子数量').nextElementSibling?.textContent).toBe('3,814 颗');
    expect(screen.getByText('颜色数量').nextElementSibling?.textContent).toBe('42 种');
    // 190 分钟 → 走 timeEstimate 的同一套格式化，不是硬编码字符串
    expect(screen.getByText('预估时间').nextElementSibling?.textContent).toContain('小时');
  });

  it('参数全 0（旧数据没有这些列）时显示「—」而不是 0 或 NaN', async () => {
    fetchWork.mockResolvedValue(detail({
      boardW: 0, boardH: 0, beanCount: 0, colorCount: 0, estimateMinutes: 0,
    }));
    render(<WorkDetailPage id={42} />);
    await waitFor(() => expect(screen.getByText('图纸比例')).toBeTruthy());
    expect(screen.getByText('图纸比例').nextElementSibling?.textContent).toBe('—');
    expect(screen.getByText('豆子数量').nextElementSibling?.textContent).toBe('—');
  });
});

describe('拿不到作品时自动跳回列表', () => {
  /** 900ms > 组件里的 800ms 延迟，留了 100ms 余量 */
  const AFTER_REDIRECT = 900;

  function stubLocation() {
    const replace = vi.fn();
    // 必须用 stubGlobal：实测 vi.spyOn(window.location, 'replace') 在本仓库的
    // jsdom 下抛 "TypeError: Cannot redefine property: replace"。
    vi.stubGlobal('location', { replace, pathname: '/works/999', search: '' });
    return replace;
  }

  it('fetchWork 失败时先显示提示，800ms 后 replace 到 /works', async () => {
    const replace = stubLocation();
    fetchWork.mockRejectedValue(new Error('404'));
    render(<WorkDetailPage id={999} />);

    await waitFor(() => expect(screen.getByText(/不存在或已下架/)).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, AFTER_REDIRECT));
    expect(replace).toHaveBeenCalledWith('/works');
    vi.unstubAllGlobals();
  });

  it('fetchWork 返回 null 走同一条导航', async () => {
    const replace = stubLocation();
    fetchWork.mockResolvedValue(null as never);
    render(<WorkDetailPage id={999} />);
    await waitFor(() => expect(screen.getByText(/不存在或已下架/)).toBeTruthy());
    await new Promise((r) => setTimeout(r, AFTER_REDIRECT));
    expect(replace).toHaveBeenCalledWith('/works');
    vi.unstubAllGlobals();
  });

  it('用 replace 而不是赋值 location.href（无效详情页不该堆进历史）', async () => {
    const replace = stubLocation();
    fetchWork.mockResolvedValue(null as never);
    render(<WorkDetailPage id={999} />);
    await waitFor(() => expect(screen.getByText(/不存在或已下架/)).toBeTruthy());
    await new Promise((r) => setTimeout(r, AFTER_REDIRECT));
    // 桩上只有 replace 一个方法：组件若去赋值 location.href 会拿到 undefined 而炸，
    // 这条断言因此同时锁住了「用 replace」这个选择
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/works');
    vi.unstubAllGlobals();
  });

  it('拿到作品时不跳转', async () => {
    const replace = stubLocation();
    fetchWork.mockResolvedValue(detail({}));
    render(<WorkDetailPage id={42} />);
    await waitFor(() => expect(screen.getByRole('heading')).toBeTruthy());
    await new Promise((r) => setTimeout(r, AFTER_REDIRECT));
    expect(replace).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
```

**为什么用真实定时器而不是 `vi.useFakeTimers()`**：本仓库 `globals: false`，
RTL 的 `waitFor` 走真实定时器；一旦 `useFakeTimers()`，`waitFor` 会与推进定时器
互相等待而挂死。900ms 的真实等待在这个测试里完全可接受，换来的是不会假死。

**既有断言要调整**：若原有用例断言了旧的「返回作品库」按钮
（`getByRole('link', { name: /返回作品库/ })` 或 `getByText('返回作品库')`），
**删掉那条断言** —— 自动导航已取代它，组件里不再有那个 `<a>`。

**`detail()` 工厂**是本文件既有的辅助（既有注释写明它是为了避免字面量漏字段导致
typecheck 失败），用它加 overrides 即可，不要另造一个。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/pages/WorkDetailPage.test.tsx`

Expected: FAIL —— 详情页没有参数行，也没有自动导航。

- [ ] **Step 3: 加参数展示与自动导航**

`src/pages/WorkDetailPage.tsx`：把 import 区补上

```tsx
import { useEffect, useState } from 'react';
import { formatAssemblyHours } from '@/pipeline/timeEstimate';
```

在组件里、`if (loading)` 之前插入一个 hook（**必须在所有 early return 之前调用**，否则违反 Hooks 规则）：

```tsx
  const missing = error !== null || (!loading && work === null);

  /**
   * 拿不到作品时自动跳回列表。
   *
   * 用 replace 而不是赋值 location.href：无效详情页不应该堆进浏览器历史，
   * 否则用户按「后退」会被反复弹回这里。
   *
   * 保留 800ms 提示：直接跳走会让人以为点了没反应；0 延迟则提示根本来不及渲染。
   */
  useEffect(() => {
    if (!missing) return;
    const t = window.setTimeout(() => window.location.replace('/works'), 800);
    return () => window.clearTimeout(t);
  }, [missing]);
```

把 `if (error || !work) {` 那段的文案改成：

```tsx
  // 404 / 未过审 / 已下架返回同样的文案：区分开等于告诉访客这个 id 曾经存在过。
  if (error || !work) {
    return (
      <div className="app works-detail">
        <SiteNav current={`/works/${id}`} />
        <div
          className="works-detail-state works-detail-state--error"
          role="status"
          aria-live="polite"
        >
          <p>作品不存在或已下架，正在返回作品库…</p>
        </div>
      </div>
    );
  }
```

（原来那个 `<a className="works-detail-btn" href="/works">返回作品库</a>` 删掉 —— 现在是自动导航，按钮多余。）

把详情页的 `works-detail-facts` 那个 `<dl>` 补上四项：

```tsx
          <dl className="works-detail-facts">
            <div>
              <dt>成品尺寸</dt>
              <dd>{work.width > 0 && work.height > 0 ? `${work.width} × ${work.height}` : '未知'}</dd>
            </div>
            <div>
              <dt>文件体积</dt>
              <dd>{formatBytes(work.bytes)}</dd>
            </div>
            {/* 2026-10-17 投稿参数。缺省全 0 是合法状态（旧数据没这些列），
                显示「—」而不是 0 或 NaN —— 「0 颗豆子」会被当成一张空图。 */}
            <div>
              <dt>图纸比例</dt>
              <dd>{work.boardW > 0 && work.boardH > 0 ? `${work.boardW} × ${work.boardH} 格` : '—'}</dd>
            </div>
            <div>
              <dt>豆子数量</dt>
              <dd>{work.beanCount > 0 ? `${work.beanCount.toLocaleString()} 颗` : '—'}</dd>
            </div>
            <div>
              <dt>颜色数量</dt>
              <dd>{work.colorCount > 0 ? `${work.colorCount} 种` : '—'}</dd>
            </div>
            <div>
              <dt>预估时间</dt>
              <dd>{work.estimateMinutes > 0 ? formatAssemblyHours(work.estimateMinutes / 60) : '—'}</dd>
            </div>
          </dl>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/pages/WorkDetailPage.test.tsx`

Expected: PASS —— 既有用例 + 新增 4 个全绿。

- [ ] **Step 5: 提交**

```bash
git add src/pages/WorkDetailPage.tsx src/pages/WorkDetailPage.test.tsx
git commit -m "feat(详情页): 展示投稿图纸参数 + 拿不到作品自动跳回列表

参数全 0 是合法状态（旧数据没有这些列），显示「—」而不是 0 —— 「0 颗豆子」
会被访客当成一张空图。

导航用 location.replace 而不是赋值 location.href：无效详情页不该堆进浏览器
历史，否则用户按「后退」会被反复弹回这里。800ms 延迟是为了让提示来得及读完。"
```

---

### Task 14: 一次性清库脚本

**Files:**
- Create: `scripts/reset-gallery.mjs`
- Modify: `package.json`（加 `reset:gallery` 脚本）

**Interfaces:**
- Produces: `node scripts/reset-gallery.mjs`，退出码 0 = 成功，1 = 失败

- [ ] **Step 1: 实现脚本**

创建 `scripts/reset-gallery.mjs`：

```js
#!/usr/bin/env node
/**
 * 一次性清空作品库（2026-10-17 作品来源切换时用）。
 *
 * **会永久删除**：works 表全部行 + <DATA_DIR>/media/works/ 下所有文件。
 * 之所以敢做，是因为脚本第一步就是备份 stats.db；确认线上没问题后可以自己删掉 .bak。
 *
 * 用法：
 *   node scripts/reset-gallery.mjs
 *   PINGDOU_DATA_DIR=/var/lib/pingdou node scripts/reset-gallery.mjs
 *
 * 只依赖已在 dependencies 里的 sql.js，不新增任何包 —— 这是一次性运维脚本，
 * 不值得为它往生产依赖里塞东西。
 */

import {
  copyFileSync, existsSync, readdirSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import initSqlJs from 'sql.js';

const DATA_DIR = resolve(process.env.PINGDOU_DATA_DIR?.trim() || '/var/lib/pingdou');
const DB_PATH = join(DATA_DIR, 'stats.db');
const WORKS_DIR = join(DATA_DIR, 'media', 'works');

function fail(msg) {
  console.error(`[reset-gallery] ${msg}`);
  process.exit(1);
}

if (!existsSync(DB_PATH)) fail(`找不到 ${DB_PATH}，确认 PINGDOU_DATA_DIR 是否正确`);

// 1. 先备份 —— 任何删除动作之前必须成功生成备份，否则直接退出
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${DB_PATH}.bak-${stamp}`;
try {
  copyFileSync(DB_PATH, backupPath);
  const size = statSync(backupPath).size;
  if (size === 0) fail(`备份文件是空的：${backupPath}`);
  console.log(`[reset-gallery] 已备份 ${DB_PATH} → ${backupPath}（${size} 字节）`);
} catch (err) {
  fail(`备份失败，已中止，没有任何东西被删除：${err.message}`);
}

const SQL = await initSqlJs({
  locateFile: (file) => resolve(process.cwd(), 'node_modules/sql.js/dist', file),
});
const db = new SQL.Database(new Uint8Array(readFileSync(DB_PATH)));

// 2. 清表
let rows = 0;
try {
  rows = db.exec('SELECT COUNT(*) FROM works')[0].values[0][0];
} catch {
  fail('works 表不存在，库里可能还没有作品库功能，无需清理');
}
db.exec('DELETE FROM works');
db.exec('DROP TABLE IF EXISTS work_likes');
console.log(`[reset-gallery] 已删除 works 表 ${rows} 行`);

// 3. 删文件
let files = 0;
let bytes = 0;
if (existsSync(WORKS_DIR)) {
  for (const name of readdirSync(WORKS_DIR)) {
    const p = join(WORKS_DIR, name);
    try {
      bytes += statSync(p).size;
      rmSync(p, { force: true, recursive: true });
      files++;
    } catch (err) {
      console.warn(`[reset-gallery] 跳过 ${name}：${err.message}`);
    }
  }
} else {
  console.log(`[reset-gallery] ${WORKS_DIR} 不存在，跳过文件清理`);
}
console.log(`[reset-gallery] 已删除 ${files} 个文件，释放 ${(bytes / 1024 / 1024).toFixed(1)} MB`);

// 4. 把清空后的库写回
writeFileSync(DB_PATH, Buffer.from(db.export()));
db.close();

console.log(`[reset-gallery] 完成。确认线上没问题后可以删除 ${backupPath}`);
```

- [ ] **Step 2: 加 npm 脚本**

`package.json` 的 `scripts` 里加一行：

```json
    "reset:gallery": "node scripts/reset-gallery.mjs",
```

- [ ] **Step 3: 在临时目录里跑一遍验证**

```bash
mkdir -p /tmp/pingdou-reset-test/media/works
PINGDOU_DATA_DIR=/tmp/pingdou-reset-test node -e "
const {writeFileSync}=require('fs');
writeFileSync('/tmp/pingdou-reset-test/stats.db','');
"
```

这一条只是确认脚本能启动。更实际的验证是在开发环境的临时 DATA_DIR 上手动跑一次并核对输出行数。

Run: `node -c "1" 2>/dev/null; node --check scripts/reset-gallery.mjs`

Expected: 无输出（语法检查通过）。

- [ ] **Step 4: 提交**

```bash
git add scripts/reset-gallery.mjs package.json
git commit -m "feat(脚本): 一次性清空作品库

任何删除动作之前先备份 stats.db，备份为空或失败就中止 —— 这是不可逆操作，
没有备份的「一键清空」不敢用。脚本提交进仓库而不是手敲 SQL：可审计、可重跑。"
```

---

### Task 15: 文档

**Files:**
- Modify: `README.md`（「作品库」章节 + 新增「投稿与审核」章节）
- Modify: `docs/DEPLOY.md`（加清库脚本的运行说明）

- [ ] **Step 1: 改 README 的「作品库」章节**

删掉「后台上传」那一段（`README.md` 约 200-201 行），替换为：

```markdown
- **进货渠道**：作品全部来自**用户投稿**（生成页参数面板下方），不再有后台上传入口。
  投稿先进待审核队列，站主通过后才出现在公开列表里。
- **上下架**：只有 `published=1` 且 `status='approved'` 的作品出现在公开列表和详情里。
  `GET /api/admin/works` 的响应比公开 detail 多 `published` 与 `status` 两个字段
  （服务端 `toAdminDetail` 单独序列化），公开接口**不带**这两个字段。
```

把「存储」那段之前插入：

```markdown
- **二维码**：导出图的二维码是**构建期**生成的静态码，指向 `/works` 列表页；
  投稿图的二维码是**运行时**生成的，指向 `/works/:id`，扫描直达这一件作品。
  两者共用同一个 `drawWorksQr`。
```

- [ ] **Step 2: 新增「投稿与审核」章节**

在「作品库」章节之后、「统计功能」之前插入：

```markdown
## 投稿与审核

访客在生成页填完参数后点「投稿」，填一个名称即可提交。投稿图**就是用户屏幕上
那张图** —— 直接吃 `PipelineResult` 渲染，不重新采样，所以预览与投稿永远一致。

- **两步入库**：先 POST 元数据（名称 + 四个图纸参数）拿 `id` 与一次性
  `uploadToken`，再用 `id` 生成二维码画进已预留白带的画布，最后上传带码成品图。
  白带高度在渲染时就固定成 111px（version 3 / ECC L / 静区 4 的二维码正好
  111×111，模块边长是整数 3px）。
- **`id` 可猜，所以第二步必须校验 `uploadToken`**。`works.id` 是自增整数，
  只靠它的话任何人都能把图挂到别人的待审记录上。令牌是 128 位随机值，
  写入图片后随同 `image_key` 在同一条 `UPDATE` 里清空。
- **投稿参数**：图纸比例（格数）、豆子数量、颜色数量、预估工时（存**分钟数**，
  展示时现算文案）。这四项既用于后台审核，也用于作品详情页展示。
- **配额**：每个 IP + 每个浏览器每天 3 件，指纹与点赞同一套口径（IP + UA + 日期 +
  同一个盐），只在进程内计数、跨天轮转，`works` 表不落任何 IP 派生数据。
  **重启当日配额清零** —— 与点赞去重同一前提，横向扩展需换 Redis。
- **审核态**：`pending → approved` / `pending → rejected`，另有与审核正交的
  `published` 上下架。拒绝时**物理删除源文件**（原图与缩略图），`image_key`
  字符串保留在库里作审计线索。
- **硬不变量**：`published=1` 必须伴随 `status='approved'`（后台 PUT 想上架未过审的
  作品返回 400）。公开列表与详情另有 `AND status='approved'` 的显式过滤，
  不依赖上面那条不变量成立。
- **未过审 / 已下架 / 不存在的 id**：`GET /api/public/works/:id` 一律 404（不区分三者，
  避免用状态码探测），详情页 800ms 后自动 `location.replace('/works')`。

API：
- `POST /api/public/works` — 投稿第一步，`201 { id, uploadToken }`；参数非法 400，
  当日额度用尽 429
- `POST /api/public/works/:id/image` — 投稿第二步，multipart（`image` + `thumb` +
  `uploadToken` + `width` + `height`），`200 { ok, id }`
- `POST /api/admin/works/:id/approve` / `POST /api/admin/works/:id/reject` — 审核（需 admin）
- `GET /api/admin/works?status=pending|approved|rejected|all` — 后台列表（需 admin）

非目标：用户侧没有投稿查询入口与结果通知，投稿不可编辑不可撤回。
```

- [ ] **Step 3: 改 DEPLOY.md**

在 `docs/DEPLOY.md` 的「运行时数据管理」一节末尾追加：

```markdown
### 一次性清空作品库（2026-10-17 作品来源切换）

作品来源从「后台上传」换成了「用户投稿」，存量图库需要物理清空：

```bash
cd /root/project/pingdou
PINGDOU_DATA_DIR=/var/lib/pingdou node scripts/reset-gallery.mjs
```

脚本会**先备份** `stats.db`（备份为空或失败就直接中止，不删任何东西），
然后清空 `works` 表并删除 `media/works/` 下的所有文件，最后打印备份路径。

> 部署新版本后、脚本跑之前，作品库会显示为空 —— 这是预期行为，不是故障：
> 老行被 `ensureColumn` 补成了 `status='pending'`，被公开查询的
> `AND status='approved'` 全部挡住。脚本的作用只是把这批已经不可见的行和
> 它们的文件从磁盘上物理清掉。

确认线上没问题后可以把 `stats.db.bak-*` 删掉。
```

- [ ] **Step 4: 跑一次完整回归并提交**

Run: `npm test && npm run typecheck && npm run build`

Expected: 全绿，构建产物 `dist/` 里含新代码。

```bash
git add README.md docs/DEPLOY.md
git commit -m "docs: 补投稿与审核章节，改写作品库的后台上传段落

把「后台上传」那一段换成投稿流程说明，并写清三个容易踩的点：两步入库、
uploadToken 为什么必须校验（id 可猜）、配额重启清零的前提。"
```

---

## 自审

**1. Spec 覆盖**

| Spec 章节 | 实现任务 |
| --- | --- |
| §1.3 范围内（7 列 / 2 公开接口 / 2 后台接口 / 配额 / 前端按钮 / qr 能力 / 渲染 / WorksTab / 详情页 / 清库脚本 / package.json / 文档） | 1、3、4、5、6、8、9、11、12、13、14、15 |
| §2.2 三条硬不变量 | 2（②）、5（①）、12（③） |
| §2.3 为什么单表 | 1（schema 不拆表） |
| §3.2 字段语义 | 1 |
| §3.3 迁移策略 | 1（含「不回填 approved」的说明） |
| §3.4 公开查询改动 | 2 |
| §3.5 索引影响 | 1 |
| §4.1 指纹与计数 | 3 |
| §4.2 不加令牌桶 | 6（提交信息里写明理由）、11（两步时序） |
| §4.3 已知弱点 | 3（注释）、15（README） |
| §5.1 第一步契约 | 4、6 |
| §5.2 第二步契约 | 4、6 |
| §5.3 后台接口 | 5、6 |
| §5.4 删除上传接口的理由 | 7 |
| §6.1 按钮位置 | 11 |
| §6.2 弹窗内容 | 11 |
| §6.3 两步时序 | 11（+ Task 10 的白带预留） |
| §6.4 渲染函数提取 | 10（**已修订**，见 Global Constraints） |
| §6.5 qrcode 搬家 | 9 |
| §7.1 WorksTab 改造 | 12 |
| §7.2 详情页自动导航 | 13 |
| §8 文件清单 | 全部 |
| §9 一次性清库 | 14 |
| §10 测试策略 | 各任务内联 |
| §11 已知取舍 | 3（11.2）、4（11.4）、12（11.2）、13（11.3） |

无遗漏。

**2. 与 spec 的两处偏离**（都在计划里显式标注了）

- **§6.4 改为新增 `submission.ts`**，不重构 `exportMulti`。理由：`PipelineResult.indices` 已是最终图纸，重复的只有 6 行而非 50 行，且不动工作热路径。
- **§5.2 增加了 `width` / `height` 两个 multipart 字段**。原 spec 的第二步 payload 只有 `image` / `thumb` / `uploadToken`，但 `works.width/height` 是详情页「成品尺寸」和 `<img>` 固有比例的依据（防布局跳动），缺了会退化成「未知」。浏览器从 canvas 上直接读得到，成本为零。

**3. 类型一致性核对**

- `WorkStatus` 在 `server/works.ts` 与 `src/api/works.ts` 各定义一份（仓库既有惯例，两边都要改时同步）。
- `createSubmission(raw, client)` 在 Task 4 定义，Task 6 的路由按这个签名调用 —— 一致。
- `attachSubmissionImage(id, uploadToken, input)` 同上。
- `renderSubmissionComposite(palette, result)` 在 Task 10 定义，Task 11 按此调用 —— 一致。
- `renderSubmissionQr(id, origin?)` 在 Task 9 定义，Task 11 按此调用 —— 一致。
- `SUBMISSION_QR_PX` 在 Task 9 定义，被 Task 10、Task 11 的测试引用 —— 一致。
- `makeApprovedWork(works, opts)` 在 Task 7 定义，被 Task 7 的五个既有测试文件引用 —— 一致。

**4. 已知需要在实施中就地确认的两点**（已在对应步骤里标出）

- Task 5 Step 5：有一条用例把 `rejectWork` 之后的 `listAllWorks()` 长度写成 0，实际应为 1（拒绝保留行，彻底删除由 `DELETE` 负责）—— 步骤里已给出修正。
- Task 11 Step 3：初稿的 `estimateMinutesOf` 是自己算速率的占位实现，必须删掉改用 props 传入的分钟数，否则会与 `timeEstimate.ts` 的真实口径漂移 —— 步骤里已标出。

**5. 占位符扫描**

计划中无 TBD / TODO /「类似 Task N」/「实现适当的错误处理」等表述。所有代码步骤都给出了可直接粘贴的完整代码。
