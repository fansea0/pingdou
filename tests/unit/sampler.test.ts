import { describe, it, expect } from 'vitest';
import { sampleImage } from '@/pipeline/sampler';

function makeImageData(w: number, h: number, fill: [number, number, number, number]): ImageData {
  const arr = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] = fill[0]; arr[i + 1] = fill[1]; arr[i + 2] = fill[2]; arr[i + 3] = fill[3];
  }
  return new ImageData(arr, w, h);
}

describe('sampleImage', () => {
  it('downsamples 4x4 to 2x2 averaging', () => {
    const src = makeImageData(4, 4, [200, 100, 50, 255]);
    const out = sampleImage(src, 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data[0]).toBe(200);
    expect(out.data[1]).toBe(100);
  });

  it('uses gridSize as the longest edge for a landscape image', () => {
    const src = makeImageData(200, 100, [128, 128, 128, 255]);
    const out = sampleImage(src, 50);
    expect(out.width).toBe(50);
    expect(out.height).toBe(25);
  });

  it('uses gridSize as the longest edge for a portrait image', () => {
    const src = makeImageData(100, 200, [128, 128, 128, 255]);
    const out = sampleImage(src, 50);
    expect(out.width).toBe(25);
    expect(out.height).toBe(50);
  });

  it('uses box-average (not nearest)', () => {
    const src = makeImageData(2, 2, [0, 0, 0, 255]);
    src.data[0] = 100;
    const out = sampleImage(src, 1);
    expect(out.data[0]).toBe(25);
  });
});
