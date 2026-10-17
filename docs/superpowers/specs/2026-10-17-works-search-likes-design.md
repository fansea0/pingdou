# 作品库搜索 + 点赞 + 排序 — 设计文档

- 日期：2026-10-17
- 分支：`feat/qr-download-gallery`（在二维码下载功能之后继续，不另开分支）
- 基线 commit：`62bd4bb`
- 状态：**已实施**（含一次存储模型重构，见 §2.1 / §3）

> **本文档已被 2026-10-17 的第二次修订覆盖过点赞存储模型。**
> 早期版本（§2.1 描述的 `work_likes` 复合主键表 + §4.6 的 `LEFT JOIN` 聚合）**已废弃**：
> 那是「测试全绿但查库压力大」的版本 —— 赞数只增不减地堆在独立表里，列表查询每次都要
> 对整张表做一次 `GROUP BY` 聚合。下面保留旧设计的段落时都会标注「已废弃」，
> 目的是留下「为什么不用那条路」的记录，而不是让人照抄。

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

### 2.1 赞数存 `works.likes` 计数列（2026-10-17 重构，取代原 `work_likes` 表）

```sql
-- works 表新增的列
likes INTEGER NOT NULL DEFAULT 0
-- 覆盖 hot 排序的复合索引
CREATE INDEX idx_works_published_likes ON works(published, likes DESC, created_at DESC, id DESC)
```

**为什么改**（用户拍板，根因是读的方式而不是写的量）：原设计把每一次点赞存成
`work_likes` 的一行，该表**只增不减、永不回收**，而列表查询每次都要带上
`LEFT JOIN (SELECT work_id, COUNT(*) FROM work_likes GROUP BY work_id)`。
于是站点每被访问一次，DB 就要对一张无界增长的表做一次全表聚合 —— 这才是
「存库查询压力大」的真正来源。改成整数列后：列表直读该列，**零聚合、表零增长**。

**已经废弃**（保留记录，勿照抄）：`work_likes(work_id, day, ip_hash)` 复合主键表 +
`INSERT OR IGNORE` 幂等。去重改由进程内 Set 承担，见 §3。

**迁移顺序不可颠倒：加列 → 回填 → 删表。**

```ts
ensureColumn('works', 'likes', 'INTEGER NOT NULL DEFAULT 0');
// hot 索引必须排在 ensureColumn 之后：老库的 works 还没有 likes 列，
// 提前建索引会抛 "no such column: likes"，initDb 直接起不来。
ensureIndex('idx_works_published_likes', 'works(published, likes DESC, created_at DESC, id DESC)');
migrateWorkLikesToCountColumn();
```

回填必须在 `DROP` 之前：`work_likes` 一旦 DROP，历史赞数就再也拿不回来了，而老库的
`likes` 列此刻全是默认 0 —— 表现是「升级后所有历史赞数静默归零」，且没有任何报错。
这类静默的数据丢失比迁移失败可怕得多。

```sql
UPDATE works SET likes = likes + (SELECT COUNT(*) FROM work_likes WHERE work_id = works.id);
DROP TABLE work_likes;
```

回填用**累加**而非赋值（此刻两者结果相同，但累加语义正确：万一将来别的路径先写过
`likes`，赋值会把它抹掉）。迁移后必须显式 `markDirty()` —— `exec()` 不标脏，
漏了的话改写只留在内存里，重启回滚成「有 work_likes 表、likes 全 0」的半迁移状态，
而下次启动因为表还在又会重新回填一遍，看起来「有时生效有时不生效」。

关联条件 `work_likes.work_id = works.id`：没有外键约束（`works` 表本身也没有外键），
真有孤儿行时 COUNT 为 0，不影响任何真实作品；`works.id` 是 AUTOINCREMENT，行号永不复用，
孤儿行也不会串号到后来的作品上。

**列表查询已无聚合**（原 §4.6 已废弃）：

```
SELECT w.* FROM works w WHERE w.published = 1 ORDER BY w.created_at DESC, w.id DESC LIMIT ? OFFSET ?
```

`listPublishedWorks` / `getPublishedWork` / `listAllWorks` / `rowById` 一律直读 `w.likes`。

### 2.2 点赞指纹（取代原 §2.2 的 ip_hash 设计）

去重**不再落库**，是进程内一个「当天已赞过」的哈希集合。去重指纹：

```ts
hash(IP + '\0' + User-Agent + 作品ID + isoDay(日期) + 盐) → 截断 16 位 hex
```

| 决定 | 理由 |
| --- | --- |
| **包含 User-Agent** | 用户明确要求：同一 IP 换浏览器算两个人，多人共用一个出口 IP（公司 / 学校 / 运营商 NAT）时也各自能赞。后一种情况下若只按 IP 去重，真实访客里只有第一个能赞，其余人看到的都是「已赞、点不动」 |
| 包含 User-Agent 是**有意的去重放宽** | 副作用是「同 IP 换 UA 可以再赞一次」。这是用户接受的取向，刷赞由令牌桶那一道闸兜（§3.4），不由去重兜 |
| 分隔符用 `\0`（NUL） | IP 与 UA 都是外部输入，没有分隔符时 `ip="ab",ua="c"` 与 `ip="a",ua="bc"` 拼出同一个串，两个不同的访客被当成同一个人。NUL 在 HTTP 头里不可能出现 |
| 盐取 `scripts/site-config.mjs` 的域名常量 | 防彩虹表反查。**防护力别高估**：挡的是「明文可见」，挡不住暴力枚举（IPv4 只有 2^32）。点赞数据敏感性低，不上 HMAC |
| 截断 16 位 hex | 够用且省内存；集合有整体上限，不靠这一位防碰撞 |

**与既有 `events.ip_hash` / `sessions.ip_hash` 的关系（一个必须说清的点）**：
那两列字段名叫 hash，**实际存的是明文 IP**（`server/index.ts` 的
`trackEvent({ ipHash: ip })` 直接传 `req.clientIp`）。本设计**不修改这个既有行为**
（统计模块的数据口径，动它有回归风险）。点赞指纹是另一套东西，且根本不入库。
两处字段同名不同义，**代码注释里必须写明**，否则后人必然踩坑。

---

## 3. 点赞的幂等与限流

### 3.1 限流粒度（2026-10-17 修订）

**每个 IP + 每个浏览器对每张图，每天限一次。** 同一天可以给多张图点赞，同一张图不能重复点。
（早期版本是「只按 IP」，现按 §2.2 的指纹含 UA —— 用户明确要求的放宽。）

### 3.2 不支持取消（已确认）

决定了数据模型可以极简：计数只增，不存在「当前是已赞还是未赞」的持久状态，
因此不会出现「取消了但计数没减」的中间态。「已赞没赞」只活在当天的内存集合里。

### 3.3 去重：每天一个 Set，第二天清空（取代原写库幂等）

用户原话：「还是要改，目前存库查询压力大，使用内存 set。每天一个 set，第二天清」。

```ts
let seenDay = '';                      // 当前是哪一天（isoDay，UTC）
let seenFingerprints = new Set();      // 当天已赞过的指纹
export const LIKES_FINGERPRINT_MAX = 20_000;

function rotateDayIfNeeded(now: number) {
  const day = isoDay(now);
  if (day !== seenDay) { seenDay = day; seenFingerprints = new Set(); }
}
```

- **跨天轮转沿用 `db.isoDay()`（UTC）**，与 events / sessions 全仓统一口径，
  **不引入第二套时区算法**。可感知后果：东八区用户本地 00:00–08:00 的赞算作前一天。
- 每次读写都调 `rotateDayIfNeeded`，所以不存在「没人访问时不轮转、
  第二天第一次访问读到昨天残留」的情况。
- **上限必须存在**：IP 与 UA 都由客户端控制，「伪造 UA × 伪造 XFF」能让集合无界增长，
  内存被撑爆比 DB 慢严重得多。20_000 条/天对个人站是天文数字。
- **触顶行为：整份丢弃（fail-open）**。去重失效、可以重复赞，但进程活着。
  反过来 fail-closed（拒绝所有新赞）会把一次异常流量变成「当天全站不可点赞」，
  明显更糟。真触顶了说明站点已经不属于「个人站」，那该处理的是入口而不是去重。

**已接受的代价：重启后当天可以再赞**（用户明确接受）。去重集合不在磁盘上，
进程一起来就是空的；`works.likes` 里的**计数不会丢**，丢的只是去重记忆。

### 3.4 写入路径：单条 UPDATE（同步）

```sql
UPDATE works SET likes = likes + 1 WHERE id = ? RETURNING likes
```

- `RETURNING` 直接给出写完之后的准确赞数，省掉一次 SELECT。
  `UPDATE ... WHERE id = ?` 天然校验存在性：作品不存在 → 0 行 → `{ likes: 0, liked: false }`，
  不用抛异常（签名不变）。
- **写入顺序：先 UPDATE、成功之后才登记指纹。** 反过来的话，给不存在的作品点赞
  也会往集合里塞一条永远命中不了真实请求的垃圾指纹，且「赞过」的记录会与
  「加过计数」的记录脱钩 —— 按钮显示已赞却点不动，是最难排查的一类状态不一致。
- 走 `execReturning` 而不是裸 `queryAll`：后者不调 `markDirty()`，写进去的东西
  重启即消失（见 §3.6 的警告）。

#### 3.4.1 有意偏离：「后步入库」改成同步

用户原话里提过「后端异步入库」。**这次按同步实现**，理由是改用计数列之后收益为零、
代价为正：

| | 异步 | 同步（本次采用） |
| --- | --- | --- |
| 写入成本 | 一条 UPDATE，走主键、无聚合 | 同左 |
| 落盘 | sql.js 是纯内存库，本就要靠 `flushNow` 批量 export，异步并不会更快 | 同左 |
| 返回的 `likes` | 拿不到真实值，只能让前端显示自己 +1 的数字 | `RETURNING` 给出服务端真实计数 |
| 失败窗口 | 「已返回成功但其实没写进去」 | 无 |

异步唯一能省的是「当前请求的响应时间里那一条 UPDATE 的时间」，而它本来就在
微秒级。**如果这条将来真的变慢，要先量再改，别凭感觉引入手写队列。**

### 3.5 防打爆 DB 的三道闸

用户明确要求「注意不要打爆 db」：

| # | 闸 | 作用 |
| --- | --- | --- |
| 1 | 内存去重 Set | 挡重复插入（**不再挡写事务** —— 重复请求走的是读路径 `SELECT likes`） |
| 2 | **内存令牌桶**（见下） | 挡「同一 IP 疯狂 POST」触发的写事务 |
| 3 | `express.json({ limit: '64kb' })` | 挡超大 body |

```ts
// 进程内 Map，不落盘。单进程部署（systemd + 一个 node 进程）足够。
// 定期清理：size 超阈值时顺手删掉 2 分钟前的条目，防止 Map 无限增长。
function allowLike(ip: string, now: number): boolean
```

**令牌桶必须排在存在性校验之前**：排在后面时，「不存在 / 草稿 id」会先打一条
`getPublishedWork` 的 SQL 才被 404 挡掉，于是 (a) 429 路径并非零 SQL，
(b) 同一 IP 连打不存在的 id 可以无限次穿透到 DB。放前面后超限请求**一条 SQL 都不发**。
代价（已知且接受）：无效 id 的请求会消耗调用方自己的令牌额度（自伤），但不影响别人 ——
桶按 IP 分开。**这条有测试钉着。**

**已知局限**：令牌桶与去重集合都只在本进程内有效，多进程部署不共享。这是当前部署形态
（systemd 单进程）的合理取舍，在代码注释里写明，若将来横向扩展需换 Redis（两处一起换）。

### 3.6 读取路径

`GET /api/public/works/:id/like` → `{ likes, liked }`

`liked` 需要指纹，所以 `GET` 与 `POST` 共用同一个内部函数
`likeStateOf(workId, fingerprint): { likes, liked }`，且**两条路由都必须把
`req.headers['user-agent']` 一起传下去** —— 漏传 UA 会让 GET 与 POST 的指纹口径不对称，
表现是「刚点完赞，按钮立刻变回未赞」而计数已经加过了。

> **警告：写入必须走 `execReturning`，不能直接 `queryAll`。**
>
> `server/db.ts` 里 `queryAll` 是纯读接口，**不调 `markDirty()`**。本项目的 sql.js 是
> 纯内存库，只有 `flushNow()` 执行 `db.export()` 时才会落盘，而 `flushNow()` 开头就
> `if (!dirty) return`。于是 `queryAll` 写进去的行在内存里一直都在、重启即消失。
> `execReturning` 正是为此存在：它就是 `queryAll` + `markDirty`，两者缺一不可。
>
> **危险的地方在于「测试测不出来」**：断言若查的是内存库里的同一个 sql.js 实例，
> 不管 flush 标没标脏，那行都还在，断言照样通过。正确做法是**用只读的第二个连接
> 重开磁盘上的 `stats.db`**（`tests/unit/server/works-likes.test.ts` 的「落盘」一节）。
> 写这类「读接口顺便写库」的代码时，先问一句：这个测试换一套实现还能不能变红？

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

### 4.2.1 排名不实时变化（用户明确要求）

**列表顺序一律以服务端本次响应为准，客户端绝不重排。**

点赞只改数字、不改位置。原因是：

- 卡片点赞后如果跳位，用户正准备点第二张时目标已经跑了
- 已渲染的列表一旦在用户眼前重排，滚动位置也会跟着乱
- 排名「实时变化」对访客没有价值 —— 没人会盯着数字看它涨

因此前端**禁止**根据本地 likes 做任何 sort。搜索词或排序方式变化时重新请求，
那一次请求才会拿到新的排名。实现上只靠两点保证：

1. `items` 的数组顺序直接来自 `listWorks` 的响应，页面上不对它做任何 sort
2. `LikeButton` 只更新自己的 `likes` state，不触碰父级数组

**必须由测试锁定**（Task 7）：点赞后卡片标题的顺序不变。
这条一旦被破坏（「给组件加个更顺手的前端排序」）会是很难察觉的回归。

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

### 4.6 点赞数：直读列，零聚合（2026-10-17 重构）

**已废弃**（勿照抄）：

```sql
-- 旧设计：列表每次都要对整张 work_likes 表做一次全表分组聚合，
-- 而那张表只增不减、永不回收。
LEFT JOIN (SELECT work_id, COUNT(*) AS c FROM work_likes GROUP BY work_id) l
        ON l.work_id = w.id
```

现在（详见 §2.1）：

```
SELECT w.* FROM works w WHERE w.published = 1 ORDER BY ... LIMIT ? OFFSET ?
```

`likes` 在 `w.*` 里，不带任何 JOIN。`hot` 排序的 `ORDER BY w.likes DESC` 由
`idx_works_published_likes` 覆盖。

**不要再把 JOIN 加回列表路径。** 若将来赞数需要「按天统计 / 找出点赞明细」，
那是另一个表、另一个查询 —— 本次重构之所以放弃那些能力，正是因为它们逼着
列表路径做聚合。`WorkSummary.likes` 的字段不变，前端零改动。

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
- **从详情页返回：搜索词和排序会被还原，滚动位置不会。**
  这一版实际是「部分保留」，本条订正早期 spec 里「已确认：**不做**从详情页返回时
  记住搜索词和滚动位置」的说法 —— 搜索进 URL 顺手把它解决了，原来的取舍判断已过时。
  - **保留的**：URL 里带着 `?q=xxx&sort=hot`，从详情页后退是一次全新加载，
    `parseListQuery` 直接从 URL 读回搜索词和排序，所以两项都还在。
  - **不保留的**：**滚动位置**。它不在 URL 里，而卡片跳转是 `<a href>` 全页跳转，
    页面必然卸载重建 —— 本项目没有任何状态能承载滚动偏移。要保留得引入
    `history.scrollRestoration` 处理或改客户端路由，两者都超出本 feature 范围。
    实际表现以浏览器默认行为为准，本项目不做任何承诺。
  - 对「用户搜『小熊』→ 进详情 → 后退」的路径：结果集和排序是对的，
    视觉上会回到列表顶部。

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

### 后端（2026-10-17 重构后）

**幂等与放宽语义**

- 同一 fingerprint 第二次点赞：`liked=false` 且计数不变
- **同一 IP 换 User-Agent 算两次** ← 本次新增的放宽语义，必须钉住；
  路由层也要钉（路由漏传 UA 时数据层用例全绿、只有这条会红）
- 同一人对不同作品可以各赞一次；赞数按作品隔离，不串号
- GET 与 POST 的指纹口径必须对称（同 IP 同 UA：POST 之后 GET 必须是 `liked=true`）

**跨天与上限**

- 跨天重置：第二天同一 fingerprint 可以再赞，计数累加
- 跨天后 `liked=false` 但累计计数仍在
- 轮转边界是 UTC 日界，不是 24 小时窗口
- 超过 `LIKES_FINGERPRINT_MAX` 后集合不继续增长，且**仍是 fail-open**
  （能正常点赞，不是全站不可赞）

**列表不再聚合**

- **绕过 `addLike` 直接 `UPDATE works SET likes = 7`，列表 / 详情 / 后台读到的就是 7**
  ← 聚合实现下这条必红，且正常路径下数值相同，不会误伤正确实现
- 把列表查询真正 prepare 出去的每条 SQL 抓下来，断言没有一条提到 `work_likes`、
  没有一条带 `GROUP BY`（上一种是结果断言，换一种同样贵的写法就绿了）
- `work_likes` 表已不存在

**迁移正确性**（造老库 → 跑迁移 → 赞数没归零）

- 造一个**磁盘上真的带 `work_likes` 行、`works` 表没有 `likes` 列**的 `stats.db`，
  重新 `initDb()`，断言每个作品的赞数被**累加**进去（2 → 2、5 → 5、无人赞的 → 0）
- 回填漏了的话全表是 0 且不报任何错 —— 这是「升级后历史赞数凭空消失」的最坏形态
- 断言 `work_likes` 表已被删掉、迁移结果**已落盘**（重启不回滚）、
  迁移幂等（再启动一次不会把赞数加两遍）、迁移后老作品能正常点赞

**令牌桶（契约不变）**

- 超频 429，且**一条 SQL 都不发**（数 `Database.prototype.prepare` 的调用次数）
- 令牌桶排在存在性校验之前：不存在的 id 第二次返回 429 而不是 404
- 429 时目标作品的 `likes` 保持 0

**重启后当天可再赞**（用户已接受的代价）—— 钉住它是契约，同时钉住**计数不会丢**。
注意模拟重启前必须先 `flushNow()`：点赞走的是 debounce 落盘（500ms 定时器），
不 flush 就重开读到的是「debounce 有没有被等到」，测不到本用例想测的东西。

### 前端

- **请求乱序不会覆盖新结果**（§5.3 的风险点）
- 搜索词变化清空旧列表
- 重复点击只计一次
- `alreadyLiked: true` 时数字不变
- URL 初值回填 / 输入同步到 URL
- 乐观更新与回滚（`busyRef` / `prevLikes`）

### 变异验证

每个核心用例做一次变异并贴出红/绿输出。**想不出能杀死某用例的变异，如实说
「这条没有判别力」，不得粉饰。**

## 7. 影响面

| 文件 | 改动 |
| --- | --- |
| `server/db.ts` | `works` 表加 `likes` 列 + hot 索引；**删掉 `work_likes` 建表语句**；迁移（ensureColumn → 回填 → DROP） |
| `server/works.ts` | 赞数直读列（删 `LIKES_JOIN` / `countLikes`）；`likeFingerprint` + 每日轮转的内存 Set + 上限；`addLike` 改单条 UPDATE；删 `ipHashOf` |
| `server/index.ts` | 两条 like 路由透传 `user-agent`；令牌桶 `allowLike` **保留**（不动） |
| `src/api/works.ts` | `listWorks` 加 opts；新增 2 个 like 方法（本次重构**未改**） |
| `src/hooks/useWorks.ts` | `query`/`sort` + 防抖 + 序号防乱序（本次重构**未改**） |
| `src/pages/WorksListPage.tsx` / `.css` | 搜索框、排序切换、点赞按钮、空结果区分（本次重构**未改**） |
| `src/pages/WorkDetailPage.tsx` / `.css` | 点赞按钮（本次重构**未改**） |
| `src/router.ts` | 读 `location.search` 的初值解析（本次重构**未改**） |

**前端在本次存储重构中零改动** —— `WorkSummary.likes`、`{ likes, alreadyLiked }`、
`{ likes, liked }` 三个对外形状都没变，所以 `src/` 下一行都不用改。

`server/` 与 `src/` 的既有测试全部保留；受影响的三个测试文件已重写/扩充。

---

## 8. 风险

| 风险 | 处置 |
| --- | --- |
| 令牌桶与去重集合仅单进程有效 | 已在 §3.5 注明，注释写明横向扩展需换 Redis（两处一起换） |
| **重启后当天可再赞** | **用户已明确接受**。丢的是去重记忆，计数不丢；已写成用例钉住 |
| 集合无界增长（伪造 IP/UA） | 已有上限 `LIKES_FINGERPRINT_MAX` + 触顶整份丢弃（§3.3） |
| 换 UA 可多刷一赞 | 去重有意放宽（§2.2），由令牌桶兜；计数本就是「次数」不是「人数」 |
| 排序变动导致 offset 漏图 | 已接受，见 §4.3 |
| 迁移漏了回填 → 历史赞数静默归零 | 已用「造老库」用例钉住（§6）；代码里回填排在 DROP 之前且有注释 |
| 老库升级后 likes 列建索引失败 | 索引的 `ensureIndex` 必须排在 `ensureColumn` 之后（§2.1） |
| 明文 IP 泄露 | 点赞指纹只活在内存里、不入库、不含明文；既有统计表不动 |
| LIKE 全表扫描 | 作品量级下可忽略；超千条时需 FTS5，届时再说 |
