import { describe, it, expect } from 'vitest';
import {
  buildBackgroundMask,
  detectBackground,
  DEFAULT_TOLERANCE,
} from '@/pipeline/bgRemover';
import type { BackgroundMask } from '@/types';

function makeImageData(
  w: number,
  h: number,
  fill: [number, number, number, number]
): ImageData {
  const arr = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] = fill[0];
    arr[i + 1] = fill[1];
    arr[i + 2] = fill[2];
    arr[i + 3] = fill[3];
  }
  return new ImageData(arr, w, h);
}

function maskCount(m: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) n++;
  return n;
}

describe('detectBackground', () => {
  it('detects solid color background from a uniform image', () => {
    const img = makeImageData(20, 20, [255, 255, 255, 255]);
    const r = detectBackground(img);
    expect(r).not.toBeNull();
    expect(r?.bg).toEqual([255, 255, 255]);
  });

  it('detects colored solid background (red corners)', () => {
    const arr = new Uint8ClampedArray(20 * 20 * 4);
    for (let i = 0; i < arr.length; i += 4) {
      arr[i] = 200;
      arr[i + 1] = 50;
      arr[i + 2] = 60;
      arr[i + 3] = 255;
    }
    const img = new ImageData(arr, 20, 20);
    const r = detectBackground(img);
    expect(r?.bg).toEqual([200, 50, 60]);
  });

  it('returns null when corners vary wildly (no clear background)', () => {
    const arr = new Uint8ClampedArray(20 * 20 * 4);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const i = (y * 20 + x) * 4;
        arr[i] = (x * 12) % 256;
        arr[i + 1] = (y * 12) % 256;
        arr[i + 2] = ((x + y) * 5) % 256;
        arr[i + 3] = 255;
      }
    }
    const img = new ImageData(arr, 20, 20);
    expect(detectBackground(img)).toBeNull();
  });

  it('detects background even on tiny images (clamped patch)', () => {
    const img = makeImageData(2, 2, [128, 128, 128, 255]);
    const r = detectBackground(img);
    expect(r?.bg).toEqual([128, 128, 128]);
  });
});

describe('buildBackgroundMask', () => {
  it('marks all cells matching background color', () => {
    const arr = new Uint8ClampedArray(5 * 4);
    arr[0] = 255; arr[1] = 255; arr[2] = 255;
    arr[4] = 200; arr[5] = 50; arr[6] = 50;
    arr[8] = 255; arr[9] = 255; arr[10] = 255;
    arr[12] = 255; arr[13] = 250; arr[14] = 250;
    arr[16] = 255; arr[17] = 255; arr[18] = 255;
    const img = new ImageData(arr, 1, 5);
    const { mask, bgCount } = buildBackgroundMask(img, [255, 255, 255]);
    const expected: BackgroundMask = new Uint8Array([1, 0, 1, 1, 1]);
    expect(Array.from(mask)).toEqual(Array.from(expected));
    expect(bgCount).toBe(4);
  });

  it('tolerance controls inclusion radius', () => {
    const arr = new Uint8ClampedArray([200, 200, 200, 255]); // dist^2= (55^2)*3=9075
    const img = new ImageData(arr, 1, 1);
    const narrow = buildBackgroundMask(img, [255, 255, 255], 30); // 30^2=900
    expect(narrow.bgCount).toBe(0);
    const wide = buildBackgroundMask(img, [255, 255, 255], 100); // 100^2=10000
    expect(wide.bgCount).toBe(1);
  });

  it('DEFAULT_TOLERANCE is exported and positive', () => {
    expect(DEFAULT_TOLERANCE).toBeGreaterThan(0);
  });

  it('empty grid yields empty mask', () => {
    const img = new ImageData(new Uint8ClampedArray(0), 0, 0);
    const { mask, bgCount } = buildBackgroundMask(img, [0, 0, 0]);
    expect(mask.length).toBe(0);
    expect(bgCount).toBe(0);
    expect(maskCount(mask)).toBe(0);
  });
});

describe('detectBackground + buildBackgroundMask integration', () => {
  it('detects bg then masks only that colour on a sampled grid', () => {
    const src = makeImageData(50, 50, [255, 255, 255, 255]);
    const detected = detectBackground(src);
    expect(detected).not.toBeNull();
    const sampled = makeImageData(10, 10, [255, 255, 255, 255]);
    const { mask, bgCount } = buildBackgroundMask(sampled, detected!.bg);
    expect(maskCount(mask)).toBe(100);
    expect(bgCount).toBe(100);
  });

  it('returns no mask when source is not a solid-bg image', () => {
    const arr = new Uint8ClampedArray(20 * 20 * 4);
    for (let i = 0; i < arr.length; i += 4) {
      arr[i] = (i / 4) % 256;
      arr[i + 1] = (i / 2) % 256;
      arr[i + 2] = (i * 3) % 256;
      arr[i + 3] = 255;
    }
    const img = new ImageData(arr, 20, 20);
    expect(detectBackground(img)).toBeNull();
  });
});
