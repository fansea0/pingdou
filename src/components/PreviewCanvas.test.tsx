import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PreviewCanvas, drawBeadCanvas } from '@/components/PreviewCanvas';
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

describe('drawBeadCanvas (pure)', () => {
  it('zoom=1, pan=(0,0): does not call save/restore/translate/scale', () => {
    const ctx = {
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const source = { width: 100, height: 100 } as HTMLCanvasElement;
    drawBeadCanvas(ctx, source, 1, 0, 0);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.translate).not.toHaveBeenCalled();
    expect(ctx.scale).not.toHaveBeenCalled();
  });

  it('zoom=2: calls scale(2, 2) and save/restore', () => {
    const ctx = {
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const source = { width: 100, height: 100 } as HTMLCanvasElement;
    drawBeadCanvas(ctx, source, 2, 0, 0);
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
    expect(ctx.restore).toHaveBeenCalledOnce();
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0);
  });

  it('pan=(10, 20): calls translate(10, 20)', () => {
    const ctx = {
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const source = { width: 100, height: 100 } as HTMLCanvasElement;
    drawBeadCanvas(ctx, source, 2, 10, 20);
    expect(ctx.translate).toHaveBeenCalledWith(10, 20);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });
});

describe('PreviewCanvas (component, drag)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
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
    expect(onPan).toHaveBeenCalledTimes(1);
  });
});