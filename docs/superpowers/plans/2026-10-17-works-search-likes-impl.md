# 作品库搜索 + 点赞 + 可切换排序 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给公开作品库加标题模糊搜索、每 IP 每图每天一次的幂等点赞、以及「最新/最热」可切换排序。

**Architecture:** 后端在现有 `listPublishedWorks` 上加 `q`/`sort` 两个可选参数（`total` 的 COUNT 与 WHERE 严格一致），点赞走独立的 `work_likes` 表 + 复合主键做幂等，读取用 `LEFT JOIN` 一次聚合避免 N+1。前端在 `useWorks` 上加 `query`/`sort` 状态（300ms 防抖 + 请求序号防乱序），搜索词与排序同步进 URL query string。

**Tech Stack:** Node + Express + sql.js（后端，`.js` 后缀导入）、React 18 + TypeScript + Vitest + Testing Library（前端，`@/` 别名）。

**Spec:** `docs/superpowers/specs/2026-10-17-works-search-likes-design.md` —— 执行者必须同时读 spec 与本计划，spec 是设计权威。

---

## Global Constraints

以下约束适用于**每一个**任务，不再逐条重复：

- **分支**：`feat/qr-download-gallery`，基线 commit `538ceae`
- **commit message 用中文**，格式 `feat(范围): 简述` / `test(范围): 简述` / `fix(范围): 简述`
- **后端 TS 导入必须带 `.js` 后缀**（ESM）：`await import('../../../server/db.js')`
- **前端导入用 `@/` 别名**
- **绝不修改 `events` / `sessions` 表的 ip_hash 语义**（那里存的是明文 IP，是既有统计口径，改动有回归风险）
- **`work_likes.ip_hash` 存真 sha256 hash**，与上述两处**同名不同义**，代码注释必须写明
- **每页 10 条**（原 20），保留「加载更多」按钮，**不做无限滚动**
- **排序是 `sort=hot`（用户可选）**；`sort=latest` 是默认值，行为与现状完全一致
- **点赞不支持取消**；同一 IP 对同一张图每天限一次
- **展示文案是「N 次点赞」，绝不写「N 人喜欢」**（同 IP 次日可再赞，写人数会误导）
- **移动端触摸区 ≥44px**
- **验证命令**：`npm test`（全量，基线 **551 passed / 68 files**）、`npm run typecheck`、`npm run build`
- **TS 导入带 `.js` 后缀；前端不装新依赖**

### 已知局限（必须留档，禁止「顺手修掉」）

1. **offset 分页在按热度排序时会漏图**：每次点赞都改变排名，`offset=items.length`
   会跳过被挤下去的条目。Task 7 的 id 去重只能挡重复、挡不住跳过。已由用户明确接受。
   根治需游标分页 `WHERE (likes, created_at, id) < (?,?,?)`，当前作品量级不值得。
   **代码注释里必须写明这是已知取舍。**
2. **令牌桶仅单进程有效**：当前是 systemd 单进程部署，合理。多进程需换 Redis。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| `server/db.ts` | 新增 `work_likes` 表 DDL；`isoDay` 复用 |
| `server/works.ts` | 列表查询加 `q`/`sort`；点赞读写；`escapeLike`；`ipHashOf` |
| `server/index.ts` | 列表路由透传参数；2 条 like 路由；内存令牌桶 |
| `src/api/works.ts` | `listWorks` 加 opts；`likeWork` / `fetchLikeState` |
| `src/hooks/useWorks.ts` | `query`/`sort` + 防抖 + 序号防乱序 |
| `src/pages/WorksListPage.tsx` / `.css` | 搜索框、排序切换、点赞按钮、两类空状态 |
| `src/pages/WorkDetailPage.tsx` / `.css` | 点赞按钮 |
| `src/router.ts` | `parseListQuery(search)` 解析初值 |
| `tests/unit/server/works-likes.test.ts` | 新建：点赞数据层测试 |
| `tests/unit/server/works-search.test.ts` | 新建：搜索 + 排序测试 |
| `src/hooks/useWorks.test.ts` | 新建：hook 测试（乱序防护） |

**类型定义**（Task 3 产生，后续任务依赖）：

```ts
// server/works.ts
export interface WorkSummary {
  id: number; title: string; thumbUrl: string;
  width: number; height: number; createdAt: number;
  likes: number;          // 新增
}
export type WorkSort = 'latest' | 'hot';
export interface ListWorksOptions { limit: number; offset: number; q?: string; sort: WorkSort; }
export interface LikeState { likes: number; liked: boolean; }

// src/api/works.ts —— 前端镜像（与 server/works.ts 字段一致）
export interface WorkSummary { /* 同上 */ }
```

---

### Task 1: `work_likes` 表 + 点赞数据层

**Files:**
- Modify: `server/db.ts`（在 `works` 表 DDL 之后加 `work_likes`）
- Modify: `server/works.ts`
- Test: `tests/unit/server/works-likes.test.ts`（新建）

**Interfaces:**
- Consumes: `db.ts` 的 `queryAll<T>`、`isoDay(ts)`、`flushNow()`
- Produces:
  - `server/works.ts`: `ipHashOf(ip: string): string`、`escapeLike(s: string): string`
  - `server/works.ts`: `addLike(workId: number, ipHash: string, now?: number): LikeState`
  - `server/works.ts`: `likeStateOf(workId: number, ipHash: string): LikeState`
  - `server/works.ts`: `LikeState = { likes: number; liked: boolean }`
  - `server/db.ts`: 表 `work_likes(work_id, day, ip_hash, created_at)`，PK `(work_id, day, ip_hash)`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/server/works-likes.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp = '';
let works: typeof import('../../../server/works.js');
let db: typeof import('../../../server/db.js');

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'works-likes-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  const dbMod = await import('../../../server/db.js');
  await dbMod.initDb();
  db = dbMod;
  works = await import('../../../server/works.js');
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

/** 建一件已上架作品，返回 id */
function seedWork(title = '小熊'): number {
  const created = works.createWorkSync({
    title,
    image: { body: Buffer.from([1, 2, 3]), mime: 'image/png' },
  });
  return created.id;
}

describe('ipHashOf', () => {
  it('同 IP 稳定、不同 IP 不同', () => {
    expect(works.ipHashOf('1.2.3.4')).toBe(works.ipHashOf('1.2.3.4'));
    expect(works.ipHashOf('1.2.3.4')).not.toBe(works.ipHashOf('1.2.3.5'));
  });

  it('不泄露明文 IP（输出是固定长度 hex）', () => {
    const h = works.ipHashOf('203.0.113.7');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain('203');
  });
});

describe('addLike 幂等', () => {
  it('首次点赞 liked=true、计数 1', () => {
    const id = seedWork();
    expect(works.addLike(id, 'iphash-a')).toEqual({ likes: 1, liked: true });
  });

  it('同一 IP 同一天重复点赞 liked=false、计数不变', () => {
    const id = seedWork();
    works.addLike(id, 'iphash-a');
    expect(works.addLike(id, 'iphash-a')).toEqual({ likes: 1, liked: false });
    expect(works.addLike(id, 'iphash-a')).toEqual({ likes: 1, liked: false });
  });

  it('不同 IP 可以各赞一次', () => {
    const id = seedWork();
    works.addLike(id, 'iphash-a');
    works.addLike(id, 'iphash-b');
    expect(works.likeStateOf(id, 'iphash-b')).toEqual({ likes: 2, liked: true });
  });

  it('同 IP 对不同作品可以各赞一次', () => {
    const a = seedWork('A');
    const b = seedWork('B');
    expect(works.addLike(a, 'iphash-x').liked).toBe(true);
    expect(works.addLike(b, 'iphash-x').liked).toBe(true);
  });

  it('跨天可以再次点赞（计数累加到 2）', () => {
    const id = seedWork();
    works.addLike(id, 'iphash-a', Date.parse('2026-10-17T10:00:00Z'));
    const next = works.addLike(id, 'iphash-a', Date.parse('2026-10-18T10:00:00Z'));
    expect(next).toEqual({ likes: 2, liked: true });
  });
});

describe('likeStateOf', () => {
  it('未点赞时 liked=false、计数 0', () => {
    const id = seedWork();
    expect(works.likeStateOf(id, 'iphash-z')).toEqual({ likes: 0, liked: false });
  });

  it('读操作不改变计数（幂等读取）', () => {
    const id = seedWork();
    works.addLike(id, 'iphash-a');
    works.likeStateOf(id, 'iphash-a');
    works.likeStateOf(id, 'iphash-a');
    expect(works.likeStateOf(id, 'iphash-a').likes).toBe(1);
  });
});

describe('DB 里不落明文 IP', () => {
  it('work_likes.ip_hash 存的是 hash 不是明文', () => {
    const id = seedWork();
    const raw = '203.0.113.99';
    works.addLike(id, works.ipHashOf(raw));
    const rows = db.queryAll<{ ip_hash: string }>('SELECT ip_hash FROM work_likes');
    expect(rows[0]?.ip_hash).not.toBe(raw);
    expect(rows[0]?.ip_hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
```

> **注意**：`seedWork` 用的是 `createWorkSync`。若 `createWork` 仍是 async，请改用
> `await works.createWork({...})` 并把 `seedWork` 改成 async、`it` 回调改 async。
> 实施者必须先读 `server/works.ts` 的 `createWork` 实际签名再定稿。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/works-likes.test.ts`
Expected: FAIL —— `ipHashOf` / `addLike` / `likeStateOf` 不存在

- [ ] **Step 3: 加 `work_likes` 表**

在 `server/db.ts` 的 `works` 表 DDL（含 `idx_works_published_created`）之后插入：

```ts
    -- 点赞：每 IP 对每张图每天限一次（用户已确认不支持取消）
    -- 复合主键即幂等保证，不需要「先查后插」；跨天是新 key，
    -- 因此不需要定时任务清理，也不需要 active 列。
    CREATE TABLE IF NOT EXISTS work_likes (
      work_id    INTEGER NOT NULL,
      day        TEXT    NOT NULL,
      ip_hash    TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (work_id, day, ip_hash)
    );
```

- [ ] **Step 4: 实现点赞数据层**

在 `server/works.ts` 追加（`createHash` 从 `node:crypto` 导入，文件已可能导入过 `randomBytes`，实施者核对后合并）：

```ts
/**
 * 点赞用的 IP hash —— 与 events.ip_hash / sessions.ip_hash **同名不同义**。
 *
 * 那两列字段名带 hash，但实际存的是明文 IP（server/index.ts 的 trackEvent 直接把
 * req.clientIp 传进去），那是统计模块的既有口径，本项目不去动它。
 * 点赞表是新表，且没有任何回溯真实 IP 的需求，所以这里存真 hash。
 *
 * 盐取站点域名，防止彩虹表反查。
 */
const WORKS_IP_SALT = 'https://www.xn--muu023g.xyz/';

export function ipHashOf(ip: string): string {
  return createHash('sha256')
    .update(`${ip}:${WORKS_IP_SALT}`)
    .digest('hex')
    .slice(0, 16);
}

export interface LikeState {
  likes: number;
  liked: boolean;
}

/** 该作品今天的总赞数 */
function countLikes(workId: number): number {
  const rows = queryAll<{ c: number }>(
    `SELECT COUNT(*) AS c FROM work_likes WHERE work_id = ?`,
    [workId]
  );
  return rows[0]?.c ?? 0;
}

/**
 * 点赞。幂等由复合主键保证。
 *
 * 用 `INSERT OR IGNORE ... RETURNING` 而不是「先 SELECT 再判断」：前者是单语句、
 * 并发安全（两个并发请求不会都判定为新赞），且返回行数直接就是「新赞还是重复赞」。
 * 选它而不是读 db.changes，是因为本仓库的 runStmt() 返回 void，拿不到受影响行数；
 * queryAll() 则是现成的通用读接口，零改动即可复用。
 *
 * 注意语义：同一 IP 次日可以再给同一张图点赞，计数会累加 —— 这是「热度」而非「人数」，
 * 前端文案必须是「N 次点赞」而不是「N 人喜欢」。
 */
export function addLike(workId: number, ipHash: string, now: number = Date.now()): LikeState {
  const inserted = queryAll(
    `INSERT OR IGNORE INTO work_likes (work_id, day, ip_hash, created_at)
     VALUES (?, ?, ?, ?) RETURNING work_id`,
    [workId, isoDay(now), ipHash, now]
  ).length > 0;
  return { likes: countLikes(workId), liked: inserted };
}

/** 只读不改。GET 与 POST 共用它，保证两条路由的口径一致。 */
export function likeStateOf(workId: number, ipHash: string, now: number = Date.now()): LikeState {
  const rows = queryAll(
    `SELECT 1 AS ok FROM work_likes WHERE work_id = ? AND day = ? AND ip_hash = ?`,
    [workId, isoDay(now), ipHash]
  );
  return { likes: countLikes(workId), liked: rows.length > 0 };
}
```

`isoDay` 从 `./db.js` 导入（若尚未导入则补上）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/works-likes.test.ts`
Expected: PASS

- [ ] **Step 6: 变异验证（必做）**

| 变异 | 预期 |
| --- | --- |
| `RETURNING work_id` 删掉 | 「重复点赞 liked=false」用例红 |
| `day` 换成常量 `'2026-01-01'` | 「跨天可以再次点赞」用例红 |
| `liked` 恒返回 `true` | 「重复点赞」用例红 |
| `ipHashOf` 去掉盐 | 「不同 IP 不同」用例红（若能构造碰撞） |

每次变异后立刻 `git checkout -- server/works.ts` 还原，最后 `git diff` 确认干净。
**若某变异杀不死用例，如实写「这条没有判别力」，不得粉饰。**

- [ ] **Step 7: 提交**

```bash
git add server/db.ts server/works.ts tests/unit/server/works-likes.test.ts
git commit -m "feat(点赞): work_likes 表 + 幂等点赞数据层（复合主键 + RETURNING）"
```

---

### Task 2: 搜索与排序（数据层）

**Files:**
- Modify: `server/works.ts`（`listPublishedWorks`）
- Test: `tests/unit/server/works-search.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `escapeLike` 未定义 → **本任务内定义** `escapeLike`
- Produces:
  - `server/works.ts`: `export type WorkSort = 'latest' | 'hot'`
  - `server/works.ts`: `escapeLike(s: string): string`
  - `server/works.ts`: `listPublishedWorks(opts: { limit: number; offset: number; q?: string; sort: WorkSort }): { items: WorkSummary[]; total: number }`

> **签名变更**：从 `(limit: number, offset: number)` 改为接受 options 对象。
> Task 3 会同步改调用方，本任务只改数据层并更新既有测试调用。

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/server/works-search.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp = '';
let works: typeof import('../../../server/works.js');

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'works-search-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  const db = await import('../../../server/db.js');
  await db.initDb();
  works = await import('../../../server/works.js');
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

async function seed(title: string, published = true) {
  return works.createWork({
    title,
    published,
    image: { body: Buffer.from([1, 2, 3]), mime: 'image/png' },
  });
}

const list = (o: Partial<Parameters<typeof works.listPublishedWorks>[0]> = {}) =>
  works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest', ...o });

describe('escapeLike', () => {
  it('转义 % _ 和反斜杠', () => {
    expect(works.escapeLike('50%')).toBe('50\\%');
    expect(works.escapeLike('a_b')).toBe('a\\_b');
    expect(works.escapeLike('c\\d')).toBe('c\\\\d');
  });

  it('普通字符不动', () => {
    expect(works.escapeLike('粉色小熊')).toBe('粉色小熊');
  });
});

describe('搜索', () => {
  it('q 按标题模糊匹配', async () => {
    await seed('粉色小熊');
    await seed('蓝色小熊');
    const r = await list({ q: '小熊' });
    expect(r.total).toBe(2);
  });

  it('q 只匹配标题，不匹配描述', async () => {
    await works.createWork({
      title: '甲',
      description: '这里有小熊',
      image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    await seed('乙');
    expect((await list({ q: '小熊' })).total).toBe(0);
  });

  it('total 与过滤后的结果一致（不是全表计数）', async () => {
    await seed('粉色小熊');
    await seed('蓝色小熊');
    await seed('绿色小猪');
    const r = await list({ q: '小熊' });
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(2);
  });

  it('q 空串等价于不搜索', async () => {
    await seed('甲');
    await seed('乙');
    expect((await list({ q: '' })).total).toBe(2);
    expect((await list({ q: '  ' })).total).toBe(2);   // 纯空格视为无查询
  });

  it('搜不到时 total 为 0', async () => {
    await seed('甲');
    expect((await list({ q: '不存在的东西' })).total).toBe(0);
  });

  it('% 被当字面量而非通配符', async () => {
    await seed('折扣 50% 的图纸');
    await seed('无关作品');
    expect((await list({ q: '50%' })).total).toBe(1);
  });

  it('_ 被当字面量而非单字符通配符', async () => {
    await seed('a_b 图纸');
    await seed('axb 图纸');
    expect((await list({ q: 'a_b' })).total).toBe(1);
  });

  it('草稿永远搜不到', async () => {
    await seed('小熊', false);
    expect((await list({ q: '小熊' })).total).toBe(0);
  });
});

describe('排序', () => {
  it('latest 按创建时间倒序（现状行为）', async () => {
    await seed('先');
    await seed('后');
    const r = await list({ sort: 'latest' });
    expect(r.items[0]?.title).toBe('后');
  });

  it('hot 按点赞数倒序', async () => {
    const a = await seed('A'); const b = await seed('B'); const c = await seed('C');
    const h = works.ipHashOf;
    works.addLike(a, h('1')); works.addLike(a, h('2')); works.addLike(a, h('3'));
    works.addLike(b, h('1')); works.addLike(b, h('2'));
    works.addLike(c, h('1'));
    const r = await list({ sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['A', 'B', 'C']);
  });

  it('hot 下同赞数按创建时间倒序（确定性兜底）', async () => {
    const a = await seed('先'); const b = await seed('后');
    const h = works.ipHashOf;
    works.addLike(a, h('1')); works.addLike(b, h('2'));
    const r = await list({ sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['后', '先']);
  });

  it('点赞后重新排序，热图上浮', async () => {
    const a = await seed('A'); const b = await seed('B');
    const h = works.ipHashOf;
    works.addLike(a, h('1'));
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('A');
    works.addLike(b, h('1')); works.addLike(b, h('2'));
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('B');
    void a;
  });

  it('每条 summary 都带 likes 字段', async () => {
    const a = await seed('A');
    works.addLike(a, works.ipHashOf('1'));
    const r = await list();
    expect(r.items[0]?.likes).toBe(1);
  });

  it('搜索 + 排序可组合', async () => {
    const a = await seed('小熊A'); const b = await seed('小猪B');
    const h = works.ipHashOf;
    works.addLike(a, h('1'));
    works.addLike(b, h('1')); works.addLike(b, h('2'));
    const r = await list({ q: '小', sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['小猪B', '小熊A']);
  });
});

describe('分页', () => {
  it('limit 仍然钳到 [1,60]', async () => {
    for (let i = 0; i < 3; i++) await seed(`W${i}`);
    expect((await list({ limit: 0 })).items).toHaveLength(1);
    expect((await list({ limit: 999 })).items).toHaveLength(3);
  });

  it('offset 分页仍然工作', async () => {
    for (let i = 0; i < 5; i++) await seed(`W${i}`);
    const p1 = await list({ limit: 2, offset: 0 });
    const p2 = await list({ limit: 2, offset: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    // 已知局限（用户已接受）：hot 排序下点赞会改变排名，offset 分页可能漏图。
    // 这里只验证 latest（静态排序）下分页正确。
    expect(new Set([...p1.items, ...p2.items].map(i => i.id)).size).toBe(4);
  });
});
```

> **实现者注意**：`seed` / `list` 的 async 与否取决于 `createWork` 的实际签名。
> `createWork` 当前是 `async`（因为要写文件），所以用 `await`。
> 若测试出现 `Cannot read property of undefined` 之类，检查是否漏了 `await`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/works-search.test.ts`
Expected: FAIL —— `escapeLike` 不存在，`listPublishedWorks` 签名不匹配

- [ ] **Step 3: 改 `listPublishedWorks`**

替换 `server/works.ts` 里的 `listPublishedWorks`：

```ts
export type WorkSort = 'latest' | 'hot';

/**
 * LIKE 的元字符转义。用户搜 "50%" 必须按字面匹配，不能变成通配符扫全表。
 * 反斜杠自己也要转义，否则用户搜 "c\d" 会先被 \d 破坏掉。
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/** 一次 LEFT JOIN 把点赞数带出来，避免每条作品查一次（N+1） */
const LIKES_JOIN = `
  LEFT JOIN (
    SELECT work_id, COUNT(*) AS c FROM work_likes GROUP BY work_id
  ) l ON l.work_id = w.id`;

export function listPublishedWorks(opts: {
  limit: number;
  offset: number;
  q?: string;
  sort: WorkSort;
}): { items: WorkSummary[]; total: number } {
  const { limit, offset, sort } = opts;
  // 钳到 [1,60]。注意不能写 `Math.floor(limit) || 20`：limit=0 是「非法值要钳到
  // 最小值 1」，不是「没传值走默认 20」，`||` 会把 0 当成假值改成 20。
  const raw = Number.isFinite(limit) ? Math.floor(limit) : 20;
  const lim = Math.max(1, Math.min(60, raw));
  const off = Math.max(0, Math.floor(offset) || 0);

  // q 的 WHERE 与 total 的 COUNT 必须字面一致，否则 hasMore 会一直显示
  // （搜出 5 条但 total 是全表 200 条）。
  const q = (opts.q ?? '').trim().slice(0, 100);
  const where = q
    ? `WHERE w.published = 1 AND w.title LIKE ? ESCAPE '\\'`
    : `WHERE w.published = 1`;
  const likeParam = q ? `%${escapeLike(q)}%` : null;

  // 排序必须完全确定，否则每次请求顺序抖动会导致 React 重复 key、滚动跳变。
  // hot 的兜底链是 created_at 再 id —— 同赞数时先看谁更晚传，再按 id 定死。
  //
  // 已知取舍（用户已接受，非 bug）：hot 排序下每次点赞都会改变排名，
  // offset 分页因此可能跳过被挤下去的条目。Task 7 的 id 去重只能挡重复、挡不住跳过。
  // 根治要游标分页 WHERE (c, created_at, id) < (?, ?, ?)，当前作品量级不值得。
  const orderBy = sort === 'hot'
    ? `ORDER BY COALESCE(l.c, 0) DESC, w.created_at DESC, w.id DESC`
    : `ORDER BY w.created_at DESC, w.id DESC`;

  const rows = queryAll<WorkRow & { likes: number | null }>(
    `SELECT w.*, l.c AS likes
       FROM works w ${LIKES_JOIN}
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    likeParam === null ? [lim, off] : [likeParam, lim, off]
  );

  const totalRows = queryAll<{ total: number }>(
    `SELECT COUNT(*) AS total FROM works w ${where}`,
    likeParam === null ? [] : [likeParam]
  );

  return {
    items: rows.map(r => ({ ...toSummary(r), likes: r.likes ?? 0 })),
    total: totalRows[0]?.total ?? 0,
  };
}
```

同时给 `WorkSummary` 接口加 `likes: number`，并给 `toSummary` 补默认值
（`toSummary` 被 `getPublishedWork` 等复用，那些地方没有 join，必须给 0）：

```ts
export interface WorkSummary {
  id: number;
  title: string;
  thumbUrl: string;
  width: number;
  height: number;
  createdAt: number;
  /** 总点赞数。列表经 LEFT JOIN 带出；单条读取无 join 时为 0。 */
  likes: number;
}

function toSummary(row: WorkRow, likes = 0): WorkSummary {
  return {
    id: row.id,
    title: row.title,
    thumbUrl: storage.publicUrl(row.thumb_key || row.image_key),
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    likes,
  };
}
```

- [ ] **Step 4: 修既有测试的调用**

`tests/unit/server/works.test.ts` 与 `works-routes.test.ts` 里所有
`listPublishedWorks(20, 0)` 形式的调用，改成 `listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' })`。
`rg 'listPublishedWorks\('` 逐个核对。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/works-search.test.ts tests/unit/server/works.test.ts tests/unit/server/works-routes.test.ts tests/unit/server/works-likes.test.ts`
Expected: PASS

- [ ] **Step 6: 变异验证（必做）**

| 变异 | 预期 |
| --- | --- |
| `total` 的 COUNT 去掉 `where` 中的 q 条件 | 「total 与过滤后一致」用例红 |
| `ESCAPE '\\'` 删掉 | 「% 被当字面量」用例红 |
| `escapeLike` 直接 return 原串 | 同上红 |
| `hot` 的 orderBy 去掉 `created_at` | 「同赞数按创建时间倒序」用例红 |
| `hot` 的 orderBy 去掉 `id` | 排序不确定性用例可能红（不稳定变异，多跑几次） |
| `WHERE` 去掉 `published = 1` | 「草稿永远搜不到」用例红 |

- [ ] **Step 7: 提交**

```bash
git add server/works.ts tests/unit/server/works-search.test.ts tests/unit/server/works.test.ts tests/unit/server/works-routes.test.ts
git commit -m "feat(作品库): 列表支持标题模糊搜索 + 可切换排序 + 点赞数聚合"
```

---

### Task 3: 点赞 API + 令牌桶

**Files:**
- Modify: `server/index.ts`
- Test: `tests/unit/server/works-likes-routes.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `addLike` / `likeStateOf` / `ipHashOf`
- Consumes: Task 2 的新 `listPublishedWorks`
- Produces:
  - `POST /api/public/works/:id/like` → `{ ok: true, likes: number, alreadyLiked: boolean }`
  - `GET  /api/public/works/:id/like` → `{ likes: number, liked: boolean }`
  - `server/index.ts`: `allowLike(ip: string, now?: number): boolean`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/server/works-likes-routes.test.ts`，复用
`tests/unit/server/works-routes.test.ts` 里的 `bootApp()` / `loginAdmin()` / `mkdtempSync` 脚手架
（**照抄那个文件的 setup 段，不要重新发明**）：

```ts
// 顶部 import 与 setup 与 works-routes.test.ts 完全一致（mkdtempSync / supertest /
// beforeEach 起临时数据目录 / afterEach 清理 / bootApp / loginAdmin）
// 下面只列本文件特有的部分

/** XFF 是后端取真实 IP 的唯一来源，nginx 必须传（docs 有说明） */
function asIp(app: unknown, req: request.Test, ip: string) {
  return req.set('X-Forwarded-For', ip);
}

describe('POST /api/public/works/:id/like', () => {
  it('首次点赞返回 alreadyLiked=true、likes=1', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    const r = await asIp(app, request(app as never), '1.1.1.1')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, likes: 1, alreadyLiked: true });
  });

  it('同 IP 重复点赞：alreadyLiked=false 且 likes 不变', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    await asIp(app, request(app as never), '1.1.1.1').post(`/api/public/works/${w.id}/like`);
    const r = await asIp(app, request(app as never), '1.1.1.1')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.body).toEqual({ ok: true, likes: 1, alreadyLiked: false });
  });

  it('不同 IP 各计一次', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    await asIp(app, request(app as never), '1.1.1.1').post(`/api/public/works/${w.id}/like`);
    const r = await asIp(app, request(app as never), '2.2.2.2')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.body.likes).toBe(2);
  });

  it('草稿点赞返回 404（不给草稿刷数的入口）', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', published: false,
      image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    const r = await asIp(app, request(app as never), '1.1.1.1')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.status).toBe(404);
  });

  it('不存在的 id 返回 404', async () => {
    const { app } = await bootApp();
    const r = await asIp(app, request(app as never), '1.1.1.1')
      .post('/api/public/works/999999/like');
    expect(r.status).toBe(404);
  });

  it('不需要登录即可点赞（公开功能）', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    const r = await asIp(app, request(app as never), '1.1.1.1')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.status).toBe(200);
  });
});

describe('GET /api/public/works/:id/like', () => {
  it('返回当前 IP 的点赞状态，不改变计数', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    await asIp(app, request(app as never), '1.1.1.1').post(`/api/public/works/${w.id}/like`);
    const r = await asIp(app, request(app as never), '1.1.1.1')
      .get(`/api/public/works/${w.id}/like`);
    expect(r.body).toEqual({ likes: 1, liked: true });
    // 再读一次，确认读操作没有副作用
    const again = await asIp(app, request(app as never), '1.1.1.1')
      .get(`/api/public/works/${w.id}/like`);
    expect(again.body.likes).toBe(1);
  });

  it('别的 IP 看到 liked=false 但 likes 是总数', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    await asIp(app, request(app as never), '1.1.1.1').post(`/api/public/works/${w.id}/like`);
    const r = await asIp(app, request(app as never), '9.9.9.9')
      .get(`/api/public/works/${w.id}/like`);
    expect(r.body).toEqual({ likes: 1, liked: false });
  });
});

describe('令牌桶限流', () => {
  it('同一 IP 1 秒内第二次 POST 返回 429', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    const first = await asIp(app, request(app as never), '5.5.5.5')
      .post(`/api/public/works/${w.id}/like`);
    expect(first.status).toBe(200);
    const second = await asIp(app, request(app as never), '5.5.5.5')
      .post(`/api/public/works/${w.id}/like`);
    expect(second.status).toBe(429);
  });

  it('429 时不产生任何 DB 写入', async () => {
    const { app, works } = await bootApp();
    const db = await import('../../../server/db.js');
    const w = await works.createWork({
      title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    await asIp(app, request(app as never), '6.6.6.6').post(`/api/public/works/${w.id}/like`);
    const before = db.queryAll('SELECT * FROM work_likes').length;
    await asIp(app, request(app as never), '6.6.6.6').post(`/api/public/works/${w.id}/like`);
    const after = db.queryAll('SELECT * FROM work_likes').length;
    expect(after).toBe(before);
  });

  it('不同 IP 互不影响（桶按 IP 分开）', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' },
    });
    const a = await asIp(app, request(app as never), '7.7.7.7')
      .post(`/api/public/works/${w.id}/like`);
    const b = await asIp(app, request(app as never), '8.8.8.8')
      .post(`/api/public/works/${w.id}/like`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

describe('列表接口透传 q / sort', () => {
  it('?q= 过滤生效', async () => {
    const { app, works } = await bootApp();
    await works.createWork({ title: '粉色小熊', image: { body: Buffer.from([1]), mime: 'image/png' } });
    await works.createWork({ title: '蓝色小猪', image: { body: Buffer.from([1]), mime: 'image/png' } });
    const r = await request(app as never).get('/api/public/works?q=小熊');
    expect(r.body.total).toBe(1);
  });

  it('?sort=hot 按点赞排序', async () => {
    const { app, works } = await bootApp();
    const a = await works.createWork({ title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' } });
    const b = await works.createWork({ title: 'B', image: { body: Buffer.from([1]), mime: 'image/png' } });
    const h = works.ipHashOf;
    works.addLike(a, h('1')); works.addLike(a, h('2'));
    works.addLike(b, h('1'));
    const r = await request(app as never).get('/api/public/works?sort=hot');
    expect(r.body.items[0].title).toBe('A');
  });

  it('列表每项都带 likes', async () => {
    const { app, works } = await bootApp();
    const a = await works.createWork({ title: 'A', image: { body: Buffer.from([1]), mime: 'image/png' } });
    works.addLike(a, works.ipHashOf('1'));
    const r = await request(app as never).get('/api/public/works');
    expect(r.body.items[0].likes).toBe(1);
  });

  it('草稿不出现在列表里', async () => {
    const { app, works } = await bootApp();
    await works.createWork({ title: '草稿', published: false, image: { body: Buffer.from([1]), mime: 'image/png' } });
    const r = await request(app as never).get('/api/public/works');
    expect(r.body.total).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/works-likes-routes.test.ts`
Expected: FAIL —— 路由 404

- [ ] **Step 3: 实现令牌桶**

在 `server/index.ts` 的中间件区（`app.use((req,_res,next)=>{...clientIp...})` 之后）加：

```ts
/**
 * 点赞接口的进程内令牌桶：每 IP 每 1 秒最多 1 次。
 *
 * 为什么光靠主键不够：复合主键挡住了「重复插入」，但挡不住「同一 IP 疯狂 POST
 * 触发的写事务 + COUNT 查询」—— 那些请求照样会打到 DB。这里在进 DB 之前就掐掉，
 * 超了直接 429，一条 SQL 都不发。
 *
 * 已知局限（部署形态相关，勿当 bug 修）：只在单进程内有效。当前是 systemd 单进程
 * 跑一个 node，够用；将来横向扩展成多进程必须换成 Redis 之类的共享存储。
 */
const LIKE_RATE_LIMIT_MS = 1000;
const likeBuckets = new Map<string, number>();

export function allowLike(ip: string, now: number = Date.now()): boolean {
  // 顺手清理过期条目，防止 Map 无限增长（站主一个人点一天也就几十条，
  // 但恶意 IP 可以用大量伪造地址把 Map 撑大）
  if (likeBuckets.size > 4096) {
    for (const [k, t] of likeBuckets) {
      if (now - t > LIKE_RATE_LIMIT_MS * 10) likeBuckets.delete(k);
    }
  }
  const last = likeBuckets.get(ip) ?? 0;
  if (now - last < LIKE_RATE_LIMIT_MS) return false;
  likeBuckets.set(ip, now);
  return true;
}
```

- [ ] **Step 4: 实现两条路由**

放在现有 `app.get('/api/public/works/:id', ...)` **之后**（顺序重要：`/like`
必须在 `:id` 之后注册，否则 `works/:id` 会把 `like` 当成 id 吞掉）。

```ts
/**
 * 点赞状态查询。公开、无需登录 —— 与公开列表同一性质。
 * liked 需要回传 IP 才能判断，所以 POST 与 GET 共用同一个 likeStateOf。
 */
app.get('/api/public/works/:id/like', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!getPublishedWork(id)) return res.status(404).json({ error: 'not found' });
    const ip = (req as any).clientIp ?? 'unknown';
    return res.json(likeStateOf(id, ipHashOf(ip)));
  } catch (e) {
    console.error('[public/works/:id/like]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

app.post('/api/public/works/:id/like', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!getPublishedWork(id)) return res.status(404).json({ error: 'not found' });

    const ip = (req as any).clientIp ?? 'unknown';
    if (!allowLike(ip)) {
      // 限流时不碰 DB —— 这正是这道闸的意义
      return res.status(429).json({ error: 'too many likes, try again later' });
    }

    // addLike 幂等：重复点赞 liked=false 且计数不变
    const next = addLike(id, ipHashOf(ip));
    return res.json({ ok: true, likes: next.likes, alreadyLiked: next.liked });
  } catch (e) {
    console.error('[public/works/:id/like POST]', e);
    return res.status(500).json({ error: 'like failed' });
  }
});
```

补齐 import：`addLike`、`likeStateOf`、`ipHashOf`、`getPublishedWork`（后两个若已导入则不重复）。

- [ ] **Step 5: 列表路由透传参数**

替换现有 `app.get('/api/public/works', ...)`：

```ts
app.get('/api/public/works', (req, res) => {
  try {
    const limit = Number(req.query.limit || 10); // `?limit=`（空串）也要走默认值，?? 挡不住空串
    const offset = Number(req.query.offset ?? 0);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const sort = req.query.sort === 'hot' ? 'hot' : 'latest'; // 白名单，非法值回落 latest
    return res.json(listPublishedWorks({ limit, offset, q, sort }));
  } catch (e) {
    console.error('[public/works]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});
```

> **默认 limit 从 20 改成 10**（用户要求「一次最多渲染 10 条」）。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/works-likes-routes.test.ts tests/unit/server/works-routes.test.ts tests/unit/server/works.test.ts`
Expected: PASS

- [ ] **Step 7: 变异验证（必做）**

| 变异 | 预期 |
| --- | --- |
| `allowLike` 恒返回 true | 「429」用例红 |
| 429 分支删掉（先 allowLike 再忽略结果） | 「429」用例红 |
| POST 里用 `likeStateOf` 代替 `addLike` | 「首次点赞 alreadyLiked=true」红 |
| POST 不校验作品是否存在 | 「草稿点赞 404」红 |
| like 路由注册在 `:id` 之前 | 「草稿点赞 404」红（`like` 被当 id） |
| `sort` 白名单去掉（任意值都当 hot） | 「列表默认 latest」相关用例红 |

- [ ] **Step 8: 提交**

```bash
git add server/index.ts tests/unit/server/works-likes-routes.test.ts
git commit -m "feat(点赞): POST/GET like 接口 + 进程内令牌桶防刷"
```

---

### Task 4: 前端 API 层

**Files:**
- Modify: `src/api/works.ts`
- Test: `src/api/works.test.ts`（修改既有文件，追加 describe）

**Interfaces:**
- Consumes: Task 2 的 `WorkSort`
- Produces:
  - `src/api/works.ts`: `WorkSummary` 加 `likes: number`
  - `src/api/works.ts`: `export type WorkSort = 'latest' | 'hot'`
  - `src/api/works.ts`: `listWorks(limit?: number, offset?: number, opts?: { q?: string; sort?: WorkSort }): Promise<{ items: WorkSummary[]; total: number }>`
  - `src/api/works.ts`: `likeWork(id: number): Promise<{ ok: true; likes: number; alreadyLiked: boolean }>`
  - `src/api/works.ts`: `fetchLikeState(id: number): Promise<{ likes: number; liked: boolean }>`

- [ ] **Step 1: 写失败的测试**

在 `src/api/works.test.ts` 末尾追加（沿用文件里已有的 `mockFetch` / `ok()` / `beforeEach` 脚手架）：

```ts
describe('listWorks 的搜索与排序参数', () => {
  it('不带 opts 时 URL 与旧版完全一致', async () => {
    ok({ items: [], total: 0 });
    await listWorks();
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works?limit=20&offset=0', expect.anything());
  });

  it('传 q 时拼进 query', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { q: '小熊' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/works?limit=20&offset=0&q=%E5%B0%8F%E7%86%8A', expect.anything());
  });

  it('传 sort=hot 时拼进 query', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { sort: 'hot' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/works?limit=20&offset=0&sort=hot', expect.anything());
  });

  it('q 为空串时不拼（避免 URL 里出现裸 q=）', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { q: '' });
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works?limit=20&offset=0', expect.anything());
  });

  it('q 与 sort 同时传', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { q: '熊', sort: 'hot' });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('q=%E7%86%8A');
    expect(url).toContain('sort=hot');
  });

  it('q 含空格与中文时正确编码', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { q: '粉 色' });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('q=%E7%B2%89%20%E8%89%B2');
    expect(() => new URL(url, 'http://x')).not.toThrow();
  });
});

describe('likeWork', () => {
  it('POST 到正确的 URL 且不带 body', async () => {
    ok({ ok: true, likes: 1, alreadyLiked: true });
    await likeWork(7);
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works/7/like', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('服务端报错时抛出其 error 文案', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 429, statusText: 'Too Many Requests',
      json: async () => ({ error: 'too many likes, try again later' }),
    });
    await expect(likeWork(7)).rejects.toThrow('too many likes, try again later');
  });
});

describe('fetchLikeState', () => {
  it('GET 到正确的 URL', async () => {
    ok({ likes: 3, liked: true });
    await fetchLikeState(7);
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works/7/like', expect.anything());
  });

  it('返回 liked=false 也算成功', async () => {
    ok({ likes: 3, liked: false });
    await expect(fetchLikeState(7)).resolves.toEqual({ likes: 3, liked: false });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/api/works.test.ts`
Expected: FAIL —— `likeWork` / `fetchLikeState` 不存在，`q` 未拼进 URL

- [ ] **Step 3: 实现**

改 `src/api/works.ts` 的 `WorkSummary`（加 `likes`）与 `listWorks`，追加两个方法：

```ts
export interface WorkSummary {
  id: number;
  title: string;
  thumbUrl: string;
  width: number;
  height: number;
  createdAt: number;
  /** 总点赞数。注意是「次」不是「人」——同 IP 次日可再赞。 */
  likes: number;
}

export type WorkSort = 'latest' | 'hot';

export async function listWorks(
  limit = 20,
  offset = 0,
  opts: { q?: string; sort?: WorkSort } = {},
): Promise<{ items: WorkSummary[]; total: number }> {
  // q 为空串时不拼：URL 里留一个裸 q= 没意义，还会让后端多解析一次
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (opts.q) params.set('q', opts.q);
  if (opts.sort && opts.sort !== 'latest') params.set('sort', opts.sort);
  const res = await fetch(`${BASE}/public/works?${params.toString()}`, {
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

/** 点赞。服务端幂等：重复点不会重复计数，返回 alreadyLiked 告知是否真赞上。 */
export async function likeWork(
  id: number,
): Promise<{ ok: true; likes: number; alreadyLiked: boolean }> {
  const res = await fetch(`${BASE}/public/works/${id}/like`, {
    method: 'POST',
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

/** 只读点赞状态。用于页面挂载时恢复「我今天赞过没」。 */
export async function fetchLikeState(id: number): Promise<{ likes: number; liked: boolean }> {
  const res = await fetch(`${BASE}/public/works/${id}/like`, { credentials: 'include' });
  return jsonOrThrow(res);
}
```

> **注意**：`WorkDetail extends WorkSummary`，所以详情页也会自动带上 `likes`，
> 后端 `toDetail` 需要相应补上（Task 3 已让 `getPublishedWork` 走 `toDetail`，
> 实施时确认详情接口也返回 likes，否则 typecheck 会报错）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/api/works.test.ts`
Expected: PASS

- [ ] **Step 5: 变异验证**

| 变异 | 预期 |
| --- | --- |
| `if (opts.q)` 去掉 | 「q 空串不拼」红 |
| `params.set('q', opts.q)` 不 encode（直接字符串拼） | 「q 含空格与中文时正确编码」红 |
| `sort !== 'latest'` 判断去掉 | 「不带 opts 时 URL 一致」红 |
| `likeWork` 用 GET | 「POST 到正确 URL」红 |

- [ ] **Step 6: 提交**

```bash
git add src/api/works.ts src/api/works.test.ts
git commit -m "feat(作品库): 前端 api 加 q/sort 参数与点赞接口封装"
```

---

### Task 5: 路由解析 query string

**Files:**
- Modify: `src/router.ts`
- Test: `tests/unit/router.test.ts`（追加 describe）

**Interfaces:**
- Produces: `src/router.ts`: `export interface ListQuery { q: string; sort: WorkSort }`
- Produces: `src/router.ts`: `parseListQuery(search: string): ListQuery`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/router.test.ts` 追加：

```ts
import { parseListQuery } from '@/router';

describe('parseListQuery', () => {
  it('空 query 返回默认值', () => {
    expect(parseListQuery('')).toEqual({ q: '', sort: 'latest' });
  });

  it('解析 q', () => {
    expect(parseListQuery('?q=%E5%B0%8F%E7%86%8A')).toEqual({ q: '小熊', sort: 'latest' });
  });

  it('解析 sort=hot', () => {
    expect(parseListQuery('?sort=hot')).toEqual({ q: '', sort: 'hot' });
  });

  it('两者同时解析', () => {
    expect(parseListQuery('?q=%E7%86%8A&sort=hot')).toEqual({ q: '熊', sort: 'hot' });
  });

  it('非法 sort 回落 latest（白名单）', () => {
    expect(parseListQuery('?sort=bogus')).toEqual({ q: '', sort: 'latest' });
    expect(parseListQuery('?sort=LATEST')).toEqual({ q: '', sort: 'latest' });
  });

  it('q 被截断到 100 字符（与后端上限一致）', () => {
    const long = 'a'.repeat(300);
    expect(parseListQuery(`?q=${long}`).q).toHaveLength(100);
  });

  it('q 的首尾空白被 trim', () => {
    expect(parseListQuery('?q=%20%20%E7%86%8A%20%20')).toEqual({ q: '熊', sort: 'latest' });
  });

  it('多余的参数被忽略', () => {
    expect(parseListQuery('?q=%E7%86%8A&foo=bar&sort=hot')).toEqual({ q: '熊', sort: 'hot' });
  });

  it('缺 q 时给空串而不是 undefined', () => {
    const r = parseListQuery('?sort=hot');
    expect(r.q).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/router.test.ts`
Expected: FAIL —— `parseListQuery` 不存在

- [ ] **Step 3: 实现**

在 `src/router.ts` 末尾追加：

```ts
import type { WorkSort } from '@/api/works';

export interface ListQuery {
  q: string;
  sort: WorkSort;
}

/**
 * 从 location.search 解析作品库的搜索词与排序。
 *
 * 搜索词进 URL 是产品决策：刷新和分享都能保留。截断到 100 字符是为了和后端
 * escapeLike 前的 slice 对齐 —— 两边都截才不会让 URL 显示 300 字而后端只搜前 100。
 */
export function parseListQuery(search: string): ListQuery {
  const params = new URLSearchParams(search);
  const rawSort = params.get('sort');
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    // 白名单：任何非 hot 的值都回落 latest，避免后端收到意外值
    sort: rawSort === 'hot' ? 'hot' : 'latest',
  };
}
```

> **注意**：`src/router.ts` 目前没有 import。`import type` 必须放在文件顶部
> （ESM 语法允许任意位置但风格上应统一，实施者按文件现状决定放哪）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/router.test.ts`
Expected: PASS

- [ ] **Step 5: 变异验证**

| 变异 | 预期 |
| --- | --- |
| 截断 `.slice(0, 100)` 删掉 | 「q 截断」红 |
| `rawSort === 'hot'` 改成 `rawSort === 'hot' \|\| rawSort === 'HOT'` | 「非法 sort 回落」红 |
| `.trim()` 删掉 | 「q trim」红 |
| q 缺省给 `undefined` 而非 `''` | 「缺 q 给空串」红 |

- [ ] **Step 6: 提交**

```bash
git add src/router.ts tests/unit/router.test.ts
git commit -m "feat(作品库): parseListQuery 从 URL 解析搜索词与排序"
```

---

### Task 6: `useWorks` 加搜索与排序（含乱序防护）

**Files:**
- Modify: `src/hooks/useWorks.ts`
- Test: `src/hooks/useWorks.test.ts`（新建）

**Interfaces:**
- Consumes: Task 4 的 `listWorks(limit, offset, opts)`
- Produces:
  - `useWorks(pageSize?: number): UseWorksResult`（返回值新增 `query` / `setQuery` / `sort` / `setSort`）

- [ ] **Step 1: 写失败的测试**

创建 `src/hooks/useWorks.test.ts`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorks } from './useWorks';

const listWorks = vi.fn();
vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return { ...actual, listWorks: (...a: unknown[]) => listWorks(...a) };
});

const item = (id: number, title: string) => ({
  id, title, thumbUrl: '/a.png', imageUrl: '/a.png',
  width: 0, height: 0, bytes: 1, createdAt: id, description: '',
  updatedAt: 1, likes: 0,
});

beforeEach(() => {
  listWorks.mockReset();
  listWorks.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => { vi.clearAllMocks(); });

describe('useWorks 默认行为', () => {
  it('首屏用 latest、不带 q', async () => {
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '', sort: 'latest' });
  });

  it('query/sort 初值是默认值', async () => {
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.query).toBe('');
    expect(result.current.sort).toBe('latest');
  });
});

describe('搜索防抖', () => {
  it('setQuery 后 300ms 内不立即发请求', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorks());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    listWorks.mockClear();

    act(() => { result.current.setQuery('小'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(listWorks).not.toHaveBeenCalled();   // 还没到 300ms

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(listWorks).toHaveBeenCalledTimes(1);
    expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '小', sort: 'latest' });
    vi.useRealTimers();
  });

  it('连续输入只发最后一次（不是每个字一次）', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorks());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    listWorks.mockClear();

    act(() => { result.current.setQuery('小'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => { result.current.setQuery('小熊'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => { result.current.setQuery('小熊图'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    expect(listWorks).toHaveBeenCalledTimes(1);
    expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '小熊图', sort: 'latest' });
    vi.useRealTimers();
  });
});

describe('乱序防护（核心）', () => {
  it('先发的请求后到，不能覆盖新结果', async () => {
    const deferreds: Array<{ resolve: (v: unknown) => void }> = [];
    listWorks.mockImplementation(() => new Promise(res => deferreds.push({ resolve: res })));

    const { result } = renderHook(() => useWorks());
    await act(async () => {});                     // 触发首屏
    expect(deferreds).toHaveLength(1);

    act(() => { result.current.setQuery('新词'); });
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    expect(deferreds).toHaveLength(2);

    // 先让「后发」的第二个请求返回
    await act(async () => {
      deferreds[1]!.resolve({ items: [item(2, '新结果')], total: 1 });
    });
    expect(result.current.items.map(i => i.title)).toEqual(['新结果']);

    // 再让「先发但后到」的第一个请求返回 —— 它必须被丢弃
    await act(async () => {
      deferreds[0]!.resolve({ items: [item(1, '旧结果')], total: 99 });
    });
    expect(result.current.items.map(i => i.title)).toEqual(['新结果']);
    expect(result.current.total).toBe(1);
  });
});

describe('搜索时清空旧结果', () => {
  it('query 变化后 items 不保留上一批', async () => {
    listWorks.mockResolvedValueOnce({ items: [item(1, 'A')], total: 1 });
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    listWorks.mockResolvedValueOnce({ items: [item(2, 'B')], total: 1 });
    await act(async () => {
      result.current.setQuery('B');
      await new Promise(r => setTimeout(r, 350));
    });
    expect(result.current.items.map(i => i.title)).toEqual(['B']);
  });
});

describe('排序切换', () => {
  it('setSort 立即触发新请求（不防抖）', async () => {
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    listWorks.mockClear();

    act(() => { result.current.setSort('hot'); });
    await waitFor(() => expect(listWorks).toHaveBeenCalled());
    expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '', sort: 'hot' });
  });

  it('排序 + 搜索组合传递', async () => {
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.setSort('hot'); });
    await waitFor(() => expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '', sort: 'hot' }));

    listWorks.mockClear();
    act(() => { result.current.setQuery('熊'); });
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '熊', sort: 'hot' });
  });
});

describe('loadMore 与搜索共存', () => {
  it('搜索结果也能加载更多', async () => {
    listWorks
      .mockResolvedValueOnce({ items: [item(1, 'A')], total: 2 })
      .mockResolvedValueOnce({ items: [item(2, 'B')], total: 2 });
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
  });

  it('loadMore 带上当前搜索词', async () => {
    listWorks.mockResolvedValue({ items: [item(1, 'A')], total: 100 });
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    listWorks.mockClear();
    act(() => { result.current.setQuery('熊'); });
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    listWorks.mockClear();

    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(listWorks).toHaveBeenCalled());
    expect(listWorks).toHaveBeenCalledWith(20, 1, { q: '熊', sort: 'latest' });
  });
});
```

> **注意**：本仓库 `vitest.config.ts` 是 `globals: false`，所有 import 必须显式写。
> `renderHook` / `act` 从 `@testing-library/react` 导入。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useWorks.test.ts`
Expected: FAIL —— `setQuery` / `setSort` 不存在

- [ ] **Step 3: 实现**

改写 `src/hooks/useWorks.ts`（保留 Task 7 的 `pendingRef` / `aliveRef` / id 去重逻辑）：

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { listWorks, type WorkSummary, type WorkSort } from '@/api/works';

const PAGE_SIZE = 20;
/** 搜索防抖：每敲一个字都发请求没必要 */
const SEARCH_DEBOUNCE_MS = 300;

export interface UseWorksResult {
  items: WorkSummary[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  /** 首屏加载失败。整个列表被它顶掉（此时一条数据也没有）。 */
  error: Error | null;
  /** 「加载更多」失败。只提示，已加载的列表保留 —— 与 error 分开是刻意的。 */
  loadMoreError: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  /** 当前搜索词（原始输入，未防抖） */
  query: string;
  setQuery: (q: string) => void;
  sort: WorkSort;
  setSort: (s: WorkSort) => void;
}

export function useWorks(pageSize: number = PAGE_SIZE): UseWorksResult {
  const [items, setItems] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WorkSort>('latest');

  // 卸载后不再 setState
  const aliveRef = useRef(true);
  // loadMore 进行中的同步标志（state 更新要到下一次渲染才对闭包可见）
  const pendingRef = useRef(false);
  /**
   * 首屏请求的序号。
   *
   * 现有的 cancelled 标志只能防「组件卸载后 setState」，防不了乱序：搜「小」发出去的
   * 请求可能比搜「小熊」的请求后到，如果不做点什么，它的结果会覆盖掉更新的结果。
   * 只认最新序号，晚到的旧结果直接丢。
   */
  const seqRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      pendingRef.current = false;
    };
  }, []);

  // 搜索词防抖：query 变化后等 300ms 才真正发请求
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const seq = ++seqRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    listWorks(pageSize, 0, { q: debouncedQuery, sort })
      .then(page => {
        // 三重防护：组件没卸载、effect 没被清理、且这是最新一次请求
        if (cancelled || seq !== seqRef.current) return;
        setItems(page.items);
        setTotal(page.total);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled || seq !== seqRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pageSize, nonce, debouncedQuery, sort]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || pendingRef.current) return;
    pendingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const offset = items.length;
    // loadMore 也带上当前搜索词与排序，否则翻页会翻回未搜索的全量数据
    listWorks(pageSize, offset, { q: query, sort })
      .then(page => {
        pendingRef.current = false;
        if (!aliveRef.current) return;
        // offset 分页 + 排序变动时会拉到重复项（Task 7 已处理过，见 progress.md）
        setItems(prev => {
          const seen = new Set(prev.map(i => i.id));
          return [...prev, ...page.items.filter(i => !seen.has(i.id))];
        });
        setTotal(page.total);
        setLoadingMore(false);
      })
      .catch((e: unknown) => {
        pendingRef.current = false;
        if (!aliveRef.current) return;
        setLoadMoreError(e instanceof Error ? e : new Error(String(e)));
        setLoadingMore(false);
      });
  }, [items.length, loading, loadingMore, pageSize, query, sort]);

  const reload = useCallback(() => {
    setItems([]);
    setTotal(0);
    setLoadMoreError(null);
    setError(null);
    setNonce(n => n + 1);
  }, []);

  return {
    items, total, loading, loadingMore, error, loadMoreError,
    hasMore: items.length < total,
    loadMore, reload, query, setQuery, sort, setSort,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useWorks.test.ts src/pages/WorksListPage.test.tsx`
Expected: PASS

- [ ] **Step 5: 变异验证**

| 变异 | 预期 |
| --- | --- |
| 序号校验 `seq !== seqRef.current` 删掉 | 「先发的请求后到不能覆盖」红 |
| 防抖时间改成 0 | 「300ms 内不发请求」红 |
| `loadMore` 不带 `q` | 「loadMore 带上当前搜索词」红 |
| 「搜索时清空旧结果」那行删掉（即 setItems 不覆盖） | 对应用例红 |
| `setSort` 也走 300ms 防抖 | 「排序立即触发新请求」红 |

- [ ] **Step 6: 提交**

```bash
git add src/hooks/useWorks.ts src/hooks/useWorks.test.ts
git commit -m "feat(作品库): useWorks 加搜索防抖 + 排序 + 请求序号防乱序"
```

---

### Task 7: 列表页 UI（搜索框 / 排序 / 点赞 / 空状态）

**Files:**
- Modify: `src/pages/WorksListPage.tsx`
- Modify: `src/pages/WorksListPage.css`
- Test: `src/pages/WorksListPage.test.tsx`（修改既有文件，追加 describe）

**Interfaces:**
- Consumes: Task 5 的 `parseListQuery`、Task 6 的 `useWorks`、Task 4 的 `likeWork`
- Produces: 无新导出（页面组件行为）

- [ ] **Step 1: 写失败的测试**

在 `src/pages/WorksListPage.test.tsx` 追加。注意该文件已有 `vi.mock('@/api/works')`，
需要把 `likeWork` / `fetchLikeState` 也纳入 mock：

```tsx
// 文件顶部的 vi.mock 改成：
const likeWork = vi.fn();
const fetchLikeState = vi.fn();
vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    listWorks: (...a: unknown[]) => listWorks(...a),
    likeWork: (...a: unknown[]) => likeWork(...a),
    fetchLikeState: (...a: unknown[]) => fetchLikeState(...a),
  };
});
// beforeEach 里加：likeWork.mockReset().mockResolvedValue({ ok: true, likes: 1, alreadyLiked: true });
//               fetchLikeState.mockReset().mockResolvedValue({ likes: 0, liked: false });

const work = (id: number, title: string, likes = 0) => ({
  id, title, description: '', thumbUrl: '/t.webp', imageUrl: '/i.png',
  width: 100, height: 100, bytes: 1, createdAt: id, updatedAt: id, likes,
});

describe('搜索框', () => {
  it('渲染一个搜索框', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('输入会触发带 q 的请求（防抖后）', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
    await waitFor(() => expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '小熊', sort: 'latest' }),
      { timeout: 2000 });
  });

  it('搜索词同步到 URL（replaceState，不污染历史栈）', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
    await waitFor(() => expect(replaceSpy).toHaveBeenCalled());
    const lastUrl = replaceSpy.mock.calls.at(-1)?.[2] as string;
    expect(lastUrl).toContain('q=');
    replaceSpy.mockRestore();
  });

  it('从 URL 初值回填搜索框', async () => {
    window.history.replaceState({}, '', '/works?q=%E5%B0%8F%E7%86%8A');
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('小熊');
    window.history.replaceState({}, '', '/works');
  });

  it('清除按钮清空搜索词', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
    await waitFor(() => expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('小熊'));
    fireEvent.click(screen.getByRole('button', { name: /清除/ }));
    await waitFor(() => expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(''));
  });

  it('有搜索词时展示匹配数量', async () => {
    listWorks.mockResolvedValue({ items: [work(1, '小熊')], total: 1 });
    render(<WorksListPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
    await screen.findByText(/找到 1 件/);
  });
});

describe('排序切换', () => {
  it('有「最新」「最热」两个切换按钮', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    expect(screen.getByRole('button', { name: '最新' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '最热' })).toBeTruthy();
  });

  it('点「最热」发 sort=hot 的请求', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    listWorks.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '最热' }));
    await waitFor(() => expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '', sort: 'hot' }));
  });

  it('当前排序带 aria-pressed', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    expect(screen.getByRole('button', { name: '最新' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '最热' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('两类空状态', () => {
  it('无作品时提示「还没有上传作品」', async () => {
    listWorks.mockResolvedValue({ items: [], total: 0 });
    render(<WorksListPage />);
    expect(await screen.findByText(/还没有上传作品/)).toBeTruthy();
    // 无搜索词时不该出现「换个词试试」
    expect(screen.queryByText(/换个词试试/)).toBeNull();
  });

  it('有搜索词但无结果时提示「换个词试试」', async () => {
    listWorks.mockResolvedValue({ items: [], total: 0 });
    render(<WorksListPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的词' } });
    await waitFor(() => expect(screen.getByText(/换个词试试/)).toBeTruthy(),
      { timeout: 2000 });
    // 这时候不该再显示「还没有上传作品」
    expect(screen.queryByText(/还没有上传作品/)).toBeNull();
  });

  it('搜索无结果时提供清除搜索入口', async () => {
    listWorks.mockResolvedValue({ items: [], total: 0 });
    render(<WorksListPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的词' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /清除搜索/ })).toBeTruthy(),
      { timeout: 2000 });
  });
});

describe('点赞按钮', () => {
  it('每张卡片都有点赞按钮并显示次数', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    render(<WorksListPage />);
    await screen.findByText('A');
    expect(screen.getByRole('button', { name: /5 次点赞/ })).toBeTruthy();
  });

  it('点一下调 likeWork 并更新数字', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    likeWork.mockResolvedValue({ ok: true, likes: 6, alreadyLiked: true });
    render(<WorksListPage />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));
    await waitFor(() => expect(likeWork).toHaveBeenCalledWith(1));
    expect(await screen.findByRole('button', { name: /6 次点赞/ })).toBeTruthy();
  });

  it('点赞成功后按钮变为已赞状态（不可再点）', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    likeWork.mockResolvedValue({ ok: true, likes: 6, alreadyLiked: true });
    render(<WorksListPage />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));
    const btn = await screen.findByRole('button', { name: /已赞/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('alreadyLiked=false（今天已赞过）时数字不变、状态为已赞', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    likeWork.mockResolvedValue({ ok: true, likes: 5, alreadyLiked: false });
    render(<WorksListPage />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /已赞/ })).toBeTruthy());
    // 数字没有被多加一次
    expect(screen.getByRole('button', { name: /5 次点赞/ })).toBeTruthy();
  });

  it('点赞失败时回滚数字并提示', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    likeWork.mockRejectedValue(new Error('网络炸了'));
    render(<WorksListPage />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));
    expect(await screen.findByText(/网络炸了/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /5 次点赞/ })).toBeTruthy();
  });

  it('连续快速点击只发一次请求', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    likeWork.mockResolvedValue({ ok: true, likes: 6, alreadyLiked: true });
    render(<WorksListPage />);
    await screen.findByText('A');
    const btn = screen.getByRole('button', { name: /5 次点赞/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(likeWork).toHaveBeenCalled());
    expect(likeWork).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/pages/WorksListPage.test.tsx`
Expected: FAIL —— 搜索框 / 排序按钮 / 点赞按钮不存在

- [ ] **Step 3: 实现页面**

改 `src/pages/WorksListPage.tsx`。新增 import（`likeWork`、`fetchLikeState`、`parseListQuery`），
组件体内加：

```tsx
/**
 * 单个作品的点赞按钮。
 *
 * 文案是「N 次点赞」而不是「N 人喜欢」：限流粒度是「每 IP 每图每天一次」，
 * 同一个人第二天可以再点一次，计数会累加 —— 写「人」是误导。
 */
function LikeButton({ work, onError }: { work: WorkSummary; onError: (m: string) => void }) {
  const [likes, setLikes] = useState(work.likes);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  // 乐观更新前的快照，失败时回滚
  const [rollback, setRollback] = useState<{ likes: number } | null>(null);

  // 页面挂载时问一次「我今天赞过没」—— 不能靠本次会话的内存，
  // 用户刷新后回来应该还记得自己的状态。
  useEffect(() => {
    let cancelled = false;
    fetchLikeState(work.id)
      .then(s => { if (!cancelled) { setLikes(s.likes); setLiked(s.liked); } })
      .catch(() => { /* 读不到就按未赞处理，不打扰用户 */ });
    return () => { cancelled = true; };
  }, [work.id]);

  const onClick = async () => {
    if (busy || liked) return;
    setBusy(true);
    setRollback({ likes });
    setLikes(n => n + 1);          // 乐观更新，点击手感即时
    setLiked(true);
    try {
      const r = await likeWork(work.id);
      setLikes(r.likes);           // 用服务端的权威值覆盖（幂等时它可能没变）
      setLiked(true);
    } catch (e) {
      setLikes(rollback?.likes ?? work.likes);   // 失败回滚
      setLiked(false);
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={liked ? 'works-like works-like--on' : 'works-like'}
      onClick={onClick}
      disabled={liked || busy}
      aria-pressed={liked}
      aria-label={liked ? `已赞，${likes} 次点赞` : `${likes} 次点赞`}
    >
      <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
      {likes}
    </button>
  );
}
```

组件主体现有 `const { items, total, ... } = useWorks();` 改为解构出
`query, setQuery, sort, setSort`，并加 URL 同步：

```tsx
// 进页面时从 URL 读初值（刷新 / 分享都能保留搜索词）
const [initial] = useState(() => parseListQuery(
  typeof window !== 'undefined' ? window.location.search : ''
));
// 把首次解析结果灌进 hook（只做一次）
const bootstrapped = useRef(false);
useEffect(() => {
  if (bootstrapped.current) return;
  bootstrapped.current = true;
  if (initial.q) setQuery(initial.q);
  if (initial.sort !== 'latest') setSort(initial.sort);
}, [initial.q, initial.sort, setQuery, setSort]);

// 搜索/排序变化 → 写回 URL。用 replaceState：每敲一个字都 push 会把历史栈塞满，
// 后退键就完全没法用了。
useEffect(() => {
  if (!bootstrapped.current) return;
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (sort !== 'latest') params.set('sort', sort);
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}, [query, sort]);
```

在 `<header>` 之后、`<SiteNav>` 附近插入搜索与排序控件：

```tsx
<div className="works-controls">
  <div className="works-search">
    <input
      type="search"
      className="works-search-input"
      placeholder="搜作品名…"
      aria-label="搜索作品"
      value={query}
      onChange={e => setQuery(e.target.value)}
    />
    {query && (
      <button
        type="button"
        className="works-search-clear"
        aria-label="清除搜索"
        onClick={() => setQuery('')}
      >
        ✕
      </button>
    )}
  </div>

  <div className="works-sort" role="group" aria-label="排序方式">
    <button
      type="button"
      aria-pressed={sort === 'latest'}
      className={sort === 'latest' ? 'works-sort-btn works-sort-btn--on' : 'works-sort-btn'}
      onClick={() => setSort('latest')}
    >最新</button>
    <button
      type="button"
      aria-pressed={sort === 'hot'}
      className={sort === 'hot' ? 'works-sort-btn works-sort-btn--on' : 'works-sort-btn'}
      onClick={() => setSort('hot')}
    >最热</button>
  </div>
</div>
```

计数文案与空状态区分：

```tsx
<p className="works-count">
  {query.trim()
    ? <>找到 {total} 件与「{query.trim()}」相关的作品</>
    : <>共 {total} 件</>}
</p>
```

```tsx
{!loading && !error && items.length === 0 && (
  query.trim() ? (
    // 搜索无结果 ≠ 库里没东西，文案与操作都要不一样
    <div className="works-state">
      <p>没有找到「{query.trim()}」相关的作品，换个词试试。</p>
      <button type="button" className="works-btn" onClick={() => setQuery('')}>
        清除搜索
      </button>
    </div>
  ) : (
    <div className="works-state">
      <p>还没有作品。</p>
      <a className="works-btn" href="/">去生成第一个图纸</a>
    </div>
  )
)}
```

卡片内加 `<LikeButton work={w} onError={setLikeError} />`，并在页面顶部准备
`const [likeError, setLikeError] = useState<string | null>(null)` 展示。

- [ ] **Step 4: 补 CSS**

在 `src/pages/WorksListPage.css` 追加（沿用现有 CSS 变量）：

```css
/* 搜索 + 排序。手机上堆叠，≥768px 并排。触摸区统一 44px 起。 */
.works-controls {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 1100px;
  margin: 0 auto var(--space-4);
  padding: 0 var(--space-4);
}

@media (min-width: 768px) {
  .works-controls {
    flex-direction: row;
    align-items: center;
  }
  .works-search { flex: 1; }
}

.works-search {
  position: relative;
  display: flex;
  align-items: center;
}

.works-search-input {
  width: 100%;
  /* 44px 是移动端可点区域的下限，别为了紧凑压到 40 以下 */
  min-height: 44px;
  padding: var(--space-2) var(--space-6) var(--space-2) var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--text-base);
  box-sizing: border-box;
}

.works-search-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.works-search-clear {
  position: absolute;
  right: var(--space-2);
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
}

.works-search-clear:hover { background: var(--color-surface-alt); }

.works-sort {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-md);
  background: var(--color-surface-alt);
  flex-shrink: 0;
}

.works-sort-btn {
  flex: 1;
  min-height: 36px;
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: calc(var(--radius-md) - var(--space-1));
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.18s ease, background 0.18s ease;
}

.works-sort-btn--on {
  background: var(--color-accent);
  color: #fff;
  font-weight: 600;
}

/* 点赞按钮：放在卡片底部靠右，不与标题抢注意力 */
.works-like {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: color 0.15s, transform 0.15s;
}

.works-like:hover:not(:disabled) { color: var(--color-accent); }
.works-like:disabled { cursor: default; }

.works-like--on {
  color: var(--color-accent);
  font-weight: 600;
}

/* 卡片内容区改成上下排列，给点赞按钮让位 */
.works-card-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
```

`.works-card-link` 需要相应调整成只包住图片与标题（点赞按钮在 `<a>` **外面**，
否则点点赞会跳转到详情页）。这是必须改的结构：

```tsx
<li key={w.id} className="works-card">
  <a href={`/works/${w.id}`} className="works-card-link">
    <img ... />
    <span className="works-card-title">{w.title}</span>
  </a>
  <div className="works-card-body">
    <span className="works-card-meta">{new Date(w.createdAt * 1000).toLocaleDateString()}</span>
    <LikeButton work={w} onError={setLikeError} />
  </div>
</li>
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/pages/WorksListPage.test.tsx`
Expected: PASS

- [ ] **Step 6: 变异验证**

| 变异 | 预期 |
| --- | --- |
| `disabled={liked \|\| busy}` 改成只 `disabled={liked}` | 「连续快速点击只发一次」红 |
| 乐观更新 `setLikes(n => n+1)` 删掉 | 「点一下调 likeWork 并更新数字」红 |
| catch 里不回滚 | 「点赞失败时回滚数字」红 |
| 卡片里点赞按钮挪进 `<a>` 内 | 「连续点击只发一次」可能红；至少要人工确认导航 |
| 空状态不区分有无搜索词 | 「有搜索词但无结果」红 |
| `replaceState` 改成 `pushState` | 「同步到 URL」仍绿 —— **这条测不出**，人工确认 |

- [ ] **Step 7: 提交**

```bash
git add src/pages/WorksListPage.tsx src/pages/WorksListPage.css src/pages/WorksListPage.test.tsx
git commit -m "feat(作品库): 列表页加搜索框、排序切换、点赞按钮与搜索空状态"
```

---

### Task 8: 详情页点赞 + README + 收尾自检

**Files:**
- Modify: `src/pages/WorkDetailPage.tsx` / `.css`
- Modify: `src/pages/WorkDetailPage.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 4 的 `likeWork` / `fetchLikeState`，Task 7 的 `LikeButton` 模式
- Produces: 无新导出

> `LikeButton` 在 Task 7 里定义在 `WorksListPage.tsx` 内。Task 8 需要复用，
> **把它提到 `src/components/LikeButton.tsx`**（新文件），两个页面各自 import。
> 这一步在 Step 2 完成后做。

- [ ] **Step 1: 写失败的测试**

先在 `WorkDetailPage.test.tsx` 的 `vi.mock` 里加上 `likeWork` / `fetchLikeState`，
然后追加：

```tsx
describe('详情页点赞', () => {
  it('展示点赞次数与按钮', async () => {
    fetchLikeState.mockResolvedValue({ likes: 8, liked: false });
    render(<WorkDetailPage id={42} />);
    expect(await screen.findByRole('button', { name: /8 次点赞/ })).toBeTruthy();
  });

  it('点一下点赞并更新数字', async () => {
    fetchLikeState.mockResolvedValue({ likes: 8, liked: false });
    likeWork.mockResolvedValue({ ok: true, likes: 9, alreadyLiked: true });
    render(<WorkDetailPage id={42} />);
    fireEvent.click(await screen.findByRole('button', { name: /8 次点赞/ }));
    expect(await screen.findByRole('button', { name: /9 次点赞/ })).toBeTruthy();
  });

  it('我今天赞过则按钮为已赞且禁用', async () => {
    fetchLikeState.mockResolvedValue({ likes: 9, liked: true });
    render(<WorkDetailPage id={42} />);
    const btn = await screen.findByRole('button', { name: /已赞/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('点赞失败时提示且不改数字', async () => {
    fetchLikeState.mockResolvedValue({ likes: 8, liked: false });
    likeWork.mockRejectedValue(new Error('网络炸了'));
    render(<WorkDetailPage id={42} />);
    fireEvent.click(await screen.findByRole('button', { name: /8 次点赞/ }));
    expect(await screen.findByText(/网络炸了/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /8 次点赞/ })).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/pages/WorkDetailPage.test.tsx`
Expected: FAIL —— 点赞按钮不存在

- [ ] **Step 3: 抽出 `LikeButton` 组件**

新建 `src/components/LikeButton.tsx`，把 Task 7 里的 `LikeButton` 原样搬进去
（含注释），CSS 类名沿用 `works-like` / `works-like--on`
（**同名类在两个文件里加载，谁先加载都生效，避免拆 CSS 文件**）。

- [ ] **Step 4: 两个页面改用共享组件**

`src/pages/WorksListPage.tsx`：删掉本地 `LikeButton` 定义，改
`import { LikeButton } from '@/components/LikeButton';`。

`src/pages/WorkDetailPage.tsx`：在 `.works-detail-meta` 里、`</dl>` 之后加：

```tsx
<div className="works-detail-like">
  <LikeButton work={work} onError={setLikeError} />
</div>
{likeError && <p className="works-detail-like-error">操作失败：{likeError}</p>}
```

并在组件里加 `const [likeError, setLikeError] = useState<string | null>(null);`。
详情页的 `work` 是 `WorkDetail`（`extends WorkSummary`），类型兼容。

CSS 追加到 `WorkDetailPage.css`：

```css
.works-detail-like {
  display: flex;
  justify-content: center;
  margin-top: var(--space-4);
}

.works-detail-like-error {
  margin: var(--space-2) 0 0;
  color: var(--color-error-fg);
  font-size: var(--text-sm);
  text-align: center;
}
```

- [ ] **Step 5: README**

在「作品库」章节的 API 列表补上：

```markdown
- `GET /api/public/works?limit&offset&q&sort` — 公开列表（`q` 按标题模糊搜索，
  `sort` 为 `latest`（默认）或 `hot`（按点赞数））
- `GET|POST /api/public/works/:id/like` — 点赞状态查询与点赞。
  **每个 IP 对每张图每天限一次**（复合主键 + `INSERT OR IGNORE` 保证幂等），
  进程内令牌桶按 IP 限频防刷。点赞不可取消；同一 IP 次日可再赞，
  所以计数是「次数」不是「人数」。
```

以及在功能描述里补一句搜索与排序：

```markdown
- **搜索与排序**：列表页顶部按标题实时搜索（防抖 300ms），搜索词与排序同步进 URL，
  刷新和分享都能保留；排序可切「最新 / 最热」，每页 10 条 + 加载更多。
```

- [ ] **Step 6: 跑全量验证**

```bash
npm test
npm run typecheck
npm run build
```

Expected: 全绿（测试数应比基线 551 多约 55 条）

- [ ] **Step 7: 收尾自检**

```bash
# 1. 每页默认 10 条
node -e "
const fs=require('fs');
const s=fs.readFileSync('server/index.ts','utf8');
if(!/req\.query\.limit \|\| 10/.test(s)) { console.error('FAIL: 默认 limit 不是 10'); process.exit(1); }
console.log('OK: 默认每页 10 条');
"
# 2. work_likes 表里有真 hash（不是明文 IP）
npx vitest run tests/unit/server/works-likes.test.ts
# 3. 令牌桶存在且注释写了单进程局限
grep -q "单进程" server/index.ts && echo "OK: 令牌桶局限已留档"
# 4. offset 漏图的已知取舍已写进注释
grep -q "游标分页" server/works.ts && echo "OK: 漏图取舍已留档"
```

- [ ] **Step 8: 提交**

```bash
git add src/components/LikeButton.tsx src/pages/WorksListPage.tsx src/pages/WorkDetailPage.tsx src/pages/WorkDetailPage.css src/pages/WorkDetailPage.test.tsx README.md
git commit -m "feat(作品库): 详情页点赞 + LikeButton 抽共用 + README 补搜索排序点赞说明"
```

---

## 执行后自检清单

全部任务完成后逐条核对：

- [ ] `npm test` 全绿，`npm run typecheck` 0 错误，`npm run build` 成功
- [ ] 默认每页 10 条（`?limit=` 不传时）
- [ ] `?q=` 空串不会返回 1 条（Task 2 修的坑仍在）
- [ ] 搜索 `50%` 按字面匹配，不扫全表
- [ ] `sort=hot` 同赞数时顺序确定（连续两次请求结果一致）
- [ ] 同一 IP 同一天重复点赞，`likes` 不变且 `alreadyLiked: false`
- [ ] 令牌桶超频返回 429，且 DB 无新增行
- [ ] `work_likes.ip_hash` 是 16 位 hex，不是明文 IP
- [ ] 两个页面的点赞文案都是「N 次点赞」，没有「N 人喜欢」
- [ ] 两类空状态区分正确
- [ ] 搜索词进 URL 用的是 `replaceState`
- [ ] `src/router.ts` 里那条「无 client-side 路由」的旧注释已更新（搜索进 URL 打破了该约束）
- [ ] **没有**新增 `popstate` 监听器：本项目是全页跳转，后退回列表页是全新加载、
      `parseListQuery` 直接读 URL。加了也不会触发（见 spec §5.2）
- [ ] 移动端触摸区 ≥44px（搜索框、排序按钮、点赞按钮）
- [ ] 「offset 漏图」与「令牌桶单进程」两条已知取舍在代码注释里有留档
