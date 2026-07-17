# 拼豆图生成器 — 背景误伤 + 导出水印 Design

> **For:** 拼豆图生成器 (pingdou)
> **Date:** 2026-07-18
> **Status:** Awaiting user review

## 背景与目标

两个独立但同批处理的变更：

1. **Bug 修复**：`自动去背景` 开启时，人物内部的白色（眼睛、衣服、留白）被一并识别为背景 → 这些格子在导出图上变成棋盘格透明，丢失细节。
2. **功能新增**：导出合成图（bead 图 + 色号对照表）时，在右下角打上 `拼豆.xyz` 半透明白色水印，作为品牌标识。

## Architecture

```
bgRemover.ts                   watermark.ts (新)
├── detectBackground()         ├── applyWatermark(canvas, options?)
├── buildBackgroundMask()      └── DEFAULT_WATERMARK_OPTIONS
└── filterMaskByBorderConnectivity()  ← 新增
        (mask, width, height) → mask'
        只保留触达 4 边的 8 邻接连通分量

pipeline.ts
└── process() / exportMulti()
        → renderComposite()
        → applyWatermark(canvas)        ← 新增调用点
        → canvasToBlob()
        → triggerDownload()
```

`filterMaskByBorderConnectivity` 在 `buildBackgroundMask` 返回后、`forEach` 覆盖 `result.mask` 之前调用。`applyWatermark` 在 `renderComposite` 返回 canvas 后、`canvasToBlob` 之前调用。两条变更都改 `pipeline.ts` 中的两处（`process` 和 `exportMulti`）。`exportComposite` 是未使用的死代码，不动。

## Components

### `filterMaskByBorderConnectivity(mask, width, height): Uint8Array`

- 输入：`bgRemover` 输出的 0/1 `Uint8Array`（length = W * H）
- 输出：与输入等长的 0/1 数组，**只保留触达图像 4 边的 8 邻接连通分量**
- 算法：8 邻接 BFS
  1. 扫描 4 边（顶行、底行、左列、右列），把所有 `mask === 1` 的像素入队并 `visited = true`
  2. BFS 扩散：每出队一格，8 邻接检查其邻居，邻居 `mask === 1 && !visited` 入队
  3. 遍历完，新 mask = `visited`
- 时间复杂度 O(W * H)；500 × 500 grid 一次扫一遍约 1ms
- 纯函数、零副作用

### `applyWatermark(canvas, options?): void`

```ts
export interface WatermarkOptions {
  text?: string;          // 默认 '拼豆.xyz'
  fontRatio?: number;     // 默认 0.025 → fontPx = clamp(min(W,H) * ratio, 14, 64)
  marginRatio?: number;   // 默认 0.6 → margin = fontPx * marginRatio
  fillStyle?: string;     // 默认 'rgba(255,255,255,0.65)'
  shadowColor?: string;   // 默认 'rgba(0,0,0,0.45)'
  shadowBlur?: number;    // 默认 4
}

export const DEFAULT_WATERMARK_OPTIONS: Required<WatermarkOptions>;

export function applyWatermark(
  canvas: HTMLCanvasElement,
  options?: WatermarkOptions
): void;
```

- 副作用：直接在传入 canvas 的 2D context 上画
- 锚点：右下角
- 文字位置：`textBaseline = 'alphabetic'`、`textAlign = 'right'`，坐标 `(canvasW - margin, canvasH - margin)`
- `ctx.font = 'bold {fontPx}px -apple-system, "PingFang SC", sans-serif'`，与 composite 现有字体一致

## Data flow

**Bg 修复：**

```
src        ─ImageData→  sampleImage           → sampled
sampled    ─ImageData→  detectBackground      → bg RGB
sampled    ─ImageData→  buildBackgroundMask   → mask0  (含内部白)
mask0      ─Uint8Array→ filterMaskByBorder…   → mask1  (仅外层白)
                            ↓
                          写入 result.mask
```

`pipeline.ts` 在 `process()` 和 `exportMulti()` 两处 `buildBackgroundMask` 之后插入 `filterMaskByBorderConnectivity`，结果赋值给 `mask`。

**水印：**

```
PipelineResult
  → renderComposite(...)
  → applyWatermark(canvas, options?)   ← 新增
  → canvasToBlob(canvas')
  → triggerDownload(blob, filename)
```

`pipeline.ts` 在 `exportMulti()` 的 `renderComposite(...) → canvasToBlob(...)` 之间插入 `applyWatermark(canvas)`。

## Error handling

| 函数 | 失败行为 |
|---|---|
| `filterMaskByBorderConnectivity` | 纯函数 O(W·H)，不抛错 |
| `applyWatermark` | `ctx` 为 null 时静默返回；字号 clamp 到 [14, 64]；不抛错 |

策略与 `bgRemover` 现有哲学一致 — 失败要保守。水印静默失败最多是图上没字，不会让导出挂掉；外层 `try/catch` 已经兜住导出循环。

## Testing

**`tests/unit/bgRemover.test.ts` 追加：**

- `filterMaskByBorderConnectivity` 单测：
  - 全 mask → 全保留
  - 中间孤岛 → 孤岛清零
  - 外环 + 内部孤岛 → 仅外环保留
  - 空 mask → 空 mask
  - 1×1 / 1×N / N×1 边界
- 集成：`detect + mask + filter` 验证"卡通人物 + 内部白眼睛"不丢眼睛

**`tests/unit/watermark.test.ts`（新文件）：**

- 默认 text === `'拼豆.xyz'`
- 文字画在右下角（取像素颜色：文字中心 alpha > 0，文字外侧 alpha = 0）
- 字号随 canvas 尺寸自适应（200×200 → 小字号，1000×1000 → 大字号）
- 自定义 `text` / `fontRatio` / `marginRatio` 生效
- 边界：1×1 canvas 不崩；`ctx` 为 null 静默返回

## 改动文件清单

- 新增 `src/pipeline/watermark.ts` — 水印工具
- 新增 `tests/unit/watermark.test.ts` — 水印单测
- 修改 `src/pipeline/bgRemover.ts` — 新增 `filterMaskByBorderConnectivity`
- 修改 `tests/unit/bgRemover.test.ts` — 追加连通域单测 + 集成测试
- 修改 `src/pipeline/pipeline.ts` — 两处插入连通域过滤 + 两处插入水印调用

## Out of scope

- 不动 `renderPaletteImage`（预览）的棋盘格行为
- 不动 `renderAnnotatedImage` 的色号标注逻辑
- 不动 corner 检测的 3 层 fallback 策略
- 不把水印加到预览 canvas（只加导出图）
- 不支持用户自定义水印文字（仅 `拼豆.xyz`）
