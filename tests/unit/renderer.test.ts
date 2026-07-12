import { describe, it, expect } from 'vitest';
import { renderPaletteImage } from '@/pipeline/renderer';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 0, 255], name: '蓝' },
];

describe('renderPaletteImage', () => {
  it('produces canvas of correct dimensions (square)', () => {
    const indices = new Uint8Array([0, 1, 1, 0]);
    const canvas = renderPaletteImage(indices, 2, 2, palette, 16);
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(32);
  });

  it('produces canvas of correct dimensions (non-square)', () => {
    const indices = new Uint8Array(6 * 4);
    indices.fill(0);
    const canvas = renderPaletteImage(indices, 6, 4, palette, 32);
    expect(canvas.width).toBe(6 * 32);
    expect(canvas.height).toBe(4 * 32);
  });

  it('uses palette colors', () => {
    const indices = new Uint8Array([0]);
    const canvas = renderPaletteImage(indices, 1, 1, palette, 8);
    const ctx = canvas.getContext('2d')!;
    const px = ctx.getImageData(4, 4, 1, 1).data;
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
  });

  it('renders each cell distinctly', () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    const canvas = renderPaletteImage(indices, 2, 2, palette, 16);
    const ctx = canvas.getContext('2d')!;
    const left = ctx.getImageData(4, 4, 1, 1).data;
    const right = ctx.getImageData(20, 4, 1, 1).data;
    expect([left[0], left[2]]).toEqual([255, 0]);
    expect([right[0], right[2]]).toEqual([0, 255]);
  });
});