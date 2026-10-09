# 拼豆图生成器

将任意图片转为带色号标注、色号对照表和水印的 MARD 拼豆合成图，纯前端实现。

## 特性

- 使用当前 MARD 221 色色板生成实时拼豆预览
- 网格大小可调（50×50 ~ 500×500，长边）
- 可选自动去背景
- 可选自动简化颜色：持续合并少于 10 颗的颜色；正常图案会保留每种颜色至少 10 颗。色差仅用于选择当前最接近的有效合并目标
- 导出带色号标注、色号对照表和水印的合成 PNG
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
│   ├── sampler.ts           # 像素采样（box-average）
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

### 前后端独立部署（CI 已配置）

GitHub Actions `.github/workflows/main.yml` 会在服务器上：
1. `git pull` 拉新代码
2. 杀掉旧的前后端进程
3. `npm ci` 装依赖（如有变更）
4. `npm run build:server` 编译后端
5. `npm run build` 编译前端
6. 先后端 (3000) → 前端 (5173) 各起一个进程，独立 PID / 日志

如果不想走 GitHub Actions，本地手动部署：
```bash
# 在服务器上
cd /root/project/pingdou
npm ci
npm run build:server           # 编译后端到 dist-server/
npm run build                  # 编译前端到 dist/

# 终端 A
PORT=3000 nohup npm run start:backend   > backend.log  2>&1 &

# 终端 B
nohup npx vite preview --host 0.0.0.0 --port 5173 > frontend.log 2>&1 &
```

环境变量：
- `PORT`（默认 `3000`） — 后端端口
- `STATS_DB_PATH`（默认 `data/stats.db`） — sql.js 持久化文件
- `BACKEND_URL`（默认 `http://localhost:3000`） — Vite dev/preview 代理目标

## 统计功能

后台 `/statics` 提供：

- UV（独立访客，按 IP 哈希去重）
- PV（页面浏览）
- 商品链接点击数（按商品 ID 排名）
- 图片导出次数
- 按时间桶（日）聚合的事件总数（折线图）
- 支持 1/7/30/90 天时间范围切换

数据存储在本地 SQLite 文件 `data/stats.db`，**随服务器物理文件一起持久**，重启不丢失。

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
