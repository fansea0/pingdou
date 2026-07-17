# 拼豆图生成器 — 背景误伤 + 导出水印 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复"自动去背景"把人物内部白色一并识别为背景的 bug，并在导出合成图右下角打上 `拼豆.xyz` 半透明白色水印。

**Architecture:** 在 `bgRemover.ts` 末尾追加 `filterMaskByBorderConnectivity`，对 `buildBackgroundMask` 的输出做 8 邻接连通域过滤，仅保留触达图像 4 边的连通分量。新建 `watermark.ts` 暴露 `applyWatermark(canvas, options?)`，在 `pipeline.ts` 的 `exportMulti()` 把合成图渲染完后、导出 blob 前插入一次调用。

**Tech Stack:** TypeScript、Vitest (jsdom)、React 18、Vite 5、Canvas 2D API。

## Global Constraints

- 拼豆图生成器的所有 src 测试位于 `tests/unit/` 与 `src/**/*.test.ts`，运行方式 `npm test -- <path>`
- 现有 jsdom `HTMLCanvasElement.prototype.getContext('2d')` polyfill（`tests/setup.ts`）把 `fillRect` / `getImageData` / `drawImage` / `strokeRect` 实现为真实像素写入，但 `fillText` / `stroke` / `measureText` 是 no-op — watermark 测试必须用 spy 验证调用参数，不能读像素
- 现有 `bgRemover.ts` 已有 `buildBackgroundMask` 和 `detectBackground` 与对应单测；新增函数必须保持纯函数风格、零副作用
- 提交信息保持 `feat:` / `fix:` / `test:` / `docs:` / `chore:` 风格，单任务单 commit
- 不动 `pipeline.ts:exportComposite()`（未使用的死代码），不动 `renderPaletteImage` / `renderAnnotatedImage` 的棋盘格行为

---

## File structure

- Modify: `src/pipeline/bgRemover.ts` — 新增 `filterMaskByBorderConnectivity` 导出函数
- Modify: `src/pipeline/pipeline.ts` — 两处插入连通域过滤、一处插入水印调用
- Create: `src/pipeline/watermark.ts` — `applyWatermark` + `WatermarkOptions` + 默认值常量
- Modify: `tests/unit/bgRemover.test.ts` — 追加连通域单测 + 集成测试
- Modify: `tests/unit/pipeline.bg.test.ts` — 追加"内部白不丢"集成用例
- Create: `tests/unit/watermark.test.ts` — 水印单测

---

### Task 1: Add `filterMaskByBorderConnectivity` to bgRemover (TDD)

**Files:**
- Modify: `src/pipeline/bgRemover.ts:178` — 在文件末尾（最后一个 `export` 之前）追加新函数
- Modify: `tests/unit/bgRemover.test.ts:1` — 在文件末尾追加新的 describe 块

**Interfaces:**
- Consumes: 无（纯函数，无前置依赖）
- Produces: `export function filterMaskByBorderConnectivity(mask: Uint8Array, width: number, height: number): Uint8Array` — 与输入等长，仅保留触边 8 邻接连通分量

- [ ] **Step 1: Append failing tests**

Append to `tests/unit/bgRemover.test.ts`:

```ts
import { filterMaskByBorderConnectivity } from '@/pipeline/bgRemover';

describe('filterMaskByBorderConnectivity', () => {
  it('keeps all when mask is fully 1', () => {
    const m = new Uint8Array(5 * 5).fill(1);
    const out = filterMaskByBorderConnectivity(m, 5, 5);
    expect(Array.from(out)).toEqual(Array.from(m));
  });

  it('clears interior isolated island (no border contact)', () => {
    // 5×5, only the center (2,2) is 1 — should be cleared.
    const m = new Uint8Array(5 * 5);
    m[2 * 5 + 2] = 1;
    const out = filterMaskByBorderConnectivity(m, 5, 5);
    expect(out.every(v => v === 0)).toBe(true);
  });

  it('keeps border-connected ring, clears interior island', () => {
    // 6×6: outer ring all 1s; interior cell (3,3) is 1 but surrounded by 0s.
    const m = new Uint8Array(6 * 6);
    for (let i = 0; i < 6; i++) {
      m[i] = 1;                       // top row
      m[5 * 6 + i] = 1;              // bottom row
      m[i * 6] = 1;                  // left col
      m[i * 6 + 5] = 1;              // right col
    }
    m[3 * 6 + 3] = 1;                // interior island
    const out = filterMaskByBorderConnectivity(m, 6, 6);
    // Ring kept
    expect(out[0]).toBe(1);
    expect(out[5 * 6 + 5]).toBe(1);
    expect(out[3 * 6 + 0]).toBe(1);
    expect(out[0 * 6 + 3]).toBe(1);
    // Island cleared
    expect(out[3 * 6 + 3]).toBe(0);
  });

  it('handles empty mask', () => {
    const m = new Uint8Array(0);
    const out = filterMaskByBorderConnectivity(m, 0, 0);
    expect(out.length).toBe(0);
  });

  it('handles 1×1 mask (single pixel is itself on the border)', () => {
    const m = new Uint8Array([1]);
    const out = filterMaskByBorderConnectivity(m, 1, 1);
    expect(Array.from(out)).toEqual([1]);
  });

  it('handles 1×N row: only border pixels matter', () => {
    // 1×4, only the leftmost cell is 1 → kept.
    const m = new Uint8Array([1, 0, 0, 0]);
    const out = filterMaskByBorderConnectivity(m, 1, 4);
    expect(Array.from(out)).toEqual([1, 0, 0, 0]);
    // 1×4 with only middle cell 1 → cleared (no border contact).
    const m2 = new Uint8Array([0, 0, 1, 0]);
    const out2 = filterMaskByBorderConnectivity(m2, 1, 4);
    expect(Array.from(out2)).toEqual([0, 0, 0, 0]);
  });

  it('returns a new Uint8Array (does not mutate input)', () => {
    const m = new Uint8Array(2 * 2);
    m[0] = 1; // top-left only
    const copy = new Uint8Array(m);
    const out = filterMaskByBorderConnectivity(m, 2, 2);
    expect(Array.from(m)).toEqual(Array.from(copy));   // input untouched
    expect(out === m).toBe(false);                      // new allocation
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/bgRemover.test.ts -t filterMaskByBorderConnectivity`

Expected: FAIL — `filterMaskByBorderConnectivity` is not exported from `@/pipeline/bgRemover`.

- [ ] **Step 3: Implement `filterMaskByBorderConnectivity`**

Append to `src/pipeline/bgRemover.ts` (after the existing `export function detectBackground` at the end of the file):

```ts
/**
 * Keep only the background-mask pixels that belong to an 8-connected
 * component touching any of the four image borders.
 *
 * Use case: when a subject has internal white regions (eyes, clothing,
 * negative space) on a solid-color background, `buildBackgroundMask`
 * catches those interior pixels because they share the bg color. This
 * filter keeps only the OUTER (border-touching) component so the
 * interior pixels are correctly treated as foreground.
 *
 * Pure function: never mutates `mask`. O(W * H) via 8-connected BFS.
 */
export function filterMaskByBorderConnectivity(
  mask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const out = new Uint8Array(mask.length);
  if (mask.length === 0 || width === 0 || height === 0) return out;

  const visited = new Uint8Array(mask.length);
  const queue: number[] = [];

  // Seed BFS from any border cell whose mask bit is 1.
  const pushIfMasked = (idx: number): void => {
    if (mask[idx] === 1 && !visited[idx]) {
      visited[idx] = 1;
      out[idx] = 1;
      queue.push(idx);
    }
  };
  for (let x = 0; x < width; x++) {
    pushIfMasked(x);                       // top row
    pushIfMasked((height - 1) * width + x); // bottom row
  }
  for (let y = 0; y < height; y++) {
    pushIfMasked(y * width);               // left col
    pushIfMasked(y * width + (width - 1)); // right col
  }

  // 8-connected BFS — neighbor offsets (dx, dy).
  const DIRS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % width;
    const cy = (idx - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (visited[nIdx] || mask[nIdx] !== 1) continue;
      visited[nIdx] = 1;
      out[nIdx] = 1;
      queue.push(nIdx);
    }
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/bgRemover.test.ts -t filterMaskByBorderConnectivity`

Expected: PASS — all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/bgRemover.ts tests/unit/bgRemover.test.ts
git commit -m "feat(bg): filter mask by border connectivity"
```

---

### Task 2: Wire connectivity filter into Pipeline

**Files:**
- Modify: `src/pipeline/pipeline.ts:48-60` — 在 `process()` 的 `buildBackgroundMask` 之后插入过滤
- Modify: `src/pipeline/pipeline.ts:133-149` — 在 `exportMulti()` 的 `buildBackgroundMask` 之后插入过滤
- Modify: `tests/unit/pipeline.bg.test.ts:62` — 追加集成用例

**Interfaces:**
- Consumes: Task 1 的 `filterMaskByBorderConnectivity(mask, outW, outH): Uint8Array`
- Produces: `result.mask` 中只含触边的背景格子

- [ ] **Step 1: Append a failing integration test**

Append to `tests/unit/pipeline.bg.test.ts`:

```ts
describe('Pipeline.process — internal-white preservation', () => {
  it('keeps an internal white region inside the subject (eyes/negative space)', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    // Outer red rectangle = body. Inner white rectangle = eyes/negative space.
    // Before fix: inner white got bg-masked. After fix: only outer bg is masked.
    const W = 200, H = 200;
    const arr = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < arr.length; i += 4) {
      arr[i] = 255; arr[i + 1] = 255; arr[i + 2] = 255; arr[i + 3] = 255; // white bg
    }
    // outer subject: red box 50..150 x 50..150
    for (let y = 50; y < 150; y++) {
      for (let x = 50; x < 150; x++) {
        const i = (y * W + x) * 4;
        arr[i] = 220; arr[i + 1] = 40; arr[i + 2] = 40;
      }
    }
    // inner white "eye": 90..110 x 90..110
    for (let y = 90; y < 110; y++) {
      for (let x = 90; x < 110; x++) {
        const i = (y * W + x) * 4;
        arr[i] = 255; arr[i + 1] = 255; arr[i + 2] = 255;
      }
    }
    const src = new ImageData(arr, W, H);

    const r = await runProcess(pipeline, src, true);

    // Find the grid cell corresponding to the inner eye region (center).
    const cellIdx = (cy: number, cx: number): number => cy * r.outW + cx;
    const cellAtImg = (imgX: number, imgY: number): { gx: number; gy: number } => ({
      gx: Math.floor((imgX / W) * r.outW),
      gy: Math.floor((imgY / H) * r.outH),
    });
    const eye = cellAtImg(100, 100);
    const body = cellAtImg(60, 60);
    const outerBg = cellAtImg(5, 5);

    expect(r.mask[cellIdx(eye.gy, eye.gx)]).toBe(0);   // eye NOT masked (interior)
    expect(r.mask[cellIdx(body.gy, body.gx)]).toBe(0); // body NOT masked (foreground)
    expect(r.mask[cellIdx(outerBg.gy, outerBg.gx)]).toBe(1); // outer bg IS masked
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npm test -- tests/unit/pipeline.bg.test.ts -t "internal-white preservation"`

Expected: FAIL — the eye cell is currently masked (1) because the pipeline doesn't apply the connectivity filter.

- [ ] **Step 3: Wire the filter into `process()`**

In `src/pipeline/pipeline.ts`, replace the `if (params.removeBackground) { ... }` block inside `process()` (around line 45-61) with:

```ts
      if (params.removeBackground) {
        const detected = detectBackground(src, sampled);
        if (detected) {
          const { mask: bgMask, bgCount } = buildBackgroundMask(sampled, detected.bg);
          const filtered = filterMaskByBorderConnectivity(bgMask, outW, outH);
          let kept = 0;
          filtered.forEach((v, i) => {
            if (v) kept++;
            mask[i] = v;
          });
          console.info(
            `[pingdou] bg detected = rgb(${detected.bg.join(',')}), ` +
              `kept ${kept}/${n} border-connected cells (raw ${bgCount}/${n})`
          );
        } else {
          console.warn(
            `[pingdou] 自动去背景：未能识别纯色背景。请确保四角为同色背景，或关闭此开关。`
          );
        }
      }
```

And add to the imports at the top of the file:

```ts
import {
  buildBackgroundMask,
  detectBackground,
  filterMaskByBorderConnectivity,
} from './bgRemover';
```

- [ ] **Step 4: Wire the filter into `exportMulti()`**

In `src/pipeline/pipeline.ts`, replace the matching `if (removeBackground) { ... }` block inside `exportMulti()` (around line 133-149) with:

```ts
        if (removeBackground) {
          const detected = detectBackground(src, sampled);
          if (detected) {
            const { mask: bgMask, bgCount } = buildBackgroundMask(sampled, detected.bg);
            const filtered = filterMaskByBorderConnectivity(bgMask, outW, outH);
            let kept = 0;
            filtered.forEach((v, j) => {
              if (v) kept++;
              mask[j] = v;
            });
            console.info(
              `[pingdou] bg detected = rgb(${detected.bg.join(',')}), ` +
                `kept ${kept}/${outW * outH} border-connected cells (raw ${bgCount}/${outW * outH}, gridSize=${gridSize})`
            );
          } else {
            console.warn(
              `[pingdou] 自动去背景：未能识别纯色背景 (gridSize=${gridSize})。`
            );
          }
        }
```

- [ ] **Step 5: Run pipeline + bgRemover tests to verify they pass**

Run: `npm test -- tests/unit/pipeline.bg.test.ts tests/unit/bgRemover.test.ts`

Expected: PASS — including the new internal-white test.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/pipeline.ts tests/unit/pipeline.bg.test.ts
git commit -m "fix(bg): preserve internal whites via connectivity filter"
```

---

### Task 3: Add `applyWatermark` to a new `watermark.ts` (TDD)

**Files:**
- Create: `src/pipeline/watermark.ts` — 完整文件
- Create: `tests/unit/watermark.test.ts` — 完整文件

**Interfaces:**
- Consumes: 无（独立模块）
- Produces:
  - `export interface WatermarkOptions { text?, fontRatio?, marginRatio?, fillStyle?, shadowColor?, shadowBlur? }`
  - `export const DEFAULT_WATERMARK_OPTIONS: Required<WatermarkOptions>`
  - `export function applyWatermark(canvas: HTMLCanvasElement, options?: WatermarkOptions): void`

- [ ] **Step 1: Create the failing test file**

Create `tests/unit/watermark.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  applyWatermark,
  DEFAULT_WATERMARK_OPTIONS,
} from '@/pipeline/watermark';

/**
 * Build a fresh canvas + spy ctx that records every setter call. The
 * jsdom polyfill's fillText is a no-op, so we capture the args via spy.
 */
function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const fillText = vi.fn();
  // monkey-patch the no-op fillText so the spy actually captures calls.
  (ctx as unknown as { fillText: typeof fillText }).fillText = fillText;
  return { canvas, ctx, fillText };
}

describe('applyWatermark', () => {
  it('draws the default text 拼豆.xyz in the bottom-right corner', () => {
    const { canvas, fillText } = makeCanvas(400, 300);
    applyWatermark(canvas);
    expect(fillText).toHaveBeenCalledTimes(1);
    const [text, x, y] = fillText.mock.calls[0]!;
    expect(text).toBe('拼豆.xyz');
    // bottom-right means x ≈ canvas.width - margin, y ≈ canvas.height - margin
    const margin = DEFAULT_WATERMARK_OPTIONS.marginRatio *
      Math.max(14, Math.min(64, Math.min(canvas.width, canvas.height) * DEFAULT_WATERMARK_OPTIONS.fontRatio));
    expect(x).toBeCloseTo(canvas.width - margin, 5);
    expect(y).toBeCloseTo(canvas.height - margin, 5);
  });

  it('uses a custom text when provided', () => {
    const { canvas, fillText } = makeCanvas(200, 200);
    applyWatermark(canvas, { text: 'CustomMark' });
    expect(fillText.mock.calls[0]![0]).toBe('CustomMark');
  });

  it('font size scales with canvas size (fontRatio default 0.025, clamped [14, 64])', () => {
    const small = makeCanvas(200, 200);
    applyWatermark(small.canvas);
    const smallFont = (small.ctx.font as string);
    const smallPx = parseInt(smallFont.match(/bold (\d+)px/)?.[1] ?? '0', 10);

    const big = makeCanvas(2000, 2000);
    applyWatermark(big.canvas);
    const bigFont = (big.ctx.font as string);
    const bigPx = parseInt(bigFont.match(/bold (\d+)px/)?.[1] ?? '0', 10);

    // 200 → 200*0.025 = 5 → clamped to 14
    // 2000 → 2000*0.025 = 50 → stays 50
    expect(smallPx).toBe(14);
    expect(bigPx).toBe(50);
    expect(bigPx).toBeGreaterThan(smallPx);
  });

  it('respects custom fontRatio', () => {
    const { canvas, ctx } = makeCanvas(1000, 1000);
    applyWatermark(canvas, { fontRatio: 0.05 });
    // 1000 * 0.05 = 50
    expect((ctx.font as string)).toContain('bold 50px');
  });

  it('respects custom marginRatio', () => {
    const { canvas, fillText } = makeCanvas(500, 500);
    applyWatermark(canvas, { fontRatio: 0.1, marginRatio: 2 });
    const [, x, y] = fillText.mock.calls[0]!;
    // fontPx = min(500)*0.1 = 50, clamped (already inside [14, 64]); margin = 50*2 = 100
    expect(x).toBeCloseTo(500 - 100, 5);
    expect(y).toBeCloseTo(500 - 100, 5);
  });

  it('uses a semi-transparent white fill style by default', () => {
    const { canvas, ctx } = makeCanvas(400, 400);
    applyWatermark(canvas);
    expect(ctx.fillStyle).toBe(DEFAULT_WATERMARK_OPTIONS.fillStyle);
    expect(ctx.fillStyle as string).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.\d+\)/);
  });

  it('does not throw on a 1×1 canvas (clamp keeps text inside)', () => {
    const { canvas, fillText } = makeCanvas(1, 1);
    expect(() => applyWatermark(canvas)).not.toThrow();
    expect(fillText).toHaveBeenCalledTimes(1);
  });

  it('returns silently if getContext returns null', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const orig = canvas.getContext.bind(canvas);
    canvas.getContext = vi.fn(() => null) as unknown as typeof canvas.getContext;
    expect(() => applyWatermark(canvas)).not.toThrow();
    canvas.getContext = orig;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/watermark.test.ts`

Expected: FAIL — module `@/pipeline/watermark` does not exist.

- [ ] **Step 3: Implement `watermark.ts`**

Create `src/pipeline/watermark.ts`:

```ts
/**
 * Draw a small "拼豆.xyz" watermark in the bottom-right corner of a canvas.
 *
 * Used at the very end of the export pipeline (right before canvas → blob)
 * so every downloaded composite PNG carries the brand mark. Not applied to
 * the on-screen preview.
 *
 * Pure side-effect on the canvas's 2D context. If the canvas has no 2D
 * context, the call is a silent no-op (matches the rest of the pipeline's
 * "fail conservatively" stance — better no watermark than a broken export).
 */

export interface WatermarkOptions {
  /** Override the watermark text. Default: '拼豆.xyz' */
  readonly text?: string;
  /** Font size = min(W,H) * fontRatio, clamped to [14, 64]. Default 0.025 */
  readonly fontRatio?: number;
  /** Distance from canvas edge = fontPx * marginRatio. Default 0.6 */
  readonly marginRatio?: number;
  /** Default 'rgba(255,255,255,0.65)' */
  readonly fillStyle?: string;
  /** Default 'rgba(0,0,0,0.45)' */
  readonly shadowColor?: string;
  /** Default 4 */
  readonly shadowBlur?: number;
}

export const DEFAULT_WATERMARK_OPTIONS = {
  text: '拼豆.xyz',
  fontRatio: 0.025,
  marginRatio: 0.6,
  fillStyle: 'rgba(255,255,255,0.65)',
  shadowColor: 'rgba(0,0,0,0.45)',
  shadowBlur: 4,
} as const;

const FONT_MIN = 14;
const FONT_MAX = 64;
const FONT_FAMILY = '-apple-system, "PingFang SC", sans-serif';

export function applyWatermark(
  canvas: HTMLCanvasElement,
  options?: WatermarkOptions
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const opts = { ...DEFAULT_WATERMARK_OPTIONS, ...(options ?? {}) };
  const shortSide = Math.min(canvas.width, canvas.height);
  const fontPx = Math.max(FONT_MIN, Math.min(FONT_MAX, shortSide * opts.fontRatio));
  const margin = fontPx * opts.marginRatio;

  ctx.save();
  ctx.font = `bold ${fontPx}px ${FONT_FAMILY}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = opts.fillStyle;
  ctx.shadowColor = opts.shadowColor;
  ctx.shadowBlur = opts.shadowBlur;
  ctx.fillText(opts.text, canvas.width - margin, canvas.height - margin);
  ctx.restore();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/watermark.test.ts`

Expected: PASS — all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/watermark.ts tests/unit/watermark.test.ts
git commit -m "feat(export): add 拼豆.xyz watermark tool"
```

---

### Task 4: Apply watermark in Pipeline.exportMulti

**Files:**
- Modify: `src/pipeline/pipeline.ts:158` — 在 `renderComposite(...)` 之后、`canvasToBlob(...)` 之前插入 `applyWatermark`
- Modify: `src/pipeline/pipeline.ts:5` — 新增 import

**Interfaces:**
- Consumes: Task 3 的 `applyWatermark(canvas)`
- Produces: `exportMulti()` 输出的每个 PNG 在右下角带水印

- [ ] **Step 1: Add the import**

In `src/pipeline/pipeline.ts`, update the existing imports near the top:

```ts
import { canvasToBlob, triggerDownload } from './exporter';
import { applyWatermark } from './watermark';
```

- [ ] **Step 2: Wire `applyWatermark` into `exportMulti()`**

In `src/pipeline/pipeline.ts`, inside `exportMulti()` (around line 150-160), replace:

```ts
        const compositeCanvas = renderComposite(
          indices,
          outW,
          outH,
          this.palette,
          { cellPx: exportCellPx },
          mask
        );
        const blob = await canvasToBlob(compositeCanvas);
```

with:

```ts
        const compositeCanvas = renderComposite(
          indices,
          outW,
          outH,
          this.palette,
          { cellPx: exportCellPx },
          mask
        );
        applyWatermark(compositeCanvas);
        const blob = await canvasToBlob(compositeCanvas);
```

- [ ] **Step 3: Verify the existing pipeline tests still pass**

Run: `npm test -- tests/unit/pipeline.bg.test.ts tests/unit/composite.test.ts tests/unit/exporter.test.ts`

Expected: PASS — no regression in pipeline / composite / exporter suites.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/pipeline.ts
git commit -m "feat(export): stamp 拼豆.xyz watermark on composite PNGs"
```

---

### Task 5: Verify the full suite + build

**Files:** none

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`

Expected: PASS — all unit tests green; new tests visible under `bgRemover` (filterMaskByBorderConnectivity), `pipeline.bg` (internal-white preservation), and `watermark`.

- [ ] **Step 3: Production build**

Run: `npm run build`

Expected: exit 0; `dist/` produced.

- [ ] **Step 4: Inspect final patch**

Run: `git log --oneline HEAD~5..HEAD && git status --short`

Expected: 4 commits on top of the spec commit (`docs(spec): ...`), clean working tree.

- [ ] **Step 5: Commit any leftovers (if needed)**

If `git status --short` showed anything, fix it and:

```bash
git add -A
git commit -m "chore: post-verify cleanup"
```

If the tree is already clean, skip this step.
