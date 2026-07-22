# 拼豆图生成器

将任意图片转为带色号标注、色号对照表和水印的 MARD 拼豆合成图，纯前端实现。

## 特性

- 使用当前 MARD 221 色色板生成实时拼豆预览
- 网格大小可调（50×50 ~ 500×500，长边）
- 可选自动去背景
- 可选自动简化颜色：将少于 10 颗且 CIE Lab Delta E 76 色差不大于 8 的近似色合并到已使用的主色
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

```bash
npm install
npm run dev              # 启动开发服务器 (http://localhost:5173)
npm run typecheck        # 类型检查
npm run build            # 生产构建 (产物 dist/)
npm test                 # 跑单测 (vitest)
npx vitest run tests/bench   # 跑性能基准（控制台输出日志）
npx playwright install       # 安装 Playwright 浏览器（首次）
npm run test:e2e         # 跑 Playwright E2E
```

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

### 静态托管（仅前端，不含统计）

```bash
npm run build
```

`dist/` 可部署到 Vercel / Cloudflare Pages / GitHub Pages 等静态托管。

### 含统计服务（Node.js）

需要 Node.js 18+。同时提供前端 + `/statics` 后台。

```bash
cp .env.example .env  # 修改 STATICS_PASSWORD
npm install
npm run start         # 构建前端+服务端，启动 http://localhost:3000
```

访问 `http://localhost:3000/statics` 输入 `STATICS_PASSWORD` 查看统计。

环境变量：
- `STATICS_PASSWORD`（必填，至少 6 位）— `/statics` 后台登录密码
- `PORT`（默认 3000）
- `IP_HASH_SALT`（可选，未设置则启动时随机生成）
- `STATS_DB_PATH`（默认 `data/stats.db`）

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
