import { describe, it, expect } from 'vitest';
import { renderComposite, DEFAULT_COMPOSITE_OPTIONS } from '@/pipeline/composite';
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
  it('canvas width = beadW + cellGap + legendW', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadW = 3 * 32;
    const legendW = opts.legendColWidth + 100 + 100 + 80 + opts.legendPadding * 2;
    const expectedW = beadW + opts.cellGap + legendW;
    expect(canvas.width).toBe(expectedW);
  });

  it('canvas height = max(beadH, legendH)', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadH = 3 * 32;
    const legendRows = 1 + 3 + 1;
    const legendH = legendRows * opts.legendRowHeight + opts.legendPadding * 2;
    expect(canvas.height).toBe(Math.max(beadH, legendH));
  });

  it('bead image appears in left half of canvas', () => {
    const indices = new Uint8Array(9);
    indices.fill(0);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32 });
    const ctx = canvas.getContext('2d')!;
    const beadW = 3 * 32;
    const leftReds = countRedPixels(ctx, 0, 0, beadW, canvas.height);
    const rightReds = countRedPixels(ctx, beadW, 0, canvas.width, canvas.height);
    expect(leftReds).toBeGreaterThan(rightReds * 5);
  });

  it('legend swatch appears in right half of canvas', () => {
    const indices = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32 });
    const ctx = canvas.getContext('2d')!;
    const beadW = 3 * 32;
    const rightReds = countRedPixels(ctx, beadW, 0, canvas.width, canvas.height);
    expect(rightReds).toBeGreaterThan(100);
  });

  it('bead image is vertically centered when shorter than legend', () => {
    // Use a wide canvas so bead is centered but legend is taller.
    // Verify by checking bead top distance from canvas top == bead bottom distance to canvas bottom.
    const indices = new Uint8Array([0, 1, 0, 1]);
    const canvas = renderComposite(indices, 2, palette, { cellPx: 32, legendRowHeight: 60, cellGap: 40 });
    const ctx = canvas.getContext('2d')!;
    const canvasH = canvas.height;
    // Find first non-white row from top (in bead column area, x=16)
    let firstBeadRow = -1;
    for (let y = 0; y < canvasH; y++) {
      const px = ctx.getImageData(16, y, 1, 1).data;
      if (px[0] === 255 && px[1] === 0 && px[2] === 0 && px[3] === 255) {
        firstBeadRow = y;
        break;
      }
    }
    // Find last non-white row from bottom (in bead column area)
    let lastBeadRow = -1;
    for (let y = canvasH - 1; y >= 0; y--) {
      const px = ctx.getImageData(16, y, 1, 1).data;
      if (px[0] === 255 && px[1] === 0 && px[2] === 0 && px[3] === 255) {
        lastBeadRow = y;
        break;
      }
    }
    expect(firstBeadRow).toBeGreaterThanOrEqual(0);
    expect(lastBeadRow).toBeGreaterThan(firstBeadRow);
    const topPad = firstBeadRow;
    const bottomPad = canvasH - 1 - lastBeadRow;
    // For exact centering, difference should be at most 1 (due to floor())
    expect(Math.abs(topPad - bottomPad)).toBeLessThanOrEqual(1);
  });
});