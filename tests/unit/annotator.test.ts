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
    const canvas = renderAnnotatedImage(indices, 2, 2, palette, { cellPx: 24, fontPx: 10 });
    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(48);
  });

  it('canvas dimensions for non-square grids', () => {
    const indices = new Uint8Array(6 * 4);
    indices.fill(0);
    const canvas = renderAnnotatedImage(indices, 6, 4, palette, { cellPx: 24, fontPx: 10 });
    expect(canvas.width).toBe(144);
    expect(canvas.height).toBe(96);
  });

  it('reports cell size requirement when codes are enabled', () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    expect(() =>
      renderAnnotatedImage(indices, 2, 2, palette, { cellPx: 8, fontPx: 4 })
    ).toThrow(/cell/);
  });

  it('allows tiny cells when codes are turned off', () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    expect(() =>
      renderAnnotatedImage(indices, 2, 2, palette, { cellPx: 8, fontPx: 4, showCodes: false })
    ).not.toThrow();
  });

  it('paints masked cells with the given plain background instead of a checkerboard', () => {
    const indices = new Uint8Array([0, 1]);
    const mask = new Uint8Array([0, 1]);
    const canvas = renderAnnotatedImage(indices, 2, 1, palette, {
      cellPx: 24,
      fontPx: 10,
      mask,
      backgroundStyle: 'plain',
      backgroundColor: '#ffffff',
    });
    const ctx = canvas.getContext('2d')!;
    const masked = ctx.getImageData(30, 10, 1, 1).data;
    expect([...masked]).toEqual([255, 255, 255, 255]);
  });

  it('keeps the checkerboard for masked cells in preview mode', () => {
    const indices = new Uint8Array([0, 1]);
    const mask = new Uint8Array([0, 1]);
    const canvas = renderAnnotatedImage(indices, 2, 1, palette, {
      cellPx: 24,
      fontPx: 10,
      mask,
      backgroundStyle: 'checker',
    });
    const ctx = canvas.getContext('2d')!;
    // (x + y) & 1 === 1 for the masked cell at x=1,y=0
    expect([...ctx.getImageData(30, 10, 1, 1).data]).toEqual([228, 228, 231, 255]);
  });

  it('shrinks the code font so long palette ids stay inside the cell', () => {
    const longPalette: Palette = [
      { id: 'H2853', rgb: [255, 0, 0], name: '长色号' },
      { id: 'A1', rgb: [0, 0, 255], name: '短色号' },
    ];
    const indices = new Uint8Array([0, 1]);
    const ctxFor = renderAnnotatedImage(indices, 2, 1, longPalette, {
      cellPx: 32,
      fontPx: 12,
    }).getContext('2d')!;

    ctxFor.font = '12px -apple-system, "PingFang SC", sans-serif';
    const narrow = ctxFor.measureText('A1').width;
    ctxFor.font = '12px -apple-system, "PingFang SC", sans-serif';
    const wide = ctxFor.measureText('H2853').width;
    expect(wide).toBeGreaterThan(narrow);
    // 12px 的 H2853 在 32px 格子里放不下，渲染时必须降档
    expect(wide).toBeGreaterThan(32 - 3);
  });
});