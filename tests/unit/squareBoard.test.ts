import { describe, expect, it } from 'vitest';
import { renderSquareBoard } from '@/pipeline/squareBoard';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
];

describe('renderSquareBoard', () => {
  it('centers a rectangular board on a transparent square canvas', () => {
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

    const ctx = canvas.getContext('2d')!;
    for (const [x, y] of [[0, 0], [95, 0], [0, 95], [95, 95]]) {
      expect([...ctx.getImageData(x, y, 1, 1).data]).toEqual([51, 51, 51, 255]);
    }
    expect(ctx.getImageData(10, 10, 1, 1).data[3]).toBe(0);
    expect(ctx.getImageData(25, 37, 1, 1).data[3]).toBe(255);
  });

  it('rejects a board smaller than the sampled grid', () => {
    expect(() => renderSquareBoard(new Uint8Array([0, 0]), 2, 1, palette, 1, 24, 10, null))
      .toThrow(RangeError);
  });
});
