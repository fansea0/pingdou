import { describe, it, expect } from 'vitest';
import { renderAnnotatedImage } from '@/pipeline/annotator';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 0, 255], name: '蓝' },
];

describe('renderAnnotatedImage', () => {
  it('canvas dimensions match cellPx * outW/outH', () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    const canvas = renderAnnotatedImage(indices, 2, 2, palette, 24, 10);
    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(48);
  });

  it('canvas dimensions for non-square grids', () => {
    const indices = new Uint8Array(6 * 4);
    indices.fill(0);
    const canvas = renderAnnotatedImage(indices, 6, 4, palette, 24, 10);
    expect(canvas.width).toBe(144);
    expect(canvas.height).toBe(96);
  });

  it('reports font size for cell threshold', () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    expect(() => renderAnnotatedImage(indices, 2, 2, palette, 16, 8))
      .toThrow(/cell/);
  });
});