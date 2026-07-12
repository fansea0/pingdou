# 拼豆图：空状态引导文案优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty "blank box" appearance in the middle preview area and right legend area with minimal, guiding text when no image has been uploaded.

**Architecture:** Add a `.empty-state` CSS class for the empty-state visual treatment. Inside `PreviewCanvas`, conditionally render either the `<canvas>` (when result is non-null) or a `<p className="empty-state">` (when result is null), inside the existing `.preview-scroll` beige container. Inside `ColorLegend`, when the `legend` array is empty, render `<p className="empty-state">` in place of the current inaccurate `<p className="legend-empty">当前图像未匹配到任何色号</p>` text. No new components, no new state, no new dependencies.

**Tech Stack:** React 18, TypeScript, Vite 5, native CSS, Vitest, @testing-library/react.

**Reference Spec:** `docs/superpowers/specs/2026-07-13-empty-state-ux-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/styles/global.css` | Modify | Add `.empty-state` utility class |
| `src/components/PreviewCanvas.tsx` | Modify | Add empty-state branch in JSX |
| `src/components/PreviewCanvas.test.tsx` | Create | Add 2 empty-state tests |
| `src/components/ColorLegend.tsx` | Modify | Replace `legend-empty` text with `.empty-state` |
| `src/components/ColorLegend.test.tsx` | Modify | Add 2 empty-state tests |

---

## Task 1: Create Branch + Add `.empty-state` CSS

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create a feature branch**

Run:
```bash
git checkout -b feature/empty-state-ux
```
Expected: `Switched to a new branch 'feature/empty-state-ux'`

- [ ] **Step 2: Find an existing related style to anchor the new class next to**

Run: `grep -n "product-loading\|product-error" src/styles/global.css | head -3`
Expected: shows line numbers for existing loading/error styles. We'll insert `.empty-state` near them.

- [ ] **Step 3: Append the `.empty-state` rule to `src/styles/global.css`**

At the end of the file (after the `.product-error` rule), add:

```css
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 200px;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-5);
}
```

- [ ] **Step 4: Verify build picks up the change**

Run: `npm run build 2>&1 | tail -3`
Expected: 0 errors; dist regenerated.

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css
git commit -m "style: .empty-state 通用类（空状态居中文案）"
```

---

## Task 2: `PreviewCanvas` — Add Empty-State Branch

**Files:**
- Modify: `src/components/PreviewCanvas.tsx`
- Create: `src/components/PreviewCanvas.test.tsx`

- [ ] **Step 1: Write the failing empty-state tests**

Create `src/components/PreviewCanvas.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import type { Palette, PipelineResult } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 0, 255], name: '蓝' },
];

const result: PipelineResult = {
  indices: new Uint8Array([0, 1, 1, 0]),
  gridSize: 2,
  outW: 2,
  outH: 2,
  token: 1,
};

describe('PreviewCanvas (empty state)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows empty-state text when result is null', () => {
    const { container } = render(
      <PreviewCanvas
        result={null}
        palette={palette}
        cellPx={24}
        isRecomputing={false}
      />
    );
    const el = container.querySelector('.empty-state');
    expect(el).toBeTruthy();
    expect(el?.textContent).toMatch(/上传图片以查看预览/);
  });

  it('does not render <canvas> when result is null', () => {
    const { container } = render(
      <PreviewCanvas
        result={null}
        palette={palette}
        cellPx={24}
        isRecomputing={false}
      />
    );
    expect(container.querySelector('canvas.preview')).toBeNull();
  });

  it('does not render empty-state when result is provided', () => {
    const { container } = render(
      <PreviewCanvas
        result={result}
        palette={palette}
        cellPx={24}
        isRecomputing={false}
      />
    );
    expect(container.querySelector('.empty-state')).toBeNull();
    expect(container.querySelector('canvas.preview')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests, verify the empty-state tests fail**

Run: `npm test PreviewCanvas`
Expected: 2 new tests fail (the "does not render <canvas>" and "does not render empty-state" assertions will fail because the current code always renders `<canvas>` regardless of result).

- [ ] **Step 3: Read current `src/components/PreviewCanvas.tsx`**

Run: `cat src/components/PreviewCanvas.tsx`

- [ ] **Step 4: Modify the JSX return to conditionally render canvas or empty-state**

Find this block:

```tsx
  return (
    <div className="preview-wrap">
      <div className={isRecomputing ? 'preview-scroll dim' : 'preview-scroll'}>
        <canvas ref={ref} className="preview" />
      </div>
      {isRecomputing && <div className="overlay">计算中...</div>}
    </div>
  );
```

Replace with:

```tsx
  return (
    <div className="preview-wrap">
      <div className={isRecomputing ? 'preview-scroll dim' : 'preview-scroll'}>
        {result ? (
          <canvas ref={ref} className="preview" />
        ) : (
          <p className="empty-state">上传图片以查看预览</p>
        )}
      </div>
      {isRecomputing && <div className="overlay">计算中...</div>}
    </div>
  );
```

- [ ] **Step 5: Run tests, verify all pass**

Run: `npm test PreviewCanvas`
Expected: 3/3 pass (the new 3 empty-state tests).

- [ ] **Step 6: Run full suite to confirm no regression**

Run: `npm test`
Expected: 62/62 pass (59 baseline + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/components/PreviewCanvas.tsx src/components/PreviewCanvas.test.tsx
git commit -m "feat(preview): result=null 时显示空状态引导文案"
```

---

## Task 3: `ColorLegend` — Replace `legend-empty` with `.empty-state`

**Files:**
- Modify: `src/components/ColorLegend.tsx`
- Modify: `src/components/ColorLegend.test.tsx`

- [ ] **Step 1: Read current `src/components/ColorLegend.tsx`**

Run: `cat src/components/ColorLegend.tsx`

- [ ] **Step 2: Add failing tests for the new empty-state**

Open `src/components/ColorLegend.test.tsx`. The existing test file has 4 tests. Append 2 more:

```tsx
describe('ColorLegend (empty state)', () => {
  it('shows guiding text when legend is empty', () => {
    const { container } = render(<ColorLegend legend={[]} />);
    const el = container.querySelector('.empty-state');
    expect(el).toBeTruthy();
    expect(el?.textContent).toMatch(/上传图片后查看色号对照表/);
  });

  it('does not show empty-state when legend has items', () => {
    const { container } = render(
      <ColorLegend
        legend={[
          { id: 'A01', name: '红', rgb: [255, 0, 0], count: 3, index: 0 },
        ]}
      />
    );
    expect(container.querySelector('.empty-state')).toBeNull();
    expect(container.querySelector('.legend-row')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests, verify the new tests fail**

Run: `npm test ColorLegend`
Expected: 2 new tests fail.

- [ ] **Step 4: Replace the `legend-empty` block in `ColorLegend.tsx`**

Find:

```tsx
  if (legend.length === 0) {
    return (
      <aside className="legend-wrap">
        <p className="legend-empty">当前图像未匹配到任何色号</p>
      </aside>
    );
  }
```

Replace with:

```tsx
  if (legend.length === 0) {
    return (
      <aside className="legend-wrap">
        <p className="empty-state">上传图片后查看色号对照表</p>
      </aside>
    );
  }
```

- [ ] **Step 5: Remove the now-unused `.legend-empty` CSS rule (if it exists)**

Run: `grep -n "legend-empty" src/styles/global.css`
If a match is found, delete the entire `.legend-empty { ... }` block. (If no match, skip — the rule may not exist.)

- [ ] **Step 6: Run tests, verify all pass**

Run: `npm test ColorLegend`
Expected: 6/6 pass (4 original + 2 new).

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: 64/64 pass (62 after Task 2 + 2 new).

- [ ] **Step 8: Commit**

```bash
git add src/components/ColorLegend.tsx src/components/ColorLegend.test.tsx src/styles/global.css
git commit -m "feat(legend): legend=[] 时显示空状态引导文案"
```

---

## Task 4: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run full unit suite**

Run: `npm test`
Expected: 64/64 pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: 0 errors; dist/ generated.

- [ ] **Step 4: Manual dev-server smoke test**

Run: `npm run dev` (background); visit http://localhost:5173; verify:
- Page loads with header visible
- Middle preview area shows "上传图片以查看预览" in beige container
- Right legend area shows "上传图片后查看色号对照表" in beige container
- Upload a sample image
- Middle area switches from text to canvas
- Right legend area switches from text to color table

Stop server with Ctrl+C after verifying.

- [ ] **Step 5: Git log review**

Run: `git log --oneline | head -6`
Expected: 3 new commits on `feature/empty-state-ux` branch since the spec commit:
1. `style: .empty-state 通用类（空状态居中文案）`
2. `feat(preview): result=null 时显示空状态引导文案`
3. `feat(legend): legend=[] 时显示空状态引导文案`

- [ ] **Step 6: Stay on the feature branch — DO NOT merge to main**

The user wants this work to remain on `feature/empty-state-ux` for review. Do not run `git checkout main` + `git merge`.

---

## Self-Review

After writing this plan I checked against the spec:

**1. Spec coverage:**
- ES-1 (预览区引导文案) → Task 2 renders `<p className="empty-state">上传图片以查看预览</p>`
- ES-2 (右侧 legend 引导文案) → Task 3 renders `<p className="empty-state">上传图片后查看色号对照表</p>`
- ES-3 (上传后切换) → Both tasks use `{result ? <canvas> : <p>}` and `{legend.length === 0 ? <p> : <table>}` — React handles the transition automatically
- ES-4 (米色容器保留) → Both tasks keep the existing `.preview-wrap` and `.legend-wrap` containers unchanged

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later". Every step has full code or commands. Test code is complete.

**3. Type consistency:**
- `PreviewCanvas` props (`result: PipelineResult | null, palette: Palette, cellPx: number, isRecomputing: boolean`) unchanged
- `ColorLegend` props (`legend: LegendRow[]`) unchanged
- CSS class `.empty-state` referenced in both components and the stylesheet

**4. Edge cases / gaps fixed during self-review:**
- Task 2 Step 1 includes 3 tests (the spec listed 2 — but the "result is provided → canvas only" test is essential to prevent regression of the non-empty path; included for thoroughness)
- Task 3 Step 5 cleans up the now-unused `.legend-empty` CSS rule (good hygiene; the new class replaces it)
- Task 4 Step 6 explicitly states: DO NOT merge to main — user wants this on the feature branch for review

**5. Test count progression:**
- Before this plan: 59 tests
- After Task 2 (PreviewCanvas): 62 (+3)
- After Task 3 (ColorLegend): 64 (+2)
- Final: 64 unit tests

Plan is ready for execution on `feature/empty-state-ux` branch.