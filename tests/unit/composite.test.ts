import { describe, it, expect } from 'vitest';
import { renderComposite, DEFAULT_COMPOSITE_OPTIONS } from '@/pipeline/composite';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 255, 0], name: '绿' },
  { id: 'A03', rgb: [0, 0, 255], name: '蓝' },
];

describe('renderComposite', () => {
  it('canvas dimensions match layout formula', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadW = 3 * 32;
    const beadH = 3 * 32;
    const legendRows = 1 + 3 + 1;
    const legendW = opts.legendColWidth + 100 + 100 + 80 + opts.legendPadding * 2;
    const expectedW = Math.max(beadW, legendW);
    const expectedH = beadH + opts.cellGap + legendRows * opts.legendRowHeight + opts.legendPadding * 2;
    expect(canvas.width).toBe(expectedW);
    expect(canvas.height).toBe(expectedH);
  });

  it('renders bead image in top half (sample pixel at center of cell)', () => {
    const indices = new Uint8Array(9);
    indices.set([0, 0, 1, 1, 2, 2], 0);
    const canvas = renderComposite(indices, 3, palette, { cellPx: 32, cellGap: 40, legendRowHeight: 36, legendColWidth: 60, legendPadding: 16 });
    const ctx = canvas.getContext('2d')!;
    const beadX = Math.floor((canvas.width - 3 * 32) / 2);
    const px = ctx.getImageData(beadX + 16, 16, 1, 1).data;
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
  });

  it('renders legend in bottom half with non-white content', () => {
    const indices = new Uint8Array(25);
    indices.set([0, 0, 0, 1, 2], 0);
    const canvas = renderComposite(indices, 5, palette, { cellPx: 24, cellGap: 8, legendRowHeight: 20, legendColWidth: 30, legendPadding: 8 });
    const ctx = canvas.getContext('2d')!;
    const beadH = 5 * 24;
    const legendTop = beadH + 8 + 8;
    const legendBottom = canvas.height - 8;
    let nonWhite = 0;
    for (let y = legendTop; y < legendBottom; y += 5) {
      for (let x = 0; x < canvas.width; x += 5) {
        const px = ctx.getImageData(x, y, 1, 1).data;
        if (px[0] !== 255 || px[1] !== 255 || px[2] !== 255) nonWhite++;
      }
    }
    expect(nonWhite).toBeGreaterThan(50);
  });
});
