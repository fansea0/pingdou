import { describe, it, expect } from 'vitest';
import { floydSteinbergDither } from '@/pipeline/ditherer';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [0, 0, 0], name: '黑' },
  { id: 'A02', rgb: [255, 255, 255], name: '白' },
];

function img(w: number, h: number, gray: number): ImageData {
  const arr = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] = arr[i + 1] = arr[i + 2] = gray;
    arr[i + 3] = 255;
  }
  return new ImageData(arr, w, h);
}

describe('floydSteinbergDither', () => {
  it('returns index matrix of correct size', () => {
    const src = img(4, 4, 128);
    const indices = floydSteinbergDither(src, palette);
    expect(indices.length).toBe(16);
  });

  it('all values are valid palette indices', () => {
    const src = img(8, 8, 64);
    const indices = floydSteinbergDither(src, palette);
    for (const v of indices) {
      expect([0, 1]).toContain(v);
    }
  });

  it('shifts midpoint gray into a mix of black and white', () => {
    const src = img(10, 10, 128);
    const indices = floydSteinbergDither(src, palette);
    const blacks = Array.from(indices).filter(v => v === 0).length;
    const whites = Array.from(indices).filter(v => v === 1).length;
    expect(blacks).toBeGreaterThan(0);
    expect(whites).toBeGreaterThan(0);
  });

  it('pure black image → all zero index', () => {
    const src = img(4, 4, 0);
    const indices = floydSteinbergDither(src, palette);
    expect(Array.from(indices).every(v => v === 0)).toBe(true);
  });
});