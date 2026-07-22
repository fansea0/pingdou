# Automatic Color Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, default-off color simplifier that keeps the current 221-color palette and merges only colors used fewer than 10 times into an already-used main color when their CIE Lab Delta E 76 distance is at most 8.

**Architecture:** Introduce a pure `colorSimplifier` pipeline module for color-space conversion, perceptual distance, counting, and stable index remapping. Run it after quantization and background-mask creation in both preview processing and every export size, then carry immutable before/after statistics through `PipelineResult` to the legend. Keep the UI state in `App` and pass the same complete process settings through desktop, mobile, uploads, reprocessing, and export.

**Tech Stack:** React 18, TypeScript, Canvas pipeline, Vitest, Testing Library, Vite.

---

## File map

- Create `src/pipeline/colorSimplifier.ts`: pure sRGB-to-Lab conversion, Delta E 76 calculation, used-color counting, rare-color remapping, and named thresholds.
- Create `tests/unit/colorSimplifier.test.ts`: algorithm, threshold, mask, immutability, stability, and validation tests.
- Modify `src/types.ts`: add the simplification flag and result statistics.
- Modify `src/pipeline/pipeline.ts`: invoke one simplification path after mask creation for preview and each export size.
- Create `tests/unit/pipeline-color-simplification.test.ts`: prove preview behavior, default-off equivalence, statistics, and export consistency.
- Modify `src/hooks/usePipeline.ts`: retain both processing options for export instead of retaining only background removal.
- Modify `src/App.tsx`: own the default-off state and pass complete parameters to every processing entry point.
- Modify `src/components/ParamPanel.tsx` and `src/components/ParamPanel.test.tsx`: desktop checkbox and behavior.
- Modify `src/components/MobileActionBar.tsx`, `src/components/MobileActionBar.test.tsx`, and `src/components/MobileActionBar.boardSize.test.tsx`: mobile checkbox and existing test fixtures.
- Modify `src/components/ColorLegend.tsx` and `src/components/ColorLegend.test.tsx`: render before/after statistics only when colors were actually merged.
- Modify `README.md`: document the current 221-color palette and optional simplification behavior.

### Task 1: Build the pure perceptual color simplifier

**Files:**
- Create: `src/pipeline/colorSimplifier.ts`
- Create: `tests/unit/colorSimplifier.test.ts`

- [ ] **Step 1: Write failing color-space and simplification tests**

Create `tests/unit/colorSimplifier.test.ts` with focused fixtures. The test data deliberately uses ten main-color cells and nine rare-color cells so the boundary is explicit.

```ts
import { describe, expect, it } from 'vitest';
import {
  deltaE76,
  rgbToLab,
  simplifyRareColors,
} from '@/pipeline/colorSimplifier';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [100, 100, 100], name: '主灰' },
  { id: 'A02', rgb: [104, 104, 104], name: '近灰' },
  { id: 'A03', rgb: [255, 0, 0], name: '红' },
];

function indices(...groups: Array<[index: number, count: number]>): Uint8Array {
  return Uint8Array.from(groups.flatMap(([index, count]) => Array(count).fill(index)));
}

describe('colorSimplifier color distance', () => {
  it('maps black and white to the Lab lightness endpoints', () => {
    expect(rgbToLab([0, 0, 0])).toEqual([0, 0, 0]);
    const white = rgbToLab([255, 255, 255]);
    expect(white[0]).toBeCloseTo(100, 3);
    expect(white[1]).toBeCloseTo(0, 2);
    expect(white[2]).toBeCloseTo(0, 2);
  });

  it('calculates symmetric Delta E 76 distance', () => {
    const a = rgbToLab([100, 100, 100]);
    const b = rgbToLab([104, 104, 104]);
    expect(deltaE76(a, b)).toBeCloseTo(deltaE76(b, a), 10);
    expect(deltaE76(a, a)).toBe(0);
  });
});

describe('simplifyRareColors', () => {
  it('merges a similar color used fewer than 10 times into an existing main color', () => {
    const input = indices([0, 10], [1, 9]);
    const result = simplifyRareColors(input, palette, new Uint8Array(input.length));
    expect(Array.from(result.indices)).toEqual(Array(19).fill(0));
    expect(result.stats).toEqual({
      beforeColorCount: 2,
      afterColorCount: 1,
      mergedColorCount: 1,
    });
  });

  it('does not treat a color used exactly 10 times as rare', () => {
    const input = indices([0, 10], [1, 10]);
    const result = simplifyRareColors(input, palette, new Uint8Array(input.length));
    expect(result.stats.mergedColorCount).toBe(0);
    expect(Array.from(result.indices)).toEqual(Array.from(input));
  });

  it('keeps a perceptually distant rare accent color', () => {
    const input = indices([0, 10], [2, 1]);
    const result = simplifyRareColors(input, palette, new Uint8Array(input.length));
    expect(result.indices.at(-1)).toBe(2);
    expect(result.stats).toEqual({
      beforeColorCount: 2,
      afterColorCount: 2,
      mergedColorCount: 0,
    });
  });

  it('keeps all colors when no color has at least 10 visible cells', () => {
    const input = indices([0, 9], [1, 9]);
    const result = simplifyRareColors(input, palette, new Uint8Array(input.length));
    expect(Array.from(result.indices)).toEqual(Array.from(input));
  });

  it('excludes background cells from counts and leaves their stored indices untouched', () => {
    const input = indices([0, 10], [1, 10]);
    const mask = new Uint8Array(input.length);
    mask[input.length - 1] = 1;
    const result = simplifyRareColors(input, palette, mask);
    expect(result.indices.at(-1)).toBe(1);
    expect(result.indices.slice(10, -1).every(index => index === 0)).toBe(true);
    expect(result.stats.mergedColorCount).toBe(1);
  });

  it('does not mutate the source index array', () => {
    const input = indices([0, 10], [1, 1]);
    const original = input.slice();
    simplifyRareColors(input, palette, new Uint8Array(input.length));
    expect(input).toEqual(original);
  });

  it('uses the lower palette index when two targets have the same distance', () => {
    const symmetric: Palette = [
      { id: 'A01', rgb: [100, 100, 100], name: '主色一' },
      { id: 'A02', rgb: [100, 100, 100], name: '主色二' },
      { id: 'A03', rgb: [102, 102, 102], name: '稀有色' },
    ];
    const input = indices([0, 10], [1, 10], [2, 1]);
    const result = simplifyRareColors(input, symmetric, new Uint8Array(input.length));
    expect(result.indices.at(-1)).toBe(0);
  });

  it('throws for mismatched mask length and invalid palette indices', () => {
    expect(() => simplifyRareColors(new Uint8Array([0]), palette, new Uint8Array(0)))
      .toThrow('Color simplification mask length must match indices length');
    expect(() => simplifyRareColors(new Uint8Array([9]), palette, new Uint8Array(1)))
      .toThrow('Color simplification palette index out of range: 9');
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails because the module is missing**

Run:

```bash
npx vitest run tests/unit/colorSimplifier.test.ts
```

Expected: FAIL with an import-resolution error for `@/pipeline/colorSimplifier`.

- [ ] **Step 3: Implement the pure module**

Create `src/pipeline/colorSimplifier.ts`. Convert sRGB through D65 XYZ to Lab, cache Lab values once per palette call, count only unmasked cells, and choose only currently used colors with at least ten visible cells as targets.

```ts
import type { BackgroundMask, Palette, RGB } from '@/types';

export const RARE_COLOR_COUNT_LIMIT = 10;
export const MAX_SIMILAR_COLOR_DELTA_E = 8;

export type Lab = readonly [number, number, number];

export interface ColorSimplificationStats {
  readonly beforeColorCount: number;
  readonly afterColorCount: number;
  readonly mergedColorCount: number;
}

export interface ColorSimplificationResult {
  readonly indices: Uint8Array;
  readonly stats: ColorSimplificationStats;
}

function linearizeSrgb(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function labPivot(value: number): number {
  return value > 0.008856
    ? Math.cbrt(value)
    : 7.787 * value + 16 / 116;
}

export function rgbToLab(rgb: RGB): Lab {
  const [r, g, b] = rgb.map(linearizeSrgb);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const fx = labPivot(x);
  const fy = labPivot(y);
  const fz = labPivot(z);
  const lab: Lab = [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  return lab.map(value => Math.abs(value) < 1e-12 ? 0 : value) as unknown as Lab;
}

export function deltaE76(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function countVisibleColors(
  indices: Uint8Array,
  palette: Palette,
  mask: BackgroundMask,
): Uint32Array {
  if (mask.length !== indices.length) {
    throw new Error('Color simplification mask length must match indices length');
  }
  const counts = new Uint32Array(palette.length);
  for (let position = 0; position < indices.length; position++) {
    const paletteIndex = indices[position];
    if (paletteIndex >= palette.length) {
      throw new Error(`Color simplification palette index out of range: ${paletteIndex}`);
    }
    if (!mask[position]) counts[paletteIndex]++;
  }
  return counts;
}

function usedColorCount(counts: Uint32Array): number {
  let total = 0;
  for (const count of counts) if (count > 0) total++;
  return total;
}

export function summarizeColors(
  indices: Uint8Array,
  palette: Palette,
  mask: BackgroundMask,
): ColorSimplificationStats {
  const colorCount = usedColorCount(countVisibleColors(indices, palette, mask));
  return {
    beforeColorCount: colorCount,
    afterColorCount: colorCount,
    mergedColorCount: 0,
  };
}

export function simplifyRareColors(
  indices: Uint8Array,
  palette: Palette,
  mask: BackgroundMask,
): ColorSimplificationResult {
  const counts = countVisibleColors(indices, palette, mask);
  const beforeColorCount = usedColorCount(counts);
  const mainColors = Array.from(counts.keys())
    .filter(index => counts[index] >= RARE_COLOR_COUNT_LIMIT);
  const labs = palette.map(entry => rgbToLab(entry.rgb));
  const replacements = new Map<number, number>();

  for (let source = 0; source < counts.length; source++) {
    if (counts[source] === 0 || counts[source] >= RARE_COLOR_COUNT_LIMIT) continue;
    let bestTarget = -1;
    let bestDistance = Infinity;
    for (const target of mainColors) {
      const distance = deltaE76(labs[source], labs[target]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTarget = target;
      }
    }
    if (bestTarget >= 0 && bestDistance <= MAX_SIMILAR_COLOR_DELTA_E) {
      replacements.set(source, bestTarget);
    }
  }

  const output = indices.slice();
  for (let position = 0; position < output.length; position++) {
    if (mask[position]) continue;
    output[position] = replacements.get(output[position]) ?? output[position];
  }
  const afterColorCount = beforeColorCount - replacements.size;
  return {
    indices: output,
    stats: {
      beforeColorCount,
      afterColorCount,
      mergedColorCount: replacements.size,
    },
  };
}
```

- [ ] **Step 4: Run the simplifier tests and make only evidence-driven corrections**

Run:

```bash
npx vitest run tests/unit/colorSimplifier.test.ts
```

Expected: all tests PASS. If numeric precision differs, correct only the asserted decimal precision; do not raise the confirmed Delta E threshold.

- [ ] **Step 5: Commit the pure algorithm**

```bash
git add src/pipeline/colorSimplifier.ts tests/unit/colorSimplifier.test.ts
git commit -m "feat: add perceptual color simplifier"
```

### Task 2: Integrate simplification into preview and export pipelines

**Files:**
- Modify: `src/types.ts:11-29`
- Modify: `src/pipeline/pipeline.ts:18-224`
- Modify: `src/hooks/usePipeline.ts:6-65`
- Modify: `src/App.tsx:50-160` (temporary explicit `simplifyColors: false` values keep this task buildable; Task 3 replaces them with state)
- Modify: `src/components/PreviewCanvas.test.tsx` (add result statistics to typed fixtures)
- Modify: `tests/unit/pipeline.bg.test.ts:29-53` (add the disabled flag and typed statistics)
- Modify: `tests/unit/pipeline-export.test.ts:36-69` (add the disabled export flag and result statistics)
- Create: `tests/unit/pipeline-color-simplification.test.ts`

- [ ] **Step 1: Write failing pipeline tests for disabled, enabled, and export behavior**

Create `tests/unit/pipeline-color-simplification.test.ts`. Mock only render/export boundaries so assertions inspect the actual indices delivered by the pipeline.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { renderSquareBoard, renderCompositeFromBoard } = vi.hoisted(() => ({
  renderSquareBoard: vi.fn((_indices: Uint8Array) => document.createElement('canvas')),
  renderCompositeFromBoard: vi.fn((
    _board: HTMLCanvasElement,
    _indices: Uint8Array,
  ) => document.createElement('canvas')),
}));

vi.mock('@/pipeline/squareBoard', () => ({ renderSquareBoard }));
vi.mock('@/pipeline/composite', () => ({
  DEFAULT_COMPOSITE_OPTIONS: { cellPx: 24 },
  renderComposite: vi.fn(() => document.createElement('canvas')),
  renderCompositeFromBoard,
}));
vi.mock('@/pipeline/exporter', () => ({
  canvasToBlob: vi.fn(async () => new Blob()),
  triggerDownload: vi.fn(),
}));
vi.mock('@/pipeline/watermark', () => ({ applyWatermark: vi.fn() }));

import { Pipeline } from '@/pipeline/pipeline';
import type { Palette, PipelineResult, ProcessParams } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [100, 100, 100], name: '主灰' },
  { id: 'A02', rgb: [104, 104, 104], name: '近灰' },
];

function source(): ImageData {
  const data = new Uint8ClampedArray(19 * 4);
  for (let cell = 0; cell < 19; cell++) {
    const value = cell < 10 ? 100 : 104;
    data[cell * 4] = value;
    data[cell * 4 + 1] = value;
    data[cell * 4 + 2] = value;
    data[cell * 4 + 3] = 255;
  }
  return new ImageData(data, 19, 1);
}

async function process(params: ProcessParams): Promise<PipelineResult> {
  const pipeline = new Pipeline();
  pipeline.init(palette);
  let result: PipelineResult | null = null;
  await pipeline.process(source(), params, () => {}, value => { result = value; });
  return result!;
}

describe('Pipeline automatic color simplification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves quantized indices when disabled', async () => {
    const result = await process({
      gridSize: 19,
      removeBackground: false,
      simplifyColors: false,
    });
    expect(Array.from(result.indices)).toEqual([
      ...Array(10).fill(0),
      ...Array(9).fill(1),
    ]);
    expect(result.colorSimplification).toEqual({
      beforeColorCount: 2,
      afterColorCount: 2,
      mergedColorCount: 0,
    });
  });

  it('simplifies preview indices and reports before/after counts when enabled', async () => {
    const result = await process({
      gridSize: 19,
      removeBackground: false,
      simplifyColors: true,
    });
    expect(Array.from(result.indices)).toEqual(Array(19).fill(0));
    expect(result.colorSimplification).toEqual({
      beforeColorCount: 2,
      afterColorCount: 1,
      mergedColorCount: 1,
    });
  });

  it('passes simplified indices to every export renderer', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    await pipeline.exportMulti(source(), 24, 19, [], false, true);
    const exportedIndices = renderSquareBoard.mock.calls[0][0] as Uint8Array;
    expect(Array.from(exportedIndices)).toEqual(Array(19).fill(0));
    expect(renderCompositeFromBoard.mock.calls[0][1]).toEqual(exportedIndices);
  });
});
```

- [ ] **Step 2: Run the test and verify type/API failures**

Run:

```bash
npx vitest run tests/unit/pipeline-color-simplification.test.ts
```

Expected: FAIL because `simplifyColors`, `colorSimplification`, and the sixth `exportMulti` argument do not exist yet.

- [ ] **Step 3: Add shared types and apply one helper in both pipeline paths**

In `src/types.ts`, import the stats type with a type-only import and extend the existing interfaces:

```ts
import type { ColorSimplificationStats } from '@/pipeline/colorSimplifier';

export interface ProcessParams {
  readonly gridSize: number;
  readonly removeBackground: boolean;
  readonly simplifyColors: boolean;
}

export interface PipelineResult {
  readonly indices: Uint8Array;
  readonly gridSize: number;
  readonly outW: number;
  readonly outH: number;
  readonly token: number;
  readonly mask: BackgroundMask;
  readonly colorSimplification: ColorSimplificationStats;
}
```

In `src/pipeline/pipeline.ts`, import `simplifyRareColors` and `summarizeColors`, and add a private helper so preview and export cannot drift:

```ts
import {
  simplifyRareColors,
  summarizeColors,
} from './colorSimplifier';
import type { ColorSimplificationResult } from './colorSimplifier';

private applyColorSimplification(
  indices: Uint8Array,
  mask: BackgroundMask,
  enabled: boolean,
): ColorSimplificationResult {
  if (!this.palette) throw new Error('Pipeline not initialized');
  if (enabled) return simplifyRareColors(indices, this.palette, mask);
  return {
    indices,
    stats: summarizeColors(indices, this.palette, mask),
  };
}
```

After mask creation in `process`, call the helper and return its data:

```ts
const simplified = this.applyColorSimplification(
  indices,
  mask,
  params.simplifyColors,
);

onResult({
  indices: simplified.indices,
  gridSize: outW,
  outW,
  outH,
  token: myToken,
  mask,
  colorSimplification: simplified.stats,
});
```

Extend `exportMulti` and use the helper immediately after its mask is complete, then pass `simplified.indices` to both renderers:

```ts
async exportMulti(
  src: ImageData,
  exportCellPx: number,
  selectedGridSize: number,
  extraGridSizes: number[],
  removeBackground: boolean,
  simplifyColors: boolean,
): Promise<{ success: number; failed: number }> {
  // existing sampling, quantization, and mask logic
  const simplified = this.applyColorSimplification(indices, mask, simplifyColors);
  const boardCanvas = renderSquareBoard(
    simplified.indices,
    outW,
    outH,
    this.palette,
    gridSize,
    exportCellPx,
    12,
    mask,
  );
  const compositeCanvas = renderCompositeFromBoard(
    boardCanvas,
    simplified.indices,
    this.palette,
    mask,
  );
  // existing watermark/download logic
}
```

- [ ] **Step 4: Retain complete processing options in the hook**

Replace `removeBgRef` in `src/hooks/usePipeline.ts` with a focused settings ref and update it in `throttledProcess`, `process`, and `reprocess`:

```ts
const processSettingsRef = useRef({
  removeBackground: false,
  simplifyColors: false,
});

function rememberSettings(params: ProcessParams): void {
  processSettingsRef.current = {
    removeBackground: params.removeBackground,
    simplifyColors: params.simplifyColors,
  };
}
```

Use direct helper calls rather than passing methods as values:

```ts
rememberSettings(params);
await pipelineRef.current.process(src, params, setStatus, setResult);
```

Pass both retained booleans during export:

```ts
const settings = processSettingsRef.current;
const out = await pipelineRef.current.exportMulti(
  srcRef.current,
  exportCellPx,
  selectedGridSize,
  extraGridSizes,
  settings.removeBackground,
  settings.simplifyColors,
);
```

- [ ] **Step 5: Update compile-time fixtures without changing their tested behavior**

Find every `ProcessParams` object and `PipelineResult` literal:

```bash
rg -n 'removeBackground|PipelineResult' src tests --glob '*.{ts,tsx}'
```

Add `simplifyColors: false` to existing process calls and add the unchanged statistics below to pre-existing `PipelineResult` literals:

```ts
colorSimplification: {
  beforeColorCount: 1,
  afterColorCount: 1,
  mergedColorCount: 0,
},
```

Use the literal's actual number of visible colors when it is not one. Append `false` to existing direct `exportMulti` calls so their behavior stays unchanged.

- [ ] **Step 6: Run focused pipeline tests and typecheck**

Run:

```bash
npx vitest run tests/unit/colorSimplifier.test.ts tests/unit/pipeline-color-simplification.test.ts tests/unit/pipeline.bg.test.ts tests/unit/pipeline-export.test.ts
npm run typecheck
```

Expected: all focused tests PASS and both client/server TypeScript checks exit 0.

- [ ] **Step 7: Commit pipeline integration**

```bash
git add src/types.ts src/pipeline/pipeline.ts src/hooks/usePipeline.ts src/App.tsx src/components/PreviewCanvas.test.tsx tests/unit/pipeline-color-simplification.test.ts tests/unit/pipeline.bg.test.ts tests/unit/pipeline-export.test.ts
git commit -m "feat: apply color simplification to preview and exports"
```

### Task 3: Add the desktop control and complete App parameter flow

**Files:**
- Modify: `src/App.tsx:19-175`
- Modify: `src/components/ParamPanel.tsx:4-179`
- Modify: `src/components/ParamPanel.test.tsx:1-143`

- [ ] **Step 1: Write failing desktop control tests**

Extend `baseProps` and replace the old “single checkbox” assertion in `src/components/ParamPanel.test.tsx`:

```ts
const baseProps = () => ({
  gridSize: 100,
  beanCount: 10000,
  totalCells: 10000,
  removeBackground: false,
  simplifyColors: false,
  onGridSizeChange: () => {},
  onRemoveBackgroundChange: () => {},
  onSimplifyColorsChange: () => {},
});

it('renders the default-off automatic color simplification option', () => {
  render(<ParamPanel {...baseProps()} />);
  const checkbox = screen.getByRole('checkbox', { name: /自动简化颜色/ });
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText(/合并少于 10 颗的相近色/)).toBeTruthy();
});

it('reports automatic color simplification changes', () => {
  const onSimplifyColorsChange = vi.fn();
  render(
    <ParamPanel
      {...baseProps()}
      onSimplifyColorsChange={onSimplifyColorsChange}
    />
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /自动简化颜色/ }));
  expect(onSimplifyColorsChange).toHaveBeenCalledWith(true);
});
```

Add `screen` to the Testing Library import.

- [ ] **Step 2: Run the component test and verify missing-prop/UI failures**

Run:

```bash
npx vitest run src/components/ParamPanel.test.tsx
```

Expected: FAIL because the simplification props and checkbox do not exist.

- [ ] **Step 3: Add the desktop checkbox**

Extend `ParamPanel` props and destructuring:

```ts
interface Props {
  gridSize: number;
  beanCount: number;
  totalCells: number;
  estimateLabel?: string | null;
  removeBackground: boolean;
  simplifyColors: boolean;
  onGridSizeChange: (n: number) => void;
  onRemoveBackgroundChange: (b: boolean) => void;
  onSimplifyColorsChange: (enabled: boolean) => void;
  disabled?: boolean;
}
```

Render a sibling label after the existing background checkbox:

```tsx
<label className="checkbox param-toggle">
  <input
    type="checkbox"
    checked={simplifyColors}
    onChange={event => onSimplifyColorsChange(event.target.checked)}
    disabled={disabled}
  />
  <span>
    自动简化颜色
    <span className="param-toggle-hint"> · 合并少于 10 颗的相近色</span>
  </span>
</label>
```

- [ ] **Step 4: Make App own and pass complete parameters**

Add default-off state in `src/App.tsx`:

```ts
const [simplifyColors, setSimplifyColors] = useState(false);
```

Every `process` or `reprocess` call must contain all three fields:

```ts
{
  gridSize,
  removeBackground,
  simplifyColors,
}
```

For a changed field, substitute the new value while retaining the others. Add these props to `ParamPanel`:

```tsx
simplifyColors={simplifyColors}
onSimplifyColorsChange={enabled => {
  setSimplifyColors(enabled);
  reprocess({ gridSize, removeBackground, simplifyColors: enabled });
}}
```

Upload callbacks and the sample-image effect must pass the same `simplifyColors` state. This ensures there is no path where uploading silently resets simplification.

- [ ] **Step 5: Run desktop tests and typecheck**

Run:

```bash
npx vitest run src/components/ParamPanel.test.tsx
npm run typecheck
```

Expected: ParamPanel tests PASS and both TypeScript checks exit 0. Mobile and legend public props have not changed yet, so this task must remain independently buildable.

- [ ] **Step 6: Commit desktop parameter flow**

```bash
git add src/App.tsx src/components/ParamPanel.tsx src/components/ParamPanel.test.tsx
git commit -m "feat: add desktop color simplification control"
```

### Task 4: Add mobile control and simplification feedback

**Files:**
- Modify: `src/components/MobileActionBar.tsx:44-236`
- Modify: `src/components/MobileActionBar.test.tsx`
- Modify: `src/components/MobileActionBar.boardSize.test.tsx`
- Modify: `src/components/ColorLegend.tsx:4-67`
- Modify: `src/components/ColorLegend.test.tsx`
- Modify: `src/App.tsx:138-171`

- [ ] **Step 1: Write failing mobile and legend tests**

Add the new required props to every existing `MobileActionBar` test render:

```tsx
simplifyColors={false}
onSimplifyColorsChange={() => {}}
```

Then add this behavior test to `src/components/MobileActionBar.test.tsx`:

```ts
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

it('shows and changes the mobile automatic color simplification option', () => {
  const onSimplifyColorsChange = vi.fn();
  render(
    <MobileActionBar
      gridSize={100}
      beanCount={0}
      removeBackground={false}
      simplifyColors={false}
      onGridSizeChange={() => {}}
      onRemoveBackgroundChange={() => {}}
      onSimplifyColorsChange={onSimplifyColorsChange}
      onLoad={() => {}}
      onExport={() => {}}
      canExport
      exporting={false}
    />
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /自动简化颜色/ }));
  expect(onSimplifyColorsChange).toHaveBeenCalledWith(true);
});
```

Extend `src/components/ColorLegend.test.tsx` with explicit simplification stats:

```ts
it('shows before and after counts only when colors were merged', () => {
  const { container, rerender } = render(
    <ColorLegend
      legend={legend}
      colorSimplification={{
        beforeColorCount: 12,
        afterColorCount: 8,
        mergedColorCount: 4,
      }}
    />
  );
  expect(container.textContent).toMatch(/已从 12 种简化为 8 种/);

  rerender(
    <ColorLegend
      legend={legend}
      colorSimplification={{
        beforeColorCount: 8,
        afterColorCount: 8,
        mergedColorCount: 0,
      }}
    />
  );
  expect(container.textContent).not.toMatch(/已从/);
  expect(container.textContent).toMatch(/当前图像/);
});
```

Add default zero-change stats to existing `ColorLegend` renders.

- [ ] **Step 2: Run the tests and verify they fail for missing UI**

Run:

```bash
npx vitest run src/components/MobileActionBar.test.tsx src/components/MobileActionBar.boardSize.test.tsx src/components/ColorLegend.test.tsx
```

Expected: FAIL because mobile and legend props/rendering are not implemented.

- [ ] **Step 3: Add the mobile checkbox**

Extend `MobileActionBar` props and destructuring:

```ts
simplifyColors: boolean;
onSimplifyColorsChange: (enabled: boolean) => void;
```

Render below the existing background toggle:

```tsx
<label className="mobile-toggle-row">
  <input
    type="checkbox"
    checked={simplifyColors}
    onChange={event => onSimplifyColorsChange(event.target.checked)}
  />
  自动简化颜色 · 合并少于 10 颗的相近色
</label>
```

- [ ] **Step 4: Render simplification statistics in the legend**

Import the stats type into `ColorLegend.tsx`, extend props, and compute a single subtitle branch:

```ts
import type { ColorSimplificationStats } from '@/pipeline/colorSimplifier';

interface Props {
  legend: LegendRow[];
  colorSimplification: ColorSimplificationStats;
}
```

```tsx
<p className="legend-subtitle">
  {colorSimplification.mergedColorCount > 0 ? (
    <>
      已从 <strong>{colorSimplification.beforeColorCount}</strong> 种简化为{' '}
      <strong>{colorSimplification.afterColorCount}</strong> 种
    </>
  ) : (
    <>
      当前图像 · <strong>{legend.length}</strong> 种颜色
    </>
  )}
</p>
```

- [ ] **Step 5: Connect mobile and legend props in App**

Pass the same state and reprocess handler used by desktop to `MobileActionBar`:

```tsx
simplifyColors={simplifyColors}
onSimplifyColorsChange={enabled => {
  setSimplifyColors(enabled);
  reprocess({ gridSize, removeBackground, simplifyColors: enabled });
}}
```

Ensure mobile upload passes `{ gridSize, removeBackground, simplifyColors }`. Pass result statistics to the legend:

```tsx
<ColorLegend
  legend={legend}
  colorSimplification={result?.colorSimplification ?? {
    beforeColorCount: 0,
    afterColorCount: 0,
    mergedColorCount: 0,
  }}
/>
```

Prefer a module-level `EMPTY_COLOR_SIMPLIFICATION` constant in `App.tsx` so a new object is not created on every render.

- [ ] **Step 6: Run component tests and typecheck**

Run:

```bash
npx vitest run src/components/ParamPanel.test.tsx src/components/MobileActionBar.test.tsx src/components/MobileActionBar.boardSize.test.tsx src/components/ColorLegend.test.tsx
npm run typecheck
```

Expected: all named tests PASS and both TypeScript checks exit 0.

- [ ] **Step 7: Commit mobile control and feedback**

```bash
git add src/App.tsx src/components/MobileActionBar.tsx src/components/MobileActionBar.test.tsx src/components/MobileActionBar.boardSize.test.tsx src/components/ColorLegend.tsx src/components/ColorLegend.test.tsx
git commit -m "feat: show color simplification controls and results"
```

### Task 5: Update documentation and complete verification

**Files:**
- Modify: `README.md:1-40`
- Verify: all files changed by Tasks 1-4

- [ ] **Step 1: Correct and extend the README feature description**

Replace outdated palette and dithering claims with current behavior:

```md
- 使用当前 MARD 221 色色板生成实时拼豆预览
- 可选自动去背景
- 可选自动简化颜色：将少于 10 颗且感知色差不大于 8 的近似色合并到已用主色
- 导出带色号标注、色号对照表和水印的合成 PNG
- 全程在前端处理图片，图片不会上传到服务端
```

Keep deployment and statistics documentation unchanged.

- [ ] **Step 2: Run formatting and stale-assumption scans**

Run:

```bash
git diff --check
rg -n '283|可选 Floyd-Steinberg|simplifyColors' README.md src tests --glob '*.{md,ts,tsx}'
```

Expected: `git diff --check` has no output. The stale `283` and Floyd-Steinberg feature claims are absent from README. Every `ProcessParams` construction shown by surrounding context includes `simplifyColors`.

- [ ] **Step 3: Run all unit/component tests**

Run:

```bash
npm test
```

Expected: all Vitest suites PASS with zero failures.

- [ ] **Step 4: Run production typecheck and build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit 0; Vite creates `dist/` successfully.

- [ ] **Step 5: Perform a requirement-by-requirement diff review**

Run:

```bash
git diff --stat 1d5279f..HEAD
git diff 1d5279f..HEAD -- src tests README.md
git status --short
```

Review evidence for each requirement:

```text
221-color palette unchanged: public/data/mard.json is not modified and contains 221 entries.
Default off: App initializes simplifyColors to false; desktop/mobile receive false.
Rare rule: count < 10 only; count == 10 test remains unchanged.
Similarity rule: Delta E 76 <= 8 constant and distant-accent test.
Consistency: process and exportMulti call the same private helper.
Background safety: mask exclusion test and pipeline background regression suite.
Feedback: legend before/after component test.
Existing behavior: full test suite and disabled pipeline test.
```

Do not stage `.superpowers/`, `docs/superpowers/plans/2026-07-16-seo-baseline-impl.md`, or any other unrelated pre-existing worktree item.

- [ ] **Step 6: Commit README and any final evidence-driven correction**

```bash
git add README.md
git commit -m "docs: document automatic color simplification"
```

- [ ] **Step 7: Invoke completion workflows**

Read and follow `superpowers:requesting-code-review`, address only verified findings, then read and follow `superpowers:verification-before-completion`. Do not claim completion until fresh verification output proves every acceptance criterion.
