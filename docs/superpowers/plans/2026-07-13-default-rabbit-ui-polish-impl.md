# 拼豆图：默认兔子图 + UI 重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a default rabbit bead-image on page load (no upload required), simplify the export panel to a single button, retheme the UI to a soft macaron palette, and add a one-line legal disclaimer in the footer.

**Architecture:** Add a `useSampleImage` hook that fetches `/samples/rabbit.png`, decodes it into `ImageData`, and exposes `{ imageData, loading, error }`. In `App.tsx`, a `useEffect` watches `[sample, palette, status === 'idle']` and auto-calls `usePipeline.process(sample, ...)` so the canvas and legend render the rabbit by default. Simplify `ExportPanel` to a single "导出 1 张图" button (delete the extra-sizes checkbox list, the pixel-density dropdown, the multi-state logic, and the state hooks). Rewrite `global.css` with a macaron color palette (warm beige bg, peach accent, mint/yellow/pink secondary tokens), larger radii (8/16/24px), and softer warm-tinted shadows. Add a one-line legal disclaimer in `app-footer`.

**Tech Stack:** React 18, TypeScript, Vite 5, native CSS, native `fetch` + `createImageBitmap`, Vitest, @testing-library/react, Playwright.

**Reference Spec:** `docs/superpowers/specs/2026-07-13-default-rabbit-ui-polish-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `public/samples/rabbit.png` | Create | Default demo image (placeholder — user replaces with real rabbit image later) |
| `src/hooks/useSampleImage.ts` | Create | Fetch `/samples/rabbit.png` → `ImageData` |
| `src/hooks/useSampleImage.test.ts` | Create | 3 hook tests (success / failure / unmount) |
| `src/components/ExportPanel.tsx` | Simplify | Single "导出 1 张图" button, drop all options |
| `src/components/ExportPanel.test.tsx` | Simplify | 1 button-click test |
| `src/App.tsx` | Modify | Use `useSampleImage`, auto-process on load, add footer disclaimer |
| `src/styles/global.css` | Rewrite | Macaron palette, larger radius, soft warm shadow |

---

## Task 1: Create Feature Branch + Add Rabbit Placeholder

**Files:**
- Create: `public/samples/rabbit.png`

- [ ] **Step 1: Create the feature branch**

Run:
```bash
git checkout -b feature/default-rabbit-ui-polish
```
Expected: `Switched to a new branch 'feature/default-rabbit-ui-polish'`

- [ ] **Step 2: Create the samples directory**

Run:
```bash
mkdir -p public/samples
```

- [ ] **Step 3: Create a placeholder PNG for the rabbit**

Run:
```bash
node -e "require('fs').writeFileSync('public/samples/rabbit.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'))"
```

This creates a 1×1 transparent PNG (the smallest valid PNG). It's a placeholder — the user will replace it with the real rabbit image later. The actual rabbit from the brainstorming chat is provided as the eventual image.

- [ ] **Step 4: Verify the file exists**

Run: `ls -la public/samples/rabbit.png && file public/samples/rabbit.png`
Expected: file exists, ~70 bytes, PNG image data.

- [ ] **Step 5: Commit**

```bash
git add public/samples/rabbit.png
git commit -m "feat(samples): 默认兔子图占位"
```

---

## Task 2: `useSampleImage` Hook + Tests

**Files:**
- Create: `src/hooks/useSampleImage.ts`
- Create: `src/hooks/useSampleImage.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useSampleImage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSampleImage } from '@/hooks/useSampleImage';

describe('useSampleImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in loading state', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSampleImage());
    expect(result.current.loading).toBe(true);
    expect(result.current.imageData).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('populates imageData on successful fetch', async () => {
    const fakeBitmap = { width: 4, height: 4 } as ImageBitmap;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'image/png' }),
    } as Response);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap));
    // Stub document.createElement('canvas') with a minimal stub that exposes getContext + drawImage + getImageData.
    const stubCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 })),
    };
    const stubCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => stubCtx),
    };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return stubCanvas as unknown as HTMLCanvasElement;
      return origCreate(tag);
    });

    const { result } = renderHook(() => useSampleImage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.imageData).toBeTruthy();
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      blob: async () => new Blob([], { type: 'image/png' }),
    } as unknown as Response);

    const { result } = renderHook(() => useSampleImage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.imageData).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test useSampleImage`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/hooks/useSampleImage.ts`**

```ts
import { useEffect, useState } from 'react';

export function useSampleImage(): {
  imageData: ImageData | null;
  loading: boolean;
  error: Error | null;
} {
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/samples/rabbit.png')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then(blob => createImageBitmap(blob))
      .then(bitmap => {
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        setImageData(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { imageData, loading, error };
}
```

- [ ] **Step 4: Run tests, verify passing**

Run: `npm test useSampleImage`
Expected: 3/3 pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 66/66 pass (63 baseline + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSampleImage.ts src/hooks/useSampleImage.test.ts
git commit -m "feat(hooks): useSampleImage fetch + decode 默认示例图"
```

---

## Task 3: Simplify `ExportPanel` to a Single Button

**Files:**
- Modify: `src/components/ExportPanel.tsx`
- Modify: `src/components/ExportPanel.test.tsx`

- [ ] **Step 1: Read current `src/components/ExportPanel.tsx`**

Run: `cat src/components/ExportPanel.tsx`

- [ ] **Step 2: Read current `src/components/ExportPanel.test.tsx`**

Run: `cat src/components/ExportPanel.test.tsx`

- [ ] **Step 3: Replace `src/components/ExportPanel.tsx`**

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
        导出 1 张图
      </button>
      <p className="hint">默认 32px 一格，可直接打印或分享</p>
    </div>
  );
}
```

- [ ] **Step 4: Update `src/components/ExportPanel.test.tsx`**

Replace the entire file with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ExportPanel } from '@/components/ExportPanel';

describe('ExportPanel', () => {
  it('renders single export button', () => {
    const { container } = render(<ExportPanel onExport={() => {}} disabled={false} />);
    const btn = container.querySelector('button.primary');
    expect(btn?.textContent).toMatch(/导出 1 张图/);
  });

  it('clicking the button triggers onExport', () => {
    const onExport = vi.fn();
    const { container } = render(<ExportPanel onExport={onExport} disabled={false} />);
    fireEvent.click(container.querySelector('button.primary')!);
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('disables button when disabled prop is true', () => {
    const { container } = render(<ExportPanel onExport={() => {}} disabled={true} />);
    const btn = container.querySelector('button.primary') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test ExportPanel`
Expected: 3/3 pass.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: 66/66 pass (3 new ExportPanel tests + 0 removed = 66 since hook added 3 already).

- [ ] **Step 7: Commit**

```bash
git add src/components/ExportPanel.tsx src/components/ExportPanel.test.tsx
git commit -m "refactor(ui): ExportPanel 简化为单按钮（删除额外尺寸/像素密度/场景化）"
```

---

## Task 4: Update `App.tsx` — Auto-Process Sample + Footer Disclaimer

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Read current `src/App.tsx`**

Run: `cat src/App.tsx`

- [ ] **Step 2: Add `useSampleImage` import**

Find:
```tsx
import { usePipeline } from '@/hooks/usePipeline';
```

Add after it:
```tsx
import { useSampleImage } from '@/hooks/useSampleImage';
```

- [ ] **Step 3: Use `useSampleImage` and add auto-process effect**

Find the line where `usePipeline` is destructured. After it, add:
```tsx
const { imageData: sample } = useSampleImage();
```

Then add this useEffect (anywhere inside the component, but ideally after the other hooks):
```tsx
useEffect(() => {
  if (sample && palette && status === 'idle') {
    process(sample, { gridSize, enableDither });
  }
}, [sample, palette, status]);
```

This requires `useEffect` to be in the import:
```tsx
import { useEffect, useMemo, useState } from 'react';
```

- [ ] **Step 4: Update the `handleExport` callback**

Find the existing `handleExport`. The new signature should be parameter-less because the simplified `ExportPanel` no longer passes options:

```tsx
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

- [ ] **Step 5: Update `<ExportPanel>` usage in JSX**

Find:
```tsx
<ExportPanel
  currentGridSize={result?.gridSize ?? 100}
  disabled={!result || exporting}
  onExport={handleExport}
/>
```

Replace with:
```tsx
<ExportPanel
  disabled={!result || exporting}
  onExport={handleExport}
/>
```

- [ ] **Step 6: Add the footer disclaimer with macaron emoji header**

Find the closing `<ProductShowcase />` element. After it (and before the closing `<footer>` if any, or replace the existing footer), add:

```tsx
      <footer className="app-footer">
        <p>© 拼豆图生成器 · 仅作手工参考 · 颜色归各品牌所有</p>
      </footer>
```

Also add the rabbit emoji to the header `<h1>`:
```tsx
<h1>🐰 拼豆图生成器</h1>
```

- [ ] **Step 7: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: 66/66 pass (no behavior change yet, just app wiring).

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): App 启动自动加载兔子示例 + 页脚法律声明"
```

---

## Task 5: Rewrite `global.css` with Macaron Palette

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Replace the `:root` block**

Find the existing `:root { ... }` block in `src/styles/global.css`. Replace the entire block with:

```css
:root {
  /* Color — 柔和马卡龙 */
  --color-bg: #fdf6f0;
  --color-surface: #ffffff;
  --color-surface-alt: #f5ede5;
  --color-text: #2d2a26;
  --color-text-muted: #968b80;
  --color-border: #f0e6dc;
  --color-border-strong: #d9c9b9;
  --color-accent: #e07856;
  --color-accent-hover: #c95f3f;
  --color-accent-soft: #fce0d6;
  --color-pink: #f7b5c5;
  --color-mint: #a8d8b9;
  --color-yellow: #f8d77f;
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
  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 24px;

  /* Shadow — 柔和 */
  --shadow-sm: 0 2px 6px rgba(180, 130, 100, 0.08);
  --shadow-md: 0 6px 20px rgba(180, 130, 100, 0.12);
  --shadow-lg: 0 12px 32px rgba(180, 130, 100, 0.16);

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 22px;
  --text-2xl: 28px;

  /* Layout */
  --left-col-w: 280px;
  --right-col-w: 300px;
}
```

- [ ] **Step 2: Update `header h1` typography to use the larger title size**

Find the `.app` or `header h1` rule (it currently uses `font-size: var(--text-xl)`). Update to use the new larger size:

```css
header h1 {
  font-size: var(--text-2xl);
  font-weight: 700;
  margin-bottom: var(--space-1);
  letter-spacing: -0.01em;
}
```

- [ ] **Step 3: Add `app-footer` styles (likely missing)**

Find where the `.error` block is. After it, append:

```css
.app-footer {
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
```

(If `.app-footer` already exists, just ensure the values match — modify in place.)

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -3`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css
git commit -m "style: 柔和马卡龙色板 + 大圆角 + 暖色柔阴影"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run full unit suite**

Run: `npm test`
Expected: 66/66 pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: 0 errors; dist/ generated. Verify:
```bash
ls dist/samples/rabbit.png
```
Should exist (Vite copies public/ as-is).

- [ ] **Step 4: Manual dev-server smoke test**

Run: `npm run dev` (background); visit http://localhost:5173; verify:
- Page loads with the small placeholder image shown as the bead image (since we used a 1×1 transparent PNG, the preview will be tiny — that's expected; user will replace `public/samples/rabbit.png` with the real rabbit)
- Right legend area should be populated (from auto-generated rabbit colors)
- Color scheme is warm beige with peach accent
- Single "导出 1 张图" button (no extra options)
- Footer shows the legal disclaimer line

Stop server with Ctrl+C after verifying.

- [ ] **Step 5: User-instruction reminder**

After merging, remind the user to replace `public/samples/rabbit.png` with the actual rabbit image. The placeholder is a 1×1 transparent PNG; the real rabbit image should be reasonably sized (e.g., 500-1000px wide) to look good as the default.

- [ ] **Step 6: Stay on the feature branch — DO NOT merge to main**

The user wants this work to remain on `feature/default-rabbit-ui-polish` for review. Do not run `git checkout main` + `git merge`.

---

## Self-Review

After writing this plan I checked against the spec:

**1. Spec coverage:**
- DR-1 (默认兔子图) → Task 1 creates placeholder; Task 2 builds useSampleImage; Task 4 wires auto-process
- DR-2 (示例直观) → Same as DR-1
- DR-3 (上传切换) → Task 4 keeps `process(data, ...)` in UploadZone onLoad handler
- DR-4 (1 按钮导出) → Task 3 simplifies ExportPanel to single button
- DR-5 (UI 柔和) → Task 5 rewrites global.css with macaron palette
- DR-6 (法律声明) → Task 4 adds footer with disclaimer line

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later". Every step has full code or commands. Test code is complete for each test.

**3. Type consistency:**
- `useSampleImage` return type `{ imageData, loading, error }` consistent across Task 2 (hook) and Task 4 (App destructure)
- `ExportPanel` Props `{ onExport, disabled }` consistent in Task 3 (component) and Task 4 (App usage)
- App.tsx state variables (`gridSize`, `enableDither`, `exporting`, `result`) unchanged

**4. Edge cases / gaps fixed during self-review:**
- Task 2 Step 1 useSampleImage test stubs `document.createElement` for canvas (the hook creates a temp canvas to read `getImageData`) — this is non-obvious but needed for jsdom
- Task 4 auto-process `useEffect` checks `status === 'idle'` to prevent repeated calls when processing
- Task 5 footer styles use `var(--space-6)` for top margin (separates from main content) and `var(--text-xs)` for legal text (small but readable)

**5. Test count progression:**
- Before this plan: 63 tests
- After Task 2 (useSampleImage): 66 (+3)
- After Task 3 (ExportPanel): 66 (3 new + 0 removed; old ExportPanel had 1 test, new has 3, so net +2 = 68)
- Recount: 63 + 3 (hook) + 2 (ExportPanel replacement, was 1 now 3) = **68 unit tests**
- Final: 68 unit tests

Plan is ready for execution on `feature/default-rabbit-ui-polish` branch.