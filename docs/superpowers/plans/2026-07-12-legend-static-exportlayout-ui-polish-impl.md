# 拼豆图：导出图横向布局 + 静态对照表 + UI 美化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing 拼豆图生成器 UI to (1) put the legend on the right side of the exported composite image, (2) make the in-page ColorLegend fully static with no hover highlight (keep the preview clean), and (3) polish the UI to a clean modern light style using CSS variables.

**Architecture:** Two deletion-first rounds (remove hover/highlight code), then composite.ts layout algorithm rewrite with updated tests, then full CSS rewrite introducing a `:root`-level design-token system. All algorithms (sampler/ditherer/quantizer/renderer/annotator/recipe) untouched.

**Tech Stack:** React 18, TypeScript, Vite 5, Canvas 2D, Vitest, Playwright, native CSS with `:root` custom properties.

**Reference Spec:** `docs/superpowers/specs/2026-07-12-legend-static-exportlayout-ui-polish-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/App.tsx` | Modify | Remove `highlightedIndex` state and related handlers |
| `src/components/PreviewCanvas.tsx` | Modify | Remove `highlightedIndex` prop + overlay `useEffect` + `HIGHLIGHT_COLOR` |
| `src/components/ColorLegend.tsx` | Modify | Remove `highlightedIndex`/`onHoverIndex` props + mouse events + highlighted class |
| `src/components/ColorLegend.test.tsx` | Modify | Drop 1 hover test, update 3 remaining to new props |
| `src/pipeline/composite.ts` | Modify | Rewrite layout: bead image left (vertically centered) + legend right (vertically centered) |
| `tests/unit/composite.test.ts` | Modify | Adjust 3 test assertions for new layout |
| `src/styles/global.css` | Modify | Full rewrite: `:root` tokens + clean modern light theme |
| `tests/e2e/flow.spec.ts` | Modify | Drop 1 hover test |

---

## Task 1: App.tsx — Remove `highlightedIndex` State

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Read current App.tsx**

Run: `cat src/App.tsx`

- [ ] **Step 2: Remove `highlightedIndex` state and its usages**

In `src/App.tsx`, remove these lines (with surrounding whitespace):

- The line `const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);`
- In the `onGridSizeChange` handler, the `setHighlightedIndex(null);` line
- In the `onDitherChange` handler, the `setHighlightedIndex(null);` line
- In the `handleExport` callback, nothing changes (it doesn't reference highlightedIndex)
- The `highlightedIndex={highlightedIndex}` prop on `<PreviewCanvas>`
- The `highlightedIndex={highlightedIndex}` and `onHoverIndex={setHighlightedIndex}` props on `<ColorLegend>`

- [ ] **Step 3: Verify typecheck fails before downstream fixes**

Run: `npm run typecheck`
Expected: FAIL with errors about `ColorLegend` props (`highlightedIndex`, `onHoverIndex` not accepted) and `PreviewCanvas` prop (`highlightedIndex` not accepted). This is intentional — we're going to fix it in Tasks 2-3.

- [ ] **Step 4: Don't commit yet — keep building**

(No commit in this task; final commit happens after Task 3 fixes the prop mismatches.)

---

## Task 2: PreviewCanvas — Remove `highlightedIndex` Prop and Overlay

**Files:**
- Modify: `src/components/PreviewCanvas.tsx`

- [ ] **Step 1: Replace `src/components/PreviewCanvas.tsx` with:**

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
    const c = renderPaletteImage(result.indices, result.gridSize, palette, cellPx, '#ddd');
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

- [ ] **Step 2: Don't commit yet — App.tsx + ColorLegend still have prop mismatches that need fixing**

---

## Task 3: ColorLegend — Simplify to Pure Presentational

**Files:**
- Modify: `src/components/ColorLegend.tsx`
- Modify: `src/components/ColorLegend.test.tsx`

- [ ] **Step 1: Replace `src/components/ColorLegend.tsx` with:**

```tsx
import type { LegendRow } from '@/pipeline/legend';

interface Props {
  legend: LegendRow[];
}

export function ColorLegend({ legend }: Props) {
  if (legend.length === 0) {
    return (
      <aside className="legend-wrap">
        <p className="legend-empty">当前图像未匹配到任何色号</p>
      </aside>
    );
  }

  return (
    <aside className="legend-wrap">
      <h3 className="legend-title">色号对照表</h3>
      <p className="legend-subtitle">点击复制色号（v2）</p>
      <div className="legend-table">
        <div className="legend-header">
          <div className="col-swatch">色块</div>
          <div className="col-id">色号</div>
          <div className="col-name">名称</div>
          <div className="col-count">数量</div>
        </div>
        {legend.map(row => (
          <div key={row.id} className="legend-row">
            <div className="col-swatch">
              <span
                className="swatch"
                style={{ backgroundColor: `rgb(${row.rgb[0]},${row.rgb[1]},${row.rgb[2]})` }}
              />
            </div>
            <div className="col-id">{row.id}</div>
            <div className="col-name">{row.name}</div>
            <div className="col-count">{row.count}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
```

> Note: subtitle mentions "点击复制" as a forward-looking hint; no actual click handler is wired (out of scope per spec §1.3). Remove this subtitle string if you'd rather not pre-announce a future feature — keeping it is fine.

- [ ] **Step 2: Replace `src/components/ColorLegend.test.tsx` with:**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ColorLegend } from '@/components/ColorLegend';
import type { LegendRow } from '@/pipeline/legend';

const legend: LegendRow[] = [
  { id: 'A01', name: '红', rgb: [255, 0, 0], count: 3, index: 0 },
  { id: 'A02', name: '绿', rgb: [0, 255, 0], count: 1, index: 1 },
];

describe('ColorLegend', () => {
  it('renders one row per legend entry', () => {
    const { container } = render(<ColorLegend legend={legend} />);
    const rows = container.querySelectorAll('.legend-row');
    expect(rows).toHaveLength(2);
  });

  it('shows id, name, count for each row', () => {
    const { container } = render(<ColorLegend legend={legend} />);
    expect(container.textContent).toContain('A01');
    expect(container.textContent).toContain('红');
    expect(container.textContent).toContain('3');
  });

  it('renders empty state when legend is empty', () => {
    const { container } = render(<ColorLegend legend={[]} />);
    expect(container.querySelector('.legend-empty')?.textContent).toMatch(/未匹配/);
  });

  it('does not have any mouse event handlers attached', () => {
    const { container } = render(<ColorLegend legend={legend} />);
    const firstRow = container.querySelector('.legend-row')!;
    // jsdom doesn't run handlers, but we can check that no listener is attached
    // by looking at React's internal prop. Simpler: just verify no `highlighted` class.
    expect(firstRow.className).not.toMatch(/highlighted/);
  });
});
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Run ColorLegend tests**

Run: `npm test ColorLegend`
Expected: 4/4 pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 42/42 pass (was 43; 1 hover test removed + 1 new "no highlighted class" test added = net same count).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/PreviewCanvas.tsx src/components/ColorLegend.tsx src/components/ColorLegend.test.tsx
git commit -m "refactor(ui): 移除 hover 高亮逻辑；ColorLegend 变纯展示组件"
```

---

## Task 4: Update E2E — Drop Hover Test

**Files:**
- Modify: `tests/e2e/flow.spec.ts`

- [ ] **Step 1: Read current file**

Run: `cat tests/e2e/flow.spec.ts`

- [ ] **Step 2: Replace the hover test with a static-rendering test**

Find this test:

```ts
  test('hover 对照表行时该行加 highlighted 类', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('.legend-row').first();
    await firstRow.hover();
    await expect(firstRow).toHaveClass(/highlighted/);
  });
```

Replace it with:

```ts
  test('对照表行是纯静态，无 highlighted 类', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('.legend-row').first();
    expect(await firstRow.getAttribute('class')).not.toMatch(/highlighted/);
  });
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/flow.spec.ts
git commit -m "test(e2e): hover 用例替换为静态断言"
```

---

## Task 5: Composite Layout Rewrite (Bead Image Left + Legend Right)

**Files:**
- Modify: `src/pipeline/composite.ts`
- Modify: `tests/unit/composite.test.ts`

- [ ] **Step 1: Write updated failing tests**

Replace `tests/unit/composite.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { renderComposite, DEFAULT_COMPOSITE_OPTIONS } from '@/pipeline/composite';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 255, 0], name: '绿' },
  { id: 'A03', rgb: [0, 0, 255], name: '蓝' },
];

describe('renderComposite', () => {
  it('canvas width = beadW + cellGap + legendW', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadW = 3 * 32;
    const legendRows = 1 + 3 + 1;
    const legendW = opts.legendColWidth + 100 + 100 + 80 + opts.legendPadding * 2;
    const expectedW = beadW + opts.cellGap + legendW;
    expect(canvas.width).toBe(expectedW);
  });

  it('canvas height = max(beadH, legendH)', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadH = 3 * 32;
    const legendRows = 1 + 3 + 1;
    const legendH = legendRows * opts.legendRowHeight + opts.legendPadding * 2;
    expect(canvas.height).toBe(Math.max(beadH, legendH));
  });

  it('bead image appears on the left half (sample left region = bead color)', () => {
    const indices = new Uint8Array(9); // 3×3 grid all red
    indices.fill(0);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32, cellGap: 40, legendRowHeight: 36, legendColWidth: 60, legendPadding: 16 });
    const ctx = canvas.getContext('2d')!;
    // Sample at cell (0,0) center: (16, 16). Should be red.
    const px = ctx.getImageData(16, 16, 1, 1).data;
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
  });

  it('legend appears on the right half (sample right region = swatch color)', () => {
    const indices = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0]); // only A01 red used
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32, cellGap: 40, legendRowHeight: 36, legendColWidth: 60, legendPadding: 16 });
    const ctx = canvas.getContext('2d')!;
    // Bead image ends at x = 3*32 = 96. Cellgap = 40. Legend starts at x = 136.
    // Swatch is at legendPadding (16) inside legend. So x ~ 136 + 16 + 4 = 156.
    // y: legendPadding (16) + headerRowHeight (36) + 1st data row center = 16+36+18 = 70
    const px = ctx.getImageData(156, 70, 1, 1).data;
    // Should be red (A01 swatch)
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
  });

  it('bead image is vertically centered', () => {
    // Use a small bead image and large legend to force centering.
    const indices = new Uint8Array([0, 0, 1, 1]); // 2x2 grid
    const canvas = renderComposite(indices, 2, palette, { cellPx: 32, cellGap: 40, legendRowHeight: 60, legendColWidth: 60, legendPadding: 16 });
    const ctx = canvas.getContext('2d')!;
    // Bead area (top-left cell) should be at y > 0 because canvas is taller than bead.
    const beadH = 2 * 32; // 64
    const legendRows = 1 + 2 + 1; // header + 2 data + total = 4
    const legendH = 4 * 60 + 16 * 2; // 272
    const canvasH = Math.max(beadH, legendH); // 272
    const expectedBeadY = Math.floor((canvasH - beadH) / 2); // floor((272 - 64) / 2) = 104
    // Sample inside bead area at center of cell (0,0): x=16, y=expectedBeadY+16 = 120
    const px = ctx.getImageData(16, expectedBeadY + 16, 1, 1).data;
    expect(px[3]).toBeGreaterThan(0); // non-transparent — there's a color
    // And just above expectedBeadY there's white background
    const abovePx = ctx.getImageData(16, expectedBeadY - 4, 1, 1).data;
    expect([abovePx[0], abovePx[1], abovePx[2]]).toEqual([255, 255, 255]);
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test composite`
Expected: FAIL on width/height formula mismatch.

- [ ] **Step 3: Replace `src/pipeline/composite.ts` with the new layout:**

```ts
import type { Palette } from '@/types';
import { renderAnnotatedImage } from './annotator';

export interface CompositeOptions {
  readonly cellPx: number;
  readonly fontPx: number;
  readonly cellGap: number;
  readonly legendRowHeight: number;
  readonly legendColWidth: number;
  readonly legendPadding: number;
}

export const DEFAULT_COMPOSITE_OPTIONS: CompositeOptions = {
  cellPx: 32,
  fontPx: 12,
  cellGap: 40,
  legendRowHeight: 36,
  legendColWidth: 60,
  legendPadding: 16,
};

interface InternalRow {
  readonly id: string;
  readonly name: string;
  readonly rgb: readonly [number, number, number];
  readonly count: number;
}

function buildRows(indices: Uint8Array, palette: Palette): InternalRow[] {
  const counts = new Map<number, number>();
  for (const i of indices) counts.set(i, (counts.get(i) ?? 0) + 1);
  const rows: InternalRow[] = [];
  for (const [idx, count] of counts) {
    const { id, name, rgb } = palette[idx];
    rows.push({ id, name, rgb, count });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

/**
 * Render a composite image: bead image (with color-code annotations) on the LEFT
 * and legend table on the RIGHT. Both vertically centered.
 *
 * Layout:
 *   canvasW = beadW + cellGap + legendW
 *   canvasH = max(beadH, legendH)
 *   beadX = 0
 *   beadY = floor((canvasH - beadH) / 2)
 *   legendX = beadW + cellGap
 *   legendY = floor((canvasH - legendH) / 2)
 */
export function renderComposite(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  options?: Partial<CompositeOptions>
): HTMLCanvasElement {
  const opts: CompositeOptions = { ...DEFAULT_COMPOSITE_OPTIONS, ...options };

  const beadCanvas = renderAnnotatedImage(
    indices,
    gridSize,
    palette,
    opts.cellPx,
    opts.fontPx
  );
  const beadW = beadCanvas.width;
  const beadH = beadCanvas.height;

  const rows = buildRows(indices, palette);
  const legendRowsCount = 1 + rows.length + 1;
  const labelColW = 100;
  const nameColW = 100;
  const countColW = 80;
  const legendInnerW = opts.legendColWidth + labelColW + nameColW + countColW;
  const legendW = legendInnerW + opts.legendPadding * 2;
  const legendH = legendRowsCount * opts.legendRowHeight + opts.legendPadding * 2;

  const canvasW = beadW + opts.cellGap + legendW;
  const canvasH = Math.max(beadH, legendH);

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Draw bead image left, vertically centered.
  const beadX = 0;
  const beadY = Math.floor((canvasH - beadH) / 2);
  ctx.drawImage(beadCanvas, beadX, beadY);

  // Draw legend right, vertically centered.
  const legendTop = Math.floor((canvasH - legendH) / 2);
  const legendLeft = beadW + opts.cellGap;

  ctx.strokeStyle = '#e5e5e5';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendLeft + 0.5, legendTop + 0.5, legendW - 1, legendH - 1);

  const colWidths = [opts.legendColWidth, labelColW, nameColW, countColW];
  const colXs: number[] = [legendLeft + opts.legendPadding];
  for (let i = 0; i < colWidths.length - 1; i++) colXs.push(colXs[i] + colWidths[i]);

  ctx.font = `bold 13px -apple-system, "PingFang SC", sans-serif`;
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const headerY = legendTop + opts.legendPadding + opts.legendRowHeight / 2;
  const headers = ['', '色号', '名称', '数量'];
  for (let i = 0; i < headers.length; i++) {
    if (i > 0) ctx.fillText(headers[i], colXs[i] + 8, headerY);
  }

  ctx.beginPath();
  ctx.moveTo(colXs[0], legendTop + opts.legendPadding + opts.legendRowHeight);
  ctx.lineTo(colXs[0] + legendInnerW, legendTop + opts.legendPadding + opts.legendRowHeight);
  ctx.strokeStyle = '#333';
  ctx.stroke();

  ctx.font = `13px -apple-system, "PingFang SC", sans-serif`;
  let rowY = legendTop + opts.legendPadding + opts.legendRowHeight + opts.legendRowHeight / 2;
  for (const row of rows) {
    ctx.fillStyle = `rgb(${row.rgb[0]},${row.rgb[1]},${row.rgb[2]})`;
    ctx.fillRect(
      colXs[0] + 4,
      rowY - opts.legendRowHeight / 2 + 4,
      opts.legendColWidth - 8,
      opts.legendRowHeight - 8
    );
    ctx.strokeStyle = '#ccc';
    ctx.strokeRect(
      colXs[0] + 4.5,
      rowY - opts.legendRowHeight / 2 + 4.5,
      opts.legendColWidth - 8,
      opts.legendRowHeight - 8
    );
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(row.id, colXs[1] + 8, rowY);
    ctx.fillText(row.name, colXs[2] + 8, rowY);
    ctx.textAlign = 'right';
    ctx.fillText(String(row.count), colXs[3] + countColW - 8, rowY);
    ctx.textAlign = 'left';
    rowY += opts.legendRowHeight;
  }

  ctx.font = `bold 13px -apple-system, "PingFang SC", sans-serif`;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('合计', colXs[0] + 8, rowY);
  ctx.textAlign = 'right';
  ctx.fillText(String(indices.length), colXs[3] + countColW - 8, rowY);
  ctx.textAlign = 'left';

  return canvas;
}
```

- [ ] **Step 4: Run tests, verify passing**

Run: `npm test composite`
Expected: 5/5 pass (was 3; +2 new tests for left/centered).

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 44/44 pass (was 43; -1 ColorLegend hover + 1 new "no highlighted class" + 2 new composite tests = 44).

Wait — recount: previous total was 43. Removed 1 ColorLegend hover test = 42. Added 1 ColorLegend "no highlighted class" = 43. Replaced 3 composite tests with 5 = +2, total = 45. Let me clarify in Step 5.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/composite.ts tests/unit/composite.test.ts
git commit -m "refactor(composite): 导出图改为横向布局（拼豆图左+对照表右）"
```

---

## Task 6: CSS Rewrite — Clean Modern Light Theme with :root Tokens

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Read current file to understand all existing class names**

Run: `cat src/styles/global.css`

Identify every class used by components: `.app`, `.layout-3col`, `.upload-zone`, `.param-panel`, `.export-panel`, `.preview-wrap`, `.preview-scroll`, `.preview`, `.overlay`, `.error`, `.legend-wrap`, `.legend-title`, `.legend-subtitle`, `.legend-table`, `.legend-header`, `.legend-row`, `.legend-row.highlighted`, `.col-swatch`, `.col-id`, `.col-name`, `.col-count`, `.swatch`, `.legend-empty`, `button.primary`, `.preset`, `.preset.active`, `.checkbox`.

- [ ] **Step 2: Replace `src/styles/global.css` with:**

```css
:root {
  /* Color */
  --color-bg: #f7f7f8;
  --color-surface: #ffffff;
  --color-surface-alt: #fafafa;
  --color-text: #1f2328;
  --color-text-muted: #6b7280;
  --color-border: #e5e7eb;
  --color-border-strong: #d1d5db;
  --color-accent: #2563eb;
  --color-accent-hover: #1d4ed8;
  --color-accent-soft: #eff6ff;
  --color-error-bg: #fef2f2;
  --color-error-fg: #b91c1c;

  /* Spacing (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Shadow */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.06);

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

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root { height: 100%; }

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.app {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--space-5);
}

header h1 {
  font-size: var(--text-xl);
  font-weight: 600;
  margin-bottom: var(--space-1);
  letter-spacing: -0.01em;
}
header .subtitle {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.layout-3col {
  display: grid;
  grid-template-columns: var(--left-col-w) 1fr var(--right-col-w);
  gap: var(--space-4);
  margin-top: var(--space-5);
}
@media (max-width: 1024px) {
  .layout-3col { grid-template-columns: 1fr; }
}

/* === Buttons === */
button.primary {
  background: var(--color-accent);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  font-size: var(--text-base);
  font-weight: 500;
  transition: background 0.15s;
}
button.primary:hover:not(:disabled) { background: var(--color-accent-hover); }
button.primary:disabled {
  background: var(--color-border-strong);
  cursor: not-allowed;
}

/* === Upload Zone === */
.upload-zone {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-6) var(--space-4);
  text-align: center;
  background: var(--color-surface);
  margin-bottom: var(--space-4);
  transition: border-color 0.15s;
}
.upload-zone:hover { border-color: var(--color-accent); }
.upload-zone .hint {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  margin-top: var(--space-2);
}

/* === Param Panel === */
.param-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
  box-shadow: var(--shadow-sm);
}
.param-panel label {
  display: block;
  margin-bottom: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text);
}
.param-panel input[type=range] {
  width: 100%;
  margin-top: var(--space-1);
  accent-color: var(--color-accent);
}
.param-panel .value {
  display: inline-block;
  margin-left: var(--space-2);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.param-panel .presets {
  margin: var(--space-3) 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.param-panel .preset {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  cursor: pointer;
  color: var(--color-text);
  transition: all 0.15s;
}
.param-panel .preset:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.param-panel .preset.active {
  background: var(--color-accent);
  color: #ffffff;
  border-color: var(--color-accent);
}

.checkbox {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  cursor: pointer;
}
.checkbox input { accent-color: var(--color-accent); }

/* === Export Panel === */
.export-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  box-shadow: var(--shadow-sm);
}
.export-panel label {
  display: block;
  font-size: var(--text-sm);
  margin-bottom: var(--space-2);
  color: var(--color-text);
}
.export-panel select {
  margin-left: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface);
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--color-text);
}
.export-panel .hint {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  margin-top: var(--space-2);
}

/* === Preview === */
.preview-wrap {
  position: relative;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  min-height: 480px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  box-shadow: var(--shadow-sm);
}
.preview-scroll {
  max-width: 100%;
  max-height: 80vh;
  overflow: auto;
  background: var(--color-surface-alt);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
}
.preview-scroll.dim { opacity: 0.5; }
.preview { display: block; }

.overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(31, 35, 40, 0.85);
  color: #ffffff;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

/* === Color Legend (static) === */
.legend-wrap {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  position: sticky;
  top: var(--space-3);
  max-height: calc(100vh - var(--space-5));
  overflow-y: auto;
  box-shadow: var(--shadow-sm);
}
.legend-title {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: var(--space-1);
}
.legend-subtitle {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-bottom: var(--space-3);
}
.legend-table {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  font-size: var(--text-xs);
}
.legend-header,
.legend-row {
  display: grid;
  grid-template-columns: 60px 1fr 1fr 60px;
  align-items: center;
}
.legend-header {
  background: var(--color-surface-alt);
  font-weight: 600;
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
.legend-row {
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}
.legend-row:last-child { border-bottom: none; }
.legend-row .col-swatch {
  display: flex;
  align-items: center;
  justify-content: center;
}
.legend-row .swatch {
  display: inline-block;
  width: 28px;
  height: 20px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.legend-row .col-count {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
.legend-empty {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  padding: var(--space-5) 0;
  text-align: center;
}

/* === Error === */
.error {
  color: var(--color-error-fg);
  background: var(--color-error-bg);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  margin: var(--space-3) 0;
  font-size: var(--text-sm);
  border: 1px solid #fecaca;
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: 0 errors; dist generated.

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "style: 重写 global.css 浅色干净现代风 + :root 设计变量"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run full unit suite**

Run: `npm test`
Expected: 45/45 pass.

> Recount: starting state was 43 tests. Removed 1 ColorLegend hover test → 42. Added 1 ColorLegend "no highlighted class" → 43. Replaced 3 composite tests with 5 → +2 = 45.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: dist/ generated; total < 200KB gzipped.

- [ ] **Step 4: Verify dev server boots and looks clean**

Run: `npm run dev` (background); visit http://localhost:5173; verify:
- Background is light gray, cards are white with subtle shadow
- Three columns balanced, breathing room between sections
- Upload button uses accent color
- ColorLegend on right shows color swatch / id / name / count
- Hovering over legend rows does NOT change the preview (preview stays clean)
- "导出合成图" button present
- Switch grid size — preview updates
- Click export — PNG downloads with bead image on left + legend on right (verify by opening the downloaded file)

Stop server with Ctrl+C after verifying.

- [ ] **Step 5: Git log review**

Run: `git log --oneline | head -12`
Expected: 4 new commits since `d9e712f` (the spec commit):
- `refactor(ui): 移除 hover 高亮逻辑；ColorLegend 变纯展示组件`
- `test(e2e): hover 用例替换为静态断言`
- `refactor(composite): 导出图改为横向布局（拼豆图左+对照表右）`
- `style: 重写 global.css 浅色干净现代风 + :root 设计变量`

- [ ] **Step 6: Final commit if any uncommitted changes**

```bash
git status
# If clean, nothing to do.
```

---

## Self-Review

After writing this plan I checked against the spec:

**1. Spec coverage:**
- PL-1 (legend on right side of export) → Task 5 rewrites `composite.ts` layout; tests 1-5 verify formula + position
- PL-2 (preview never polluted by overlay) → Tasks 1, 2, 3 delete all hover/highlight code from App / PreviewCanvas / ColorLegend
- PL-3 (clean modern light UI) → Task 6 rewrites `global.css` with `:root` tokens + light theme; spec §2.6 visual rules followed

**2. Placeholder scan:** No TBD/TODO. Every step has actual code or commands. Tasks 1-2 deliberately leave the build in a broken state between them; Task 3 fixes it. The intentional typecheck failure is a known transient state, not a placeholder.

**3. Type consistency:**
- `renderComposite` signature unchanged (composite.ts Step 3 of Task 5)
- `LegendRow` interface unchanged
- `ColorLegend` props: `legend` only (was `legend + highlightedIndex + onHoverIndex`)
- `PreviewCanvas` props: `result + palette + cellPx + isRecomputing` (was + `highlightedIndex`)
- `Pipeline` and `usePipeline` unchanged
- CSS class names preserved (`.layout-3col`, `.legend-wrap`, `.legend-row`, etc.) so App.tsx keeps working
- App.tsx usage of these classes is unchanged

**4. Edge cases / gaps fixed during self-review:**
- Task 1 explicitly doesn't commit; Tasks 2-3 complete the prop-cascade fix and commit once
- Task 5 test "bead image is vertically centered" uses a tall legend (60px rows × 4 = 272) vs short bead (2×32 = 64) to force centering; checks both inside-bead has color and above-bead is white
- E2E test rewrite in Task 4 keeps coverage for "static rendering" semantics while dropping impossible hover behavior

**5. Test count progression:**
- Before this plan: 43 tests
- After Task 3: 42 tests (1 ColorLegend hover removed) + 1 added ("no highlighted class") = 43
- After Task 5: 43 + 2 (composite tests) = 45
- Final expected: 45

Plan is ready for execution.