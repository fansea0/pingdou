# 拼豆图生成器 - 设计文档

- **日期**: 2026-07-12
- **作者**: 通过 brainstorming 流程生成
- **状态**: 待实施

## 一、需求文档

### 1.1 背景与目标

拼豆（Perler Beads）是一种用小塑料管状珠子摆出图案，再熨烫定型的手工，目前在国内年轻群体中热度极高。玩家痛点：**将任意图片转成"由 MARD 128 色拼豆珠构成的网格图 + 色号标注图 + 配方表"**，从而可以直接照着买豆、照着拼。

本项目交付一个**纯前端网页**，用户上传图片 → 选择参数 → 实时预览 → 导出三件套，零部署、零服务端依赖。

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| US-1 | 作为玩家，我想上传一张照片，得到一张能直接打印照拼的拼豆图 | 上传后 ≤30s 内出现预览，三件套 PNG/PNG/CSV 全部下载可用 |
| US-2 | 作为玩家，我希望能调节网格大小（珠子颗粒度）和颜色数 | 50×50 ~ 500×500 范围内连续可调 |
| US-3 | 作为玩家，我希望预览能反映调参效果，而不是要我点"生成" | 拖动参数 ≤300ms 内预览更新 |
| US-4 | 作为玩家，我希望能选择是否抖动（保留细节 vs 干净硬边） | 切换后实时重算 |
| US-5 | 作为玩家，我希望高分辨率导出，能直接打印 A4/A3 | 单元默认 32px，200×200 输出 ≥6400×6400px |
| US-6 | 作为玩家，我希望导出物中包含色号，方便购买对照 | 标注图 + 配方表（CSV） |

### 1.3 范围 / 非目标

**范围内**：
- 单图处理，无历史记录，无账号体系
- MARD 官方 128 色（参考 Zippland/perler-beads）
- 纯前端实现，零后端
- 三件套导出（高清图 / 标注图 / 配方表）

**非目标（明确不做）**：
- 逐格手动改色
- 用户账号 / 云端保存
- 多图批量处理
- 移动端 App（响应式可用但不专门优化）
- 非 MARD 色板（Perler / Hama 等）支持
- 服务端处理路径

### 1.4 成功标准

- 100×100 网格首屏预览 ≤300ms，调参响应 ≤300ms
- 500×500 网格量化 ≤2.5s
- Chrome / Edge / Safari 三家主流浏览器均可用
- 无 WebGL 时降级到 Canvas 2D（仅支持 ≤100×100），超规格清晰报错
- 离线可用（MARD 色板数据 IndexedDB 缓存）

## 二、实现方案

### 2.1 技术栈

| 层 | 选型 | 理由 |
|----|------|------|
| UI 框架 | React 18 + TypeScript | 组件化、主流、社区资源充足 |
| 构建 | Vite | 启动快、HMR 体验好 |
| 计算层 | WebGL (主) + Canvas 2D (兜底) | 颜色量化天然并行，GPU fragment shader 一次跑完全图 |
| 多线程 | Web Worker | 量化计算不阻塞 UI |
| 测试 | Vitest + Playwright | 单测 + E2E |
| 状态管理 | React useState/useReducer + Zundo | 简单场景无需 Redux；Zundo 提供撤销/重做（如后续需要） |
| 样式 | CSS Modules / Tailwind（待定） | 后续在 plan 阶段确定 |

### 2.2 架构图

```
┌────────────────────────────────────────────────────────┐
│                   UI 层 (React)                        │
│  - UploadZone                                            │
│  - ParamPanel (网格/颜色数/抖动/导出像素密度)             │
│  - PreviewCanvas (实时缩略图)                             │
│  - ExportPanel (三件套下载)                               │
└────────────────────┬───────────────────────────────────┘
                     │ 事件 / Promise
┌────────────────────▼───────────────────────────────────┐
│              Pipeline 编排器 (主线程)                    │
│  - 串联各模块                                            │
│  - 节流 200ms                                            │
│  - token 机制保障"最后一次参数生效"                       │
└────────────────────┬───────────────────────────────────┘
                     │
        ┌────────────┼────────────────┐
        ↓            ↓                ↓
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│ 像素采样器   │ │ 颜色量化器   │ │ 渲染器 + 导出器  │
│ (纯函数)     │ │ (WebGL/Worker│ │ (Canvas 2D)      │
│              │ │  + Canvas   │ │                  │
│              │ │  2D兜底)    │ │                  │
└──────────────┘ └──────────────┘ └──────────────────┘
        │                │
        └────────┬───────┘
                 ↓
        ┌────────────────────┐
        │ MARD 128 色板 JSON │
        │ (data/mard.json)   │
        └────────────────────┘
```

### 2.3 模块边界与接口

| 模块 | 输入 | 输出 | 依赖 | 是否纯函数 |
|------|------|------|------|-----------|
| **MARD 色板** | — | `Palette` (`{ id, rgb, name }[]`) | 无 | 是 |
| **像素采样器 (sampler)** | `ImageData` + `gridSize` | `ImageData` (gridSize²) | 无 | 是 |
| **WebGL 量化器 (quantizer.webgl)** | `ImageData` + `Palette` + `enableDither` | `Uint8Array` (索引矩阵) | WebGL 上下文 / Web Worker | 否 |
| **Canvas 2D 量化器 (quantizer.canvas)** | 同上 | 同上 | Canvas 2D | 否（仅兜底 ≤100×100） |
| **抖动器 (ditherer)** | `ImageData` + `Palette` + `enableDither` | `Uint8Array` | Floyd-Steinberg | 是 |
| **渲染器 (renderer)** | `Uint8Array` + `Palette` + `cellPx` | `HTMLCanvasElement` | Canvas 2D | 是 |
| **标注器 (annotator)** | `Uint8Array` + `Palette` + `cellPx` + `fontPx` | `HTMLCanvasElement` | Canvas 2D | 是 |
| **配方表 (recipe)** | `Uint8Array` + `Palette` | `Blob` (CSV) | 无 | 是 |
| **导出器 (exporter)** | `Canvas`×N + `Blob` | 触发下载 | 无 | 是 |

### 2.4 核心数据流（端到端时序）

```
[上传] File → ImageData (保留原分辨率)
   ↓
[参数变更] 节流 200ms 触发重算，token 自增
   ↓
[采样] ImageData + gridSize → ImageData (gridSize²)
   ↓
[量化] ImageData + Palette + enableDither → Uint8Array 索引矩阵
       (WebGL: Web Worker 里跑；Canvas 2D: 主线程同步)
   ↓
[回传] Worker onmessage → 检查 token，匹配则更新
   ↓
[预览渲染] 索引矩阵 + Palette + cellPx(预览) → Canvas → 显示
   ↓
[导出] (用户点导出按钮时)
       - 渲染高清 PNG (cellPx 导出值，默认 32)
       - 渲染色号标注图 (cellPx ≥24 强制)
       - 生成配方表 CSV
       - 触发三连下载
```

### 2.5 UI 状态机

| 状态 | 触发 | UI 表现 |
|------|------|---------|
| `idle` | 首次进入 | 显示上传区 + 色板预览 |
| `loading` | 上传后解析图片 | Skeleton + 进度 |
| `ready` | 首次量化完成 | 预览 + 参数面板 + 导出按钮 |
| `recomputing` | 参数变更后 | 预览半透明 + "计算中" |
| `exporting` | 点导出 | 模态进度条 |

## 三、数据存储

### 3.1 文件 / 静态资源

| 路径 | 类型 | 用途 |
|------|------|------|
| `public/data/mard.json` | 静态 JSON | MARD 128 色板数据（色号、RGB、名称） |
| `index.html` | HTML | 入口 |

> **数据来源**：以 [Zippland/perler-beads](https://github.com/Zippland/perler-beads) 仓库为参考依据，提取并清洗 MARD 官方 128 色板。代码中显式标注数据来源。

### 3.2 浏览器存储

| 存储 | 用途 | 生命周期 |
|------|------|---------|
| IndexedDB (store: `palette`) | MARD 色板缓存 | 首次加载后缓存；版本号变化时清除 |
| LocalStorage (key: `ui-prefs`) | 用户偏好（最近一次参数） | 持久 |
| （无） | 不保存原图，不保存生成的拼豆图 | — |

### 3.3 不引入数据库

无后端，无数据库。色板 JSON 静态引入；用户作品不入库（用户自管文件）。

## 四、todo_list

### 4.1 实施任务（高层）

- [ ] 脚手架：Vite + React + TS + Vitest + Playwright
- [ ] MARD 128 色板 JSON 数据准备（含来源声明 + JSON schema）
- [ ] 像素采样器 (`sampler.ts`) + 单测
- [ ] Canvas 2D 量化器（reference 实现）
- [ ] WebGL 量化器（含 fragment shader + Web Worker 包装）+ vs reference 单测
- [ ] 抖动器 (`ditherer.ts`) + 单测
- [ ] 渲染器 (`renderer.ts`) + 单测
- [ ] 标注器 (`annotator.ts`) + 单测
- [ ] 配方表 (`recipe.ts`) + 单测
- [ ] 导出器 (`exporter.ts`)
- [ ] Pipeline 编排器（含节流、token 机制）
- [ ] UI：UploadZone / ParamPanel / PreviewCanvas / ExportPanel
- [ ] UI 状态机 + 错误兜底（WebGL 不可用提示）
- [ ] 性能 benchmark（控制台输出）
- [ ] Playwright E2E 测试覆盖核心流程
- [ ] README（含 demo 图、数据来源致谢）

### 4.2 验收清单（Definition of Done）

完整验收用例见 §5。

## 五、常量、枚举、状态映射表

### 5.1 网格尺寸约束

| 常量 | 值 | 说明 |
|------|----|-----|
| `MIN_GRID` | 50 | 最小网格 50×50 |
| `MAX_GRID_WEBGL` | 500 | WebGL 主路径上限 |
| `MAX_GRID_CANVAS_FALLBACK` | 100 | Canvas 2D 兜底下限 |
| `DEFAULT_GRID` | 100 | 默认网格 |
| `GRID_PRESETS` | [50, 75, 100, 150, 200, 300, 500] | UI 预设档位 |

### 5.2 导出像素密度

| 常量 | 值 | 说明 |
|------|----|-----|
| `DEFAULT_EXPORT_CELL_PX` | 32 | 默认一格 32px → 200×200 输出 6400×6400 |
| `EXPORT_CELL_PX_OPTIONS` | [16, 24, 32, 48] | UI 档位 |
| `MIN_CELL_PX_FOR_ANNOTATION` | 24 | 低于此值不输出标注图（糊） |

### 5.3 颜色与抖动

| 常量 | 值 | 说明 |
|------|----|-----|
| `PALETTE_SIZE` | 128 | MARD 128 色 |
| `DEFAULT_DITHER` | false | 默认不抖动（硬边锐利） |
| `COLOR_TOLERANCE_OPTIONS` | [16, 32, 48, 64, 96] | 颜色上限档位（应用到色板子集） |

### 5.4 性能预算

| 操作 | 预算 |
|------|------|
| 100×100 量化 | ≤300ms |
| 200×200 量化 | ≤800ms |
| 500×500 量化 | ≤2500ms |
| 高清 PNG 导出 200×200 | ≤2000ms |
| 配方表生成 | ≤100ms |

### 5.5 状态机映射（参考 §2.5）

| 前置事件 | 状态 |
|---------|------|
| 页面加载 | `idle` |
| 上传文件解析中 | `loading` |
| 首次量化完成 | `ready` |
| 参数变更 | `recomputing` |
| 点导出按钮 | `exporting` |
| 导出完成 | `ready` |

## 六、接口协议

本项目无服务端，故无 REST/GraphQL 接口协议。所有"接口"为模块函数签名：

```ts
// sampler.ts
export function sampleImage(
  src: ImageData,
  gridSize: number
): ImageData;

// quantizer.webgl.ts
export class WebGLQuantizer {
  constructor(palette: Palette);
  quantize(
    image: ImageData,
    enableDither: boolean
  ): Promise<Uint8Array>; // 返回索引矩阵
}

// quantizer.canvas.ts (兜底)
export function quantizeWithCanvas2D(
  image: ImageData,
  palette: Palette,
  enableDither: boolean
): Uint8Array;

// ditherer.ts
export function floydSteinbergDither(
  src: ImageData,
  palette: Palette
): Uint8Array;

// renderer.ts
export function renderPaletteImage(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  cellPx: number
): HTMLCanvasElement;

// annotator.ts
export function renderAnnotatedImage(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  cellPx: number,
  fontPx: number
): HTMLCanvasElement;

// recipe.ts
export function generateRecipeCSV(
  indices: Uint8Array,
  palette: Palette
): Blob;
```

UI 层通讯约定：

```ts
// pipeline.ts (主线程编排器)
type PipelineEvent = {
  token: number;          // 自增，匹配最新参数
  indices: Uint8Array;    // 量化结果
  gridSize: number;       // 当前网格
};

class Pipeline {
  async run(params: ProcessParams, token: number): Promise<PipelineEvent | null>;
  // 返回 null 表示 token 已过期，结果丢弃
}
```

## 七、服务发布

本项目无服务端。"发布"即前端构建部署：

- **构建命令**: `npm run build`
- **产物路径**: `dist/`
- **目标平台**: 静态托管（Vercel / Cloudflare Pages / GitHub Pages 任选）
- **缓存策略**: `index.html` 不缓存；`assets/*` 强缓存 + 文件名 hash
- **离线**: 首次访问后缓存 MARD 色板到 IndexedDB；service worker 可选（v2 加入）

## 八、CR 点（自查清单）

实施时以及 code review 时关注以下点：

### 8.1 代码质量
- [ ] 模块边界清晰，无跨层引用（如 UI 直接调 quantizer 而不经过 pipeline）
- [ ] 纯函数模块可在 Node 跑测试，无 DOM 依赖
- [ ] 抖动 / 量化这种算法逻辑有 reference 实现 + 交叉验证
- [ ] MARD 色板数据从静态 JSON 加载，不出现在业务代码中

### 8.2 性能
- [ ] 量化在 Worker 跑，不阻塞主线程
- [ ] 200ms 节流落实，用户拖参数不会触发大量重复计算
- [ ] token 取消机制落实，旧计算结果不再回写状态
- [ ] 导出 ≥6400×6400 PNG 时 `canvas.toBlob` 用 `image/png` 不要 `image/jpeg`
- [ ] 大图导出前评估内存（500×500 × 32px × 4 通道 ≈ 122MB，必要时提示）

### 8.3 错误处理
- [ ] WebGL 不可用 → 检测 → 兜底（仅 ≤100×100） → 超出明确报错
- [ ] Worker 崩溃 → 主线程 catch → 友好提示，不白屏
- [ ] 文件类型校验：仅 `image/*` MIME，且 magic number 二次校验
- [ ] 文件大小 > 20MB → warn 但不阻断

### 8.4 数据合规
- [ ] MARD 色板数据来源在 README + 代码注释中明示
- [ ] 不上传用户图片到任何服务器
- [ ] 无第三方分析 / 追踪脚本（除可选的 Vercel Analytics）

### 8.5 可测试性
- [ ] 关键算法（量化、抖动）有 reference JS 实现，用于 cross-check
- [ ] UI 流程有 Playwright E2E 覆盖
- [ ] benchmark 自动跑并输出到 console + 写入 json 报告

## 九、实施步骤

按"自底向上"实施，先算法后 UI：

### Step 1: 基础设施
1. Vite + React + TS 脚手架
2. Vitest + Playwright 配置
3. 项目目录结构、路径别名、ESLint + Prettier

### Step 2: 数据与纯算法
4. 准备 `public/data/mard.json`（含数据来源声明 + JSON schema 校验）
5. 实现 `sampler.ts` + 单测
6. 实现 `ditherer.ts` (Floyd-Steinberg) + 单测
7. 实现 `renderer.ts` / `annotator.ts` / `recipe.ts` + 单测

### Step 3: 量化器（核心难点）
8. Canvas 2D 量化器 (reference) + 单测
9. WebGL fragment shader 编写
10. WebGL 量化器包装 + Web Worker
11. WebGL vs Canvas reference 单测（颜色分布一致性抽样校验）

### Step 4: 编排与 UI
12. Pipeline 编排器（节流 + token）
13. UI 组件：UploadZone / ParamPanel / PreviewCanvas / ExportPanel
14. 状态机 + 错误兜底

### Step 5: 集成与验收
15. Playwright E2E
16. 性能 benchmark
17. README + demo 图
18. 跨浏览器手测（Chrome / Edge / Safari）

### Step 6: 可选增强（v2）
- Service Worker 离线
- PWA 安装
- 撤销 / 重做（Zundo）
- 多语言支持

---

## 附录 A: 参考资料

- MARD 色板数据参考：[Zippland/perler-beads](https://github.com/Zippland/perler-beads)（代码中显式致谢）
- Web 颜色量化：[Leptonica / Median-cut](https://en.wikipedia.org/wiki/Median_cut) 作为理论参考（实际实现用最近邻查找 + 可选抖动）
- Floyd-Steinberg 抖动：[Wikipedia](https://en.wikipedia.org/wiki/Floyd%E2%80%93Steinberg_dithering)
