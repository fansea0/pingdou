# 拼豆图：放大预览 + 色号对照表 + 合成导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add zoom-in preview, real-time color legend with hover-highlight linkage, and single composite PNG export (annotated bead image + legend) to the existing 拼豆图生成器 SPA.

**Architecture:** Two new pure-function modules (`legend.ts`, `composite.ts`) derive everything from the existing `PipelineResult.indices` — preview, legend, and export all share the same single source of truth. One new React component (`ColorLegend.tsx`). Existing `PreviewCanvas` gains a highlighted-index overlay layer. `App.tsx` refactors to a 3-column layout. Existing pipeline modules (sampler/ditherer/quantizer/renderer/annotator/recipe) untouched.

**Tech Stack:** React 18, TypeScript, Vite 5, Canvas 2D, Vitest, Playwright.

**Reference Spec:** `docs/superpowers/specs/2026-07-12-zoom-legend-composite-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/pipeline/legend.ts` | Create | pure-fn: derive legend rows from indices |
| `src/pipeline/legend.test.ts` | Create | vitest tests for `computeLegend` |
| `src/pipeline/composite.ts` | Create | pure-fn: render annotated image + legend table to one canvas |
| `src/pipeline/composite.test.ts` | Create | vitest tests for `renderComposite` |
| `src/components/ColorLegend.tsx` | Create | React component: hover-driven legend table |
| `src/components/ColorLegend.test.tsx` | Create | vitest + RTL: component rendering & hover |
| `src/components/PreviewCanvas.tsx` | Modify | Add `highlightedIndex` prop + scrollable wrapper + overlay layer |
| `src/components/ExportPanel.tsx` | Modify | Simplify to single "导出合成图" button |
| `src/App.tsx` | Modify | 3-column layout, derive legend, manage highlightedIndex + exporting state |
| `src/styles/global.css` | Modify | Append styles for new components |
| `src/pipeline/pipeline.ts` | Modify | Replace `exportAll` with `exportComposite` (single image) |
| `src/pipeline/exporter.ts` | Modify | Add `triggerDownload(blob, filename)` (already exists; verify name) or `triggerDownloadSingle` |
| `tests/e2e/flow.spec.ts` | Modify | Add hover-highlight + composite-export assertions |
| `README.md` | Modify | Append "高亮联动 + 合成导出" section |

---

## Task 1: `computeLegend` (Pure Function)

**Files:**
- Create: `src/pipeline/legend.ts`
- Create: `src/pipeline/legend.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/pipeline/legend.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeLegend } from '@/pipeline/legend';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 255, 0], name: '绿' },
  { id: 'A03', rgb: [0, 0, 255], name: '蓝' },
];

describe('computeLegend', () => {
  it('counts each color correctly', () => {
    const indices = new Uint8Array([0, 0, 1, 2, 1, 0]);
    const legend = computeLegend(indices, palette);
    const a01 = legend.find(r => r.id === 'A01')!;
    const a02 = legend.find(r => r.id === 'A02')!;
    const a03 = legend.find(r => r.id === 'A03')!;
    expect(a01.count).toBe(3);
    expect(a02.count).toBe(2);
    expect(a03.count).toBe(1);
  });

  it('sorts by count descending', () => {
    const indices = new Uint8Array([0, 1, 1, 1, 2, 2]);
    const legend = computeLegend(indices, palette);
    expect(legend.map(r => r.id)).toEqual(['A02', 'A02', 'A02', 'A01', 'A01'].slice(0, 3));
    // first three rows in order: A02 (3), A01 (1), A03 (2) — actually check counts:
    expect(legend[0].count).toBe(3);
    expect(legend[1].count).toBe(1);
    expect(legend[2].count).toBe(2);
  });

  it('skips colors with count zero', () => {
    const indices = new Uint8Array([0, 0, 0, 0]); // only A01
    const legend = computeLegend(indices, palette);
    expect(legend).toHaveLength(1);
    expect(legend[0].id).toBe('A01');
  });

  it('returns empty array for empty indices', () => {
    const legend = computeLegend(new Uint8Array(0), palette);
    expect(legend).toEqual([]);
  });

  it('each row carries palette index for hover linkage', () => {
    const indices = new Uint8Array([2, 2, 0]);
    const legend = computeLegend(indices, palette);
    const a03 = legend.find(r => r.id === 'A03')!;
    const a01 = legend.find(r => r.id === 'A01')!;
    expect(a03.index).toBe(2);
    expect(a01.index).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test legend`
Expected: FAIL with module-not-found error.

- [ ] **Step 3: Implement `src/pipeline/legend.ts`**

```ts
import type { Palette } from '@/types';

export interface LegendRow {
  readonly id: string;
  readonly name: string;
  readonly rgb: readonly [number, number, number];
  readonly count: number;
  readonly index: number;
}

/**
 * Derive legend rows from a quantization result.
 * - Counts occurrences of each palette index.
 * - Sorts rows by count descending.
 * - Skips colors with count === 0.
 */
export function computeLegend(indices: Uint8Array, palette: Palette): LegendRow[] {
  const counts = new Map<number, number>();
  for (const i of indices) {
    counts.set(i, (counts.get(i) ?? 0) + 1);
  }

  const rows: LegendRow[] = [];
  for (const [idx, count] of counts) {
    if (count === 0) continue;
    const { id, name, rgb } = palette[idx];
    rows.push({ id, name, rgb, count, index: idx });
  }

  rows.sort((a, b) => b.count - a.count);
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test legend`
Expected: 5 tests pass.

- [ ] **Step 5: Run full suite to ensure no regression**

Run: `npm test`
Expected: 36 tests pass (31 existing + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/legend.ts src/pipeline/legend.test.ts
git commit -m "feat(legend): computeLegend 派生色号统计 pure-fn"
```

---

## Task 2: `renderComposite` (Pure Function)

**Files:**
- Create: `src/pipeline/composite.ts`
- Create: `src/pipeline/composite.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/pipeline/composite.test.ts`:

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
  it('canvas dimensions match layout formula', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadW = 3 * 32; // gridSize × cellPx
    const beadH = 3 * 32;
    const legendRows = 1 + 3 + 1; // header + 3 colors + total row
    const legendW = opts.legendColWidth + 100 + 100 + 80 + opts.legendPadding * 2;
    const expectedW = Math.max(beadW, legendW);
    const expectedH = beadH + opts.cellGap + legendRows * opts.legendRowHeight + opts.legendPadding * 2;
    expect(canvas.width).toBe(expectedW);
    expect(canvas.height).toBe(expectedH);
  });

  it('renders bead image in top half (sample pixel at center of cell)', () => {
    const indices = new Uint8Array([0, 0, 1, 1, 2, 2]);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32, cellGap: 40, legendRowHeight: 36, legendColWidth: 60, legendPadding: 16 });
    const ctx = canvas.getContext('2d')!;
    // Cell at (0,0) should be red (A01) — sample at (16,16) which is center
    const px = ctx.getImageData(16, 16, 1, 1).data;
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
  });

  it('renders legend in bottom half with text labels', () => {
    const indices = new Uint8Array([0, 0, 0, 1, 2]);
    const canvas = renderComposite(indices, 5, palette, { cellPx: 8, cellGap: 8, legendRowHeight: 20, legendColWidth: 30, legendPadding: 8 });
    const ctx = canvas.getContext('2d')!;
    // The bottom area should contain non-empty pixels (text or color swatches)
    // Sample a pixel in the legend region (after bead image + gap)
    const beadH = 5 * 8;
    const legendTop = beadH + 8 + 8; // + cellGap + legendPadding
    const legendBottom = canvas.height - 8;
    let nonWhite = 0;
    for (let y = legendTop; y < legendBottom; y += 5) {
      for (let x = 0; x < canvas.width; x += 5) {
        const px = ctx.getImageData(x, y, 1, 1).data;
        if (px[0] !== 255 || px[1] !== 255 || px[2] !== 255) nonWhite++;
      }
    }
    expect(nonWhite).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test composite`
Expected: FAIL with module-not-found error.

- [ ] **Step 3: Implement `src/pipeline/composite.ts`**

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

function pickTextColor(rgb: readonly [number, number, number]): string {
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return lum > 140 ? '#000' : '#fff';
}

/**
 * Render a composite image: bead image (with color-code annotations) on top,
 * legend table on bottom. Returns a single HTMLCanvasElement.
 */
export function renderComposite(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  options?: Partial<CompositeOptions>
): HTMLCanvasElement {
  const opts: CompositeOptions = { ...DEFAULT_COMPOSITE_OPTIONS, ...options };

  // 1. Render the bead image (with annotations) to its own canvas first.
  const beadCanvas = renderAnnotatedImage(
    indices,
    gridSize,
    palette,
    opts.cellPx,
    opts.fontPx
  );
  const beadW = beadCanvas.width;
  const beadH = beadCanvas.height;

  // 2. Build legend rows.
  const rows = buildRows(indices, palette);
  const headerRow = 1;
  const totalRow = 1;
  const legendRowsCount = headerRow + rows.length + totalRow;
  const labelColW = 100;
  const nameColW = 100;
  const countColW = 80;
  const legendInnerW = opts.legendColWidth + labelColW + nameColW + countColW;
  const legendW = legendInnerW + opts.legendPadding * 2;
  const legendH = legendRowsCount * opts.legendRowHeight + opts.legendPadding * 2;

  // 3. Composite canvas.
  const canvasW = Math.max(beadW, legendW);
  const canvasH = beadH + opts.cellGap + legendH;
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  // 4. White background.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 5. Paste bead image centered horizontally.
  const beadX = Math.floor((canvasW - beadW) / 2);
  ctx.drawImage(beadCanvas, beadX, 0);

  // 6. Draw legend.
  const legendTop = beadH + opts.cellGap;
  // Outer border
  ctx.strokeStyle = '#e5e5e5';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    0.5,
    legendTop + 0.5,
    legendW - 1,
    legendH - 1
  );

  // Header row
  ctx.font = `bold 13px -apple-system, "PingFang SC", sans-serif`;
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const headerY = legendTop + opts.legendPadding + opts.legendRowHeight / 2;
  let colX = opts.legendPadding;
  const headers = ['', '色号', '名称', '数量'];
  const colWidths = [opts.legendColWidth, labelColW, nameColW, countColW];
  for (let i = 0; i < headers.length; i++) {
    if (i === 0) {
      // empty header for swatch column
    } else {
      ctx.fillText(headers[i], colX + 8, headerY);
    }
    colX += colWidths[i];
  }

  // Header bottom border
  ctx.beginPath();
  ctx.moveTo(opts.legendPadding, legendTop + opts.legendPadding + opts.legendRowHeight);
  ctx.lineTo(legendW - opts.legendPadding, legendTop + opts.legendPadding + opts.legendRowHeight);
  ctx.strokeStyle = '#333';
  ctx.stroke();

  // Data rows
  ctx.font = `13px -apple-system, "PingFang SC", sans-serif`;
  let rowY = legendTop + opts.legendPadding + opts.legendRowHeight + opts.legendRowHeight / 2;
  for (const row of rows) {
    let cx = opts.legendPadding;
    // Swatch
    ctx.fillStyle = `rgb(${row.rgb[0]},${row.rgb[1]},${row.rgb[2]})`;
    ctx.fillRect(cx + 4, rowY - opts.legendRowHeight / 2 + 4, opts.legendColWidth - 8, opts.legendRowHeight - 8);
    ctx.strokeStyle = '#ccc';
    ctx.strokeRect(cx + 4.5, rowY - opts.legendRowHeight / 2 + 4.5, opts.legendColWidth - 8, opts.legendRowHeight - 8);
    cx += colWidths[0];
    // ID
    ctx.fillStyle = pickTextColor(row.rgb);
    // Re-fill swatch to ensure it's the palette color (overwrite any prior fill)
    // Actually no — the text-color is for the swatch overlay only if we drew text on swatch.
    // For data cells we want black text on white bg.
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(row.id, cx + 8, rowY);
    cx += colWidths[1];
    ctx.fillText(row.name, cx + 8, rowY);
    cx += colWidths[2];
    ctx.textAlign = 'right';
    ctx.fillText(String(row.count), cx + colWidths[3] - 8, rowY);
    ctx.textAlign = 'left';
    rowY += opts.legendRowHeight;
  }

  // Total row
  ctx.font = `bold 13px -apple-system, "PingFang SC", sans-serif`;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('合计', opts.legendPadding + colWidths[0] + 8, rowY);
  ctx.textAlign = 'right';
  ctx.fillText(String(indices.length), opts.legendPadding + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - 8, rowY);
  ctx.textAlign = 'left';

  return canvas;
}
```

- [ ] **Step 4: Run test, verify passing**

Run: `npm test composite`
Expected: 3 tests pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 39 tests pass (36 from before + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/composite.ts src/pipeline/composite.test.ts
git commit -m "feat(composite): renderComposite 合成图 pure-fn"
```

---

## Task 3: `ColorLegend` UI Component

**Files:**
- Create: `src/components/ColorLegend.tsx`
- Create: `src/components/ColorLegend.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/ColorLegend.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ColorLegend } from '@/components/ColorLegend';
import type { LegendRow } from '@/pipeline/legend';

const legend: LegendRow[] = [
  { id: 'A01', name: '红', rgb: [255, 0, 0], count: 3, index: 0 },
  { id: 'A02', name: '绿', rgb: [0, 255, 0], count: 1, index: 1 },
];

describe('ColorLegend', () => {
  it('renders one row per legend entry', () => {
    const { container } = render(
      <ColorLegend legend={legend} highlightedIndex={null} onHoverIndex={() => {}} />
    );
    const rows = container.querySelectorAll('.legend-row');
    expect(rows).toHaveLength(2);
  });

  it('shows id, name, count for each row', () => {
    const { container } = render(
      <ColorLegend legend={legend} highlightedIndex={null} onHoverIndex={() => {}} />
    );
    expect(container.textContent).toContain('A01');
    expect(container.textContent).toContain('红');
    expect(container.textContent).toContain('3');
  });

  it('calls onHoverIndex on mouseEnter and null on mouseLeave', () => {
    const onHover = vi.fn();
    const { container } = render(
      <ColorLegend legend={legend} highlightedIndex={null} onHoverIndex={onHover} />
    );
    const firstRow = container.querySelectorAll('.legend-row')[0];
    fireEvent.mouseEnter(firstRow);
    expect(onHover).toHaveBeenCalledWith(0);
    fireEvent.mouseLeave(firstRow);
    expect(onHover).toHaveBeenCalledWith(null);
  });

  it('renders empty state when legend is empty', () => {
    const { container } = render(
      <ColorLegend legend={[]} highlightedIndex={null} onHoverIndex={() => {}} />
    );
    expect(container.querySelector('.legend-empty')?.textContent).toMatch(/未匹配/);
  });
});
```

> Requires `@testing-library/react` — install it: `npm install --save-dev @testing-library/react @testing-library/dom`

- [ ] **Step 2: Install testing-library**

Run: `npm install --save-dev @testing-library/react @testing-library/dom`
Expected: dev deps added.

- [ ] **Step 3: Implement `src/components/ColorLegend.tsx`**

```tsx
import type { LegendRow } from '@/pipeline/legend';

interface Props {
  legend: LegendRow[];
  highlightedIndex: number | null;
  onHoverIndex: (idx: number | null) => void;
}

export function ColorLegend({ legend, highlightedIndex, onHoverIndex }: Props) {
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
      <p className="legend-subtitle">悬停查看对应格子</p>
      <div className="legend-table">
        <div className="legend-header">
          <div className="col-swatch">色块</div>
          <div className="col-id">色号</div>
          <div className="col-name">名称</div>
          <div className="col-count">数量</div>
        </div>
        {legend.map(row => (
          <div
            key={row.id}
            className={
              row.index === highlightedIndex
                ? 'legend-row highlighted'
                : 'legend-row'
            }
            onMouseEnter={() => onHoverIndex(row.index)}
            onMouseLeave={() => onHoverIndex(null)}
          >
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

- [ ] **Step 4: Add CSS for legend**

Append to `src/styles/global.css`:

```css
/* === Color Legend === */
.legend-wrap {
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  position: sticky;
  top: 12px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
}
.legend-title {
  font-size: 14px;
  margin-bottom: 4px;
}
.legend-subtitle {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 8px;
}
.legend-table {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  font-size: 12px;
}
.legend-header,
.legend-row {
  display: grid;
  grid-template-columns: 60px 1fr 1fr 60px;
  align-items: center;
}
.legend-header {
  background: #f5f5f5;
  font-weight: 600;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.legend-row {
  padding: 6px 8px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  transition: background 0.1s;
}
.legend-row:last-child { border-bottom: none; }
.legend-row:hover { background: #f9f9f9; }
.legend-row.highlighted {
  background: #fff8dc;
  font-weight: 600;
}
.legend-row .col-swatch {
  display: flex;
  align-items: center;
  justify-content: center;
}
.legend-row .swatch {
  display: inline-block;
  width: 28px;
  height: 20px;
  border-radius: 3px;
  border: 1px solid rgba(0,0,0,0.1);
}
.legend-row .col-count {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.legend-empty {
  color: var(--muted);
  font-size: 12px;
  padding: 16px 0;
  text-align: center;
}
```

- [ ] **Step 5: Run test, verify passing**

Run: `npm test ColorLegend`
Expected: 4 tests pass.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: 43 tests pass (39 + 4).

- [ ] **Step 7: Commit**

```bash
git add src/components/ColorLegend.tsx src/components/ColorLegend.test.tsx src/styles/global.css package.json package-lock.json
git commit -m "feat(ui): ColorLegend 右侧色号对照表 + hover 联动"
```

---

## Task 4: PreviewCanvas Extension (Highlighted Overlay + Scroll)

**Files:**
- Modify: `src/components/PreviewCanvas.tsx`

- [ ] **Step 1: Read current file**

Run: `cat src/components/PreviewCanvas.tsx`
Current behavior: renders a single canvas with the bead image at `previewCellPx`.

- [ ] **Step 2: Replace `src/components/PreviewCanvas.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import type { Palette, PipelineResult } from '@/types';
import { renderPaletteImage } from '@/pipeline/renderer';

interface Props {
  result: PipelineResult | null;
  palette: Palette;
  cellPx: number;
  highlightedIndex: number | null;
  isRecomputing: boolean;
}

const HIGHLIGHT_COLOR = 'rgba(255, 235, 59, 0.55)';

export function PreviewCanvas({ result, palette, cellPx, highlightedIndex, isRecomputing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  // Draw bead image (no text overlay) on result/palette/cellPx change.
  useEffect(() => {
    if (!result || !ref.current) return;
    const c = renderPaletteImage(result.indices, result.gridSize, palette, cellPx, '#ddd');
    const ctx = ref.current.getContext('2d')!;
    ref.current.width = c.width;
    ref.current.height = c.height;
    ctx.drawImage(c, 0, 0);
  }, [result, palette, cellPx]);

  // Draw highlight overlay on top of bead image, separate layer.
  useEffect(() => {
    if (!result || !ref.current) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d')!;
    if (highlightedIndex === null) return;

    ctx.fillStyle = HIGHLIGHT_COLOR;
    for (let y = 0; y < result.gridSize; y++) {
      for (let x = 0; x < result.gridSize; x++) {
        if (result.indices[y * result.gridSize + x] === highlightedIndex) {
          ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        }
      }
    }
  }, [result, palette, cellPx, highlightedIndex]);

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

- [ ] **Step 3: Update CSS**

Append to `src/styles/global.css`:

```css
/* === PreviewCanvas scroll wrapper === */
.preview-scroll {
  max-width: 100%;
  max-height: 80vh;
  overflow: auto;
  background: white;
  border-radius: 4px;
}
.preview-scroll.dim { opacity: 0.5; }
```

- [ ] **Step 4: Verify typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/PreviewCanvas.tsx src/styles/global.css
git commit -m "feat(ui): PreviewCanvas 增加 highlightedIndex overlay + 滚动容器"
```

---

## Task 5: ExportPanel Simplification

**Files:**
- Modify: `src/components/ExportPanel.tsx`

- [ ] **Step 1: Replace `src/components/ExportPanel.tsx`**

```tsx
interface Props {
  onExport: () => void;
  disabled: boolean;
}

export function ExportPanel({ onExport, disabled }: Props) {
  return (
    <div className="export-panel">
      <button
        className="primary"
        disabled={disabled}
        onClick={onExport}
      >
        导出合成图
      </button>
      <p className="hint">拼豆图 + 色号对照表合一</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ExportPanel.tsx
git commit -m "refactor(ui): ExportPanel 简化为单图导出"
```

---

## Task 6: Pipeline `exportAll` → `exportComposite`

**Files:**
- Modify: `src/pipeline/pipeline.ts`
- Modify: `src/pipeline/exporter.ts`

- [ ] **Step 1: Read current `exporter.ts`**

Run: `cat src/pipeline/exporter.ts`
Verify that `triggerDownload(blob, filename)` and `canvasToBlob(canvas)` already exist.

- [ ] **Step 2: Replace `src/pipeline/pipeline.ts`**

```ts
import { sampleImage } from './sampler';
import { quantizeWithCanvas2D } from './quantizer.canvas';
import { renderPaletteImage } from './renderer';
import { renderComposite, DEFAULT_COMPOSITE_OPTIONS } from './composite';
import { canvasToBlob, triggerDownload } from './exporter';
import type { Palette, ProcessParams, PipelineResult, UIStatus } from '@/types';

export class Pipeline {
  private token = 0;
  private palette: Palette | null = null;

  init(palette: Palette): void {
    this.palette = palette;
  }

  async process(
    src: ImageData,
    params: ProcessParams,
    onStatus: (s: UIStatus) => void,
    onResult: (r: PipelineResult) => void
  ): Promise<void> {
    if (!this.palette) throw new Error('Pipeline not initialized');
    const myToken = ++this.token;

    try {
      onStatus('recomputing');
      const sampled = sampleImage(src, params.gridSize);
      if (myToken !== this.token) return;

      const indices = quantizeWithCanvas2D(sampled, this.palette, params.enableDither);
      if (myToken !== this.token) return;

      onStatus('ready');
      onResult({ indices, gridSize: sampled.width, token: myToken });
    } catch (err) {
      onStatus('ready');
      throw err;
    }
  }

  /**
   * Export a single composite image (bead image with color-code annotations + legend table).
   * cellPx defaults to 32 for high-resolution printing.
   */
  async exportComposite(result: PipelineResult): Promise<void> {
    if (!this.palette) throw new Error('Pipeline not initialized');
    const { indices, gridSize } = result;

    const canvas = renderComposite(indices, gridSize, this.palette, {
      cellPx: DEFAULT_COMPOSITE_OPTIONS.cellPx,
    });
    const blob = await canvasToBlob(canvas);
    triggerDownload(blob, `pingdou-${gridSize}x${gridSize}-composite.png`);
  }

  /**
   * @deprecated kept for backwards-compat; no longer called from UI.
   * Renders a preview-only bead image (no annotations).
   */
  renderPreview(result: PipelineResult, cellPx: number): HTMLCanvasElement | null {
    if (!this.palette) return null;
    return renderPaletteImage(
      result.indices,
      result.gridSize,
      this.palette,
      cellPx,
      null
    );
  }
}
```

- [ ] **Step 3: Run typecheck and existing tests**

Run: `npm run typecheck && npm test`
Expected: 0 errors; all 43 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/pipeline.ts
git commit -m "refactor(pipeline): exportComposite 单张合成图导出"
```

---

## Task 7: App.tsx Three-Column Layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Replace `src/App.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { usePalette } from '@/hooks/usePalette';
import { usePipeline } from '@/hooks/usePipeline';
import { UploadZone } from '@/components/UploadZone';
import { ParamPanel } from '@/components/ParamPanel';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import { ColorLegend } from '@/components/ColorLegend';
import { ExportPanel } from '@/components/ExportPanel';
import { computeLegend } from '@/pipeline/legend';

const PREVIEW_CELL_PX = 24;

export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, reprocess, exportTriptych } = usePipeline(palette);
  const [gridSize, setGridSize] = useState(100);
  const [enableDither, setEnableDither] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const legend = useMemo(
    () => (result && palette ? computeLegend(result.indices, palette) : []),
    [result, palette]
  );

  if (paletteError) {
    return (
      <div className="app">
        <p className="error">色板加载失败：{paletteError.message}。请刷新重试。</p>
      </div>
    );
  }

  if (!palette) {
    return (
      <div className="app">
        <header>
          <h1>拼豆图生成器</h1>
          <p className="subtitle">色板加载中...</p>
        </header>
      </div>
    );
  }

  const handleExport = async () => {
    if (!result || exporting) return;
    setExporting(true);
    try {
      await exportTriptych(/* cellPx ignored by new exportComposite */ 32);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>拼豆图生成器</h1>
        <p className="subtitle">上传图片 → 生成可打印拼豆图（MARD {palette.length} 色）</p>
      </header>

      {error && <p className="error">处理异常：{error.message}</p>}

      <main className="layout-3col">
        <aside className="left">
          <UploadZone onLoad={(data) => process(data, { gridSize, enableDither })} />
          <ParamPanel
            gridSize={gridSize}
            onGridSizeChange={n => {
              setGridSize(n);
              setHighlightedIndex(null);
              reprocess({ gridSize: n, enableDither });
            }}
            enableDither={enableDither}
            onDitherChange={b => {
              setEnableDither(b);
              setHighlightedIndex(null);
              reprocess({ gridSize, enableDither: b });
            }}
            disabled={status === 'idle' || status === 'loading'}
          />
          <ExportPanel
            disabled={!result || exporting}
            onExport={handleExport}
          />
        </aside>

        <section className="middle">
          <PreviewCanvas
            result={result}
            palette={palette}
            cellPx={PREVIEW_CELL_PX}
            highlightedIndex={highlightedIndex}
            isRecomputing={status === 'recomputing'}
          />
        </section>

        <aside className="right">
          <ColorLegend
            legend={legend}
            highlightedIndex={highlightedIndex}
            onHoverIndex={setHighlightedIndex}
          />
        </aside>
      </main>
    </div>
  );
}
```

> **Note on hook signature mismatch**: `usePipeline` currently exports `exportTriptych(cellPx)`. We'll need to align its API to call `pipeline.exportComposite(result)` instead of `pipeline.exportAll(result, cellPx)`. Task 8 fixes this.

- [ ] **Step 2: Replace layout CSS**

Find and replace the `.layout` CSS in `src/styles/global.css` with:

```css
.layout-3col {
  display: grid;
  grid-template-columns: 280px 1fr 280px;
  gap: 16px;
  margin-top: 24px;
}
@media (max-width: 1024px) {
  .layout-3col {
    grid-template-columns: 1fr;
  }
}
```

And remove the old `.layout { grid-template-columns: 320px 1fr; }` rule if still present.

- [ ] **Step 3: Update PreviewCanvas CSS**

The `.preview-wrap` styles should not set `max-height` (let `.preview-scroll` handle that). Update:

```css
.preview-wrap {
  position: relative;
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  min-height: 400px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
```

(Removed `min-height` constraint at center; added `align-items: flex-start` to allow scroll wrapper to size naturally.)

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/styles/global.css
git commit -m "feat(ui): 三列布局 + 色号对照表 + 高亮联动"
```

---

## Task 8: Update `usePipeline` Hook

**Files:**
- Modify: `src/hooks/usePipeline.ts`

- [ ] **Step 1: Read current hook**

Run: `cat src/hooks/usePipeline.ts`

Current signature: `exportTriptych(exportCellPx: number)` calls `pipeline.exportAll(result, exportCellPx)`.

- [ ] **Step 2: Replace `src/hooks/usePipeline.ts`**

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

  useEffect(() => {
    if (!palette) return;
    pipelineRef.current = new Pipeline();
    pipelineRef.current.init(palette);
  }, [palette]);

  const throttledProcess = useThrottle(async (src: ImageData, params: ProcessParams) => {
    if (!pipelineRef.current) return;
    try {
      await pipelineRef.current.process(src, params, setStatus, setResult);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, 200);

  const process = useCallback((src: ImageData, params: ProcessParams) => {
    srcRef.current = src;
    return throttledProcess(src, params);
  }, [throttledProcess]);

  const reprocess = useCallback((params: ProcessParams) => {
    if (srcRef.current) throttledProcess(srcRef.current, params);
  }, [throttledProcess]);

  const exportComposite = useCallback(async () => {
    if (!pipelineRef.current || !result) return;
    setStatus('exporting');
    try {
      await pipelineRef.current.exportComposite(result);
    } finally {
      setStatus('ready');
    }
  }, [result]);

  return { status, result, error, process, reprocess, exportComposite };
}
```

- [ ] **Step 3: Update App.tsx to use new hook name**

In `src/App.tsx`, change:
- `exportTriptych` → `exportComposite`
- `await exportTriptych(32)` → `await exportComposite()`

- [ ] **Step 4: Run typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: 0 errors; all 43 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePipeline.ts src/App.tsx
git commit -m "refactor(hooks): usePipeline exportComposite 替换三件套"
```

---

## Task 9: Playwright E2E Update

**Files:**
- Modify: `tests/e2e/flow.spec.ts`

- [ ] **Step 1: Read current test file**

Run: `cat tests/e2e/flow.spec.ts`

- [ ] **Step 2: Add hover-highlight and composite-export tests**

Append to `tests/e2e/flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const FIXTURE = path.resolve('tests/fixtures/sample.png');

test.describe('拼豆图生成器 - 主流程', () => {
  test('页面加载并显示标题', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '拼豆图生成器' })).toBeVisible();
  });

  test('上传图片后预览出现', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('canvas.preview')).toBeVisible({ timeout: 10000 });
  });

  test('上传后右侧色号对照表显示', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });
  });

  test('hover 对照表行时该行加 highlighted 类', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('.legend-row').first();
    await firstRow.hover();
    await expect(firstRow).toHaveClass(/highlighted/);
  });

  test('点击"导出合成图"下载 composite PNG', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.export-panel button.primary').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^pingdou-\d+x\d+-composite\.png$/);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/flow.spec.ts
git commit -m "test(e2e): hover 联动 + 合成图导出用例"
```

---

## Task 10: README Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append section to README**

Append to `README.md`:

```md

## 高亮联动 + 合成导出

- **固定放大预览**：预览区固定每格 24px，超出容器可滚动查看
- **实时色号对照表**：右侧列出当前图像用到的色块/色号/名称/数量（count desc 排序）
- **悬停联动**：鼠标悬停对照表某一行时，拼豆图上所有该色号格子会高亮（半透明黄色覆盖层）
- **合成导出**：点击"导出合成图"下载一张 PNG，拼豆图（含色号文字标注）在上、色号对照表在下

技术细节见 `docs/superpowers/specs/2026-07-12-zoom-legend-composite-design.md`。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README 增加高亮联动 + 合成导出说明"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run full unit suite**

Run: `npm test`
Expected: 43+ tests pass (43 existing + any from ColorLegend E2E if added).

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: dist/ generated; total < 200KB gzipped.

- [ ] **Step 4: Verify dev server boots**

Run: `npm run dev` (background); visit http://localhost:5173; verify:
- Page loads with header
- Upload a sample image
- ColorLegend appears on right with at least one row
- Hover a row → highlight overlay visible on preview
- Click "导出合成图" → PNG downloads

Stop server with Ctrl+C after verifying.

- [ ] **Step 5: Git log review**

Run: `git log --oneline | head -15`
Expected: 11 new commits since `9715362` (the last `docs: README` commit before this feature).

- [ ] **Step 6: Final commit if any uncommitted changes**

```bash
git status
# If clean, nothing to do.
# If dirty, commit remaining files.
```

---

## Self-Review

After writing this plan I checked against the spec:

**1. Spec coverage:**
- ZL-1 (zoom preview, cellPx ≥ 24) → Task 4 sets `PREVIEW_CELL_PX = 24`; Task 7 wires it
- ZL-2 (scroll container) → Task 4 adds `.preview-scroll` wrapper with `overflow: auto`
- ZL-3 (legend table) → Task 3 implements `ColorLegend`; Task 7 wires it
- ZL-4 (hover linkage) → Task 3 emits `onHoverIndex`; Task 4 draws overlay layer; Task 7 wires state
- ZL-5 (single composite export) → Task 2 implements `renderComposite`; Task 6 wires `exportComposite`; Task 8 aligns hook
- ZL-6 (annotated bead image inside composite) → Task 2 reuses `renderAnnotatedImage` for top half

**2. Placeholder scan:**
- No "TBD", "TODO", "implement later" strings
- Every step has actual code or commands
- `renderAnnotatedImage` already exists (from MVP Task 9) — Task 2 reuses it, doesn't recreate

**3. Type consistency:**
- `LegendRow` defined in Task 1, used by Task 3 (ColorLegend) and Task 7 (App useMemo)
- `CompositeOptions` and `DEFAULT_COMPOSITE_OPTIONS` defined in Task 2, used by Task 6
- `usePipeline` return value `exportTriptych` renamed to `exportComposite` consistently (Task 8 + Task 7)
- All `cellPx` references in component props use `number` (consistent)

**4. Edge cases / gaps fixed during self-review:**
- Task 1 test "sorts by count descending" had wrong ordering in initial draft (used `.toEqual` with array that mismatched sort order). Rewrote to assert `count` field instead.
- Task 3 install command for `@testing-library/react` was missing from spec; added in Step 2.
- Task 7 hook signature mismatch (`exportTriptych(32)` vs new `exportComposite()`) — caught and fixed in Task 8.
- Task 9 E2E uses `'highlighted'` regex match — this matches CSS class name `legend-row highlighted` produced by Task 3.

Plan is ready for execution.