# 拼豆图：撤 + 修（不自适应）+ 预览随窗大 + 多图导出 - 设计文档

- **日期**: 2026-07-12
- **作者**: 通过 brainstorming 流程生成（**主动认错**：上一轮"自适应 + 缩放"语义理解完全错误）
- **状态**: 待实施
- **依赖**: 已存在的 MVP + 上一轮 UI 美化（commit `9d756e`）

## 一、需求文档

### 1.1 背景

上一轮（commit `5ea405a` ~ `85d8615`）实现了"自适应布局 + 缩放/平移"功能，但**完全理解错了用户需求**：

| 用户原话 | 我的实现 | 用户实际意图 |
|----------|---------|------------|
| "支持自适应尺寸" | 加 1024/1400px 断点 + `aspect-ratio: 1/1` 强制预览框正方形 | **导出图自适应原图比例**（不被裁切）|
| "页面端支持图片放大" | 加 ZoomToolbar + ctx.scale 位图缩放 + 拖动 | **预览画布随窗口变大**（CSS 拉伸）|

**直接后果**：
- composite 强制 gridSize²（正方形），对 16:9 输入图就是裁切/变形 → 用户明确指出"正方形导出来总是把图片截掉了"
- 加了一堆用户不要的 toolbar / 拖动交互

本 spec **主动认错**：
1. **撤销上一轮 5 个 commit**（zoom 相关）
2. **修复 composite 渲染**为按 outW/outH 矩形（不裁切）
3. **修复 PreviewCanvas**为跟随容器 CSS 拉伸
4. **重新设计 CSS**为暖色 + 软阴影 + 圆角
5. **新增多图导出**（额外勾选网格尺寸）

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| CM-1 | 作为玩家，我希望导出图按上传原图比例（不被裁切） | composite 用 outW/outH 而不是 gridSize² |
| CM-2 | 作为玩家，我希望预览画布随窗口变大而变大（看清细节） | canvas 元素 width/height = outW/outH × cellPx；CSS max-width:100% |
| CM-3 | 作为玩家，我希望拖窗口时预览实时跟着伸缩（不变形） | CSS `height: auto` 保持宽高比 |
| CM-4 | 作为玩家，我希望界面看起来更暖更柔和 | global.css 重设计：暖中性 + 软阴影 + 圆角 |
| CM-5 | 作为玩家，我希望能一次导出多种网格尺寸的成品 | ExportPanel 多选额外尺寸，"导出 N 张图片" |

### 1.3 范围 / 非目标

**范围内**：
- 撤 commit 5ea405a, 4fdfdb3, 1153548, 44f50f2, 85d8615
- PipelineResult 增加 outW/outH
- renderer.ts / annotator.ts 接受 outW/outH
- composite.ts 用 outW/outH 计算画布（不裁切）
- PreviewCanvas CSS 拉伸（不强制正方形）
- ExportPanel 多选交互
- pipeline.exportMulti 串行下载（100ms 间隔）
- global.css 暖色重设计

**非目标（明确不做）**：
- ❌ 任何 toolbar / 位图 ctx.scale 缩放
- ❌ 任何 toolbar / 拖动平移
- ❌ 响应式断点（1024/1400）
- ❌ aspect-ratio: 1/1（强制正方形已废）
- ❌ JSZip 依赖
- ❌ 撤销/重做
- ❌ 多图进度条

### 1.4 成功标准

- 16:9 输入图导出后，合成图里的拼豆图部分是 16:9 矩形，不是正方形
- 预览画布随窗口宽度实时缩放（不变形）
- 勾选 3 个额外尺寸 → 触发 4 次 PNG 下载（1 当前 + 3 额外）
- typecheck 0 错误；npm test ≥ 50 通过
- npm run build 通过

## 二、实现方案

### 2.1 文件清单

| 路径 | 动作 | 责任 |
|------|------|------|
| (git 操作) | revert 5 commit | 回到 9d756e 之上 |
| `src/types.ts` | 修改 | `PipelineResult` 增加 `outW, outH` |
| `src/pipeline/pipeline.ts` | 修改 | `process` 填充 `outW, outH`；新增 `exportMulti` |
| `src/pipeline/renderer.ts` | 修改 | 接受 `outW, outH` |
| `src/pipeline/annotator.ts` | 修改 | 接受 `outW, outH` |
| `src/pipeline/composite.ts` | 修改 | 用 outW/outH；canvas 尺寸公式改为矩形 |
| `src/pipeline/composite.test.ts` | 修改 | 测试用 outW/outH 矩形场景 |
| `src/components/PreviewCanvas.tsx` | 修改 | canvas 元素 width/height = outW/outH × cellPx；CSS 拉伸 |
| `src/components/ExportPanel.tsx` | 修改 | 多选额外尺寸 + "导出 N 张图片" |
| `src/App.tsx` | 修改 | 持有 exportGridSizes state；调 exportMulti |
| `src/styles/global.css` | 修改 | 暖色 + 软阴影 + 圆角；删除过时样式 |
| `tests/e2e/flow.spec.ts` | 修改 | 多图下载用例 |

### 2.2 架构图

```
用户上传原图 (例如 1920x1080)
   ↓
sampler.sampleImage: 按比例输出 outW=80, outH=45 (假设 gridSize=80)
   ↓
quantizeWithCanvas2D: indices (outW*outH = 3600 个)
   ↓
PipelineResult { indices, gridSize=80, outW=80, outH=45, token }
   ↓
   ├─► PreviewCanvas:
   │     canvas.width = 80 * 24 = 1920px (位图)
   │     canvas.height = 45 * 24 = 1080px (位图)
   │     CSS: max-width:100%; height:auto
   │     → 浏览器按容器宽度等比缩放显示
   │
   ├─► composite (导出):
   │     beadW = 80 * 32 = 2560px
   │     beadH = 45 * 32 = 1440px
   │     canvasH = max(beadH, legendH)
   │     → 拼豆图保持 16:9 比例（不裁切）
   │
   └─► exportMulti:
         对每个 gridSize 重新采样 + 渲染 + 下载
         100ms 间隔
```

### 2.3 接口签名

```ts
// src/types.ts
export interface PipelineResult {
  readonly indices: Uint8Array;
  readonly gridSize: number;      // 长边目标格子数
  readonly outW: number;          // 实际宽格子数（按比例）
  readonly outH: number;          // 实际高格子数（按比例）
  readonly token: number;
}

// src/pipeline/renderer.ts (签名变)
export function renderPaletteImage(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  cellPx: number,
  borderColor: string | null
): HTMLCanvasElement;

// src/pipeline/annotator.ts (签名变)
export function renderAnnotatedImage(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  cellPx: number,
  fontPx: number
): HTMLCanvasElement;

// src/pipeline/composite.ts (签名变)
export function renderComposite(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  options?: Partial<CompositeOptions>
): HTMLCanvasElement;

// src/pipeline/pipeline.ts (新增)
export class Pipeline {
  // ... 现有 process / exportComposite 不变 ...
  async exportMulti(
    src: ImageData,        // 重新采样需要原图
    currentResult: PipelineResult,
    exportCellPx: number,
    extraGridSizes: number[]   // [] = 只导当前；多个 = N 张
  ): Promise<{ success: number; failed: number }>;
}
```

### 2.4 PreviewCanvas 拉伸实现

```tsx
// src/components/PreviewCanvas.tsx
export function PreviewCanvas({ result, palette, cellPx, isRecomputing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!result || !ref.current) return;
    const c = renderPaletteImage(
      result.indices, result.outW, result.outH,
      palette, cellPx, '#ddd'
    );
    const ctx = ref.current.getContext('2d')!;
    ref.current.width = c.width;
    ref.current.height = c.height;
    ctx.drawImage(c, 0, 0);
  }, [result, palette, cellPx]);

  return (
    <div className="preview-wrap">
      <div className={isRecomputing ? 'preview-scroll dim' : 'preview-scroll'}>
        <canvas ref={ref} className="preview" />
      </div>
      {isRecomputing && <div className="overlay">计算中...</div>}
    </div>
  );
}
```

CSS：
```css
.preview { display: block; max-width: 100%; height: auto; }
/* 不再用 aspect-ratio: 1/1 — 让画布按位图比例自然伸缩 */
```

### 2.5 composite.ts 新公式

```ts
const beadW = outW * cellPx;
const beadH = outH * cellPx;
const legendW = ...; // 不变
const legendH = ...; // 不变
const canvasW = beadW + cellGap + legendW;
const canvasH = Math.max(beadH, legendH);

beadX = 0;
beadY = Math.floor((canvasH - beadH) / 2); // 垂直居中（当 bead 短于 legend）
```

### 2.6 多图导出交互

```
┌──────────────────────────────────┐
│ 导出图片                          │
│                                  │
│ 当前（必选）：100 × 100          │
│                                  │
│ 额外尺寸（可选）：                │
│  ☐ 50   ☐ 75   ☐ 150             │
│  ☐ 200  ☐ 300  ☐ 500             │
│                                  │
│ [导出 1 张图片]                  │  ← 文字随勾选数变化
└──────────────────────────────────┘
```

### 2.7 global.css 暖色重设计

保留现有 :root 变量结构，但调整色板和阴影：

```css
:root {
  /* Color — 暖中性 */
  --color-bg: #faf8f5;            /* 暖白 */
  --color-surface: #fffefa;       /* 微暖白 */
  --color-surface-alt: #f5f1ea;
  --color-text: #2d2a26;          /* 深棕黑 */
  --color-text-muted: #78716c;
  --color-border: #e7e2d8;        /* 暖灰 */
  --color-border-strong: #d6cfc1;
  --color-accent: #c2410c;        /* 橙陶 */
  --color-accent-hover: #9a3412;
  --color-accent-soft: #fef3eb;
  --color-error-bg: #fef2f2;
  --color-error-fg: #b91c1c;

  /* Radius — 大圆角 */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;

  /* Shadow — 柔和 */
  --shadow-sm: 0 1px 3px rgba(60, 40, 20, 0.06);
  --shadow-md: 0 4px 12px rgba(60, 40, 20, 0.08);
  --shadow-lg: 0 8px 24px rgba(60, 40, 20, 0.12);
}
```

### 2.8 exportMulti 实现

```ts
// src/pipeline/pipeline.ts
async exportMulti(
  src: ImageData,
  currentResult: PipelineResult,
  exportCellPx: number,
  extraGridSizes: number[]
): Promise<{ success: number; failed: number }> {
  if (!this.palette) throw new Error('Pipeline not initialized');

  const sizes = [currentResult.gridSize, ...extraGridSizes.filter(n => n !== currentResult.gridSize)];
  let success = 0;
  let failed = 0;

  for (const gridSize of sizes) {
    try {
      // 重新采样（按比例）
      const sampled = sampleImage(src, gridSize);
      const indices = quantizeWithCanvas2D(sampled, this.palette, currentResult.enableDither);
      const compositeCanvas = renderComposite(indices, sampled.width, sampled.height, this.palette, {
        cellPx: exportCellPx,
      });
      const blob = await canvasToBlob(compositeCanvas);
      triggerDownload(blob, `pingdou-${sampled.width}x${sampled.height}.png`);
      success++;
      await new Promise(r => setTimeout(r, 100));  // 浏览器下载间隔
    } catch (err) {
      failed++;
      console.error(`exportMulti failed for gridSize ${gridSize}:`, err);
    }
  }

  return { success, failed };
}
```

**问题**：`enableDither` 不在 `currentResult` 里，需要加回 PipelineResult 或让 usePipeline 持有 dither state 并在 exportMulti 时传入。

**简单方案**：让 `exportMulti` 接收 `enableDither: boolean` 参数：
```ts
async exportMulti(src, currentResult, exportCellPx, extraGridSizes, enableDither)
```

## 三、数据存储

无新增 / 修改任何持久化数据。

## 四、TODO

### 4.1 实施任务

- [ ] `git revert --no-commit 5ea405a 4fdfdb3 1153548 44f50f2 85d8615` + 1 commit
- [ ] `src/types.ts` 加 `outW, outH` 到 PipelineResult
- [ ] `src/pipeline/pipeline.ts` process() 填 outW/outH；新增 exportMulti
- [ ] `src/pipeline/renderer.ts` 改签名 outW/outH
- [ ] `src/pipeline/annotator.ts` 改签名 outW/outH
- [ ] `src/pipeline/composite.ts` 改签名 + 公式（用 outW/outH）
- [ ] `tests/unit/composite.test.ts` 用 outW/outH 矩形测试
- [ ] `tests/unit/renderer.test.ts` 用 outW/outH 矩形测试（如有）
- [ ] `tests/unit/annotator.test.ts` 用 outW/outH 矩形测试
- [ ] `src/components/PreviewCanvas.tsx` 用 outW/outH 替换 gridSize；canvas 元素 width/height 属性绑定
- [ ] `src/components/ExportPanel.tsx` 多选交互
- [ ] `src/App.tsx` 持 exportGridSizes state；调 exportMulti
- [ ] `src/styles/global.css` 暖色重设计
- [ ] `tests/e2e/flow.spec.ts` 多图下载用例

### 4.2 验收清单

- [ ] 撤 commit 成功，43 个旧测试全过
- [ ] PipelineResult 有 outW/outH
- [ ] composite 接受矩形 outW/outH，canvas 不裁切
- [ ] PreviewCanvas 跟随容器 CSS 拉伸
- [ ] ExportPanel 多选交互
- [ ] 多图导出触发 N 次 download
- [ ] global.css 暖色 + 软阴影 + 圆角
- [ ] typecheck 0 错误
- [ ] npm test ≥ 50 通过
- [ ] npm run build 通过
- [ ] E2E 多图下载 1 用例

## 五、常量映射

| 常量 | 值 | 用途 |
|------|----|------|
| `EXPORT_INTERVAL_MS` | 100 | 多图下载间隔 |
| `--radius-sm/md/lg` | 6/12/16px | 暖色版圆角 |
| `--color-accent` | `#c2410c` | 橙陶主色 |
| 主网格选项 | [50, 75, 100, 150, 200, 300, 500] | 同 MVP |

## 六、接口协议

### 6.1 变更的接口（关键！）

```ts
// PipelineResult: 新增字段
+ readonly outW: number
+ readonly outH: number

// renderer.ts: 参数重命名
- gridSize: number
+ outW: number, outH: number

// annotator.ts: 参数重命名
- gridSize: number
+ outW: number, outH: number

// composite.ts: 参数重命名
- gridSize: number
+ outW: number, outH: number
```

### 6.2 不变的接口

- `computeLegend(indices, palette)` —— 不变
- `sampler.sampleImage(src, gridSize)` —— 不变（已按比例）
- `quantizeWithCanvas2D(...)` —— 不变
- `usePalette()` / `usePipeline()` —— 核心不变（加 exportMulti 返回值）
- `ColorLegend` —— 不变

## 七、服务发布

无后端变更。沿用 Vite 静态构建。
- 构建产物 `dist/`：预计增量 < 5KB gzipped（多图导出 + CSS 调整）

## 八、CR 点

- [ ] 撤 commit 必须用 `git revert --no-commit`，**不要 `git reset`**（保历史）
- [ ] PipelineResult 增加 outW/outH **不能删除** gridSize（向后兼容）
- [ ] 下游渲染模块必须接受 outW/outH 而非 gridSize²
- [ ] composite 不裁切：对 80×45 输入，beadW/beadH 是矩形
- [ ] PreviewCanvas 用 canvas 元素 width/height 属性绑定尺寸
- [ ] CSS `max-width: 100%; height: auto` 拉伸
- [ ] 删除 `.zoom-toolbar` / `aspect-ratio: 1/1` / `@media (max-width: 1400px)`
- [ ] exportMulti 串行 + 100ms 间隔 + 容错单张失败
- [ ] 不引入 JSZip

## 九、实施步骤

按"风险递增"：

1. **撤 commit**（最快回到稳定点）
2. **types + pipeline 扩字段**（最低风险）
3. **renderer/annotator 改签名**（pure-fn，有测试）
4. **composite 改公式**（核心修复）
5. **测试更新**
6. **PreviewCanvas 拉伸**
7. **ExportPanel 多选 + App 接入**
8. **pipeline.exportMulti**
9. **CSS 重设计**
10. **E2E**
11. **验收**

---

## 自检（写完后再过一遍）

1. **占位符扫描**：无 TBD/TODO/待定项。✓
2. **内部一致性**：架构图 / 接口 / TODO / CR 全对齐。✓
3. **范围检查**：聚焦"撤+修+美+多图"，单 spec 可落地。✓
4. **歧义检查**：
   - "自适应"在 §1.1 明确是"按原图比例不裁切"
   - "放大"在 §1.1 明确是"画布随窗口大"
   - "美化"在 §2.7 明确暖中性色 + 软阴影 + 圆角
5. **回归风险**：明确列出"撤哪 5 个 commit"+ "新增面在 N 个文件"。✓