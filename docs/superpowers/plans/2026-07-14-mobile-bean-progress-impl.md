# 拼豆图：手机端响应式 + 进度条网格 + 豆子数提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the page mobile-friendly (single-column layout below 900px) and replace the range slider with a log-scale progress bar + scatter preset buttons showing real bean counts, so users can easily pick small grids (20-100) for typical patterns.

**Architecture:** `ParamPanel` is rewritten to contain a custom `ProgressBar` sub-component that uses log-scale positioning for 8 preset buttons (20/30/50/75/100/150/200/300). A new `beanCount` prop (computed in `App.tsx` as `result.outW * result.outH`) is displayed under the bar. CSS media query at `max-width: 900px` collapses the 3-column layout to single-column for mobile. All 8 preset buttons are positioned absolutely on a log-scaled track (so 20 and 50 are visually distinguishable despite 20-50 being smaller absolute gaps than 200-300).

**Tech Stack:** React 18, TypeScript, Vite 5, native CSS, Vitest, @testing-library/react, Playwright.

**Reference Spec:** `docs/superpowers/specs/2026-07-14-mobile-responsive-bean-grid-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/components/ParamPanel.css` | Create | Progress bar + scatter dot styles |
| `src/components/ParamPanel.tsx` | Rewrite | ProgressBar sub-component + beanCount display |
| `src/components/ParamPanel.test.tsx` | Rewrite | Progress bar interaction tests |
| `src/App.tsx` | Modify | Compute `beanCount` and pass to ParamPanel |
| `src/styles/global.css` | Modify | Add `@media (max-width: 900px)` for single-column stack |

---

## Task 1: Create Feature Branch

**Files:** (no source changes)

- [ ] **Step 1: Create and switch to a feature branch**

Run:
```bash
git checkout -b feature/mobile-bean-progress
```
Expected: `Switched to a new branch 'feature/mobile-bean-progress'`

- [ ] **Step 2: Verify branch**

Run: `git branch`
Expected: `* feature/mobile-bean-progress` and other branches listed.

---

## Task 2: `ParamPanel.css` — Progress Bar Styles

**Files:**
- Create: `src/components/ParamPanel.css`

- [ ] **Step 1: Create the CSS file with progress bar + scatter + bean-count styles**

Write to `src/components/ParamPanel.css`:

```css
/* === Param Panel === */
.param-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  box-shadow: var(--shadow-sm);
}

.grid-label {
  display: block;
  font-size: var(--text-sm);
  color: var(--color-text);
  margin-bottom: var(--space-1);
  font-weight: 500;
}

/* === Progress Bar === */
.grid-progress {
  position: relative;
  height: 32px;
  margin: var(--space-3) 0;
  cursor: pointer;
  user-select: none;
}
.grid-progress-track {
  position: absolute;
  top: 14px;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--color-border);
  border-radius: var(--radius-sm);
}
.grid-progress-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: var(--radius-sm);
  transition: width 0.2s ease;
}
.grid-preset {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  background: var(--color-surface);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.grid-preset:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
  transform: translateX(-50%) scale(1.1);
}
.grid-preset.main {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.grid-preset.active {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 4px var(--color-accent-soft);
}
.grid-preset:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* === Bean Count === */
.bean-count {
  font-size: var(--text-base);
  color: var(--color-text);
  margin: var(--space-2) 0 var(--space-1);
}
.bean-count strong {
  color: var(--color-accent);
  font-weight: 700;
}
```

- [ ] **Step 2: Verify CSS is valid**

Run: `npm run build 2>&1 | tail -3`
Expected: 0 errors; dist rebuilt.

- [ ] **Step 3: Commit**

```bash
git add src/components/ParamPanel.css
git commit -m "style(ParamPanel): 进度条 + 散点预设 + 豆子数样式"
```

---

## Task 3: `ParamPanel.tsx` — Rewrite with ProgressBar

**Files:**
- Modify: `src/components/ParamPanel.tsx`
- Modify: `src/components/ParamPanel.test.tsx`

- [ ] **Step 1: Read current `src/components/ParamPanel.tsx`**

Run: `cat src/components/ParamPanel.tsx`

- [ ] **Step 2: Write failing tests for the new ParamPanel**

Replace `src/components/ParamPanel.test.tsx` entirely with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ParamPanel } from '@/components/ParamPanel';

describe('ParamPanel', () => {
  it('renders 8 scatter preset buttons for grid sizes', () => {
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={10000}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const presets = container.querySelectorAll('.grid-preset');
    expect(presets).toHaveLength(8);
  });

  it('displays bean count formatted with locale string', () => {
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={10000}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    expect(container.textContent).toMatch(/10,000/);
  });

  it('displays "—" when bean count is 0', () => {
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={0}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const el = container.querySelector('.bean-count');
    expect(el?.textContent).toMatch(/—/);
  });

  it('clicking a scatter button triggers onGridSizeChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={10000}
        onGridSizeChange={onChange}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const presets = container.querySelectorAll('.grid-preset');
    // 4th preset = 75
    fireEvent.click(presets[3]);
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('marks main presets (20-100) with .main class', () => {
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={10000}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const mainPresets = container.querySelectorAll('.grid-preset.main');
    // 20, 30, 50, 75, 100 = 5 main presets
    expect(mainPresets).toHaveLength(5);
  });

  it('marks current gridSize preset with .active class', () => {
    const { container } = render(
      <ParamPanel
        gridSize={50}
        beanCount={2500}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const active = container.querySelectorAll('.grid-preset.active');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe('50');
  });
});
```

- [ ] **Step 3: Run tests, verify failure**

Run: `npm test ParamPanel`
Expected: FAIL (new tests reference `.grid-preset` etc. that don't exist yet).

- [ ] **Step 4: Replace `src/components/ParamPanel.tsx`**

```tsx
import './ParamPanel.css';

interface Props {
  gridSize: number;
  beanCount: number;
  onGridSizeChange: (n: number) => void;
  enableDither: boolean;
  onDitherChange: (b: boolean) => void;
  disabled?: boolean;
}

const GRID_PRESETS = [20, 30, 50, 75, 100, 150, 200, 300] as const;
const MIN_PRESET = GRID_PRESETS[0];
const MAX_PRESET = GRID_PRESETS[GRID_PRESETS.length - 1];

const LOG_MIN = Math.log(MIN_PRESET);
const LOG_MAX = Math.log(MAX_PRESET);
const LOG_RANGE = LOG_MAX - LOG_MIN;

function valueToRatio(v: number): number {
  return (Math.log(v) - LOG_MIN) / LOG_RANGE;
}

function ratioToValue(ratio: number): number {
  return Math.exp(LOG_MIN + LOG_RANGE * Math.max(0, Math.min(1, ratio)));
}

function nearestPreset(rawValue: number): number {
  let nearest = GRID_PRESETS[0];
  let minDiff = Math.abs(rawValue - nearest);
  for (const p of GRID_PRESETS) {
    const diff = Math.abs(rawValue - p);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = p;
    }
  }
  return nearest;
}

function isMainPreset(p: number): boolean {
  return p >= 20 && p <= 100;
}

function ProgressBar({
  value,
  presets,
  onChange,
  disabled,
}: {
  value: number;
  presets: readonly number[];
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const rawValue = ratioToValue(ratio);
    onChange(nearestPreset(rawValue));
  };

  return (
    <div
      className="grid-progress"
      onClick={disabled ? undefined : onTrackClick}
      role="slider"
      aria-valuenow={value}
      aria-valuemin={MIN_PRESET}
      aria-valuemax={MAX_PRESET}
    >
      <div className="grid-progress-track">
        <div
          className="grid-progress-fill"
          style={{ width: `${valueToRatio(value) * 100}%` }}
        />
      </div>
      {presets.map(p => {
        const isActive = p === value;
        return (
          <button
            key={p}
            type="button"
            className={`grid-preset ${isActive ? 'active' : ''} ${isMainPreset(p) ? 'main' : ''}`}
            style={{ left: `${valueToRatio(p) * 100}%` }}
            onClick={e => {
              e.stopPropagation();
              onChange(p);
            }}
            aria-label={`网格 ${p}`}
            disabled={disabled}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

export function ParamPanel({
  gridSize,
  beanCount,
  onGridSizeChange,
  enableDither,
  onDitherChange,
  disabled,
}: Props) {
  return (
    <div className="param-panel">
      <label className="grid-label">网格大小（长边豆子数）</label>

      <ProgressBar
        value={gridSize}
        presets={GRID_PRESETS}
        onChange={onGridSizeChange}
        disabled={disabled}
      />

      <p className="bean-count">
        {gridSize} × {gridSize}  ≈  <strong>{beanCount > 0 ? beanCount.toLocaleString() : '—'}</strong>  颗
      </p>
      <p className="hint">推荐 20-100 档位（普通图案常用范围）</p>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={enableDither}
          onChange={e => onDitherChange(e.target.checked)}
          disabled={disabled}
        />
        启用抖动（细节更平滑）
      </label>
    </div>
  );
}
```

- [ ] **Step 5: Run ParamPanel tests, verify passing**

Run: `npm test ParamPanel`
Expected: 6/6 pass.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: 75/75 pass (69 baseline + 6 new).

- [ ] **Step 7: Commit**

```bash
git add src/components/ParamPanel.tsx src/components/ParamPanel.test.tsx
git commit -m "feat(ParamPanel): 进度条 + 散点预设 + 豆子数提示"
```

---

## Task 4: `App.tsx` — Compute and Pass `beanCount`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Read current `src/App.tsx`**

Run: `cat src/App.tsx`

- [ ] **Step 2: Compute `beanCount` and pass to ParamPanel**

Find this line:
```tsx
const legend = useMemo(
  () => (result && palette ? computeLegend(result.indices, palette) : []),
  [result, palette]
);
```

After it, add:
```tsx
const beanCount = result ? result.outW * result.outH : 0;
```

- [ ] **Step 3: Pass `beanCount` to `<ParamPanel>`**

Find:
```tsx
<ParamPanel
  gridSize={gridSize}
  onGridSizeChange={n => {
    setGridSize(n);
    reprocess({ gridSize: n, enableDither });
  }}
  enableDither={enableDither}
  onDitherChange={b => {
    setEnableDither(b);
    reprocess({ gridSize, enableDither: b });
  }}
  disabled={status === 'idle' || status === 'loading'}
/>
```

Replace with:
```tsx
<ParamPanel
  gridSize={gridSize}
  beanCount={beanCount}
  onGridSizeChange={n => {
    setGridSize(n);
    reprocess({ gridSize: n, enableDither });
  }}
  enableDither={enableDither}
  onDitherChange={b => {
    setEnableDither(b);
    reprocess({ gridSize, enableDither: b });
  }}
  disabled={status === 'idle' || status === 'loading'}
/>
```

- [ ] **Step 4: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: 0 errors; 75/75 pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): App 计算 beanCount 传给 ParamPanel"
```

---

## Task 5: `global.css` — Mobile Single-Column Stack

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Read current `.layout-3col` rules**

Run: `grep -n "layout-3col\|@media" src/styles/global.css | head -10`

- [ ] **Step 2: Add `@media (max-width: 900px)` block**

Find this block (the desktop 3-column rule + existing 1400px media query):
```css
.layout-3col {
  display: grid;
  grid-template-columns: var(--left-col-w) 1fr var(--right-col-w);
  gap: var(--space-4);
  margin-top: var(--space-5);
}
@media (max-width: 1400px) {
  .layout-3col {
    grid-template-columns: 240px 1fr 240px;
  }
}
```

Replace with:
```css
.layout-3col {
  display: grid;
  grid-template-columns: var(--left-col-w) 1fr var(--right-col-w);
  gap: var(--space-4);
  margin-top: var(--space-5);
}
@media (max-width: 1400px) {
  .layout-3col {
    grid-template-columns: 240px 1fr 240px;
  }
}
/* Mobile / narrow: single column stack */
@media (max-width: 900px) {
  .layout-3col {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }
  .preview-wrap {
    aspect-ratio: auto;
    min-height: 320px;
  }
  header h1 {
    font-size: var(--text-xl);
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -3`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "style: 移动端 ≤900px 单列堆叠"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run full unit suite**

Run: `npm test`
Expected: 75/75 pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: 0 errors; dist/ regenerated.

- [ ] **Step 4: Manual dev-server smoke test**

Run: `npm run dev` (background); visit http://localhost:5173; verify:
- Progress bar visible with 8 scatter buttons (20/30/50/75/100/150/200/300)
- Main presets (20-100) visually distinct (softer background + accent text)
- Current preset (e.g. 100) has shadow ring + accent fill
- Click "50" scatter button: gridSize updates, preview re-renders, beanCount shows "50 × 50 ≈ 2,500 颗"
- Drag browser window to ≤900px width: layout switches to single column
- Click progress bar track at center: jumps to nearest preset (likely 50 or 75)
- Hover a scatter: scales up slightly
- Phone simulation (Chrome DevTools 375px): single column, progress bar works on touch

Stop server with Ctrl+C after verifying.

- [ ] **Step 5: Stay on the feature branch — DO NOT merge to main**

The user wants this work to remain on `feature/mobile-bean-progress` for review.

---

## Self-Review

After writing this plan I checked against the spec:

**1. Spec coverage:**
- MR-1 (手机端单列堆叠) → Task 5 adds `@media (max-width: 900px)` single column
- MR-2 (8 个档位 20-300) → Task 3 step 4 has `GRID_PRESETS = [20, 30, 50, 75, 100, 150, 200, 300]`
- MR-3 (beanCount 显示) → Task 4 computes `result.outW * result.outH`; Task 3 step 4 displays it with `toLocaleString()`
- MR-4 (进度条 + 散点) → Task 3 step 4 implements `ProgressBar` sub-component with log-scaled track
- MR-5 (主档位 20-100 突出) → Task 2 CSS has `.grid-preset.main`; Task 3 step 4 has `isMainPreset(p)` helper

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later". Every step has full code or commands. Test code is complete for each test.

**3. Type consistency:**
- `Props` interface `{ gridSize, beanCount, onGridSizeChange, enableDither, onDitherChange, disabled? }` consistent across Task 3 (component) and Task 4 (App usage)
- `GRID_PRESETS = [20, 30, 50, 75, 100, 150, 200, 300]` is a single source of truth in ParamPanel.tsx
- `valueToRatio` / `ratioToValue` / `nearestPreset` helpers are local to ParamPanel.tsx, not exported

**4. Edge cases / gaps fixed during self-review:**
- Task 3 step 4 uses `e.stopPropagation()` on scatter click to prevent the track-click handler from also firing
- `beanCount > 0` check shows "—" instead of "0" (avoids showing "0 颗" which is confusing)
- The disabled prop on ProgressBar's container div (`onClick={disabled ? undefined : onTrackClick}`) prevents accidental clicks
- Task 2 CSS uses `transform: translateX(-50%)` on presets so the visual center of each circle aligns with the track point (not the left edge)

**5. Test count progression:**
- Before this plan: 69 tests
- After Task 3 (ParamPanel): 75 (+6 new; old tests removed = 0)
- Final: 75 unit tests

Plan is ready for execution on `feature/mobile-bean-progress` branch.