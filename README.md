# 拼豆图生成器

将任意图片转为带色号标注、色号对照表和水印的 MARD 拼豆合成图，纯前端实现。

## 特性

- 使用当前 MARD 221 色色板生成实时拼豆预览
- 网格大小可调（50×50 ~ 500×500，长边）
- 可选自动去背景
- 可选自动简化颜色：持续合并少于 10 颗的颜色；正常图案会保留每种颜色至少 10 颗。色差仅用于选择当前最接近的有效合并目标
- 导出带色号标注、色号对照表和水印的合成 PNG（水印可在参数面板关闭，默认开启；投稿图始终保留）
- 图片全程在浏览器本地处理，不会上传到服务端
- 色板缓存到 IndexedDB，减少重复加载

## 技术栈

React 18 + TypeScript + Vite 5 + Canvas 2D + CIE Lab 色差计算 + IndexedDB。
WebGL2 / Web Worker 路径已搭好但 MVP 用纯 JS 量化（性能满足预算）。

## 数据来源

MARD 拼豆色板（当前 221 种颜色）参考自
[Zippland/perler-beads](https://github.com/Zippland/perler-beads)，
从其 `colorSystemMapping.json` 反向整理得到 `{id, rgb, name}` 列表。

## 开发

端口约定：**前端 5173，后端 3000**，dev / prod 一致。

```bash
npm install
npm run dev              # 启动前端 Vite dev (http://localhost:5173)
npm run dev:server       # 启动后端 Express (http://localhost:3000)
npm run dev:full         # 同时启动前后端（concurrently，日志分流）
npm run typecheck        # 类型检查
npm run build            # 生产构建前端 (产物 dist/)
npm run build:server     # 生产构建后端 (产物 dist-server/)
npm test                 # 跑单测 (vitest)
npx vitest run tests/bench   # 跑性能基准（控制台输出日志）
npx playwright install       # 安装 Playwright 浏览器（首次）
npm run test:e2e         # 跑 Playwright E2E
```

Vite dev / preview 已配置 `/api` 代理到 `http://localhost:3000`，
前端 fetch 仍写绝对路径 `/api/...`，**不要在源码里写 3000**。
后端地址可通过环境变量 `BACKEND_URL` 覆盖（例如反向代理到其他机器）。

## 项目结构

```
src/
├── types.ts                 # 共享类型
├── palette/schema.ts        # 色板加载 + 校验
├── data/palette.ts          # IndexedDB 缓存
├── pipeline/
│   ├── sampler.ts           # 像素采样（box-average + 边界格不产混合色）
│   ├── quantizer.canvas.ts  # 颜色量化（纯 JS）
│   ├── quantizer.webgl.ts   # WebGL2 量化器（占位）
│   ├── colorSimplifier.ts   # 自动合并低频近似色
│   ├── renderer.ts          # 色块图渲染
│   ├── annotator.ts         # 色号标注图渲染
│   ├── recipe.ts            # 配方表 CSV
│   ├── exporter.ts          # 浏览器下载
│   ├── pipeline.ts          # 主线程编排器
│   └── README.md            # 架构决策记录
├── hooks/                   # React hooks (usePalette/usePipeline/useThrottle)
├── components/              # UI 组件
└── workers/                 # Web Worker 入口
shaders/
└── quantize.frag.glsl       # 颜色量化 fragment shader
tests/
├── unit/                    # vitest 单测
├── bench/                   # 性能基准
├── e2e/                     # Playwright E2E
└── fixtures/                # 测试素材
```

## 部署

### 端口约定

- 前端 **5173** — 由 `vite preview` 独立托管（产物 `dist/`）
- 后端 **3000** — 由 `node dist-server/server/index.js` 独立托管（仅 API）

### 推荐：同域名反向代理（最简单）

最干净的方案是用 nginx / Caddy 把 443/80 反代到 5173 + 3000，避免跨域。
前端代码里只写 `/api/...`，Nginx 把 `/api/*` 转给后端。

```nginx
# /etc/nginx/sites-enabled/pingdou.conf
server {
  listen 80;
  server_name your.domain;

  # 前端静态资源
  location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # 后端 API（注意 /api 必须在 / 之前匹配）
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Cookie $http_cookie;
    proxy_pass_header   Set-Cookie;
  }
}
```

> ⚠️ 鉴权用的是 cookie（`credentials: 'include'`），所以代理时一定要把 `Cookie` /
> `Set-Cookie` 头原样透传，否则登录态会丢。

### 部署（CI 已配置）

`.github/workflows/main.yml` 里只有一个 `deploy` job。它**不自己装依赖、不自己构建**，
只在服务器上跑两步：

```bash
git fetch origin main && git reset --hard origin/main   # CI 做的
bash scripts/deploy-server.sh                            # 脚本做的
```

`scripts/deploy-server.sh` 依次做：补 node 的 PATH → **`npm install`** → `npm run build:server`
+ `npm run build` → 把 `dist/` 拷到 `/var/www/pingdou` → 检查运行时目录与 systemd env →
`systemctl restart pingdou-backend` + `nginx -t && systemctl reload nginx` → 健康检查。

三点值得记住：

- **没有 `npm ci`**。仓库不提交 `package-lock.json`，脚本用的是 `npm install`。
- **`npm install` 是无条件的**，不再看 `node_modules` 目录在不在。服务器上的
  `node_modules` 是上一次部署留下的，「目录存在」不代表「包是新的」—— 新增或升级
  依赖后跳过安装，构建期就会 `ERR_MODULE_NOT_FOUND` 直接把部署打断。
- **`prebuild` 只跑 `scripts/gen-sitemap.mjs`**（只用 Node 内置模块，零外部依赖）。
  站内已经没有「构建期产物」了 —— 二维码是投稿时在浏览器里现场编码的，
  构建期不需要任何第三方依赖。给 `prebuild` 加新依赖前先想清楚：它会跟着每次部署一起跑。

如果不想走 GitHub Actions，手动部署时同样用 `npm install`，别照搬 `npm ci`：
```bash
# 在服务器上
cd /root/project/pingdou
bash scripts/deploy-server.sh   # 推荐：和 CI 走同一条路径，行为完全一致

```

（后端由 systemd 的 `pingdou-backend` 托管、前端静态产物由 nginx 托管，**不需要**再
nohup 起 vite preview 或 `npm run start:backend`；见 [`docs/DEPLOY.md`](./docs/DEPLOY.md)
与 [`docs/nginx-https-setup.md`](./docs/nginx-https-setup.md)。）

环境变量（**生产部署必填**，详见 [`docs/DEPLOY.md#运行时数据管理`](./docs/DEPLOY.md#运行时数据管理)）：
- `PINGDOU_DATA_DIR` — 运行时数据根目录，**下面所有路径都从它派生**。
  不设时默认 `/var/lib/pingdou`（`server/paths.ts`），生产建议通过 systemd 显式注入
- `PORT`（默认 `3000`） — 后端端口
- `BACKEND_URL`（默认 `http://localhost:3000`） — Vite dev/preview 代理目标

> **已退役、设了也没用的变量**：`PRODUCTS_JSON_PATH` / `PRODUCTS_IMAGES_DIR` /
> `STATS_DB_PATH` / `ROOT_PASSWORD`。代码里已不再识别它们，照着设置不会报错但也
> **不产生任何效果**；`scripts/deploy-server.sh` 只会在检测到它们仍留在 systemd
> 配置里时告警并提示删除。`ROOT_PASSWORD` 从未真正生效过：默认 seed 密码是硬编码的
> `12345678`，首次启动后必须改密。

## 作品库

作品库里的每一张图都由访客投稿，带一枚**只属于它自己**的二维码：111×111，
扫码直达这件作品的详情页 `/works/:id`。导出/下载的图**不带码** —— 那张图不进
作品库，扫码无处可去，底边留白也只是打印时的空白边。

- **二维码在哪生成**：用户点投稿时在浏览器里现场编码（`renderSubmissionQr`），
  `qrcode` 用动态 `import()` 拉，不进首屏 bundle。站点上没有任何构建期生成的二维码文件。
- **规格钉死**：version 3 / ECC L / 静区 4 模块 / 111×111 = 37 列 × 3px，模块边长必须是整数。
  version 是钉死的而不是让库自己挑 —— version 1 / 2 只有 29 / 33 列，111 除不开。
  规格在 `SUBMISSION_QR_OPTIONS`（`src/pipeline/qr.ts`）。
- **二维码落位**：`composite.ts` 的 `qrBandPx` 只把底部边距加宽，页眉 / 图纸 / 色卡
  的纵向布局一行不动 —— 色卡既不会被压也不会重排。生成或加载失败时自动降级为
  「留一条空白带、不画码」，投稿照常成功。
- **作品库页面**：`/works` 列表（缩略图网格 + 加载更多）、`/works/:id` 详情
  （大图 + 「长按图片保存」提示 + 「下载原图」按钮 + 点赞按钮）。
  同一个图片 URL 承担两种用途：被 `<img>` 引用是内联渲染（可长按），
  被带 `download` 的 `<a>` 引用是直接下载 —— 不需要 `Content-Disposition`。
- **搜索与排序**：列表页顶部按标题实时搜索（防抖 300ms），搜索词与排序同步进 URL
  （`replaceState`，不污染历史栈），刷新、分享、从详情页后退回来都保留；排序可切
  「最新 / 最热」。每页 10 条 + 「加载更多」。排名不随点赞实时重排 —— 列表顺序一律以
  服务端本次响应为准，点赞只改数字。
- **点赞**：列表页每张卡片与详情页各有一个心形按钮，文案是「N **次**点赞」而不是
  「N 人喜欢」（限流粒度是「每 IP + 每浏览器 每图每天一次」且不支持取消，同一人次日
  可再赞，计数会累加）。点击立即乐观更新 +1，失败回滚并提示；被限流时给中文提示
  而不是英文原文。
- **赞数怎么存**：赞数是 `works.likes` 上的**整数计数列**，列表查询直接读这一列 ——
  没有任何 JOIN、没有 `GROUP BY` 聚合。早期版本把每次点赞作为一个行存进 `work_likes` 表，
  列表每次都要对整张表做一次分组聚合，而那张表只增不减、永不回收：站点每被访问一次
  就多扫一遍越来越大的表，这正是当初要改掉的「存库查询压力大」。
- **去重怎么算**：去重**不落库**，是进程内一个「当天已赞过」的哈希集合，跨天自动
  换新。去重指纹 = `hash(IP + User-Agent + 作品ID + 日期)`，**包含 User-Agent** ——
  这样同一 IP 换浏览器算两个人，多人共用一个出口 IP（公司 / 学校 / 运营商 NAT）
  时也各自能赞。集合有上限（2 万条/天），因为 IP 和 UA 都由客户端伪造；
  触顶后整份丢弃（去重暂时失效、可以多赞）而不是拒绝新赞。
  **代价：重启后当天的去重记忆清零，同一个访客当天可以再赞一次。**
- **进货渠道**：作品全部来自**用户投稿**（生成页参数面板下方），不再有后台上传入口。
  投稿先进待审核队列，站主通过后才出现在公开列表里。缩略图由浏览器压成 480px WebP
  一起提交（服务端不引入 `sharp`），列表页只加载缩略图，下载仍是原始 PNG。
- **上下架**：只有 `published=1` **且** `status='approved'` 的作品出现在公开列表和详情里。
  `GET /api/admin/works` 的响应比公开 detail 多 `published` 与 `status` 两个字段
  （服务端 `toAdminDetail` 单独序列化），公开接口**不带**这两个字段。
- **二维码**：**只有投稿图有码**，指向 `/works/:id`，扫描直达这一件作品；
  导出/下载的图一律不带码。实现都在 `src/pipeline/qr.ts`。
- **存储**：`works` 表只存 key（`works/<16hex>.png`），不存 URL，对外地址一律由
  `server/storage/` 里的 `StorageDriver.publicUrl()` 现算。换 S3/OSS 只需新增一个
  driver 实现文件 + 改 `server/storage/index.ts` 一行，老数据一行不用洗。
- **文件位置**：`<PINGDOU_DATA_DIR>/media/works/`；生产由 nginx 直读（见
  `docs/nginx-https-setup.md` 的 `location ~ ^/media/works/`）。

API：
- `GET /api/public/works?limit&offset&q&sort` — 公开列表（无需登录）。`q` 按标题模糊搜索
  （`%` `_` 按字面转义），`sort` 为 `latest`（默认）或 `hot`（按点赞数）；
  默认每页 10 条
- `GET /api/public/works/:id` — 公开详情（**未过审 / 已下架 / 不存在一律 404**，三者不区分，
  避免用状态码探测某个 id 是否曾经存在）
- `GET /api/public/works/:id/like` — 点赞状态查询（`{ likes, liked }`，只读）
- `POST /api/public/works/:id/like` — 点赞，返回 `{ ok, likes, alreadyLiked }`。
  **每个 IP + 每个浏览器对每张图每天限一次**（进程内指纹集合保证幂等，不落库）。
  写入是单条 `UPDATE works SET likes = likes + 1 WHERE id = ? RETURNING likes` ——
  走主键、无聚合，**同步**返回，因此 `likes` 是服务端真实计数而不是前端自己编的数字。
  另有进程内令牌桶按 IP 限频（1 次/秒），排在作品存在性校验**之前**，超了返回 429
  且一条 SQL 都不发。点赞不可取消；同一访客次日可再赞，所以计数是「次数」不是「人数」。
  令牌桶与去重集合都只在本进程内生效（当前是 systemd 单进程部署）；横向扩展需换 Redis。
- `GET /api/admin/works` / `PUT /api/admin/works/:id` /
  `POST /api/admin/works/:id/approve` / `POST /api/admin/works/:id/reject` /
  `DELETE /api/admin/works/:id` — 后台（需 admin）。**后台已没有建作品 / 换图的接口**
  （`POST /api/admin/works` 与 `POST /api/admin/works/:id/image` 随投稿通道一起删除了）

## 投稿与审核

访客在生成页填完参数后点「投稿」，填一个名称即可提交。投稿图**就是用户屏幕上
那张图** —— 直接吃 `PipelineResult` 渲染，不重新采样，所以预览与投稿永远一致。

- **两步入库**：先 POST 元数据（名称 + 四个图纸参数）拿 `id` 与一次性
  `uploadToken`，再用 `id` 生成二维码画进已预留白带的画布，最后上传带码成品图。
  白带高度在渲染时就固定成 111px —— version 3 的码是 29×29 模块，加静区 4 后
  共 37 列，37 × 3px = 111px，模块边长正好是整数 3px，扫得出来。
  缩略图由浏览器压成 480px WebP 一起提交；压不出来就降级成「无缩略图」
  （服务端留空 `thumb_key`，前端用原图当缩略图），不是致命错误。
- **`id` 可猜，所以第二步必须校验 `uploadToken`**。`works.id` 是自增整数，
  只靠它的话任何人都能把图挂到别人的待审记录上。令牌是 128 位随机值
  （`randomBytes(16)`，32 个 hex 字符），写入图片后随同 `image_key`
  在同一条 `UPDATE` 里清空，因此只对那一次上传有效。
- **投稿参数**：图纸格数（宽 × 高）、豆子数量、颜色数量、预估工时（存**分钟数**，
  展示时现算文案）。这四项既用于后台审核队列，也用于作品详情页展示。
  服务端对四个数字做严格校验（必须是范围内的**整数**，非整数一律 400），
  不做静默兜底 —— 悄悄把非法值变成 0 会让审核者以为那是张空图。
- **配额**：每个 IP + 每个浏览器每天 3 件，指纹与点赞同一套口径
  （`hash(IP + User-Agent + UTC 日期 + 同一个盐)`，只去掉作品 ID 那一段），
  只在进程内计数、跨天轮转，`works` 表不落任何 IP 派生数据。
  **重启当日配额清零** —— 与点赞去重同一前提，横向扩展需换 Redis。
  轮换 UA 可以绕过这个上限，这是有意换来的：兜底是审核队列本身，
  与其把配额做成攻防战，不如让站主在 pending 列表里一眼看到并拒绝。
- **审核态**：`pending → approved` / `pending → rejected`，另有与审核正交的
  `published` 上下架。通过会自动上架；拒绝时**物理删除源文件**（原图与缩略图），
  `image_key` 字符串保留在库里作审计线索（所以 rejected 行在后台显示
  「源文件已删除」而不是裂图）。
- **硬不变量**：`published=1` 必须伴随 `status='approved'`。后台 PUT 想上架一件未过审的
  作品会被拒（`updateWorkMeta` 抛 `WorkStateError`，作品行一个字节都不改），
  **返回 400** —— 含义是「请求不合法」，**不是**「作品不存在」。
  404 在这条路由上仍然只表示「没有这件作品」：改一个不存在的 id 得到的就是 404。
  （此前该路由把 `updateWorkMeta` 的所有异常一律映射成 404，于是「存在但不能这么改」
  被报成「不存在」，站主会去数据库里找、去翻备份，方向整个是错的。）
  公开列表与详情另有 `AND status='approved'` 的显式过滤，
  **不依赖**上面那条不变量成立 —— 公开路径的正确性不该建立在另一条约束没被违反之上。
- **未过审 / 已下架 / 不存在的 id**：`GET /api/public/works/:id` 一律 404（不区分三者，
  避免用状态码探测），详情页 800ms 后自动 `location.replace('/works')`。

API：
- `POST /api/public/works` — 投稿第一步，`201 { id, uploadToken }`；参数非法 400，
  当日额度用尽 429
- `POST /api/public/works/:id/image` — 投稿第二步，multipart（`image` + `thumb` +
  `uploadToken` + `width` + `height`），`200 { ok, id }`
- `POST /api/admin/works/:id/approve` / `POST /api/admin/works/:id/reject` — 审核（需 admin）
- `GET /api/admin/works?status=pending|approved|rejected|all` — 后台列表（需 admin）
  （不传 `status` 等于全量）

非目标：用户侧没有投稿查询入口与结果通知，投稿不可编辑不可撤回。

> **作品来源切换是一次性的、不可逆的运维动作。** 存量图库要物理清空时，
> 必须**先停服**再跑 `scripts/reset-gallery.mjs`；在服务运行中跑它，
> 内存库会把已删的作品行写回磁盘，得到「有作品行、图片却不存在」的坏图库，
> **这种情况连备份都救不回来**。完整步骤与脚本内部的执行顺序见
> [`docs/DEPLOY.md`](./docs/DEPLOY.md#一次性清空作品库2026-10-17-作品来源切换)。

## 统计功能

后台 `/statics` 提供：

- UV（独立访客，按 IP 哈希去重）
- PV（页面浏览）
- 商品链接点击数（按商品 ID 排名）
- 图片导出次数
- 按时间桶（日）聚合的事件总数（折线图）
- 支持 1/7/30/90 天时间范围切换

数据存储在 SQLite 文件里，路径由 `PINGDOU_DATA_DIR` 派生：`server/paths.ts` 里
`dbPath = join(DATA_DIR, 'stats.db')`，**没有 `db/` 这一层**。所以默认配置下它落在
`/var/lib/pingdou/stats.db`（不是 `/var/lib/pingdou/db/stats.db`），**随服务器物理文件
一起持久**，重启不丢失。要备份就备份整个 `/var/lib/pingdou/`，见
[`docs/DEPLOY.md#备份与恢复`](./docs/DEPLOY.md#备份与恢复)。

API 端点：
- `POST /api/track` — 上报事件（无需鉴权）
- `POST /api/session/touch` — 刷新会话（UV 去重）
- `POST /api/auth/login` — 登录
- `GET /api/statics/summary?days=N` — 拉取汇总（需登录）
- `GET /api/health` — 健康检查

## 高亮联动 + 合成导出

- **固定放大预览**：预览区固定每格 24px，超出容器可滚动查看
- **实时色号对照表**：右侧列出当前图像用到的色块/色号/名称/数量（count desc 排序）
- **悬停联动**：鼠标悬停对照表某一行时，拼豆图上所有该色号格子会高亮（半透明黄色覆盖层）
- **合成导出**：点击"导出合成图"下载一张 PNG，拼豆图（含色号文字标注）在上、色号对照表在下

技术细节见 `docs/superpowers/specs/2026-07-12-zoom-legend-composite-design.md`。

## 许可

仅供学习使用。MARD 商标与色号归其所有者。
接入广告：  git revert ec58a41 
