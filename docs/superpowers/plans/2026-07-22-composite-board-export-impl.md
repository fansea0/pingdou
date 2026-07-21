# 保留色号表的正方形板子导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在导出中保留既有色号数量表与水印，同时使左侧拼豆图区为所选尺寸的透明补边正方形，并增加板子边框。

**Architecture:** `squareBoard` 仅渲染新的左侧拼豆图区。`composite` 提取既有的色号表排版能力，使其可以接收任意拼豆画布；旧的 `renderComposite` 继续渲染矩形网格以维持现有调用兼容。`Pipeline` 复用 `renderCompositeFromBoard` 与 `applyWatermark`，不复制色号计数、合计或水印代码。

**Tech Stack:** TypeScript、Canvas 2D、Vitest。

---

## 文件结构

- 修改 `src/pipeline/squareBoard.ts`：为透明正方形拼豆图区绘制外沿细边框。
- 修改 `src/pipeline/composite.ts`：导出可复用的 `renderCompositeFromBoard`，使用既有色号表和合计渲染代码。
- 修改 `src/pipeline/pipeline.ts`：组合正方形拼豆图区、既有色号表并调用既有水印函数。
- 修改 `tests/unit/squareBoard.test.ts`、`tests/unit/composite.test.ts`、`tests/unit/pipeline-export.test.ts`：覆盖边框、色号表组合与水印调用。

### Task 1: 给正方形拼豆图区添加外沿边框

**Files:**
- Modify: `tests/unit/squareBoard.test.ts:10-37`
- Modify: `src/pipeline/squareBoard.ts:5-35`

- [ ] **Step 1: 写入失败的边框测试**

```ts
it('draws a visible border around the selected board bounds', () => {
  const canvas = renderSquareBoard(new Uint8Array([0]), 1, 1, palette, 4, 24, 10);
  const pixel = canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data;
  expect(pixel[3]).toBe(255);
  expect([pixel[0], pixel[1], pixel[2]]).not.toEqual([0, 0, 0]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/unit/squareBoard.test.ts`

Expected: FAIL，因为当前透明画布四角 alpha 为 0，尚无边框。

- [ ] **Step 3: 最小实现**

```ts
ctx.strokeStyle = '#374151';
ctx.lineWidth = 2;
ctx.strokeRect(1, 1, boardPx - 2, boardPx - 2);
```

边框在 `drawImage` 之后绘制，覆盖在板子外沿；不得填充透明补边。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- --run tests/unit/squareBoard.test.ts`

Expected: PASS，四角边框不透明，未接触边框的补边仍透明。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/squareBoard.ts tests/unit/squareBoard.test.ts
git commit -m "feat: add board border to square exports"
```

### Task 2: 复用色号数量表组合正方形拼豆图区

**Files:**
- Modify: `tests/unit/composite.test.ts:20-112`
- Modify: `src/pipeline/composite.ts:20-152`

- [ ] **Step 1: 写入失败的组合测试**

```ts
it('places a supplied square board canvas left of the existing legend', () => {
  const board = document.createElement('canvas');
  board.width = 128;
  board.height = 128;
  const canvas = renderCompositeFromBoard(board, indices, palette, null);
  expect(canvas.width).toBe(128 + DEFAULT_COMPOSITE_OPTIONS.cellGap + 372);
  expect(canvas.height).toBeGreaterThanOrEqual(128);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/unit/composite.test.ts`

Expected: FAIL，因为 `renderCompositeFromBoard` 尚不存在。

- [ ] **Step 3: 提取现有合成逻辑**

```ts
export function renderCompositeFromBoard(
  beadCanvas: HTMLCanvasElement,
  indices: Uint8Array,
  palette: Palette,
  mask: BackgroundMask | null = null
): HTMLCanvasElement {
  // Move the current legend-table layout from renderComposite here unchanged.
}

export function renderComposite(/* existing signature */): HTMLCanvasElement {
  const beadCanvas = renderAnnotatedImage(/* existing arguments */);
  return renderCompositeFromBoard(beadCanvas, indices, palette, mask);
}
```

The helper must keep the existing `buildRows` logic so colors, counts and total retain their current behavior, including exclusion of `mask[i] === 1` cells.

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- --run tests/unit/composite.test.ts`

Expected: PASS；原有 6 个测试与新增左侧正方形画布测试均通过。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/composite.ts tests/unit/composite.test.ts
git commit -m "refactor: reuse legend composition for square boards"
```

### Task 3: 恢复最终合成图的既有水印

**Files:**
- Modify: `tests/unit/pipeline-export.test.ts:1-43`
- Modify: `src/pipeline/pipeline.ts:1-208`

- [ ] **Step 1: 写入失败的导出组合测试**

```ts
vi.mock('@/pipeline/watermark', () => ({ applyWatermark }));

it('combines the square board with the existing legend and applies the watermark', async () => {
  await pipeline.exportMulti(source(40, 20), 24, 4, [], false);
  expect(applyWatermark).toHaveBeenCalledWith(expect.objectContaining({ width: expect.any(Number) }));
  expect(canvasToBlob).toHaveBeenCalledWith(expect.objectContaining({ width: 96 + 40 + 372 }));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/unit/pipeline-export.test.ts`

Expected: FAIL，因为当前导出直接序列化 `boardCanvas`，且未调用水印函数。

- [ ] **Step 3: 使用现有合成和水印函数**

```ts
const boardCanvas = renderSquareBoard(/* existing arguments */);
const compositeCanvas = renderCompositeFromBoard(boardCanvas, indices, this.palette, mask);
applyWatermark(compositeCanvas);
const blob = await canvasToBlob(compositeCanvas);
```

Do not alter `applyWatermark`, `buildRows`, or legend rendering. Keep `pingdou-${gridSize}x${gridSize}.png` as the filename.

- [ ] **Step 4: 运行导出回归测试确认通过**

Run: `npm test -- --run tests/unit/pipeline-export.test.ts tests/unit/composite.test.ts tests/unit/watermark.test.ts`

Expected: PASS；色号表、合计、水印与文件名回归均通过。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/pipeline.ts tests/unit/pipeline-export.test.ts
git commit -m "feat: preserve legend and watermark in board exports"
```

### Task 4: 完整验证

**Files:**
- Verify only

- [ ] **Step 1: 运行完整验证**

Run: `npm test && npm run typecheck && npm run build && git diff main...HEAD --check`

Expected: 全部测试通过、TypeScript 无错误、生产构建成功、diff 无空白错误。

- [ ] **Step 2: 检查提交范围**

Run: `git status --short && git log --oneline main..HEAD`

Expected: 仅本功能文件被提交；用户已有未追踪文件保持未暂存。
