# 拼豆板尺寸快捷选择与工时预估 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click 52×52, 78×78, and 104×104 board-size controls plus a live, hour-based assembly-time estimate.

**Architecture:** A shared constants module owns the three board sizes and the 250-beads-per-hour rate. A pure estimate module converts the already-calculated foreground `beanCount` into a display value. `App` computes that value once and passes it to desktop and mobile controls, which render their platform-specific shortcut buttons and selected state.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing CSS modules.

---

## File structure

- Create `src/constants/boardSizes.ts` — shared board-size presets and production-speed constant.
- Create `src/pipeline/timeEstimate.ts` — pure count-to-hours calculation and display formatting.
- Create `tests/unit/timeEstimate.test.ts` — isolated calculation coverage.
- Modify `src/pipeline/sampler.ts` — make `gridSize` constrain the longest output edge.
- Modify `tests/unit/sampler.test.ts` — prove landscape and portrait images respect the selected board edge.
- Modify `src/App.tsx` — derive the estimate from `beanCount` and pass it to both controls.
- Modify `src/components/ParamPanel.tsx` and `.css` — desktop shortcut buttons and estimate text.
- Modify `src/components/ParamPanel.test.tsx` — desktop interactions and display coverage.
- Modify `src/components/MobileActionBar.tsx` and `.css` — mobile shortcut buttons and estimate text.
- Create `src/components/MobileActionBar.boardSize.test.tsx` — separate mobile coverage without changing the existing untracked test file.

### Task 1: Add the shared board-size and time-estimate domain helpers

**Files:**
- Create: `src/constants/boardSizes.ts`
- Create: `src/pipeline/timeEstimate.ts`
- Create: `tests/unit/timeEstimate.test.ts`

- [ ] **Step 1: Write failing tests for invalid, whole-hour, and fractional estimates**

```ts
import { describe, expect, it } from 'vitest';
import { estimateAssemblyHours, formatAssemblyHours } from '@/pipeline/timeEstimate';

describe('timeEstimate', () => {
  it('returns null for non-positive and non-finite bean counts', () => {
    expect(estimateAssemblyHours(0)).toBeNull();
    expect(estimateAssemblyHours(-1)).toBeNull();
    expect(estimateAssemblyHours(Number.NaN)).toBeNull();
  });

  it('calculates hours from 250 beads per hour', () => {
    expect(estimateAssemblyHours(250)).toBe(1);
    expect(estimateAssemblyHours(375)).toBe(1.5);
  });

  it('formats a one-decimal Chinese hour label', () => {
    expect(formatAssemblyHours(1.5)).toBe('约 1.5 小时');
    expect(formatAssemblyHours(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npm test -- --run tests/unit/timeEstimate.test.ts`

Expected: FAIL because `@/pipeline/timeEstimate` does not exist.

- [ ] **Step 3: Implement shared constants and the minimal pure helpers**

```ts
// src/constants/boardSizes.ts
export const BOARD_SIZE_PRESETS = [52, 78, 104] as const;
export const BEADS_PER_HOUR = 250;
```

```ts
// src/pipeline/timeEstimate.ts
import { BEADS_PER_HOUR } from '@/constants/boardSizes';

export function estimateAssemblyHours(beanCount: number): number | null {
  if (!Number.isFinite(beanCount) || beanCount <= 0) return null;
  return Math.round((beanCount / BEADS_PER_HOUR) * 10) / 10;
}

export function formatAssemblyHours(hours: number | null): string | null {
  return hours === null ? null : `约 ${hours.toFixed(1)} 小时`;
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `npm test -- --run tests/unit/timeEstimate.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit the helper layer**

```bash
git add src/constants/boardSizes.ts src/pipeline/timeEstimate.ts tests/unit/timeEstimate.test.ts
git commit -m "feat: add board size time estimates"
```

### Task 2: Make the selected board size constrain the longest grid edge

**Files:**
- Modify: `src/pipeline/sampler.ts`
- Modify: `tests/unit/sampler.test.ts`

- [ ] **Step 1: Write failing landscape and portrait sampler tests**

```ts
it('uses gridSize as the longest edge for a landscape image', () => {
  const src = new ImageData(new Uint8ClampedArray(120 * 80 * 4), 120, 80);
  const sampled = sampleImage(src, 52);

  expect(sampled.width).toBe(52);
  expect(sampled.height).toBe(35);
});

it('uses gridSize as the longest edge for a portrait image', () => {
  const src = new ImageData(new Uint8ClampedArray(80 * 120 * 4), 80, 120);
  const sampled = sampleImage(src, 52);

  expect(sampled.width).toBe(35);
  expect(sampled.height).toBe(52);
});
```

- [ ] **Step 2: Run the sampler test to verify it fails**

Run: `npm test -- --run tests/unit/sampler.test.ts`

Expected: FAIL because landscape images currently exceed the selected longest edge.

- [ ] **Step 3: Calculate output width and height from the source orientation**

```ts
const aspect = src.height / src.width;
const outW = aspect >= 1 ? Math.max(1, Math.round(gridSize / aspect)) : gridSize;
const outH = aspect >= 1 ? gridSize : Math.max(1, Math.round(gridSize * aspect));
```

Keep the existing box-average loop unchanged.

- [ ] **Step 4: Run the sampler test to verify it passes**

Run: `npm test -- --run tests/unit/sampler.test.ts`

Expected: PASS with the existing sampler coverage plus the two new board-edge tests.

- [ ] **Step 5: Commit the board-edge correction**

```bash
git add src/pipeline/sampler.ts tests/unit/sampler.test.ts
git commit -m "fix: constrain sampled grids to the longest edge"
```

### Task 3: Add desktop board shortcuts and estimated time

**Files:**
- Modify: `src/components/ParamPanel.tsx`
- Modify: `src/components/ParamPanel.css`
- Modify: `src/components/ParamPanel.test.tsx`

- [ ] **Step 1: Write failing desktop component tests**

```ts
it('offers board-size shortcuts that select the matching grid size', () => {
  const onChange = vi.fn();
  const { getByRole } = render(
    <ParamPanel {...baseProps()} onGridSizeChange={onChange} estimateLabel="约 4.0 小时" />
  );

  fireEvent.click(getByRole('button', { name: '78 × 78 板子' }));

  expect(onChange).toHaveBeenCalledWith(78);
});

it('highlights the selected board size and renders its estimate', () => {
  const { getByRole, getByText } = render(
    <ParamPanel {...baseProps()} gridSize={52} estimateLabel="约 4.0 小时" />
  );

  expect(getByRole('button', { name: '52 × 52 板子' })).toHaveClass('active');
  expect(getByText('约 4.0 小时')).toBeTruthy();
});
```

- [ ] **Step 2: Run the desktop test to verify it fails**

Run: `npm test -- --run src/components/ParamPanel.test.tsx`

Expected: FAIL because `estimateLabel` and board-size buttons are absent.

- [ ] **Step 3: Add the desktop prop and shortcut button group**

```tsx
// Props addition
estimateLabel: string | null;

// In ParamPanel, above the grid label
<div className="board-size-shortcuts" aria-label="快捷板子尺寸">
  <span className="board-size-label">快捷板子尺寸</span>
  <div className="board-size-options">
    {BOARD_SIZE_PRESETS.map(size => (
      <button
        key={size}
        type="button"
        className={`board-size-option ${gridSize === size ? 'active' : ''}`}
        aria-label={`${size} × ${size} 板子`}
        aria-pressed={gridSize === size}
        disabled={disabled}
        onClick={() => onGridSizeChange(size)}
      >
        {size} × {size}
      </button>
    ))}
  </div>
</div>

// In the bean count paragraph
{estimateLabel && <span className="assembly-time"> · {estimateLabel}</span>}
```

Add CSS so `.board-size-options` is a wrapped row, `.board-size-option.active` uses the existing accent and soft-accent tokens, and `.assembly-time` matches the existing muted metadata text.

- [ ] **Step 4: Run the desktop test to verify it passes**

Run: `npm test -- --run src/components/ParamPanel.test.tsx`

Expected: PASS with the existing tests plus the two new shortcut and time tests.

- [ ] **Step 5: Commit the desktop UI**

```bash
git add src/components/ParamPanel.tsx src/components/ParamPanel.css src/components/ParamPanel.test.tsx
git commit -m "feat: add desktop board size shortcuts"
```

### Task 4: Wire the estimate through the app and add mobile controls

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/MobileActionBar.tsx`
- Modify: `src/components/MobileActionBar.css`
- Create: `src/components/MobileActionBar.boardSize.test.tsx`

- [ ] **Step 1: Write a failing mobile shortcut and estimate test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { MobileActionBar } from './MobileActionBar';

it('selects a mobile board size and shows the supplied estimate', () => {
  const onGridSizeChange = vi.fn();
  render(
    <MobileActionBar
      gridSize={78}
      beanCount={1000}
      estimateLabel="约 4.0 小时"
      removeBackground={false}
      onGridSizeChange={onGridSizeChange}
      onRemoveBackgroundChange={() => {}}
      onLoad={() => {}}
      onExport={() => {}}
      canExport
      exporting={false}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: '104 × 104 板子' }));

  expect(onGridSizeChange).toHaveBeenCalledWith(104);
  expect(screen.getByText('约 4.0 小时')).toBeTruthy();
  expect(screen.getByRole('button', { name: '78 × 78 板子' })).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2: Run the mobile test to verify it fails**

Run: `npm test -- --run src/components/MobileActionBar.boardSize.test.tsx`

Expected: FAIL because `estimateLabel` and board-size shortcut buttons are absent.

- [ ] **Step 3: Derive once in App and pass the label to both controls**

```tsx
import { estimateAssemblyHours, formatAssemblyHours } from '@/pipeline/timeEstimate';

const estimateLabel = useMemo(
  () => formatAssemblyHours(estimateAssemblyHours(beanCount)),
  [beanCount]
);

<ParamPanel
  // existing props
  estimateLabel={estimateLabel}
/>

<MobileActionBar
  // existing props
  estimateLabel={estimateLabel}
/>
```

- [ ] **Step 4: Add mobile shortcut markup and styling**

```tsx
// Add `estimateLabel: string | null` to MobileActionBar Props.
<div className="mobile-board-size-options" aria-label="快捷板子尺寸">
  {BOARD_SIZE_PRESETS.map(size => (
    <button
      key={size}
      type="button"
      className={`mobile-board-size-option ${gridSize === size ? 'active' : ''}`}
      aria-label={`${size} × ${size} 板子`}
      aria-pressed={gridSize === size}
      onClick={() => onGridSizeChange(size)}
    >
      {size} × {size}
    </button>
  ))}
</div>
```

Place this group after `.mobile-grid-row`. Add `{estimateLabel && <span className="mobile-assembly-time"> · {estimateLabel}</span>}` inside `.mobile-bean-count`. Style the button group as a compact, wrapping row and keep the fixed bar content within its current mobile width.

- [ ] **Step 5: Run mobile and desktop component tests to verify they pass**

Run: `npm test -- --run src/components/MobileActionBar.boardSize.test.tsx src/components/ParamPanel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the app wiring and mobile UI**

```bash
git add src/App.tsx src/components/MobileActionBar.tsx src/components/MobileActionBar.css src/components/MobileActionBar.boardSize.test.tsx
git commit -m "feat: add mobile board size shortcuts"
```

### Task 5: Verify the complete feature

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: PASS with no failing test files.

- [ ] **Step 2: Run type-checking and production build**

Run: `npm run typecheck && npm run build`

Expected: both commands exit 0.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff main...HEAD --check && git status --short`

Expected: no whitespace errors; only feature files and pre-existing untracked user files appear.
