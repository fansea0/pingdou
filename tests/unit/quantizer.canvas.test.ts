import { describe, it, expect } from 'vitest';
import { quantizeWithCanvas2D } from '@/pipeline/quantizer.canvas';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [0, 0, 0], name: '黑' },
  { id: 'A02', rgb: [255, 0, 0], name: '红' },
  { id: 'A03', rgb: [0, 255, 0], name: '绿' },
];

function img(w: number, h: number, rgb: [number, number, number]): ImageData {
  const arr = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] = rgb[0]; arr[i + 1] = rgb[1]; arr[i + 2] = rgb[2]; arr[i + 3] = 255;
  }
  return new ImageData(arr, w, h);
}

describe('quantizeWithCanvas2D', () => {
  it('returns indices of length w*h', () => {
    const src = img(10, 10, [10, 10, 10]);
    const idx = quantizeWithCanvas2D(src, palette);
    expect(idx.length).toBe(100);
  });

  it('exact red maps to A02 (red)', () => {
    const src = img(2, 2, [255, 0, 0]);
    const idx = quantizeWithCanvas2D(src, palette);
    for (const v of idx) expect(v).toBe(1);
  });

  it('exact green maps to A03 (green)', () => {
    const src = img(2, 2, [0, 255, 0]);
    const idx = quantizeWithCanvas2D(src, palette);
    for (const v of idx) expect(v).toBe(2);
  });

  // Mid-gray (128,128,128) is NOT nearest to pure black in a 3-color palette —
  // it's equidistant from red and green. This test verifies the algorithm
  // correctly picks a non-black color in that tie scenario.
  it('mid gray maps to nearest (red or green in 3-color palette)', () => {
    const src = img(1, 1, [128, 128, 128]);
    const idx = quantizeWithCanvas2D(src, palette);
    // red [255,0,0] and green [0,255,0] tie at d²=48897, both nearer than black at 49152
    expect([1, 2]).toContain(idx[0]);
  });
});