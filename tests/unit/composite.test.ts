import { describe, it, expect } from 'vitest';
import {
  renderComposite,
  renderCompositeFromBoard,
  DEFAULT_COMPOSITE_OPTIONS,
} from '@/pipeline/composite';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 255, 0], name: '绿' },
  { id: 'A03', rgb: [0, 0, 255], name: '蓝' },
];

function countRedPixels(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number
): number {
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = ctx.getImageData(x, y, 1, 1).data;
      if (px[0] === 255 && px[1] === 0 && px[2] === 0 && px[3] === 255) n++;
    }
  }
  return n;
}

describe('renderComposite', () => {
  it('places an existing board left of the default legend', () => {
    const boardCanvas = document.createElement('canvas');
    boardCanvas.width = 128;
    boardCanvas.height = 128;
    const boardCtx = boardCanvas.getContext('2d')!;
    boardCtx.fillStyle = 'rgb(255,0,0)';
    boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    const indices = new Uint8Array([0]);

    const canvas = renderCompositeFromBoard(boardCanvas, indices, palette, null);
    const ctx = canvas.getContext('2d')!;
    const boardTop = Math.floor((canvas.height - boardCanvas.height) / 2);

    expect(canvas.width).toBe(
      boardCanvas.width + DEFAULT_COMPOSITE_OPTIONS.cellGap + 372
    );
    expect(canvas.height).toBeGreaterThanOrEqual(boardCanvas.height);
    expect(Array.from(ctx.getImageData(8, boardTop + 8, 1, 1).data.slice(0, 3))).toEqual([
      255,
      0,
      0,
    ]);
  });

  it('canvas width = beadW + cellGap + legendW', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, 3, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadW = 3 * 32;
    const legendW = opts.legendColWidth + 100 + 100 + 80 + opts.legendPadding * 2;
    const expectedW = beadW + opts.cellGap + legendW;
    expect(canvas.width).toBe(expectedW);
  });

  it('canvas height = max(beadH, legendH)', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, 3, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadH = 3 * 32;
    // indices uses all 3 colors → legendRows = 1 (header) + 3 (data) + 1 (total) = 5
    const legendRows = 5;
    const legendH = legendRows * opts.legendRowHeight + opts.legendPadding * 2;
    expect(canvas.height).toBe(Math.max(beadH, legendH));
  });

  it('non-square (6x4): canvas preserves rectangle', () => {
    const indices = new Uint8Array(24);
    indices.fill(0);
    const canvas = renderComposite(indices, 6, 4, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadW = 6 * 32;
    const beadH = 4 * 32;
    // Only 1 color used (all 0) → legendRows = 3
    const legendRows = 3;
    const legendH = legendRows * opts.legendRowHeight + opts.legendPadding * 2;
    const legendW = opts.legendColWidth + 100 + 100 + 80 + opts.legendPadding * 2;
    expect(canvas.width).toBe(beadW + opts.cellGap + legendW);
    expect(canvas.height).toBe(Math.max(beadH, legendH));
  });

  it('bead image appears in left half of canvas (non-square)', () => {
    const indices = new Uint8Array(24);
    indices.fill(0);
    const canvas = renderComposite(indices, 6, 4, palette, { cellPx: 32 });
    const ctx = canvas.getContext('2d')!;
    const beadW = 6 * 32;
    const leftReds = countRedPixels(ctx, 0, 0, beadW, canvas.height);
    const rightReds = countRedPixels(ctx, beadW, 0, canvas.width, canvas.height);
    expect(leftReds).toBeGreaterThan(rightReds * 3);
  });

  it('legend swatch appears in right half (non-square, only red used)', () => {
    const indices = new Uint8Array(24);
    indices.fill(0);
    const canvas = renderComposite(indices, 6, 4, palette, { cellPx: 32 });
    const ctx = canvas.getContext('2d')!;
    const beadW = 6 * 32;
    const rightReds = countRedPixels(ctx, beadW, 0, canvas.width, canvas.height);
    expect(rightReds).toBeGreaterThan(100);
  });

  it('preserves non-square aspect ratio (no cropping)', () => {
    // 80 wide × 45 tall → 16:9
    const indices = new Uint8Array(80 * 45);
    indices.fill(0);
    const canvas = renderComposite(indices, 80, 45, palette, { cellPx: 32 });
    const ctx = canvas.getContext('2d')!;
    const beadW = 80 * 32; // 2560
    const beadH = 45 * 32; // 1440
    const tl = ctx.getImageData(16, 16, 1, 1).data;
    expect([tl[0], tl[1], tl[2]]).toEqual([255, 0, 0]);
    const right = ctx.getImageData(beadW - 16, 16, 1, 1).data;
    expect([right[0], right[1], right[2]]).toEqual([255, 0, 0]);
    const bottom = ctx.getImageData(16, beadH - 16, 1, 1).data;
    expect([bottom[0], bottom[1], bottom[2]]).toEqual([255, 0, 0]);
  });
});
