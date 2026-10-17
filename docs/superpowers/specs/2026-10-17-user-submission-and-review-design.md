# 用户投稿 + 后台审核 — 设计文档

- 日期：2026-10-17
- 作者：通过 brainstorming 流程生成（Mavis / MiniMax Code）
- 基线 commit：`c9c9be7`
- 分支：`feat/qr-download-gallery`（延续，不另开分支）
- 状态：待 review → writing-plans → 实施
- 依赖：现有导出流水线（`composite.ts` / `pipeline.ts` / `qr.ts`）、`sql.js` engine + `flushNow()` 写盘模型、`multer` 上传管线、`StorageDriver` 抽象、现有 `works` 表

---

## 1. 需求与范围

### 1.1 背景

作品库目前只有一条进货渠道：站主在后台 `WorksTab` 手动上传 PNG。这条路有三个问题：

1. **作品集只能靠站主自己攒。** 用户做出一张图纸、下载完就走了，站点没有承接这个动作的任何入口。
2. **作品的数据是残的。** 后台上传只有一张图 + 标题 + 描述，没有图纸格数、豆子数、颜色数、预估工时 —— 而这些恰恰是拼豆用户最想看的（"这张图多大？要做多久？"）。
3. **导出图的二维码指向全站。** `/brand/works-qr.png` 是构建期生成的静态码，指向 `/works` 列表页，不是"这张图自己的页面"。分享出去的人扫码只能进列表。

目标是让用户能把自己的图纸投进作品库，并让每一件作品都带着**属于它自己的二维码**和**属于它自己的图纸参数**。

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| S-1 | 作为访客，在生成页填完参数后能点「投稿」 | 参数面板下方有投稿按钮；点击弹出名称输入框 |
| S-2 | 作为访客，确认投稿后系统按当前参数生成图片并入库 | 生成的成品图与导出图同规格（含色号标注、色卡、水印），尺寸等于当前图纸 |
| S-3 | 作为访客，投稿时能看到自己正在投什么 | 弹窗内以只读方式展示：图纸比例、豆子数、颜色数、预估工时 |
| S-4 | 作为访客，投稿图扫出来能直达这张图自己的详情页 | 成品图右下角二维码指向 `https://<站点>/works/:id`，不是 `/works` |
| S-5 | 作为站主，能在后台看到待审核队列 | 待审核区块列出缩略图、名称、四个图纸参数 |
| S-6 | 作为站主，能通过或拒绝投稿 | 通过后立刻出现在 `/works`；拒绝后源文件被删除 |
| S-7 | 作为站主，能在审核时改投稿名称 | 通过前可改名，改完随通过一起公开 |
| S-8 | 作为站主，能对已公开作品下架 / 重新上架 / 删除 | 三个操作各自生效，删除时文件一并清理 |
| S-9 | 作为访客，扫到未通过审核或已删除的 id 时不会撞到死页面 | 自动跳回 `/works` 列表 |
| S-10 | 作为站主，后台不再有上传作品的入口 | 后台上传区块与对应接口全部移除；存量图库被清空 |

### 1.3 范围内

- `works` 表追加 7 列（审核态 + 四个图纸参数 + 一次性上传令牌）+ 1 个索引
- `server/works.ts`：投稿创建 / 图片上传 / 审核通过 / 审核拒绝 / 列表按状态过滤 / 投稿配额（进程内指纹，按天轮转）
- `server/index.ts`：2 个公开投稿接口 + 2 个后台审核接口；删除 2 个后台上传接口
- 前端新增 `SubmitWorkButton`（按钮 + 弹窗 + 两步上传编排）
- `src/pipeline/qr.ts`：新增「按作品 id 生成二维码」的能力（`drawWorksQr` 本身不改）
- `src/pipeline/pipeline.ts`：提取投稿与导出共用的单尺寸渲染函数
- `src/pages/admin/WorksTab.tsx`：删上传区块，改为「待审核」+「作品集」两块
- `src/pages/WorkDetailPage.tsx`：拿不到作品时自动跳回 `/works`
- `scripts/reset-gallery.mjs`：一次性清空图库
- `package.json`：`qrcode` 从 devDependencies 移到 dependencies
- 文档：`README.md` 加「投稿与审核」章节并改写「作品库」章节

### 1.4 非目标

- ❌ **用户侧的投稿查询 / 结果通知**：不做"我的投稿"页面、不发邮件或站内信。投稿后 pending 行用户拿不到 id 和链接，这是刻意的 —— 未过审的作品本来就不该有可访问地址。
- ❌ **投稿编辑与撤回**：待审核期间用户改不了自己投的图。
- ❌ **拒绝理由字段**：后台只提供"通过 / 拒绝"两个动作，不记录拒绝原因。
- ❌ **孤儿 pending 行的自动清理**：见 §11 的取舍说明。
- ❌ **投稿的瞬时限流令牌桶**：见 §4.2，这是为了避免两步上传自己撞自己。
- ❌ **单作品页 SEO 预渲染**：沿用 2026-10-16 spec 的同一判断，本次不承诺。
- ❌ **按颜色数 / 工时排序**：列表仍只有「最新 / 最热」两种排序。

### 1.5 成功标准

- `npm test` 现有全部通过 + 新增测试全部通过
- `npm run typecheck` 0 错误；`npm run build` 通过
- 访客投稿一次 → 后台待审核队列出现该条目 → 点通过 → `/works` 列表与 `/works/:id` 详情都能打开，二维码扫出的是**这一件**作品的详情页
- 点拒绝 → 磁盘上 `media/works/` 下对应两个文件消失，后台该行显示「源文件已删除」，`/works/:id` 404 并跳回列表
- 同一 IP + UA 连投 4 件 → 第 4 件返回 429 中文提示
- 清库脚本在生产上跑一次后：`GET /api/public/works` 返回 `total: 0`，`media/works/` 目录为空
- 待审核 / 已拒绝的作品，`GET /api/public/works` 与 `GET /api/public/works/:id` 一律不可见（`total` 不含它们，详情返回 404）

---

## 2. 状态机与不变量

### 2.1 状态流转

```
                    POST /api/public/works  （分配 id + uploadToken）
                              ↓
                     ┌──────────────────┐
                     │ pending          │  published=0, upload_token 有效
                     │ 待审核（图可暂缺）  │
                     └────┬────────┬────┘
              approve     │        │   reject（删源文件）
                  ┌───────┘        └────────┐
                  v                          v
        ┌──────────────────┐      ┌──────────────────┐
        │ approved         │      │ rejected         │
        │ published=1      │      │ published=0      │
        │ 公开可见          │      │ 源文件已从磁盘删除 │
        └───┬──────────┬───┘      └──────────────────┘
            │ 下架      │ 上架          终态，不可再流转
        published=0   published=1
```

`pending → approved`（审核通过）、`pending → rejected`（审核拒绝）、
`approved ⇄ published` 是**正交**的两件事 —— 下架不影响审核结论，重新上架不需要重新审核。

### 2.2 三条硬不变量

全部由服务端强制，前端绕不过去：

| 不变量 | 强制点 | 理由 |
| --- | --- | --- |
| ① `published = 1` 必须伴随 `status = 'approved'` | `updateWorkMeta` 收到 `published: true` 而当前 `status !== 'approved'` → 400 | 让"未过审的东西上了架"在接口层就不可能发生 |
| ② 公开查询显式带 `AND status = 'approved'` | `listPublishedWorks` / `getPublishedWork` 的 WHERE | **不依赖①成立**。①是防手滑，②是防万一。公开路径的正确性不应该建立在另一个约束没被违反之上 |
| ③ `rejected` 之后磁盘上已无文件 | `rejectWork` 里 `removeQuietly(image_key)` + `removeQuietly(thumb_key)`，删文件幂等 | 后台渲染 `rejected` 行时不能出 `<img>`（会 404 破图），改渲染文字占位 |

### 2.3 为什么审核态与作品共用一张表

备选方案是拆成 `submissions`（审核表）+ `works`（展示表）两张，通过时跨表搬数据。**不采用**，理由：

- 图片 key 只有一份。不拆表时 `createWork → replaceWorkImage` 的现有代码整条能复用；拆表则要么搬文件，要么两个 key 指向同一文件然后两边都得记得更新。
- 「已下架」和「已拒绝」语义完全不同，拆表会让这两个状态分散在两张表里，后台两个列表极易维护错。
- `published` 已经在管可见性了，`status` 是正交的一维，两个布尔/枚举不冲突。

代价：审核历史和展示品混在同一张表里。但量级上完全可接受 —— 这是站主一个人的站，待审队列永远在几十条以内。

---

## 3. 数据库设计

### 3.1 追加的列

在 `server/db.ts` 的 `CREATE TABLE works` 块里补上新列（**新库路径**），并在 `ensureColumn` 段落里补上（**老库路径**）：

```ts
// 新库：works 表 DDL 内追加
status           TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
board_w          INTEGER NOT NULL DEFAULT 0,
board_h          INTEGER NOT NULL DEFAULT 0,
bean_count       INTEGER NOT NULL DEFAULT 0,
color_count      INTEGER NOT NULL DEFAULT 0,
estimate_minutes INTEGER NOT NULL DEFAULT 0,
upload_token     TEXT    NOT NULL DEFAULT '',

// 老库：幂等追加
ensureColumn('works', 'status', "TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))");
ensureColumn('works', 'board_w', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('works', 'board_h', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('works', 'bean_count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('works', 'color_count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('works', 'estimate_minutes', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('works', 'upload_token', "TEXT NOT NULL DEFAULT ''");

// 审核队列：按状态倒序查
ensureIndex('idx_works_status_created', 'works(status, created_at DESC)');
```

### 3.2 每个字段的语义与决策

| 字段 | 语义 | 决策与理由 |
| --- | --- | --- |
| `status` | 审核态 | **默认值取 `pending` 而不是 `approved`**：漏写 status 的行（新增字段、手工 SQL 插数据）会落到"不公开"而不是"直接对外可见"。默认值是失败安全的那一端 |
| `board_w` / `board_h` | 图纸格数，如 `87 × 62` | 存**格数**而不是 `"1:1.4"` 字符串。比例可以从两个整数现算，改展示精度不用洗数据；而存字符串的话要防用户传 `"1:999"` 这类离谱值 |
| `bean_count` | 实际画出的豆子数（已去背景） | 与前端 `beanCount` 同口径：统计 `mask` 中未被去掉的格数 |
| `color_count` | 图纸用到的色号种数 | 与前端 `legend.length` 同口径：色卡里有几行就是几种颜色 |
| `estimate_minutes` | 预估装配工时，**分钟数** | 存数字不存文案。前端 `formatAssemblyHours` 的文案将来若从"约 3 小时"改成"约 3 小时 30 分"，历史数据不需要迁移 |
| `upload_token` | 第二步上传图用的一次性令牌 | 见 §5.2。`randomBytes(16).toString('hex')` = 32 位 hex。图片写入成功后清空成 `''`，于是"这张图已经传过了"这件事由 `upload_token === ''` 直接判定 |

### 3.3 迁移策略

全部走 `CREATE TABLE IF NOT EXISTS` / `ensureColumn` / `ensureIndex` 三条既有幂等路径，**没有一条是 `DROP` 或改写既有列**：

- 新库：`CREATE TABLE` 直接建好全部 8 列
- 老库：7 条 `ensureColumn` 依次追加。存量行全部落成 `status='pending'` / `published=1` 的组合 —— 按不变量①这是非法组合，但它们**本来就要被 §9 的清库脚本删掉**，且在脚本跑之前它们会被②挡住（`status != 'approved'` 全部不可见），即"清库前图库是空的"。

> 这里刻意**不**写一条 `UPDATE works SET status='approved'` 的回填。理由：那会把"未过审"和"已过审"在数据上混成同一个值，而这次改动的全部意义就是这两者分开。存量数据的正确归宿是被清掉，不是被洗成 approved。

### 3.4 公开查询的改动

```sql
-- 改前
WHERE w.published = 1
-- 改后
WHERE w.published = 1 AND w.status = 'approved'
```

`listPublishedWorks` 的 `q` 搜索分支与 `COUNT(*)` 分支必须**字面一致**（既有注释已经强调过这点，`hasMore` 会因此一直显示）。三处 WHERE 都要带上新条件。

`getPublishedWork` 改为：

```ts
if (!row || row.published !== 1 || row.status !== 'approved') return null;
```

草稿、未过审、已拒绝一律返回 `null`，与既有注释的立场一致：**不区分"不存在"和"不可见"，避免用状态码探测**。

### 3.5 索引影响

| 索引 | 变化 |
| --- | --- |
| `idx_works_published_created (published, created_at DESC)` | 不变。公开列表仍只按 `published` 过滤 + 按 `created_at` 排序，`status` 是过滤完 ≤10 行之后的残余判断，走不上索引但也几乎不花钱 |
| `idx_works_published_likes (published, likes DESC, created_at DESC, id DESC)` | 不变，hot 排序路径同理由 |
| `idx_works_status_created (status, created_at DESC)` | **新增**。后台审核队列按状态倒序取，两条查询（`status = ?` 和计数）都精确命中 |

---

## 4. 投稿配额与限流

### 4.1 指纹与计数

复用 `likeFingerprint` 的全部口径（同一个盐 `WORKS_IP_SALT`、同一个 `\0` 分隔符、同一个 `isoDay` UTC 日期、同样的截断 16 位 hex），只是**去掉作品 ID 那一段** —— 投稿时作品还不存在：

```ts
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
```

进程内一个 `Map<指纹, 当日已投件数>`，每天一个 Map，跨天轮转（与 `rotateDayIfNeeded` 同一套写法）。**每指纹每日上限 3 件**，第 4 件返回 429 + 中文文案。

`works` 表**不落任何 IP 派生数据**：配额只活在内存里，和点赞去重保持同一条隐私立场。

| 决定 | 理由 |
| --- | --- |
| 包含 User-Agent | 沿用点赞已拍板的取向：同一 IP 换浏览器算两个人；多人共用一个出口 IP（公司 / 学校 / 运营商 NAT）时也能各自投 |
| 包含 UA 是**有意的收紧方向的反面** —— 它让配额更容易被绕过 | 后果是"轮换 UA 就能多投"。这是接受的：配额挡的是随手刷，定向攻击的兜底是审核本身 —— pending 永远不公开，攻击者投进来的东西站主一眼就能看到并拒绝 |
| 上限 3 件 / 天 | 单件成品图 1–5 MB。3 件/天/指纹对一个真实用户足够（正常用户不会一天投 9 张），对磁盘是有限暴露 |

### 4.2 为什么不加 `allowLike` 那种 1 次/秒令牌桶

投稿是**两步**请求（先占 id、再传图），第二步紧接着第一步，中间只隔着一次二维码生成（几十毫秒）。`LIKE_RATE_LIMIT_MS = 1000` 的令牌桶按 IP 计时，小图纸时两步间隔可能不足 1 秒 —— **正常用户会把自己撞出去**。

所以投稿的防线只有两道：**每日 3 件配额** + **现有 `MAX_IMAGE_BYTES`（5 MB）体积上限**。不引入新的瞬时限流。

### 4.3 已知的弱点

- **进程重启当日配额清零**：与点赞去重同一个前提（systemd 单进程部署）。重启后每人的 3 件回到 0。将来横向扩展需要换成 Redis，届时两处一起换。
- **轮换 UA 可绕过**：见上表。审核是真正的闸门。
- 指纹 IP 来自 `req.clientIp`（`x-forwarded-for` 首段），可被客户端伪造。与点赞同一处境。

---

## 5. API 设计

### 5.1 第一步：创建投稿记录

```
POST /api/public/works                      免登录
Content-Type: application/json

{ "title": "我的第一个作品", "boardW": 87, "boardH": 62,
  "beanCount": 3814, "colorCount": 42, "estimateMinutes": 190 }

→ 201 { "id": 128, "uploadToken": "9f2c1a…" }
```

| 参数 | 校验 | 失败 |
| --- | --- | --- |
| `title` | 必须 string；`trim()` 后**非空**；截断到 200 字符 | 400 `名称不能为空` / 超长静默截断 |
| `boardW` / `boardH` | 必须正整数；`<= 500`（与前端 `GRID_PRESETS` 上限同档） | 400 |
| `beanCount` | 必须正整数；`<= 250_000` | 400 |
| `colorCount` | 必须正整数；`<= 221`（MARD 色板总数） | 400 |
| `estimateMinutes` | 必须非负整数；`<= 100_000` | 400 |

**数字一律用 `Number.isInteger` 判定，非法直接 400，绝不静默转 0。** 理由：这些数字会原样出现在审核队列和作品详情页上，一个被静默转成 0 的 `beanCount` 会让站主以为这张图是空图、让访客以为「0 颗豆子」，而且没有任何报错。

**执行顺序是「参数校验 → 配额检查 → INSERT」，配额在参数校验之后。** 这与点赞接口「令牌桶排在存在性校验之前」是相反的顺序，理由是二者的代价结构不同：

- 点赞的令牌桶排在前面，是为了在**任何 SQL 之前**掐掉洪峰。
- 投稿这一步只做 JSON 解析、数字校验和一次 INSERT，不碰磁盘（真正的 5 MB 文件传输在第二步，而那一步被第一步已消耗的配额和 `upload_token` 的一次性语义双重挡着）。这里省下的开销远小于"用户把名称打错一个字，400 了，结果白扣掉 3 件配额里的 1 件"这种体验损失。

所以：名称为空的 400 不消耗配额；合法请求才会 `allowSubmission()` 占一个名额。INSERT 本身失败（DB 故障）时名额不退还 —— 那种情况下站主重启后端就清零了，不必为一个罕见路径写补偿逻辑。

**投稿只填名称，不填描述。** 需求里弹窗只要求"图片的名称"，所以 `description` 不进 payload，落成空串（`normalizeDescription(undefined)` 的既有行为）。站主日后可以在后台补写 —— 与 `title` 一样受现有受控草稿逻辑保护。

### 5.2 第二步：上传带码成品图

```
POST /api/public/works/:id/image            免登录
Content-Type: multipart/form-data

image       File   必填，image/png | jpeg | webp，<= 5 MB
thumb       File   可选，image/webp
uploadToken string 必填

→ 200 { "ok": true, "id": 128 }
```

**必须校验的四件事**，缺一不可：

1. `:id` 存在
2. `row.status === 'pending'`
3. `row.upload_token === 上传的 token`
4. `row.image_key` 为空（这张图还没传过）

第 3、4 条在正常写入路径下是等价的 —— `attachSubmissionImage` 用**一条** `UPDATE` 同时写 `image_key` 并把 `upload_token` 清空，两者不可能不同步。第 4 条仍然保留，是为了让"图已存在"这个失败原因在错误信息里单独可辨（而不是笼统的"凭证无效"），代价只是一次整数判空。

**为什么必须比对令牌，不能只靠 IP 校验**：`works.id` 是 `AUTOINCREMENT` 整数，完全可猜。不校验的话，任何人都能 `POST /api/public/works/7/image` 把一张任意图挂到别人的待审记录上 —— 既污染审核队列，又能把别人的投稿换成自己的图。`upload_token` 是 128 位随机值，只在第 ① 步的响应里出现一次。

比对用 `===` 即可，不上 `timingSafeEqual`：令牌是 128 位随机值，猜不中，时序差在这个规模下不构成实际攻击面。既有 `auth_tokens` 也是同一档强度。

### 5.3 后台接口

| 方法 | 路径 | 变化 |
| --- | --- | --- |
| `GET` | `/api/admin/works?status=pending\|approved\|rejected\|all` | **新增可选参数**，默认 `all`（保持既有行为不变）。带 `status` 时 WHERE 加等值条件 |
| `POST` | `/api/admin/works/:id/approve` | **新增**。`status='pending'` → `'approved'` 且 `published=1`。已是 approved 时**幂等返回**（重复点击不报错）。是 rejected 时 400（终态不可回退） |
| `POST` | `/api/admin/works/:id/reject` | **新增**。`status='rejected'`、`published=0`、删两个文件。已是 rejected 时幂等 |
| `PUT` | `/api/admin/works/:id` | 行为不变 + 新增不变量①的检查 |
| `DELETE` | `/api/admin/works/:id` | 行为不变（删行 + 删文件） |
| `POST` | `/api/admin/works` | **删除** |
| `POST` | `/api/admin/works/:id/image` | **删除** |

`AdminWorkDetail` 响应形状追加 `status`、四个参数字段。公开的 `WorkSummary` **不加**参数（列表页不需要，塞进去是白给流量），`WorkDetail` **加**（详情页要展示）。

### 5.4 后台上传接口为什么整条删掉

删入口、删数据、留接口（备选 B）或留一个 403 分支（备选 C）都被否了：

- 留着 `POST /api/admin/works` 就意味着 multer 双文件字段解析、缩略图 mime 校验、`createWork` 里那段"缩略图写失败要回收孤儿文件"的逻辑、`makeThumb` 的 WebP 回落判断 —— 全都还要维护、还要测，而**没有任何调用方**。
- 留 403 分支更糟：多一个永远走不到的分支，而且它同样需要测（要断言 403 及文案）。
- 将来若真要恢复后台直传，从 git 历史里取回这两个路由 + `createWork` 即可，代价远低于长期维护一条死路径。

连带清掉：前端 `WorksTab.tsx` 里的 `makeThumb` 函数（移给投稿流程复用）与整个 `works-admin-upload` 区块。

---

## 6. 前端：投稿流程

### 6.1 按钮与弹窗的位置

`aside.left` 里，`<ParamPanel>` 之下、`<ExportPanel>` 之上：

```tsx
<UploadZone ... />
<ParamPanel ... />
<SubmitWorkButton result={result} ... />   {/* 新增 */}
<ExportPanel ... />
```

移动端 `.layout-3col` 在 ≤900px 变成单列堆叠（`src/styles/global.css:108`），aside 整体排在最上面，所以按钮落在参数面板下方、预览区上方。**不放进 `MobileActionBar`** —— 那里已经有上传和导出，再塞第三个操作会让底部条拥挤；投稿是低频动作，不值得占那条固定槽。

### 6.2 弹窗内容

- 一个名称输入框（`maxLength=200`，必填）
- 四个参数的**只读摘要**：
  - `图纸比例` → `87 × 62 格`
  - `豆子数量` → `3,814 颗`
  - `颜色数量` → `42 种`
  - `预估时间` → 走 `formatAssemblyHours(estimateAssemblyHours(beanCount))`
- 「确认投稿」/「取消」两个按钮
- 投稿进行中时禁用重复点击

参数摘要不是装饰：这四组值就是即将写进审核表的内容，让用户在点确认之前看到，比事后在审核队列里才发现"颜色数写错了"要好。

### 6.3 两步上传的时序

```
① 渲染：renderBeadBoard → renderCompositeFromBoard({ qrBandPx: SUBMISSION_QR_PX }) → drawWatermark
   ── 白带此时已按 SUBMISSION_QR_PX 预留好，但还不画码
② POST /api/public/works  { title + 四参数 }  →  { id, uploadToken }
③ 生成 /works/:id 的二维码（version 3, ECC L, margin 4, width 111）→ dataURL
   → new Image() → drawWorksQr(canvas, img)
④ canvas.toBlob('image/png')  +  canvas 压 480px WebP 缩略图
⑤ POST /api/public/works/:id/image  (multipart: image + thumb + uploadToken)
⑥ 成功 → toast「投稿成功，等审核通过就会出现在作品库」
```

**关键在于 ① 和 ③ 之间的顺序**：白带高度必须在渲染时就知道，而码要等 id。解法是把码的**输出尺寸固定成常量** `SUBMISSION_QR_PX = 111`（与构建期 `scripts/gen-qr.mjs` 的 version 3 / ECC L / module 3px / 静区 4 模块产物同尺寸），渲染时按它预留 `qrBandPx`，第 ③ 步生成时强制产出同样 111×111，两者严丝合缝。

**`version: 3` 必须显式指定，不能让 qrcode 库自己挑版本。** 这是本设计里最容易踩的坑，`src/pipeline/qr.ts` 的既有注释已经点名过一次：

> 模块边长必须是整数 px，任何非整数缩放都会把模块糊在一起，糊了就扫不出来。

具体推演：`margin: 4` + version N 时，二维码占 `(N 的模块数 + 8) × 3px` 的网格。version 3 是 29 模块 → 37 × 3 = **111px，整数**。但 `https://<站点>/works/128` 这个短 URL 会被库判成 **version 1**（21 模块 → 29 × 3 = 87px），再被强行拉宽到 111 就变成 111/29 = **3.83px 每模块** —— 非整数，模块边缘被插值糊掉，**成品图上的码扫不出来**，而且图看起来"有个码"，只有真扫的时候才发现。

所以第 ③ 步的 options 是**钉死的常量组合**，不是"建议写法"：

```ts
export const SUBMISSION_QR_PX = 111;
// version 3 → 29 模块 + 静区 8 = 37 列 → 37 × 3px = 111px，模块边长恰为整数 3。
// 不钉死 version 就会被库挑成 v1（87px），拉到 111 后模块边长变 3.83px，码糊掉扫不出。
export const SUBMISSION_QR_OPTIONS = {
  version: 3, errorCorrectionLevel: 'L', margin: 4, width: SUBMISSION_QR_PX,
} as const;
```

版本容量余量：`version 3` @ ECC L 可容纳 53 字节二进制，当前 URL 约 42 字节（`https://www.xn--muu023g.xyz/works/1234567`）。`id` 增长到 10 位之前都安全，超出时 qrcode 库会**抛错**而不是降级 —— 那是显式失败，比糊码好。

**一道单测守住这个耦合**（见 §10）：断言用 `SUBMISSION_QR_OPTIONS` 生成 `https://<站点>/works/9999999` 的码，输出恰好 111×111。将来有人改了 version / margin / width 里的任何一个、或改了 `SUBMISSION_QR_PX`，测试立刻红 —— 而"白带高度"和"码的实际边长"这两个数字分处两个模块，正是最容易被改失衡的地方。

**为什么 `drawWorksQr` 一行都不用改**：它吃的是 `HTMLImageElement` 并读 `naturalWidth`。第 ③ 步把 dataURL 灌进 `new Image()` 等 onload，就得到一个和构建期静态 PNG 完全同型的对象。同一支画码代码同时服务"全站码"和"per-work 码"。

### 6.4 渲染函数提取

`pipeline.ts` 的 `exportMulti` 循环体（约 50 行：采样 → 量化 → 去背景 → 简化颜色 → 紧裁/补方板 → 渲染 board → 渲染 composite → 水印 → 码 → blob → 下载）提取成独立函数：

```ts
export async function renderBoardComposite(
  src: ImageData, gridSize: number, opts: {
    cellPx: number; removeBackground: boolean; simplifyColors: boolean;
    tightCrop: boolean; colorBudget: ColorBudgetLevel;
    qrBandPx: number;       // 预留带高，0 = 不留带
  },
): Promise<{ canvas: HTMLCanvasElement; boardW: number; boardH: number }>
```

`exportMulti` 在循环里调它再 `triggerDownload`；投稿路径调它、**不下载**、而是等到 id 到了再补画码然后 `canvasToBlob` 去上传。

**为什么不直接给投稿写一份渲染代码**：那 50 行里有去背景检测、颜色简化预算、紧裁裁剪与补方板 —— 每一处都是会 bug 的逻辑，且两边一旦漂移，用户"下载的图"和"投稿的图"就会长得不一样。两份实现的差异是纯粹的负债。

### 6.5 `qrcode` 依赖搬家

`qrcode` 现在是 **devDependency**，只被构建期的 `scripts/gen-qr.mjs` 用。前端运行时要用它生成 per-work 码 → **移到 `dependencies`**。

```ts
// 动态 import：只在用户真的点投稿时加载，主 bundle 不背这个体积
const QR = await import('qrcode');
const dataUrl = await QR.toDataURL(`${SITE_ORIGIN}/works/${id}`, SUBMISSION_QR_OPTIONS);
```

用 `toDataURL` 而不是 `toCanvas`，正是为了复用 `drawWorksQr`（它吃 `HTMLImageElement`，而 dataURL 灌进 `new Image()` 就是同型对象）。options 必须原样传 `SUBMISSION_QR_OPTIONS`，**不要让调用方覆盖 `version`** —— 理由见 §6.3。

`SITE_ORIGIN` 取 `window.location.origin`（生产走 nginx 同源，与 `scripts/site-config.mjs` 的 `SITE_URL` 一致）。

---

## 7. 前端：后台与详情页

### 7.1 `WorksTab` 改造

删掉整个 `works-admin-upload` 区块，改为两个并列区块：

**待审核**（`status = 'pending'`）
- 缩略图（有图时）/「图片未上传」占位（`image_key` 为空时）
- 名称输入框（复用现有 `drafts` 受控草稿模式）
- 四个参数的只读展示
- 「通过」「拒绝」两个按钮
- `image_key` 为空的孤儿行同样可以被拒绝 —— 见 §11

**作品集**（`status = 'approved'`）
- 缩略图、名称、描述（现有受控草稿逻辑原样保留）
- 「下架 / 上架」按钮（现有 checkbox 改成显式按钮，文案随 `published` 切换）
- 「删除」按钮
- 审核态徽章（已下架的加一个灰色「已下架」标记）

**已拒绝**（`status = 'rejected'`）
- 不渲染 `<img>`（文件已删，会破图），渲染「源文件已删除」文字占位
- 提供「彻底删除」按钮（`DELETE /api/admin/works/:id`，连行带（不存在的）文件一起清掉）

所有审核操作走**乐观更新 + 失败回滚**，沿用现有 `patchWork` 的"只合并本次改动字段"写法 —— 避免并发 PUT 乱序时旧快照把新状态盖回去。

### 7.2 详情页自动导航

`WorkDetailPage.tsx` 现在的 404 分支是渲染「作品不存在或已下架」+ 一个 `<a href="/works">` 按钮。改成自动跳：

```tsx
if (error || !work) {
  useEffect(() => {
    const t = setTimeout(() => window.location.replace('/works'), 800);
    return () => clearTimeout(t);
  }, []);
  return ( /* 「作品不存在或已下架，正在返回作品库…」 */ );
}
```

三个要点：

- **`replace` 而不是赋值 `location.href`**：无效详情页不应该堆进浏览器历史，否则用户按「后退」会被反复弹回这里。
- **保留 800ms 提示**：直接跳走会让用户以为点了没反应；0 延迟则提示文案根本来不及渲染。800ms 足够读完一行字，对 Playwright 也完全不算长。
- **文案不加区分**：「不存在」和「未过审」对访客是同一件事（拿不到这张图），文案必须是同一句。区分开等于告诉访客这个 id 曾经存在过。

`matchRoute`（`src/router.ts:37`）里 `/works/0` 已经回 home，`/works/abc` 匹配不上数字也回 home —— 路由层不用改。

---

## 8. 文件改动清单

**新增**

| 文件 | 职责 |
| --- | --- |
| `src/components/SubmitWorkButton.tsx` + `.css` + `.test.tsx` | 投稿按钮 + 名称弹窗 + 两步上传编排 |
| `src/api/submissions.ts`（或并入 `src/api/works.ts`） | 投稿两步的 API 客户端 |
| `scripts/reset-gallery.mjs` | 一次性清空图库（备份 DB → 清表 → 删文件） |
| `tests/unit/server/submissions.test.ts` | 配额、参数校验、令牌校验单测 |

**改动**

| 文件 | 改动 |
| --- | --- |
| `server/db.ts` | `works` 补 7 列 DDL + 7 条 `ensureColumn` + 1 条 `ensureIndex` |
| `server/works.ts` | `createSubmission` / `attachSubmissionImage` / `approveWork` / `rejectWork`；`submissionFingerprint` + 配额 Map（与 `likeFingerprint` 同文件同风格）；`listPublishedWorks` 加 `status='approved'`；`listAllWorks` 加 status 过滤；`updateWorkMeta` 加上架不变量检查；`WorkDetail` 加参数字段 |
| `server/index.ts` | 加 2 个公开投稿路由 + 2 个后台审核路由；**删** 2 个后台上传路由 |
| `src/pipeline/pipeline.ts` | 提取 `renderBoardComposite`，`exportMulti` 改为调用它 |
| `src/pipeline/qr.ts` | 新增 `renderSubmissionQr(id)`；`drawWorksQr` **不改** |
| `src/api/works.ts` | `WorkDetail` 加参数字段；加投稿两步的调用函数 |
| `src/App.tsx` | 插 `<SubmitWorkButton>` |
| `src/pages/admin/WorksTab.tsx` | 删上传区块与 `makeThumb`；加审核队列与状态操作 |
| `src/pages/WorkDetailPage.tsx` | 404 自动导航 |
| `package.json` | `qrcode` → `dependencies` |
| `README.md` | 改写「作品库」章节 + 新增「投稿与审核」章节 |
| `docs/DEPLOY.md` | 清库脚本的运行方式 |

---

## 9. 一次性清库

`scripts/reset-gallery.mjs`，提交进仓库（可审计、可重跑），在服务器上手动执行一次：

**部署后、脚本跑之前，作品库会显示为空 —— 这是预期的，不是故障。** 存量行在 `ensureColumn` 之后全部落成 `status='pending'`，被公开查询的 `AND status='approved'`（§3.4）全部挡掉。脚本的作用只是把这批已经不可见的行和它们的文件从磁盘上物理清掉。站主不必担心"数据没了"，`.bak` 里有一份完整的。

```
1. 读 PINGDOU_DATA_DIR（默认 /var/lib/pingdou）
2. stats.db → stats.db.bak-<timestamp>
3. sql.js 打开 db，DELETE FROM works，打印删除行数
4. rm -rf media/works/ 下所有文件，打印删除文件数与释放字节数
5. 打印「跑完确认没问题后可以把 .bak 删掉」
```

`node_modules` 只用 `sql.js`（已在 `dependencies`），脚本零新增依赖。

README 与 DEPLOY 文档写明：部署后在服务器跑 `node scripts/reset-gallery.mjs`，**跑之前确保 `.bak` 成功生成**。

---

## 10. 测试策略

| 层 | 覆盖 |
| --- | --- |
| `tests/unit/server/` | 配额：同指纹第 4 件 429；跨天重置；参数校验的 5 类 400；令牌不匹配 400；非 pending 状态上传 400；approve 幂等；reject 幂等且删文件；上架未过审作品 400；公开查询不含 pending/rejected |
| `src/pipeline/qr.test.ts`（新增） | **二维码尺寸守卫**：用 `SUBMISSION_QR_OPTIONS` 生成 `https://<站点>/works/9999999`，断言输出恰好 111×111。这条测试是"白带预留高度"与"码的实际边长"这两个分处两个模块的数字之间唯一的连接点 —— 任何人改动 `version` / `margin` / `width` / `SUBMISSION_QR_PX` 中的任何一个，它立刻红 |
| `src/components/SubmitWorkButton.test.tsx` | 无 `result` 时按钮禁用；弹窗开合；名称为空不可提交（且不消耗配额）；确认后两步的调用顺序（先 POST 元数据再 POST 图片）；第二步失败给中文错误 |
| `src/pages/admin/WorksTab.test.tsx` | 待审核/作品集/已拒绝三块渲染；通过与拒绝的乐观更新；拒绝行不渲染 `<img>`；无图的 pending 行可被拒绝；后台上传入口已不存在 |
| `src/pages/WorkDetailPage.test.tsx` | 404 后触发导航（用 `vi.useFakeTimers` 或对 `location.replace` 打桩） |
| `tests/e2e/` | 端到端：投稿 → 后台待审核出现 → 通过 → 公开列表可见 → 详情页可见 |

既有测试全部保持通过。`WorksListPage.test.tsx` 和 `server/works.test.ts` 若断言了 `SELECT` 语句或响应字段，需要按新形状更新。

---

## 11. 已知取舍

### 11.1 孤儿 pending 行不做自动清理

点开投稿弹窗、点了确认，然后在图生成或上传完成前关掉页面 —— 会留下一条 `status='pending'`、`image_key` 为空的行。

- **代价**：这些行在 `works` 表里堆积，每行几百字节。**磁盘零占用**（本来就没有文件）。
- **不自动清理的理由**：待审核行在后台审核队列里一眼可见，站主看到"图片未上传"的行点一下「拒绝」就清掉了。为一个后台可见、能一键清理的东西写定时清理任务，是纯粹的复杂度。
- **为此必须做到**：后台列表要能显示 `image_key` 为空的行；`rejectWork` 对不存在的文件删除必须是幂等成功（`removeQuietly` 已经是这个语义）。

### 11.2 配额重启清零

见 §4.3。个人站场景下可接受。

### 11.3 详情页 800ms 延迟

见 §7.2。是为了让用户看清发生了什么，不是为了美。

### 11.4 `rejected` 行保留 `image_key` 字符串

拒绝后磁盘文件已删，但 `image_key` 列里还留着那个 `works/<hex>.png` 的 key 值。**不改成空串**，理由有两个：`image_key` 是 `NOT NULL`，改它要么放宽约束要么存 `''`（而 `publicUrl('')` 会得到一个指向目录的畸形 URL）；而留着这个值是**审计线索** —— 站主日后能看出"这件作品曾经的文件叫什么"。代价是后台渲染 `rejected` 行时必须显式不画 `<img>`，这条规则写在代码注释里。
