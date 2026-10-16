# 作品库搜索 + 点赞 + 排序 — 设计文档

- 日期：2026-10-17
- 分支：`feat/qr-download-gallery`（在二维码下载功能之后继续，不另开分支）
- 基线 commit：`62bd4bb`
- 状态：待实施

---

## 1. 背景与目标

二维码下载功能已闭环（导出贴码 → 扫码 → `/works` 列表 → `/works/:id` 详情 → 下载）。
站主反馈两个体验问题：

1. 作品多了以后列表没法找东西 —— 需要按标题模糊搜索。
2. 想知道哪些作品受欢迎 —— 需要点赞，并支持按热度排序。

目标：搜索、点赞、可切换排序，全部适配手机与桌面端，UI 与现有作品库视觉一致。

### 不做的事

- 不做「扫码直达该图详情页」：导出时作品尚未入库、id 不存在。详见 `progress.md` 的分析。
- 不做无限滚动：保留「加载更多」按钮。IntersectionObserver 在 jsdom 中不存在，测试成本高；
  且按钮行为可预期、可键盘操作。
- 不做点赞取消：见 §3 的幂等设计。
- 不做游标分页：见 §4.3。

---

## 2. 数据库

### 2.1 `work_likes` 表

```sql
CREATE TABLE IF NOT EXISTS work_likes (
  work_id    INTEGER NOT NULL,
  day        TEXT    NOT NULL,
  ip_hash    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (work_id, day, ip_hash)
);
```

**设计要点**

| 决定 | 理由 |
| --- | --- |
| `PRIMARY KEY (work_id, day, ip_hash)` | 幂等由数据库保证，不靠应用层判断 |
| `day` 存 `'YYYY-MM-DD'` 字符串 | 跨天自动是新 key，**不需要定时任务清理** |
| 不设 `id` 列、不设 `AUTOINCREMENT` | 复合主键已经唯一，代理键没有用途 |
| 无额外索引 | 「这张图总赞数」走主键前缀 `(work_id)` 已够 |

**计数口径**：同一 IP 次日可再给同一张图点赞，计数会累加。
因此展示文案用「N 次点赞」，**不写「N 人喜欢」** —— 后者会误导。

### 2.2 `ip_hash` 存真 hash（与既有 `events.ip_hash` 不同）

仓库既有的 `events.ip_hash` / `sessions.ip_hash` 字段名叫 hash，**实际存的是明文 IP**
（`server/index.ts:173` 的 `trackEvent({ ipHash: ip })` 直接把 `req.clientIp` 传进去）。
本设计**不修改这个既有行为**（统计模块的数据口径，动它有回归风险），但点赞表是新表：

```ts
// 服务器端
function ipHashOf(ip: string): string {
  return createHash('sha256')
    .update(`${ip}:${WORKS_IP_SALT}`)
    .digest('hex')
    .slice(0, 16);
}
```

盐取 `scripts/site-config.mjs` 的域名常量（`https://www.xn--muu023g.xyz/`），
防止彩虹表反查。**两处字段同名不同义，必须在代码注释里写明**，否则后人必然踩坑。

---

## 3. 点赞的幂等与限流

### 3.1 限流粒度（已确认）

**每个 IP 对每张图，每天限一次。** 同一天可以给多张图点赞，同一张图不能重复点。

### 3.2 不支持取消（已确认）

决定了数据模型可以极简：一行记录 = 一次赞。没有「当前是已赞还是未赞」的状态，
因此不需要额外的 `active` 列，也不会出现「取消了但计数没减」的中间态。

### 3.3 写入路径

```sql
INSERT OR IGNORE INTO work_likes (work_id, day, ip_hash, created_at)
VALUES (?, ?, ?, ?) RETURNING work_id
```

**实测确认**（sql.js）：主键冲突时 `RETURNING` 返回 **0 行**，插入成功返回 **1 行**，
次日同 IP 再赞返回 **1 行**。因此「是否新赞」直接由返回行数判定。

```ts
const rows = queryAll('... RETURNING work_id', [workId, day, ipHash, now]);
const inserted = rows.length > 0;   // true = 新赞，false = 今天已经点过了
return { liked: inserted, likes: countLikes(workId) };
```

选 `RETURNING` 而非「读 `db.changes`」的原因：仓库现有的 `runStmt()` 返回 `void`，
拿不到受影响行数；`queryAll()` 已经是通用读接口，`RETURNING` 能零改动复用。

**不需要先 SELECT 再判断** —— 少一次查询，且两个并发请求不会都判定为「新赞」。

**`alreadyLiked: true` 时不重复计数**，这是幂等的第二步（数据库挡住了重复插入，
应用层要挡住重复 `+1`）。

### 3.4 防打爆 DB 的三道闸

用户明确要求「注意不要打爆 db」：

| # | 闸 | 作用 |
| --- | --- | --- |
| 1 | 复合主键 | 挡重复插入 |
| 2 | **内存令牌桶**（见下） | 挡「同一 IP 疯狂 POST」触发的写事务 |
| 3 | `express.json({ limit: '64kb' })` | 挡超大 body |

第 2 条是关键：主键挡得住**重复插入**，但挡不住「每次 POST 都触发一次
`INSERT OR IGNORE` 的写事务 + 随后的 COUNT 查询」。令牌桶按 IP 限频（1 次/秒），
超了直接返回 429 **且完全不碰数据库**。

```ts
// 进程内 Map，不落盘。单进程部署（systemd + 一个 node 进程）足够。
// 定期清理：写入时顺手删掉 2 分钟前的条目，防止 Map 无限增长。
function allowLike(ip: string, now: number): boolean
```

**已知局限**：多进程部署时令牌桶不共享。这是当前部署形态（systemd 单进程）的合理取舍，
在代码注释里写明，若将来横向扩展需换 Redis。

### 3.5 读取路径

`GET /api/public/works/:id/like` → `{ likes, liked }`

`liked` 需回传 IP 才能判断，因此 `GET` 与 `POST` 共用同一个内部函数
`likeStateOf(workId, ip): { likes, liked }`。

---

## 4. 列表接口扩展

### 4.1 签名

```
GET /api/public/works?limit&offset&q&sort
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | 20 → **改为 10** | 钳到 `[1,60]` |
| `offset` | 0 | `Math.max(0, ...)` |
| `q` | 空 | 标题模糊匹配 |
| `sort` | `latest` | `latest` \| `hot` |

### 4.2 排序语义（已确认：可切换）

| `sort` | SQL |
| --- | --- |
| `latest` | `ORDER BY created_at DESC, id DESC` |
| `hot` | `ORDER BY likes DESC, created_at DESC, id DESC` |

**三级排序键 `created_at DESC, id DESC` 是排序稳定性的保证**（用户确认的「加 id 兜底」
的实际形式，`created_at` 为第二级、`id` 为最终的确定性兜底）：同赞数时先按上传
时间、再按 id 排，让顺序完全确定。否则每次请求顺序可能抖动，导致 React 重复 key、
滚动位置跳变。

### 4.3 已知局限：offset 分页会漏图（已接受）

排序键是点赞数，而**每次点赞都会改变排名**：

1. 首页按点赞取第 1-10 名
2. 有人给第 30 名的作品点赞 → 它跳到第 3 名
3. 点「加载更多」→ `offset=10`，取的是**新的**第 11-20 名
4. 原来的第 10 名被挤到第 11 位 → **被跳过**

Task 7 已实现按 `id` 去重，能挡住**重复**但挡不住**跳过**。

**已接受的代价**：实际作品量为个位数到几十件，`hasMore` 大概率一次就到底，
翻不到第二页。要彻底解决需游标分页 `WHERE (likes, created_at, id) < (?, ?, ?)`，
复杂度换不来实际收益。**此局限须在代码注释与 `progress.md` 中留档**，
避免后人误以为是 bug 而「顺手修掉」。

### 4.4 LIKE 转义

用户搜索 `50%` 或 `a_b` 时，`%` 与 `_` 会被当成通配符，导致扫全表。

```ts
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, ch => `\\${ch}`);
}
// 参数用 ESCAPE 显式声明反斜杠（SQLite 默认不转义）
// ... WHERE published = 1 AND title LIKE ? ESCAPE '\'
```

截断长度上限 100 字符，防止超长输入。

### 4.5 `total` 必须与 WHERE 一致

`total` 用于前端 `hasMore: items.length < total`。若 `total` 用不带 `q` 的 COUNT，
搜出 5 条但 `total` 是全部 200 条，「加载更多」会一直显示。

**两条 SQL 的 WHERE 与过滤语义必须完全一致**，并由测试锁定。

### 4.6 点赞数：一次查询，不做 N+1

```
LEFT JOIN (SELECT work_id, COUNT(*) AS c FROM work_likes GROUP BY work_id) l
        ON l.work_id = w.id
```

每页 10 条仍只发一条 SQL。列表接口在 `WorkSummary` 上新增 `likes: number` 字段。

---

## 5. 前端

### 5.1 API 层（`src/api/works.ts`）

```ts
listWorks(limit?, offset?, opts?: { q?: string; sort?: 'latest' | 'hot' })
likeWork(id: number): Promise<{ likes: number; alreadyLiked: boolean }>
fetchLikeState(id: number): Promise<{ likes: number; liked: boolean }>
```

**不传 `opts` 时 URL 与现状完全一致** —— Task 7 已有的 3 条 api 测试不用改。

### 5.2 搜索进 URL（已确认要）

- 查询串形如 `/works?q=小熊&sort=hot`
- 用 `history.replaceState` 而非 `pushState`：搜索框每敲一个字都 push
  会把历史栈塞满，后退键完全没法用
- 进页面时从 `location.search` 读初值 → 刷新与分享都保留
- 已确认：**不做**「从详情页返回时记住搜索词和滚动位置」

**打破的既有约束**：Task 8 台账记有「本项目无 client-side 路由，整页刷新」。
搜索进 URL 后，卡片跳转仍是 `<a href>` 全页跳转，从详情页「后退」回到
`/works?q=xxx` 是一次**全新加载**，`parseListQuery` 直接从 URL 读回初值。

**因此不需要监听 `popstate`** —— 那个监听器只在页面不卸载、仅靠
`history.pushState` 切换视图时才需要触发。本项目没有 client-side 路由，
页面每次导航都会重新挂载，加了也不会被触发。**实现时不要加这个监听器。**

### 5.3 Hook（`src/hooks/useWorks.ts`）

新增 `query` / `setQuery` / `sort` / `setSort`：

- **300ms 防抖**：每敲一个字都发请求没有必要
- **请求序号防乱序**：先发的请求后到不能覆盖新结果。
  现有的 `cancelled` 标志只能防卸载，**防不了乱序**，需要序号。
- `loadMore` 在搜索态下复用同一路径，`offset` 仍是 `items.length`，
  Task 7 的 id 去重逻辑原样保留
- 搜索词变化时清空 `items`（否则会出现「旧结果 + 新搜索」的混合列表）

### 5.4 页面（`WorksListPage.tsx` / `.css`）

- **搜索框**：`<input type="search">` + 清除按钮。桌面 ≥768px 通栏；
  手机端更高，触摸区 **≥44px**（移动端可用性底线）。
- **排序切换**：「最新 / 最热」两个按钮
- **有搜索词时**文案改为「找到 N 件与「xxx」相关的作品」
- **空结果**：区分两种 ——「还没有上传作品」vs「没找到…换个词试试」，
  后者给一个「清除搜索」按钮
- **每页 10 条**（原 20）
- **保留「加载更多」按钮**（已确认）

### 5.5 点赞 UI

- 卡片右下角心形按钮 + 数字
- 已赞：实心红心；未赞：描边灰心
- 点击后**立即乐观更新** UI，再发请求；失败则回滚并提示
- 移动端触摸区 ≥44px
- 列表页与详情页都有
- 文案「N 次点赞」，不写「N 人喜欢」

---

## 6. 测试策略

吸取前 8 个任务「测试全绿但杀不死变异」的教训，核心用例必须证明有判别力。

### 后端
- `INSERT OR IGNORE` 的幂等性：重复点赞 `changes === 0` 且计数不变
- 跨天重置：不同 `day` 是新 key，可再次点赞
- LIKE 转义：`50%` 与 `a_b` 按字面匹配，不扫全表
- `sort=hot` 排序正确、**同赞数时按 `created_at` 稳定**
- **`total` 与 WHERE 一致**（搜 5 条时 `total` 必须也是 5）
- 令牌桶：超频返回 429，且**不产生任何 DB 写入**

### 前端
- **请求乱序不会覆盖新结果**（§5.3 的风险点）
- 搜索词变化清空旧列表
- 重复点击只计一次
- `alreadyLiked: true` 时数字不变
- URL 初值回填 / 输入同步到 URL

### 变异验证
每个核心用例做一次变异并贴出红/绿输出。**想不出能杀死某用例的变异，如实说
「这条没有判别力」，不得粉饰。**

---

## 7. 影响面

| 文件 | 改动 |
| --- | --- |
| `server/db.ts` | 新增 `work_likes` 表 |
| `server/works.ts` | `listPublishedWorks` 加 `q`/`sort`；新增点赞读写函数 |
| `server/index.ts` | 列表路由透传参数；新增 2 条 like 路由；令牌桶 |
| `src/api/works.ts` | `listWorks` 加 opts；新增 2 个 like 方法 |
| `src/hooks/useWorks.ts` | `query`/`sort` + 防抖 + 序号防乱序 |
| `src/pages/WorksListPage.tsx` / `.css` | 搜索框、排序切换、点赞按钮、空结果区分 |
| `src/pages/WorkDetailPage.tsx` / `.css` | 点赞按钮 |
| `src/router.ts` | 读 `location.search` 的初值解析 |

`server/` 与 `src/` 的既有测试全部保留，新增用例单独成文件。

---

## 8. 风险

| 风险 | 处置 |
| --- | --- |
| 令牌桶仅单进程有效 | 已在 §3.4 注明，注释写明横向扩展需换 Redis |
| 排序变动导致 offset 漏图 | 已接受，见 §4.3 |
| 明文 IP 泄露 | 点赞表存真 hash；不改既有统计表 |
| LIKE 全表扫描 | 作品量级下可忽略；超千条时需 FTS5，届时再说 |
