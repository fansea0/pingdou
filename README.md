# 拼豆图生成器

将任意图片转为 MARD 拼豆图的高清色块图 + 色号标注图 + 配方表，纯前端实现。

## 特性

- 上传图片 → 实时预览拼豆效果
- 网格大小可调（50×50 ~ 500×500，长边）
- 可选 Floyd-Steinberg 抖动
- 导出三件套：高清 PNG、色号标注 PNG（cellPx ≥ 24 时）、配方表 CSV
- 全程在前端运行，零上传，零服务端
- 离线可用（色板缓存到 IndexedDB）

## 技术栈

React 18 + TypeScript + Vite 5 + Canvas 2D + Floyd-Steinberg dithering + IndexedDB。
WebGL2 / Web Worker 路径已搭好但 MVP 用纯 JS 量化（性能满足预算）。

## 数据来源

MARD 拼豆色板（283 种颜色，编号 A01-A99 / B01-B99 / ...）参考自
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
│   ├── ditherer.ts          # Floyd-Steinberg 抖动
│   ├── quantizer.canvas.ts  # 颜色量化（纯 JS）
│   ├── quantizer.webgl.ts   # WebGL2 量化器（占位）
│   ├── renderer.ts          # 色块图渲染
│   ├── annotator.ts         # 色号标注图渲染
│   ├── recipe.ts            # 配方表 CSV
│   ├── exporter.ts          # 浏览器下载
│   ├── pipeline.ts          # 主线程编排器
│   └── README.md            # 架构决策记录
├── hooks/                   # React hooks (usePalette/usePipeline/useThrottle)
├── components/              # 4 个 UI 组件
└── workers/                 # Web Worker 入口
shaders/
└── quantize.frag.glsl       # 颜色量化 fragment shader
tests/
├── unit/                    # vitest 单测 (31 passing)
├── bench/                   # 性能基准
├── e2e/                     # Playwright E2E
└── fixtures/                # 测试素材
```

## 部署

构建产物在 `dist/`，可部署到任何静态托管（Vercel / Cloudflare Pages / GitHub Pages）。

## 高亮联动 + 合成导出

- **固定放大预览**：预览区固定每格 24px，超出容器可滚动查看
- **实时色号对照表**：右侧列出当前图像用到的色块/色号/名称/数量（count desc 排序）
- **悬停联动**：鼠标悬停对照表某一行时，拼豆图上所有该色号格子会高亮（半透明黄色覆盖层）
- **合成导出**：点击"导出合成图"下载一张 PNG，拼豆图（含色号文字标注）在上、色号对照表在下

技术细节见 `docs/superpowers/specs/2026-07-12-zoom-legend-composite-design.md`。

## 许可

仅供学习使用。MARD 商标与色号归其所有者。
