# 拼豆图：撤 + 修（不自适应）+ 预览随窗大 + 多图导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert the previous (incorrectly-designed) zoom/responsive feature, fix composite rendering to honor non-square source aspect ratios, make the preview canvas responsive via CSS, polish the visual design with warm neutral colors, and add multi-size export.

**Architecture:** First task is a clean git revert. Then thread `outW`/`outH` (already produced by `sampler`) through `PipelineResult` and into all downstream renderers (`renderer.ts`, `annotator.ts`, `composite.ts`) so non-square source images render as non-square bead grids. PreviewCanvas stops forcing a 1:1 aspect ratio; the canvas element uses width/height attributes bound to `outW/outH × cellPx`, and CSS `max-width: 100%; height: auto` lets it stretch with the container. ExportPanel grows a multi-select checkbox list; Pipeline gains `exportMulti(src, currentResult, cellPx, extraSizes, enableDither)` which re-samples for each size, renders, and triggers downloads 100ms apart.

**Tech Stack:** React 18, TypeScript, Vite 5, Canvas 2D, Vitest, Playwright, native CSS.

**Reference Spec:** `docs/superpowers/specs/2026-07-12-correct-misunderstanding-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| (git operation) | `git revert` | Revert 5 commits from previous (incorrect) round |
| `src/types.ts` | Modify | Add `outW`, `outH` to `PipelineResult` |
| `src/pipeline/pipeline.ts` | Modify | Populate `outW`/`outH` in `process()`; add `exportMulti()` |
| `src/pipeline/renderer.ts` | Modify | Accept `outW`, `outH` instead of `gridSize` |
| `src/pipeline/annotator.ts` | Modify | Accept `outW`, `outH` instead of `gridSize` |
| `src/pipeline/composite.ts` | Modify | Accept `outW`, `outH`; non-square canvas dimensions |
| `tests/unit/composite.test.ts` | Modify | Tests use `outW`/`outH`; non-square test cases |
| `tests/unit/annotator.test.ts` | Modify | Tests use `outW`/`outH` |
| `src/components/PreviewCanvas.tsx` | Modify | Use `outW`/`outH`; canvas element width/height attrs; remove zoom props |
| `src/components/ExportPanel.tsx` | Modify | Multi-select grid sizes; export count text |
| `src/App.tsx` | Modify | Hold `extraGridSizes` state; call `exportMulti` |
| `src/styles/global.css` | Modify | Warm palette, larger radius, softer shadow; remove zoom/responsive styles |
| `tests/e2e/flow.spec.ts` | Modify | Add multi-export test |

---

## Task 1: Revert Previous (Incorrect) Round

**Files:**
- (git history) Revert: `5ea405a`, `4fdfdb3`, `1153548`, `44f50f2`, `85d8615`

- [ ] **Step 1: Confirm commits to revert**

Run:
```bash
git log --oneline | head -10
```
Expected: Top 5 commits are exactly `5ea405a feat(hooks): useZoomPan ...`, `4fdfdb3 feat(ui): ZoomToolbar ...`, `1153548 feat(ui): PreviewCanvas 应用 ctx.translate/scale ...`, `44f50f2 feat(ui): App 接入 useZoomPan + 切换参数重置缩放 + 响应式`, `85d8615 test(e2e): 缩放控制条 + 复位 用例`.

- [ ] **Step 2: Revert the 5 commits as a single commit**

Run:
```bash
git revert --no-commit 5ea405a 4fdfdb3 1153548 44f50f2 85d8615
```
Expected: Working tree shows deleted files: `src/hooks/useZoomPan.ts`, `src/hooks/useZoomPan.test.ts`, `src/components/ZoomToolbar.tsx`, `src/components/ZoomToolbar.test.tsx`, `src/components/PreviewCanvas.test.tsx`. No conflicts (subsequent commits don't touch these files).

- [ ] **Step 3: Verify revert removed zoom code**

Run: `grep -r "useZoomPan\|ZoomToolbar\|zoom-toolbar\|aspect-ratio: 1" src/ 2>/dev/null`
Expected: No matches.

- [ ] **Step 4: Verify revert restored 43-test baseline**

Run: `npm test 2>&1 | tail -5`
Expected: `Test Files 13 passed (13)`, `Tests 43 passed (43)`.

- [ ] **Step 5: Commit the revert**

```bash
git add -A
git commit -m "revert: 回滚上一轮缩放相关 5 commit（语义理解错误）"
```

---

## Task 2: Extend `PipelineResult` with `outW` / `outH`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/pipeline/pipeline.ts` (populate fields)

- [ ] **Step 1: Edit `src/types.ts`**

Find the `PipelineResult` interface:

```ts
export interface PipelineResult {
  readonly indices: Uint8Array;
  readonly gridSize: number;
  readonly token: number;
}
```

Replace with:

```ts
export interface PipelineResult {
  readonly indices: Uint8Array;
  readonly gridSize: number;
  readonly outW: number;
  readonly outH: number;
  readonly token: number;
}
```

- [ ] **Step 2: Update `src/pipeline/pipeline.ts` to populate `outW`/`outH`**

Find the line `onResult({ indices, gridSize: sampled.width, token: myToken });` and replace with:

```ts
onResult({
  indices,
  gridSize: sampled.width,
  outW: sampled.width,
  outH: sampled.height,
  token: myToken,
});
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: 43/43 pass.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/pipeline/pipeline.ts
git commit -m "feat(types): PipelineResult 增加 outW/outH 字段"
```

---

## Task 3: Update `renderer.ts` to Accept `outW` / `outH`

**Files:**
- Modify: `src/pipeline/renderer.ts`
- Modify: `tests/unit/renderer.test.ts`

- [ ] **Step 1: Update `src/pipeline/renderer.ts`**

Find the `renderPaletteImage` signature:

```ts
export function renderPaletteImage(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  cellPx: number,
  borderColor: string | null = '#e5e7eb'
): HTMLCanvasElement {
  const w = gridSize * cellPx;
  const h = gridSize * cellPx;
```

Replace with:

```ts
export function renderPaletteImage(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  cellPx: number,
  borderColor: string | null = '#e5e7eb'
): HTMLCanvasElement {
  const w = outW * cellPx;
  const h = outH * cellPx;
```

Find the nested loops and update variable access (currently `gridSize`):

```ts
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = indices[y * gridSize + x];
```

Replace with:

```ts
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const idx = indices[y * outW + x];
```

Find the border drawing:

```ts
  if (borderColor && cellPx >= 6) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= gridSize; i++) {
```

Replace with:

```ts
  if (borderColor && cellPx >= 6) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= outW; i++) {
      ctx.moveTo(i * cellPx + 0.5, 0);
      ctx.lineTo(i * cellPx + 0.5, h);
    }
    for (let i = 0; i <= outH; i++) {
      ctx.moveTo(0, i * cellPx + 0.5);
      ctx.lineTo(w, i * cellPx + 0.5);
    }
    ctx.stroke();
  }
```

(The old code had a single loop over `gridSize` drawing both vertical and horizontal lines; the new code splits them so non-square canvas gets correct border counts.)

- [ ] **Step 2: Update `tests/unit/renderer.test.ts`**

Read the file. Update each test's call site from `renderPaletteImage(indices, N, palette, cellPx)` to use `outW`/`outH`. Since the existing tests all use square (N×N) inputs, pass `N, N`. Specifically:

For each occurrence in the test file, change:
```ts
renderPaletteImage(indices, 2, palette, 16)
```
to:
```ts
renderPaletteImage(indices, 2, 2, palette, 16)
```

Apply the same `2 → 2, 2` transformation everywhere.

- [ ] **Step 3: Run tests, verify passing**

Run: `npm test renderer`
Expected: 3/3 pass.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/renderer.ts tests/unit/renderer.test.ts
git commit -m "refactor(renderer): 接受 outW/outH 支持非正方形网格"
```

---

## Task 4: Update `annotator.ts` to Accept `outW` / `outH`

**Files:**
- Modify: `src/pipeline/annotator.ts`
- Modify: `tests/unit/annotator.test.ts`

- [ ] **Step 1: Update `src/pipeline/annotator.ts`**

Find the `renderAnnotatedImage` signature:

```ts
export function renderAnnotatedImage(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  cellPx: number,
  fontPx: number
): HTMLCanvasElement {
  if (cellPx < 24) {
    throw new Error('Annotated image requires cellPx >= 24');
  }

  const w = gridSize * cellPx;
  const h = gridSize * cellPx;
```

Replace with:

```ts
export function renderAnnotatedImage(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  cellPx: number,
  fontPx: number
): HTMLCanvasElement {
  if (cellPx < 24) {
    throw new Error('Annotated image requires cellPx >= 24');
  }

  const w = outW * cellPx;
  const h = outH * cellPx;
```

Find the nested loops:

```ts
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = indices[y * gridSize + x];
```

Replace with:

```ts
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const idx = indices[y * outW + x];
```

- [ ] **Step 2: Update `tests/unit/annotator.test.ts`**

Read the file. Find any `renderAnnotatedImage(indices, N, palette, cellPx, fontPx)` calls and change to `renderAnnotatedImage(indices, N, N, palette, cellPx, fontPx)`. Existing tests use 2×2 grids, so pass `2, 2`.

- [ ] **Step 3: Run tests, verify passing**

Run: `npm test annotator`
Expected: 2/2 pass.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/annotator.ts tests/unit/annotator.test.ts
git commit -m "refactor(annotator): 接受 outW/outH 支持非正方形网格"
```

---

## Task 5: Update `composite.ts` and Tests for Non-Square Grids

**Files:**
- Modify: `src/pipeline/composite.ts`
- Modify: `tests/unit/composite.test.ts`

- [ ] **Step 1: Update `src/pipeline/composite.ts`**

Find the `renderComposite` signature:

```ts
export function renderComposite(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  options?: Partial<CompositeOptions>
): HTMLCanvasElement {
```

Replace with:

```ts
export function renderComposite(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  options?: Partial<CompositeOptions>
): HTMLCanvasElement {
```

Find the `renderAnnotatedImage` call inside:

```ts
  const beadCanvas = renderAnnotatedImage(
    indices,
    gridSize,
    palette,
    opts.cellPx,
    opts.fontPx
  );
```

Replace with:

```ts
  const beadCanvas = renderAnnotatedImage(
    indices,
    outW,
    outH,
    palette,
    opts.cellPx,
    opts.fontPx
  );
```

The rest of `renderComposite` is unchanged — it uses `beadW` / `beadH` correctly.

- [ ] **Step 2: Replace `tests/unit/composite.test.ts`**

Replace the entire file with:

```ts
import { describe, it, expect } from 'vitest';
import { renderComposite, DEFAULT_COMPOSITE_OPTIONS } from '@/pipeline/composite';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 255, 0], name: '绿' },
  { id: 'A03', rgb: [0, 0, 255], name: '蓝' },
];

function countRedPixels(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number
): number {
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = ctx.getImageData(x, y, 1, 1).data;
      if (px[0] === 255 && px[1] === 0 && px[2] === 0 && px[3] === 255) n++;
    }
  }
  return n;
}

describe('renderComposite (non-square)', () => {
  it('canvas width = beadW + cellGap + legendW', () => {
    const indices = new Uint8Array(6 * 4);
    indices.set([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2], 0);
    const canvas = renderComposite(indices, 6, 4, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadW = 6 * 32;
    const legendRows = 1 + 3 + 1;
    const legendW = opts.legendColWidth + 100 + 100 + 80 + opts.legendPadding * 2;
    expect(canvas.width).toBe(beadW + opts.cellGap + legendW);
  });

  it('canvas height = max(beadH, legendH)', () => {
    const indices = new Uint8Array(6 * 4);
    indices.set([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2], 0);
    const canvas = renderComposite(indices, 6, 4, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadH = 4 * 32;
    const legendRows = 1 + 3 + 1;
    const legendH = legendRows * opts.legendRowHeight + opts.legendPadding * 2;
    expect(canvas.height).toBe(Math.max(beadH, legendH));
  });

  it('bead image appears in left half (non-square 6x4)', () => {
    const indices = new Uint8Array(24);
    indices.fill(0);
    const canvas = renderComposite(indices, 6, 4, palette, { cellPx: 32 });
    const ctx = canvas.getContext('2d')!;
    const beadW = 6 * 32;
    const leftReds = countRedPixels(ctx, 0, 0, beadW, canvas.height);
    const rightReds = countRedPixels(ctx, beadW, 0, canvas.width, canvas.height);
    expect(leftReds).toBeGreaterThan(rightReds * 3);
  });

  it('legend swatch appears in right half (non-square 6x4, only red used)', () => {
    const indices = new Uint8Array(24);
    indices.fill(0);
    const canvas = renderComposite(indices, 6, 4, palette, { cellPx: 32 });
    const ctx = canvas.getContext('2d')!;
    const beadW = 6 * 32;
    const rightReds = countRedPixels(ctx, beadW, 0, canvas.width, canvas.height);
    expect(rightReds).toBeGreaterThan(100);
  });

  it('preserves non-square aspect ratio (no cropping)', () => {
    // 80 wide × 45 tall → aspect ratio 16:9
    const indices = new Uint8Array(80 * 45);
    indices.fill(0);
    const canvas = renderComposite(indices, 80, 45, palette, { cellPx: 32 });
    const ctx = canvas.getContext('2d')!;
    const beadW = 80 * 32; // 2560
    const beadH = 45 * 32; // 1440
    // Sample inside bead image at (cell 0,0): x = 16, y = 16
    const px = ctx.getImageData(16, 16, 1, 1).data;
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
    // Sample at far-right of bead image: x = beadW - 16 = 2544, y = 16
    const rightPx = ctx.getImageData(beadW - 16, 16, 1, 1).data;
    expect([rightPx[0], rightPx[1], rightPx[2]]).toEqual([255, 0, 0]);
    // Sample at far-bottom of bead image: x = 16, y = beadH - 16 = 1424
    const bottomPx = ctx.getImageData(16, beadH - 16, 1, 1).data;
    expect([bottomPx[0], bottomPx[1], bottomPx[2]]).toEqual([255, 0, 0]);
  });
});
```

- [ ] **Step 3: Run tests, verify passing**

Run: `npm test composite`
Expected: 5/5 pass.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: 45/45 pass (43 + 2 modified, since renderer/annotator test counts stay same).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/composite.ts tests/unit/composite.test.ts
git commit -m "fix(composite): 接受 outW/outH 矩形画布 不裁切"
```

---

## Task 6: Update `PreviewCanvas` to Use `outW`/`outH` and CSS Stretch

**Files:**
- Modify: `src/components/PreviewCanvas.tsx`

- [ ] **Step 1: Read current `src/components/PreviewCanvas.tsx`**

Run: `cat src/components/PreviewCanvas.tsx`

The current version (after revert) should have a clean signature with `result`, `palette`, `cellPx`, `isRecomputing`.

- [ ] **Step 2: Replace `src/components/PreviewCanvas.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import type { Palette, PipelineResult } from '@/types';
import { renderPaletteImage } from '@/pipeline/renderer';

interface Props {
  result: PipelineResult | null;
  palette: Palette;
  cellPx: number;
  isRecomputing: boolean;
}

export function PreviewCanvas({ result, palette, cellPx, isRecomputing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!result || !ref.current) return;
    const c = renderPaletteImage(
      result.indices,
      result.outW,
      result.outH,
      palette,
      cellPx,
      '#ddd'
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

- [ ] **Step 3: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: 0 errors; 45/45 pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/PreviewCanvas.tsx
git commit -m "refactor(preview): 用 outW/outH 支持非正方形网格"
```

---

## Task 7: Update CSS — Remove Old Responsive/Zoom, Add Stretch

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Update `.preview` CSS rules**

Find the `.preview` and `.preview-wrap` rules. Replace any `aspect-ratio`, `min-height`, or `max-width: 100%; height: auto` declarations with:

```css
.preview-wrap {
  position: relative;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  box-shadow: var(--shadow-sm);
  width: 100%;
}
.preview-scroll {
  max-width: 100%;
  overflow: auto;
  background: var(--color-surface-alt);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
}
.preview-scroll.dim { opacity: 0.5; }
.preview { display: block; max-width: 100%; height: auto; }
```

(Removed `aspect-ratio: 1 / 1` and `min-height: 480px`.)

- [ ] **Step 2: Remove the 1400px media query**

Find:
```css
@media (max-width: 1400px) {
  .layout-3col {
    grid-template-columns: 240px 1fr 240px;
  }
}
```

Delete the entire block.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: 0 errors; dist/ regenerated.

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "style: 移除响应式断点 + aspect-ratio 强制正方形；preview CSS 拉伸"
```

---

## Task 8: Add `exportMulti` to Pipeline

**Files:**
- Modify: `src/pipeline/pipeline.ts`

- [ ] **Step 1: Update imports**

Find the import block at the top:

```ts
import { sampleImage } from './sampler';
import { quantizeWithCanvas2D } from './quantizer.canvas';
import { renderPaletteImage } from './renderer';
import { renderComposite, DEFAULT_COMPOSITE_OPTIONS } from './composite';
import { canvasToBlob, triggerDownload } from './exporter';
import type { Palette, ProcessParams, PipelineResult, UIStatus } from '@/types';
```

(All these should already be there. Add `renderPaletteImage` is unused — keep it for now, but unused import will need removal.)

Run: `npm run typecheck`
Expected: 0 errors (or warning about unused `renderPaletteImage` — leave it for the next refactor).

- [ ] **Step 2: Add `exportMulti` method**

Inside `class Pipeline`, find the closing `}` of `renderPreview` (the deprecated method). After it, add:

```ts
  /**
   * Export multiple composite images in sequence.
   * Re-samples for each extra gridSize (preserving source aspect ratio).
   * Triggers downloads 100ms apart so the browser does not block.
   */
  async exportMulti(
    src: ImageData,
    currentResult: PipelineResult,
    exportCellPx: number,
    extraGridSizes: number[],
    enableDither: boolean
  ): Promise<{ success: number; failed: number }> {
    if (!this.palette) throw new Error('Pipeline not initialized');

    const sizes = [currentResult.gridSize, ...extraGridSizes.filter(n => n !== currentResult.gridSize)];
    let success = 0;
    let failed = 0;

    for (const gridSize of sizes) {
      try {
        const sampled = sampleImage(src, gridSize);
        const indices = quantizeWithCanvas2D(sampled, this.palette, enableDither);
        const compositeCanvas = renderComposite(
          indices,
          sampled.width,
          sampled.height,
          this.palette,
          { cellPx: exportCellPx }
        );
        const blob = await canvasToBlob(compositeCanvas);
        triggerDownload(blob, `pingdou-${sampled.width}x${sampled.height}.png`);
        success++;
        if (sizes.indexOf(gridSize) < sizes.length - 1) {
          await new Promise(r => setTimeout(r, 100));
        }
      } catch (err) {
        failed++;
        console.error(`exportMulti failed for gridSize ${gridSize}:`, err);
      }
    }

    return { success, failed };
  }
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/pipeline.ts
git commit -m "feat(pipeline): exportMulti 多图串行导出（100ms 间隔）"
```

---

## Task 9: Update `usePipeline` to Expose `exportMulti`

**Files:**
- Modify: `src/hooks/usePipeline.ts`

- [ ] **Step 1: Read current hook**

Run: `cat src/hooks/usePipeline.ts`

- [ ] **Step 2: Update `usePipeline` to call `exportMulti`**

The current `exportComposite` does single-image export via `pipeline.exportComposite(result)`. We need a new export path that takes `src` (the uploaded image data) plus `extraGridSizes`.

Replace the entire file with:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useThrottle } from './useThrottle';
import { Pipeline } from '@/pipeline/pipeline';
import type { Palette, ProcessParams, PipelineResult, UIStatus } from '@/types';

export function usePipeline(palette: Palette | null) {
  const pipelineRef = useRef<Pipeline | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [status, setStatus] = useState<UIStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const srcRef = useRef<ImageData | null>(null);
  const ditherRef = useRef(false);

  useEffect(() => {
    if (!palette) return;
    pipelineRef.current = new Pipeline();
    pipelineRef.current.init(palette);
  }, [palette]);

  const throttledProcess = useThrottle(async (src: ImageData, params: ProcessParams) => {
    if (!pipelineRef.current) return;
    try {
      ditherRef.current = params.enableDither;
      await pipelineRef.current.process(src, params, setStatus, setResult);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, 200);

  const process = useCallback((src: ImageData, params: ProcessParams) => {
    srcRef.current = src;
    ditherRef.current = params.enableDither;
    return throttledProcess(src, params);
  }, [throttledProcess]);

  const reprocess = useCallback((params: ProcessParams) => {
    if (srcRef.current) {
      ditherRef.current = params.enableDither;
      throttledProcess(srcRef.current, params);
    }
  }, [throttledProcess]);

  const exportMulti = useCallback(async (exportCellPx: number, extraGridSizes: number[]) => {
    if (!pipelineRef.current || !result || !srcRef.current) return null;
    setStatus('exporting');
    try {
      const { success, failed } = await pipelineRef.current.exportMulti(
        srcRef.current,
        result,
        exportCellPx,
        extraGridSizes,
        ditherRef.current
      );
      return { success, failed };
    } finally {
      setStatus('ready');
    }
  }, [result]);

  return { status, result, error, process, reprocess, exportMulti };
}
```

- [ ] **Step 3: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: 0 errors; 45/45 pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePipeline.ts
git commit -m "refactor(hooks): usePipeline 暴露 exportMulti"
```

---

## Task 10: Update `ExportPanel` with Multi-Select

**Files:**
- Modify: `src/components/ExportPanel.tsx`

- [ ] **Step 1: Read current `src/components/ExportPanel.tsx`**

Run: `cat src/components/ExportPanel.tsx`

The current version (after revert) is the simple single-button version.

- [ ] **Step 2: Replace with multi-select version**

```tsx
import { useState } from 'react';

interface Props {
  currentGridSize: number;
  onExport: (exportCellPx: number, extraGridSizes: number[]) => void;
  disabled: boolean;
}

const PIXEL_OPTIONS = [16, 24, 32, 48];
const SIZE_OPTIONS = [50, 75, 100, 150, 200, 300, 500];

export function ExportPanel({ currentGridSize, onExport, disabled }: Props) {
  const [cellPx, setCellPx] = useState(32);
  const [extra, setExtra] = useState<number[]>([]);

  const toggle = (n: number) => {
    setExtra(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]);
  };

  const totalCount = 1 + extra.length;
  const buttonText = totalCount === 1 ? '导出 1 张图片' : `导出 ${totalCount} 张图片`;

  return (
    <div className="export-panel">
      <label>
        导出像素密度（一格）
        <select value={cellPx} onChange={e => setCellPx(Number(e.target.value))}>
          {PIXEL_OPTIONS.map(o => <option key={o} value={o}>{o}px</option>)}
        </select>
        <span className="hint">默认 32；≥24 时附标注图</span>
      </label>

      <div className="extra-sizes">
        <p className="extra-label">额外尺寸（当前必选：{currentGridSize}）</p>
        <div className="size-grid">
          {SIZE_OPTIONS.map(n => (
            <label key={n} className="size-option">
              <input
                type="checkbox"
                checked={extra.includes(n) || n === currentGridSize}
                disabled={disabled || n === currentGridSize}
                onChange={() => toggle(n)}
              />
              <span>{n}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        className="primary"
        disabled={disabled}
        onClick={() => onExport(cellPx, extra.filter(n => n !== currentGridSize))}
      >
        {buttonText}
      </button>
      <p className="hint">
        每张约 {Math.round((currentGridSize * cellPx) ** 2 * 4 / 1024 / 1024 * 10) / 10}MB PNG
        {totalCount > 1 ? ` × ${totalCount} 张` : ''}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ExportPanel.tsx
git commit -m "feat(ui): ExportPanel 多选额外尺寸 + 导出计数"
```

---

## Task 11: Update `App.tsx` to Wire `exportMulti`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Read current `src/App.tsx`**

Run: `cat src/App.tsx`

- [ ] **Step 2: Update the destructured `usePipeline` field and the `onExport` handler**

Find:
```ts
  const { status, result, error, process, reprocess, exportComposite } = usePipeline(palette);
```

Replace with:
```ts
  const { status, result, error, process, reprocess, exportMulti } = usePipeline(palette);
```

Find the `handleExport` function:

```ts
  const handleExport = async () => {
    if (!result || exporting) return;
    setExporting(true);
    try {
      await exportComposite();
    } finally {
      setExporting(false);
    }
  };
```

Replace with:

```ts
  const handleExport = async (exportCellPx: number, extraGridSizes: number[]) => {
    if (!result || exporting) return;
    setExporting(true);
    try {
      await exportMulti(exportCellPx, extraGridSizes);
    } finally {
      setExporting(false);
    }
  };
```

Find the `<ExportPanel>` usage:

```tsx
          <ExportPanel
            disabled={!result || exporting}
            onExport={handleExport}
          />
```

Replace with:

```tsx
          <ExportPanel
            currentGridSize={result?.gridSize ?? 100}
            disabled={!result || exporting}
            onExport={handleExport}
          />
```

- [ ] **Step 3: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: 0 errors; 45/45 pass.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): App 接入 exportMulti 多图导出"
```

---

## Task 12: CSS — Warm Neutral Palette + Soft Shadow + Larger Radius

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Replace `:root` color/radius/shadow tokens**

Find the `:root` block. Replace it with:

```css
:root {
  /* Color — 暖中性 */
  --color-bg: #faf8f5;
  --color-surface: #fffefa;
  --color-surface-alt: #f5f1ea;
  --color-text: #2d2a26;
  --color-text-muted: #78716c;
  --color-border: #e7e2d8;
  --color-border-strong: #d6cfc1;
  --color-accent: #c2410c;
  --color-accent-hover: #9a3412;
  --color-accent-soft: #fef3eb;
  --color-error-bg: #fef2f2;
  --color-error-fg: #b91c1c;

  /* Spacing (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  /* Radius — 大圆角 */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;

  /* Shadow — 柔和 */
  --shadow-sm: 0 1px 3px rgba(60, 40, 20, 0.06);
  --shadow-md: 0 4px 12px rgba(60, 40, 20, 0.08);
  --shadow-lg: 0 8px 24px rgba(60, 40, 20, 0.12);

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 18px;

  /* Layout */
  --left-col-w: 280px;
  --right-col-w: 300px;
}
```

(Body and shared rules below `:root` are unchanged — they reference the variables and will automatically pick up new colors.)

- [ ] **Step 2: Add `.extra-sizes` / `.extra-label` / `.size-grid` / `.size-option` styles**

Find the end of the export-panel block. After `.export-panel .hint { ... }`, add:

```css
.extra-sizes {
  margin-top: var(--space-3);
  margin-bottom: var(--space-3);
}
.extra-label {
  font-size: var(--text-sm);
  color: var(--color-text);
  margin-bottom: var(--space-2);
}
.size-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-1);
}
.size-option {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  cursor: pointer;
  user-select: none;
}
.size-option input { accent-color: var(--color-accent); }
.size-option input:disabled { cursor: not-allowed; }
.size-option input:disabled + span { color: var(--color-text-muted); }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "style: 暖中性调色盘 + 软阴影 + 大圆角 + 多选尺寸样式"
```

---

## Task 13: Add E2E Multi-Export Test

**Files:**
- Modify: `tests/e2e/flow.spec.ts`

- [ ] **Step 1: Append the multi-export test**

Find the closing `});` of the `test.describe` block. Before the closing `});`, insert:

```ts
  test('多选额外尺寸触发多次下载', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    // Pick extra grid sizes 50 and 200 (current 100 is auto-included)
    await page.locator('.size-option', { hasText: '50' }).locator('input').check();
    await page.locator('.size-option', { hasText: '200' }).locator('input').check();

    await expect(page.locator('.export-panel button.primary')).toHaveText('导出 3 张图片');

    const downloads: string[] = [];
    page.on('download', (d) => {
      downloads.push(d.suggestedFilename());
    });

    await page.locator('.export-panel button.primary').click();

    // Wait for 3 downloads (1 current + 2 extra), with 100ms gap × 2 = ~600ms total
    await page.waitForTimeout(1500);

    expect(downloads).toHaveLength(3);
    downloads.forEach(name => {
      expect(name).toMatch(/^pingdou-\d+x\d+\.png$/);
    });
  });
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/flow.spec.ts
git commit -m "test(e2e): 多选尺寸触发多次下载"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run full unit suite**

Run: `npm test`
Expected: 45/45 pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: dist/ generated; total < 200KB gzipped.

- [ ] **Step 4: Manual dev-server smoke test**

Run: `npm run dev` (background); visit http://localhost:5173; verify:
- Page loads, header visible
- Upload a 1920×1080 sample image
- Preview shows a wide (not square) canvas
- Drag browser window wider → preview grows proportionally
- Drag narrower → shrinks proportionally
- Click "导出 N 张图片" with no extras → 1 download, file is a non-square bead image
- Pick 2 extras → 3 downloads
- Visual design: warm beige background, soft shadows, rounded corners

Stop server with Ctrl+C after verifying.

- [ ] **Step 5: Git log review**

Run: `git log --oneline | head -20`
Expected: 13 new commits since `24c0ed9` (the spec commit):
1. `revert: 回滚上一轮缩放相关 5 commit`
2. `feat(types): PipelineResult 增加 outW/outH`
3. `refactor(renderer): 接受 outW/outH`
4. `refactor(annotator): 接受 outW/outH`
5. `fix(composite): 接受 outW/outH 矩形画布 不裁切`
6. `refactor(preview): 用 outW/outH`
7. `style: 移除响应式 + aspect-ratio 强制正方形`
8. `feat(pipeline): exportMulti 多图串行导出`
9. `refactor(hooks): usePipeline 暴露 exportMulti`
10. `feat(ui): ExportPanel 多选额外尺寸`
11. `feat(ui): App 接入 exportMulti`
12. `style: 暖中性调色盘 + 软阴影 + 大圆角`
13. `test(e2e): 多选尺寸触发多次下载`

---

## Self-Review

After writing this plan I checked against the spec:

**1. Spec coverage:**
- CM-1 (导出图按原图比例不裁切) → Task 5 (composite 接受 outW/outH)；test "preserves non-square aspect ratio"
- CM-2 (预览随窗口变大) → Task 6 (PreviewCanvas 用 outW/outH + CSS 拉伸) + Task 7 (移除 aspect-ratio)
- CM-3 (不变形) → Task 7 (`height: auto`)
- CM-4 (暖中性 + 软阴影 + 圆角) → Task 12 (调色盘 + shadow + radius)
- CM-5 (多图导出) → Task 8 (exportMulti) + Task 10 (ExportPanel 多选) + Task 11 (App) + Task 13 (E2E)

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later". Every step has actual code or exact commands. Test code is complete for each test.

**3. Type consistency:**
- `PipelineResult` adds `outW, outH` in Task 2 → used in Task 3 (`renderer`), Task 4 (`annotator`), Task 5 (`composite`), Task 6 (`PreviewCanvas`)
- `renderPaletteImage` / `renderAnnotatedImage` / `renderComposite` signatures change consistently across Tasks 3, 4, 5
- `exportMulti` signature in Task 8 matches what `usePipeline` calls in Task 9 and `App` calls in Task 11

**4. Edge cases / gaps fixed during self-review:**
- Task 7 removes `aspect-ratio: 1/1` (was the original misunderstanding: my code was forcing preview square, now removed)
- Task 3 splits border-drawing loop into two (one per axis) because non-square canvas needs correct border counts
- Task 8 keeps `sizes.indexOf(...) < sizes.length - 1` check to skip the final 100ms wait (no need to delay after last export)

**5. Test count progression:**
- Before this plan: 43 tests
- After Task 1 (revert): 43 tests (no change)
- After Task 5 (composite): 45 tests (3 → 5)
- All other tasks: no test count change
- Final: 45 unit tests + 1 new E2E

Plan is ready for execution.