import { describe, expect, it, vi } from 'vitest';
import { renderSquareBoard } from '@/pipeline/squareBoard';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
];

describe('renderSquareBoard', () => {
  it('centers a rectangular board on a transparent square canvas', () => {
    const strokeRect = vi.fn();
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    getContextSpy.mockImplementation(
      (function (this: HTMLCanvasElement, id: string) {
        const ctx = originalGetContext.call(this, id as '2d') as CanvasRenderingContext2D | null;
        if (this.width === 96 && this.height === 96 && ctx) {
          const originalStrokeRect = ctx.strokeRect.bind(ctx);
          ctx.strokeRect = (x: number, y: number, width: number, height: number) => {
            strokeRect(x, y, width, height);
            originalStrokeRect(x, y, width, height);
          };
        }
        return ctx;
      }) as typeof HTMLCanvasElement.prototype.getContext
    );

    try {
      const canvas = renderSquareBoard(
        new Uint8Array([0, 0]),
        2,
        1,
        palette,
        4,
        24,
        10,
        null
      );

      expect(canvas.width).toBe(96);
      expect(canvas.height).toBe(96);
      expect(strokeRect).toHaveBeenCalledTimes(1);
      expect(strokeRect).toHaveBeenCalledWith(0.5, 0.5, 95, 95);

      const ctx = canvas.getContext('2d')!;
      expect([...ctx.getImageData(0, 0, 1, 1).data]).toEqual([51, 51, 51, 255]);
      expect(ctx.getImageData(10, 10, 1, 1).data[3]).toBe(0);
      expect(ctx.getImageData(25, 37, 1, 1).data[3]).toBe(255);
    } finally {
      getContextSpy.mockRestore();
    }
  });

  it('rejects a board smaller than the sampled grid', () => {
    expect(() => renderSquareBoard(new Uint8Array([0, 0]), 2, 1, palette, 1, 24, 10, null))
      .toThrow(RangeError);
  });
});
