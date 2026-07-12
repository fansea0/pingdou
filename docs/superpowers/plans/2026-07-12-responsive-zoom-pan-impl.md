# 拼豆图：响应式布局 + 缩放/平移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (1) responsive breakpoints (1400px and 1024px) to the 3-column layout with aspect-ratio canvas sizing, and (2) an in-place zoom/pan feature for the bead-image preview using a ZoomToolbar (+ / − / number / reset) and mouse-drag panning, all without changing the export-image pipeline.

**Architecture:** `useZoomPan` hook owns zoom/pan state in App; `ZoomToolbar` is a controlled component; `PreviewCanvas` receives zoom/pan props and applies `ctx.translate + ctx.scale` per redraw — canvas bitmap dimensions stay constant (`cellPx × gridSize`), zoom is purely a GPU transform. Drag-pan via mouse events with a `useRef` for the drag origin. Responsive breakpoints are pure CSS (no JS).

**Tech Stack:** React 18, TypeScript, Vite 5, Canvas 2D, Vitest, @testing-library/react, Playwright, native CSS media queries.

**Reference Spec:** `docs/superpowers/specs/2026-07-12-responsive-zoom-pan-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/hooks/useZoomPan.ts` | Create | Zoom/pan state hook + `ZOOM_LEVELS` constant + boundary clipping |
| `src/hooks/useZoomPan.test.ts` | Create | Vitest + RTL tests for hook behavior |
| `src/components/ZoomToolbar.tsx` | Create | Controlled UI: − button, number input, + button, reset button |
| `src/components/ZoomToolbar.test.tsx` | Create | RTL tests for toolbar rendering and interactions |
| `src/components/PreviewCanvas.tsx` | Modify | Apply zoom/pan via `ctx.translate + ctx.scale`, add mouse-drag handlers |
| `src/components/PreviewCanvas.test.tsx` | Create | RTL tests for ctx.translate/scale calls + drag events |
| `src/App.tsx` | Modify | Wire `useZoomPan` + reset on param/upload change |
| `src/styles/global.css` | Modify | Add 1400px breakpoint + `aspect-ratio: 1/1` on `.preview-wrap` + toolbar styles |
| `tests/e2e/flow.spec.ts` | Modify | Add 1-2 zoom-related E2E tests |

---

## Task 1: `useZoomPan` Hook + Tests

**Files:**
- Create: `src/hooks/useZoomPan.ts`
- Create: `src/hooks/useZoomPan.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useZoomPan.test.ts`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useZoomPan, ZOOM_LEVELS } from '@/hooks/useZoomPan';

describe('useZoomPan', () => {
  it('zoomIn: moves up through ZOOM_LEVELS', () => {
    const { result } = renderHook(() => useZoomPan());
    expect(result.current.zoom).toBe(1);
    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(ZOOM_LEVELS[1]);
    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(ZOOM_LEVELS[2]);
  });

  it('zoomOut: moves down through ZOOM_LEVELS', () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.zoomIn());
    act(() => result.current.zoomIn());
    act(() => result.current.zoomIn());
    act(() => result.current.zoomOut());
    expect(result.current.zoom).toBe(ZOOM_LEVELS[2]);
  });

  it('zoomOut: clamped at 1', () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());
    expect(result.current.zoom).toBe(1);
  });

  it('reset: returns to (1, 0, 0)', () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.zoomIn());
    act(() => result.current.setPan(50, 30));
    expect(result.current.zoom).toBeGreaterThan(1);
    expect(result.current.panX).toBe(50);
    act(() => result.current.reset());
    expect(result.current.zoom).toBe(1);
    expect(result.current.panX).toBe(0);
    expect(result.current.panY).toBe(0);
  });

  it('setZoom: clamps to [1, 8]', () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.setZoom(0.5));
    expect(result.current.zoom).toBe(1);
    act(() => result.current.setZoom(99));
    expect(result.current.zoom).toBe(8);
    act(() => result.current.setZoom(2));
    expect(result.current.zoom).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test useZoomPan`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `src/hooks/useZoomPan.ts`**

```ts
import { useCallback, useState } from 'react';

export const ZOOM_LEVELS: readonly number[] = [1, 1.5, 2, 3, 4, 6, 8];
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

function clampZoom(z: number): number {
  if (Number.isNaN(z)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function useZoomPan() {
  const [zoom, setZoomState] = useState(MIN_ZOOM);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const setZoom = useCallback((z: number) => {
    setZoomState(clampZoom(z));
  }, []);

  const setPan = useCallback((x: number, y: number) => {
    setPanX(x);
    setPanY(y);
  }, []);

  const zoomIn = useCallback(() => {
    setZoomState(prev => {
      const next = ZOOM_LEVELS.find(z => z > prev);
      return next ?? MAX_ZOOM;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState(prev => {
      const next = [...ZOOM_LEVELS].reverse().find(z => z < prev);
      return next ?? MIN_ZOOM;
    });
  }, []);

  const reset = useCallback(() => {
    setZoomState(MIN_ZOOM);
    setPanX(0);
    setPanY(0);
  }, []);

  return { zoom, panX, panY, setZoom, setPan, zoomIn, zoomOut, reset };
}
```

- [ ] **Step 4: Run test to verify passing**

Run: `npm test useZoomPan`
Expected: 5/5 pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 50/50 pass (45 existing + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useZoomPan.ts src/hooks/useZoomPan.test.ts
git commit -m "feat(hooks): useZoomPan 缩放/平移状态 hook"
```

---

## Task 2: `ZoomToolbar` Component + Tests

**Files:**
- Create: `src/components/ZoomToolbar.tsx`
- Create: `src/components/ZoomToolbar.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/ZoomToolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ZoomToolbar } from '@/components/ZoomToolbar';

describe('ZoomToolbar', () => {
  it('renders zoom indicator with current value', () => {
    const { container } = render(
      <ZoomToolbar
        zoom={2}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
        onZoomChange={() => {}}
        disabled={false}
      />
    );
    const input = container.querySelector('input[type=number]') as HTMLInputElement;
    expect(input.value).toBe('2');
  });

  it('clicking + triggers onZoomIn', () => {
    const onZoomIn = vi.fn();
    const { container } = render(
      <ZoomToolbar zoom={1} onZoomIn={onZoomIn} onZoomOut={() => {}} onReset={() => {}} onZoomChange={() => {}} disabled={false} />
    );
    const btn = container.querySelector('[data-testid="zoom-in"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onZoomIn).toHaveBeenCalledOnce();
  });

  it('clicking − triggers onZoomOut', () => {
    const onZoomOut = vi.fn();
    const { container } = render(
      <ZoomToolbar zoom={2} onZoomIn={() => {}} onZoomOut={onZoomOut} onReset={() => {}} onZoomChange={() => {}} disabled={false} />
    );
    const btn = container.querySelector('[data-testid="zoom-out"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onZoomOut).toHaveBeenCalledOnce();
  });

  it('clicking reset triggers onReset', () => {
    const onReset = vi.fn();
    const { container } = render(
      <ZoomToolbar zoom={4} onZoomIn={() => {}} onZoomOut={() => {}} onReset={onReset} onZoomChange={() => {}} disabled={false} />
    );
    const btn = container.querySelector('[data-testid="zoom-reset"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('all buttons disabled when disabled prop is true', () => {
    const { container } = render(
      <ZoomToolbar zoom={1} onZoomIn={() => {}} onZoomOut={() => {}} onReset={() => {}} onZoomChange={() => {}} disabled={true} />
    );
    const buttons = container.querySelectorAll('button');
    buttons.forEach(b => expect(b.disabled).toBe(true));
  });

  it('typing in number input and pressing Enter triggers onZoomChange with parsed value', () => {
    const onZoomChange = vi.fn();
    const { container } = render(
      <ZoomToolbar zoom={1} onZoomIn={() => {}} onZoomOut={() => {}} onReset={() => {}} onZoomChange={onZoomChange} disabled={false} />
    );
    const input = container.querySelector('input[type=number]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onZoomChange).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test ZoomToolbar`
Expected: FAIL.

- [ ] **Step 3: Implement `src/components/ZoomToolbar.tsx`**

```tsx
import { useState, useEffect } from 'react';

interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onZoomChange: (z: number) => void;
  disabled: boolean;
}

export function ZoomToolbar({ zoom, onZoomIn, onZoomOut, onReset, onZoomChange, disabled }: Props) {
  const [inputValue, setInputValue] = useState(String(zoom));

  useEffect(() => {
    setInputValue(String(zoom));
  }, [zoom]);

  const commit = () => {
    const n = parseFloat(inputValue);
    if (!Number.isNaN(n)) onZoomChange(n);
    setInputValue(String(zoom));
  };

  return (
    <div className="zoom-toolbar">
      <button
        type="button"
        className="zoom-btn"
        data-testid="zoom-out"
        disabled={disabled}
        onClick={onZoomOut}
        aria-label="缩小"
      >
        −
      </button>
      <input
        type="number"
        className="zoom-input"
        value={inputValue}
        min={1}
        max={8}
        step={0.5}
        disabled={disabled}
        onChange={e => setInputValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        aria-label="当前缩放倍数"
      />
      <button
        type="button"
        className="zoom-btn"
        data-testid="zoom-in"
        disabled={disabled}
        onClick={onZoomIn}
        aria-label="放大"
      >
        +
      </button>
      <button
        type="button"
        className="zoom-btn zoom-reset"
        data-testid="zoom-reset"
        disabled={disabled}
        onClick={onReset}
        aria-label="复位"
      >
        ⊕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Append toolbar CSS to `src/styles/global.css`**

```css
/* === Zoom Toolbar === */
.zoom-toolbar {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-1);
  box-shadow: var(--shadow-md);
  z-index: 10;
}
.zoom-btn {
  width: 36px;
  height: 36px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-base);
  color: var(--color-text);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: all 0.15s;
}
.zoom-btn:hover:not(:disabled) {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.zoom-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.zoom-input {
  width: 36px;
  height: 36px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  text-align: center;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-surface);
  padding: 0;
  -moz-appearance: textfield;
}
.zoom-input::-webkit-outer-spin-button,
.zoom-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.zoom-input:disabled { opacity: 0.5; }
.zoom-reset {
  font-size: var(--text-lg);
  margin-top: var(--space-1);
}
```

- [ ] **Step 5: Run tests, verify passing**

Run: `npm test ZoomToolbar`
Expected: 6/6 pass.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: 56/56 pass (50 + 6).

- [ ] **Step 7: Commit**

```bash
git add src/components/ZoomToolbar.tsx src/components/ZoomToolbar.test.tsx src/styles/global.css
git commit -m "feat(ui): ZoomToolbar 缩放控制条 +/- 数字 复位"
```

---

## Task 3: PreviewCanvas — Apply Zoom/Pan + Drag

**Files:**
- Modify: `src/components/PreviewCanvas.tsx`
- Create: `src/components/PreviewCanvas.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/PreviewCanvas.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import type { Palette, PipelineResult } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 0, 255], name: '蓝' },
];

const result: PipelineResult = {
  indices: new Uint8Array([0, 1, 1, 0]),
  gridSize: 2,
  token: 1,
};

describe('PreviewCanvas', () => {
  beforeEach(() => {
    // ensure fresh canvas per test
    document.body.innerHTML = '';
  });

  it('zoom=1: skips ctx.translate and ctx.scale', () => {
    const ref = vi.fn();
    const onPan = vi.fn();
    const { container } = render(
      <PreviewCanvas
        result={result}
        palette={palette}
        cellPx={24}
        zoom={1}
        panX={0}
        panY={0}
        onPan={onPan}
        isRecomputing={false}
      />
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as any;
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('zoom=2: calls ctx.scale(2, 2)', () => {
    const onPan = vi.fn();
    const { container } = render(
      <PreviewCanvas
        result={result}
        palette={palette}
        cellPx={24}
        zoom={2}
        panX={0}
        panY={0}
        onPan={onPan}
        isRecomputing={false}
      />
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as any;
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });

  it('pan=(10,20): calls ctx.translate(10, 20)', () => {
    const onPan = vi.fn();
    const { container } = render(
      <PreviewCanvas
        result={result}
        palette={palette}
        cellPx={24}
        zoom={2}
        panX={10}
        panY={20}
        onPan={onPan}
        isRecomputing={false}
      />
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as any;
    expect(ctx.translate).toHaveBeenCalledWith(10, 20);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });

  it('zoom=1: drag does NOT call onPan', () => {
    const onPan = vi.fn();
    const { container } = render(
      <PreviewCanvas
        result={result}
        palette={palette}
        cellPx={24}
        zoom={1}
        panX={0}
        panY={0}
        onPan={onPan}
        isRecomputing={false}
      />
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 110 });
    fireEvent.mouseUp(canvas);
    expect(onPan).not.toHaveBeenCalled();
  });

  it('zoom>1: drag mousedown→mousemove→mouseup calls onPan with delta', () => {
    const onPan = vi.fn();
    const { container } = render(
      <PreviewCanvas
        result={result}
        palette={palette}
        cellPx={24}
        zoom={2}
        panX={50}
        panY={50}
        onPan={onPan}
        isRecomputing={false}
      />
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 110 });
    expect(onPan).toHaveBeenLastCalledWith(80, 60);
    fireEvent.mouseUp(canvas);
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    expect(onPan).toHaveBeenCalledTimes(1);  // mouseUp ended drag
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test PreviewCanvas`
Expected: FAIL (module not found, OR tests fail because context methods aren't spied).

- [ ] **Step 3: Implement `src/components/PreviewCanvas.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import type { Palette, PipelineResult } from '@/types';
import { renderPaletteImage } from '@/pipeline/renderer';

interface Props {
  result: PipelineResult | null;
  palette: Palette;
  cellPx: number;
  zoom: number;
  panX: number;
  panY: number;
  onPan: (x: number, y: number) => void;
  isRecomputing: boolean;
}

export function PreviewCanvas({ result, palette, cellPx, zoom, panX, panY, onPan, isRecomputing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => {
    if (!result || !ref.current) return;
    const c = renderPaletteImage(result.indices, result.gridSize, palette, cellPx, '#ddd');
    const ctx = ref.current.getContext('2d')!;
    ref.current.width = c.width;
    ref.current.height = c.height;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, c.width, c.height);

    if (zoom !== 1 || panX !== 0 || panY !== 0) {
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);
      ctx.drawImage(c, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(c, 0, 0);
    }
  }, [result, palette, cellPx, zoom, panX, panY]);

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (zoom === 1) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: panX,
      baseY: panY,
    };
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    onPan(dragRef.current.baseX + dx, dragRef.current.baseY + dy);
  };

  const onMouseUp = () => {
    dragRef.current = null;
  };

  const cursor = zoom === 1 ? 'default' : 'grab';

  return (
    <div className="preview-wrap">
      <div className={isRecomputing ? 'preview-scroll dim' : 'preview-scroll'}>
        <canvas
          ref={ref}
          className="preview"
          style={{ cursor }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
      </div>
      {isRecomputing && <div className="overlay">计算中...</div>}
    </div>
  );
}
```

- [ ] **Step 4: Update preview CSS for aspect-ratio**

Find and update `.preview-wrap` in `src/styles/global.css`:

Replace:
```css
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
```

With:
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
  aspect-ratio: 1 / 1;
}
.preview-scroll {
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  background: var(--color-surface-alt);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}
.preview { display: block; max-width: 100%; height: auto; }
```

- [ ] **Step 5: Run tests, verify passing**

Run: `npm test PreviewCanvas`
Expected: 5/5 pass.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: 61/61 pass (56 + 5).

- [ ] **Step 7: Commit**

```bash
git add src/components/PreviewCanvas.tsx src/components/PreviewCanvas.test.tsx src/styles/global.css
git commit -m "feat(ui): PreviewCanvas 应用 ctx.translate/scale 缩放平移 + 拖动"
```

---

## Task 4: App.tsx — Wire useZoomPan + Reset on Param/Upload Change

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace `src/App.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { usePalette } from '@/hooks/usePalette';
import { usePipeline } from '@/hooks/usePipeline';
import { useZoomPan } from '@/hooks/useZoomPan';
import { UploadZone } from '@/components/UploadZone';
import { ParamPanel } from '@/components/ParamPanel';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import { ColorLegend } from '@/components/ColorLegend';
import { ExportPanel } from '@/components/ExportPanel';
import { ZoomToolbar } from '@/components/ZoomToolbar';
import { computeLegend } from '@/pipeline/legend';

const PREVIEW_CELL_PX = 24;

export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, reprocess, exportComposite } = usePipeline(palette);
  const { zoom, panX, panY, setZoom, setPan, zoomIn, zoomOut, reset: resetZoom } = useZoomPan();
  const [gridSize, setGridSize] = useState(100);
  const [enableDither, setEnableDither] = useState(false);
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
      await exportComposite();
    } finally {
      setExporting(false);
    }
  };

  const onUpload = (data: ImageData) => {
    resetZoom();
    process(data, { gridSize, enableDither });
  };

  const onGridSizeChange = (n: number) => {
    setGridSize(n);
    resetZoom();
    reprocess({ gridSize: n, enableDither });
  };

  const onDitherChange = (b: boolean) => {
    setEnableDither(b);
    resetZoom();
    reprocess({ gridSize, enableDither: b });
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
          <UploadZone onLoad={onUpload} />
          <ParamPanel
            gridSize={gridSize}
            onGridSizeChange={onGridSizeChange}
            enableDither={enableDither}
            onDitherChange={onDitherChange}
            disabled={status === 'idle' || status === 'loading'}
          />
          <ExportPanel
            disabled={!result || exporting}
            onExport={handleExport}
          />
        </aside>

        <section className="middle">
          <div className="preview-container">
            <PreviewCanvas
              result={result}
              palette={palette}
              cellPx={PREVIEW_CELL_PX}
              zoom={zoom}
              panX={panX}
              panY={panY}
              onPan={setPan}
              isRecomputing={status === 'recomputing'}
            />
            <ZoomToolbar
              zoom={zoom}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onReset={resetZoom}
              onZoomChange={setZoom}
              disabled={!result}
            />
          </div>
        </section>

        <aside className="right">
          <ColorLegend legend={legend} />
        </aside>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for `.preview-container`**

Append to `src/styles/global.css`:

```css
.preview-container {
  position: relative;
  width: 100%;
}
```

- [ ] **Step 3: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: 0 errors; 61/61 still pass.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/styles/global.css
git commit -m "feat(ui): App 接入 useZoomPan + 切换参数重置缩放"
```

---

## Task 5: Responsive CSS — 1400px Breakpoint + Layout Adjustments

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Update `.layout-3col` CSS**

Find the existing `.layout-3col` block in `src/styles/global.css`:

```css
.layout-3col {
  display: grid;
  grid-template-columns: var(--left-col-w) 1fr var(--right-col-w);
  gap: var(--space-4);
  margin-top: var(--space-5);
}
@media (max-width: 1024px) {
  .layout-3col { grid-template-columns: 1fr; }
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
@media (max-width: 1024px) {
  .layout-3col { grid-template-columns: 1fr; }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: 0 errors; dist generated.

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "style: 加 1400px 中间断点；调整 layout-3col 列宽"
```

---

## Task 6: Playwright E2E — Add Zoom Tests

**Files:**
- Modify: `tests/e2e/flow.spec.ts`

- [ ] **Step 1: Append zoom-related E2E tests**

Read current `tests/e2e/flow.spec.ts` and append after the existing tests (before the closing `});`):

```ts
  test('点击 + 按钮缩放，toolbar 数字同步更新', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    const zoomInput = page.locator('.zoom-toolbar input[type=number]');
    await expect(zoomInput).toHaveValue('1');

    await page.locator('[data-testid="zoom-in"]').click();
    await expect(zoomInput).toHaveValue('1.5');

    await page.locator('[data-testid="zoom-in"]').click();
    await expect(zoomInput).toHaveValue('2');
  });

  test('点击复位按钮回到 1x', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="zoom-in"]').click();
    await page.locator('[data-testid="zoom-in"]').click();
    const zoomInput = page.locator('.zoom-toolbar input[type=number]');
    await expect(zoomInput).not.toHaveValue('1');

    await page.locator('[data-testid="zoom-reset"]').click();
    await expect(zoomInput).toHaveValue('1');
  });
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/flow.spec.ts
git commit -m "test(e2e): 缩放控制条 + 复位 用例"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run full unit suite**

Run: `npm test`
Expected: 61/61 pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: dist/ generated; total < 200KB gzipped.

- [ ] **Step 4: Manual dev-server smoke test**

Run: `npm run dev` (background); visit http://localhost:5173; verify:
- Page loads, header visible
- Upload a sample image
- Preview shows at 1x
- Click + → preview zooms in, toolbar shows 1.5x
- Drag canvas (when zoomed in) → image follows cursor
- Click reset → back to 1x, image at origin
- Resize browser to 800px wide → layout becomes single column
- Resize back to 1280px → three columns
- Click "导出合成图" → PNG downloads; opened file shows bead image left + legend right (unchanged by zoom)

Stop server with Ctrl+C after verifying.

- [ ] **Step 5: Git log review**

Run: `git log --oneline | head -8`
Expected: 6 new commits since `2561a25` (the spec commit):
- `feat(hooks): useZoomPan 缩放/平移状态 hook`
- `feat(ui): ZoomToolbar 缩放控制条 +/- 数字 复位`
- `feat(ui): PreviewCanvas 应用 ctx.translate/scale 缩放平移 + 拖动`
- `feat(ui): App 接入 useZoomPan + 切换参数重置缩放`
- `style: 加 1400px 中间断点；调整 layout-3col 列宽`
- `test(e2e): 缩放控制条 + 复位 用例`

- [ ] **Step 6: Final commit if any uncommitted changes**

```bash
git status
# If clean, nothing to do.
```

---

## Self-Review

After writing this plan I checked against the spec:

**1. Spec coverage:**
- RP-1 (preview canvas自适应容器) → Task 3 Step 4 changes `.preview-wrap` to `width: 100%; aspect-ratio: 1/1`
- RP-2 (1024px 以下堆叠) → Task 5 adds/keeps `@media (max-width: 1024px)`
- RP-3 (ZoomToolbar +/- / 数字 / 复位) → Task 2 builds toolbar; data-testid attributes used for E2E
- RP-4 (拖动平移) → Task 3 Step 3 implements mouse events on canvas
- RP-5 (缩放后色号锐利) → Task 3 Step 3 uses `ctx.translate + ctx.scale` (GPU-accelerated, no bitmap resampling)
- RP-6 (切换参数时重置) → Task 4 wires `resetZoom()` into `onUpload`, `onGridSizeChange`, `onDitherChange`
- RP-7 (导出图不受影响) → composite.ts and pipeline unchanged; spec §6.1 explicitly notes unchanged

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later". Every step has full code or exact commands. Test code is complete for each test.

**3. Type consistency:**
- `useZoomPan` returns `{ zoom, panX, panY, setZoom, setPan, zoomIn, zoomOut, reset }` in Task 1 → used identically in Task 4 (App.tsx) and Task 3 (PreviewCanvas receives zoom/panX/panY/onPan props)
- `ZoomToolbar` props `{ zoom, onZoomIn, onZoomOut, onReset, onZoomChange, disabled }` match App.tsx wiring in Task 4
- `data-testid` attributes added in Task 2 (`zoom-in`, `zoom-out`, `zoom-reset`) used by E2E tests in Task 6

**4. Edge cases / gaps fixed during self-review:**
- Task 3 PreviewCanvas adds `onMouseLeave={onMouseUp}` to end drag if mouse leaves canvas mid-drag (prevents "stuck drag" bug)
- Task 2 ZoomToolbar syncs input value to zoom prop via `useEffect` so external `reset()` properly clears the input field
- Task 4 wraps `resetZoom()` into `onUpload` (not just param changes) — when user uploads new image, zoom should reset too (covered by spec §3.2 edge case)
- Task 5 adds 1400px breakpoint (new), keeps existing 1024px (refactor verified)

**5. Test count progression:**
- Before this plan: 45 tests
- After Task 1: 50 (+5 useZoomPan)
- After Task 2: 56 (+6 ZoomToolbar)
- After Task 3: 61 (+5 PreviewCanvas)
- Final: 61 unit tests + 2 new E2E tests

Plan is ready for execution.