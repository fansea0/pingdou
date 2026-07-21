# 正方形板子导出与工时修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将制作速度改为每小时 600 颗，并让当前选定板子尺寸导出为主体居中、透明补边的正方形拼豆网格 PNG。

**Architecture:** 保持预览及豆子统计使用按原图比例采样得到的矩形网格；导出时以 `App` 的用户选择尺寸为唯一的目标边长。新增独立渲染器把矩形已标注网格居中绘制到透明正方形画布，`Pipeline` 仅负责导出协调和下载文件名。

**Tech Stack:** React、TypeScript、Vitest、Canvas 2D。

---

## 文件结构

- 修改 `src/constants/boardSizes.ts`：将统一工时速度改为 600。
- 修改 `src/pipeline/timeEstimate.ts`：不改接口，继续引用统一常量。
- 新增 `src/pipeline/squareBoard.ts`：生成透明、正方形的标注拼豆网格图。
- 修改 `src/pipeline/pipeline.ts`：导出时显式接收目标板子尺寸、以该尺寸重采样，并下载正方形网格 PNG。
- 修改 `src/hooks/usePipeline.ts` 与 `src/App.tsx`：把当前选择的 `gridSize` 传入导出流程。
- 修改 `tests/unit/timeEstimate.test.ts`、新增 `tests/unit/squareBoard.test.ts`、修改 `tests/unit/pipeline-export.test.ts`：覆盖速度、透明正方形渲染、导出参数和文件名。

### Task 1: 将工时速度改为每小时 600 颗

**Files:**
- Modify: `src/constants/boardSizes.ts:1-3`
- Modify: `tests/unit/timeEstimate.test.ts:1-28`

- [ ] **Step 1: 写入失败的工时测试**

```ts
it('calculates at 600 beads per hour', () => {
  expect(estimateAssemblyHours(600)).toBe(1);
  expect(estimateAssemblyHours(900)).toBe(1.5);
  expect(formatAssemblyHours(estimateAssemblyHours(900))).toBe('约 1.5 小时');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/unit/timeEstimate.test.ts`

Expected: FAIL，因为当前常量为 250，900 颗被估算为 3.6 小时。

- [ ] **Step 3: 最小实现**

```ts
export const BEADS_PER_HOUR = 600;
```

`timeEstimate.ts` 保持使用 `BEADS_PER_HOUR`，不复制常量。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- --run tests/unit/timeEstimate.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/constants/boardSizes.ts tests/unit/timeEstimate.test.ts
git commit -m "fix: estimate assembly time at 600 beads per hour"
```

### Task 2: 生成透明正方形的板子网格图

**Files:**
- Create: `src/pipeline/squareBoard.ts`
- Test: `tests/unit/squareBoard.test.ts`

- [ ] **Step 1: 写入失败的正方形画布测试**

```ts
it('centers a rectangular board on a transparent square canvas', () => {
  const canvas = renderSquareBoard(indices, 2, 1, palette, 4, 10, 4, null);
  expect(canvas.width).toBe(16);
  expect(canvas.height).toBe(16);
  const image = canvas.getContext('2d')!.getImageData(0, 0, 16, 16);
  expect(image.data[3]).toBe(0);
  expect(image.data[(4 * 16 + 4) * 4 + 3]).toBe(255);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/unit/squareBoard.test.ts`

Expected: FAIL，因为 `renderSquareBoard` 尚不存在。

- [ ] **Step 3: 实现透明补边渲染器**

```ts
export function renderSquareBoard(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  boardSize: number,
  cellPx: number,
  fontPx: number,
  mask: BackgroundMask | null
): HTMLCanvasElement {
  const source = renderAnnotatedImage(indices, outW, outH, palette, cellPx, fontPx, mask);
  const canvas = document.createElement('canvas');
  canvas.width = boardSize * cellPx;
  canvas.height = boardSize * cellPx;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, Math.floor((canvas.width - source.width) / 2), Math.floor((canvas.height - source.height) / 2));
  return canvas;
}
```

The canvas must not call `fillRect`; browser-created canvases are transparent by default. The board size must be positive and no smaller than either source grid edge, otherwise throw `RangeError`.

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- --run tests/unit/squareBoard.test.ts`

Expected: PASS，画布尺寸为 `boardSize * cellPx`，四角 alpha 为 0，居中图案区域 alpha 为 255。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/squareBoard.ts tests/unit/squareBoard.test.ts
git commit -m "feat: render transparent square board exports"
```

### Task 3: 让导出使用用户选中的板子尺寸

**Files:**
- Modify: `src/pipeline/pipeline.ts:136-208`
- Modify: `src/hooks/usePipeline.ts:44-61`
- Modify: `src/App.tsx:76-91`
- Create: `tests/unit/pipeline-export.test.ts`

- [ ] **Step 1: 写入失败的导出尺寸测试**

```ts
it('exports the selected square board size instead of PipelineResult.gridSize', async () => {
  await pipeline.exportMulti(src, result, 32, 52, [], false);
  expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), 'pingdou-52x52.png');
});
```

The fixture result should be a landscape `outW: 26, outH: 52` with an intentionally incompatible `gridSize: 26`, proving the selected `52` drives export.

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/unit/pipeline-export.test.ts`

Expected: FAIL，因为 `exportMulti` 仍由 `currentResult.gridSize` 派生导出尺寸，且文件名使用矩形边长。

- [ ] **Step 3: 显式传递尺寸并调用正方形渲染器**

```ts
async exportMulti(
  src: ImageData,
  currentResult: PipelineResult,
  exportCellPx: number,
  selectedGridSize: number,
  extraGridSizes: number[],
  removeBackground: boolean
): Promise<{ success: number; failed: number }> {
  const sizes = [selectedGridSize, ...extraGridSizes.filter(n => n !== selectedGridSize)];
  // For each size: sampleImage(src, gridSize), quantify and mask as today,
  // then renderSquareBoard(indices, outW, outH, this.palette, gridSize, exportCellPx, 12, mask).
  triggerDownload(blob, `pingdou-${gridSize}x${gridSize}.png`);
}
```

Update the hook to accept `selectedGridSize` and pass it through. In `App.handleExport`, call `exportMulti(32, gridSize, [])`.

- [ ] **Step 4: 运行导出和现有流程测试确认通过**

Run: `npm test -- --run tests/unit/pipeline-export.test.ts tests/unit/exporter.test.ts tests/unit/pipeline.bg.test.ts`

Expected: PASS；导出名为 `pingdou-52x52.png`，背景掩码回归测试继续通过。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/pipeline.ts src/hooks/usePipeline.ts src/App.tsx tests/unit/pipeline-export.test.ts
git commit -m "feat: export selected square board size"
```

### Task 4: 完整验证

**Files:**
- Verify only

- [ ] **Step 1: 运行完整验证**

Run: `npm test && npm run typecheck && npm run build && git diff main...HEAD --check`

Expected: 全部测试通过、TypeScript 无错误、生产构建成功、diff 无空白错误。

- [ ] **Step 2: 检查提交范围**

Run: `git status --short && git log --oneline main..HEAD`

Expected: 仅包含本功能提交；保留且不暂存用户已有的未追踪文件。
