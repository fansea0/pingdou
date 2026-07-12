import { describe, it, expect } from 'vitest';
import { renderAnnotatedImage } from '@/pipeline/annotator';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 0, 255], name: '蓝' },
];

describe('renderAnnotatedImage', () => {
  it('canvas dimensions match cellPx * gridSize', () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    const canvas = renderAnnotatedImage(indices, 2, palette, 24, 10);
    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(48);
  });

  it('reports font size for cell threshold', () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    expect(() => renderAnnotatedImage(indices, 2, palette, 16, 8))
      .toThrow(/cell/);
  });
});
