import { describe, it, expect } from 'vitest';
import {
  buildBackgroundMask,
  detectBackground,
  DEFAULT_TOLERANCE,
  filterMaskByBorderConnectivity,
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

function detect(img: ImageData): ReturnType<typeof detectBackground> {
  // Pass the same image as both src and sampled so the tiered strategy runs
  // through every possible detection pathway.
  return detectBackground(img, img);
}

describe('detectBackground', () => {
  it('detects solid color background from a uniform image', () => {
    const img = makeImageData(20, 20, [255, 255, 255, 255]);
    const r = detect(img);
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
    const r = detect(img);
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
    expect(detect(img)).toBeNull();
  });

  it('detects background on tiny images (passes a same-sized "sampled")', () => {
    const img = makeImageData(2, 2, [128, 128, 128, 255]);
    const r = detect(img);
    expect(r?.bg).toEqual([128, 128, 128]);
  });

  it('tiered strategy prefers sampled even if src differs wildly', () => {
    // Sampled is clean (subject on white), src is noisy → detection should
    // still succeed because we run on sampled first.
    const W = 200, H = 200;
    const sampled = makeImageData(W, H, [255, 255, 255, 255]);
    for (let y = 75; y < 125; y++) {
      for (let x = 75; x < 125; x++) {
        const i = (y * W + x) * 4;
        sampled.data[i]     = 220;
        sampled.data[i + 1] = 40;
        sampled.data[i + 2] = 40;
      }
    }
    const noisySrc = makeImageData(W, H, [255, 255, 255, 255]);
    // overwrite with random noise
    for (let i = 0; i < noisySrc.data.length; i += 4) {
      noisySrc.data[i]     = (i * 7) % 256;
      noisySrc.data[i + 1] = (i * 13) % 256;
      noisySrc.data[i + 2] = (i * 19) % 256;
    }
    const r = detectBackground(noisySrc, sampled);
    expect(r?.bg).toEqual([255, 255, 255]);
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
  it('masks only background cells in a realistic cartoon (subject centered, 4-corner solid bg)', () => {
    const W = 200, H = 200;
    const arr = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inSubject = x >= 75 && x < 125 && y >= 75 && y < 125;
        arr[i]     = inSubject ? 220 : 255;
        arr[i + 1] = inSubject ? 40  : 255;
        arr[i + 2] = inSubject ? 40  : 255;
        arr[i + 3] = 255;
      }
    }
    const img = new ImageData(arr, W, H);
    const detected = detect(img);
    expect(detected).not.toBeNull();
    expect(detected?.bg).toEqual([255, 255, 255]);
    const { mask, bgCount } = buildBackgroundMask(img, detected!.bg);
    expect(bgCount).toBe(40000 - 2500);
    expect(mask[0]).toBe(1); // top-left bg
    expect(mask[100 * W + 100]).toBe(0); // inside subject
  });

  it('tolerates light JPEG-style background noise (±2)', () => {
    const W = 200, H = 200;
    const arr = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inSubject = x >= 75 && x < 125 && y >= 75 && y < 125;
        arr[i]     = inSubject ? 220 : 254 + (x * y) % 4;
        arr[i + 1] = inSubject ? 40  : 254 + (y + 1) % 4;
        arr[i + 2] = inSubject ? 40  : 254 + (x + 2) % 4;
        arr[i + 3] = 255;
      }
    }
    const img = new ImageData(arr, W, H);
    const detected = detect(img);
    expect(detected).not.toBeNull();
    expect(detected?.bg[0]).toBeGreaterThan(250);
  });

  it('REGRESSION: subject touching multiple corners → returns null (correct fail-safe)', () => {
    const W = 100, H = 100;
    const arr = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inSubject =
          (x < 60 && y < 60) ||
          (x >= 70 && y >= 70);
        arr[i]     = inSubject ? 200 : 250;
        arr[i + 1] = inSubject ? 50  : 250;
        arr[i + 2] = inSubject ? 50  : 250;
        arr[i + 3] = 255;
      }
    }
    const img = new ImageData(arr, W, H);
    expect(detect(img)).toBeNull();
  });
});

describe('filterMaskByBorderConnectivity', () => {
  it('keeps all when mask is fully 1', () => {
    const m = new Uint8Array(5 * 5).fill(1);
    const out = filterMaskByBorderConnectivity(m, 5, 5);
    expect(Array.from(out)).toEqual(Array.from(m));
  });

  it('clears interior isolated island (no border contact)', () => {
    const m = new Uint8Array(5 * 5);
    m[2 * 5 + 2] = 1;
    const out = filterMaskByBorderConnectivity(m, 5, 5);
    expect(out.every(v => v === 0)).toBe(true);
  });

  it('keeps border-connected ring, clears interior island', () => {
    const m = new Uint8Array(6 * 6);
    for (let i = 0; i < 6; i++) {
      m[i] = 1;
      m[5 * 6 + i] = 1;
      m[i * 6] = 1;
      m[i * 6 + 5] = 1;
    }
    m[3 * 6 + 3] = 1;
    const out = filterMaskByBorderConnectivity(m, 6, 6);
    expect(out[0]).toBe(1);
    expect(out[5 * 6 + 5]).toBe(1);
    expect(out[3 * 6 + 0]).toBe(1);
    expect(out[0 * 6 + 3]).toBe(1);
    expect(out[3 * 6 + 3]).toBe(0);
  });

  it('handles empty mask', () => {
    const m = new Uint8Array(0);
    const out = filterMaskByBorderConnectivity(m, 0, 0);
    expect(out.length).toBe(0);
  });

  it('handles 1×1 mask (single pixel is itself on the border)', () => {
    const m = new Uint8Array([1]);
    const out = filterMaskByBorderConnectivity(m, 1, 1);
    expect(Array.from(out)).toEqual([1]);
  });

  it('handles 1×N row: every pixel touches the degenerate column border', () => {
    // In a 1×N image the left column equals the right column, so every
    // pixel touches that border. The function keeps all masked pixels.
    const m = new Uint8Array([1, 0, 0, 0]);
    const out = filterMaskByBorderConnectivity(m, 1, 4);
    expect(Array.from(out)).toEqual([1, 0, 0, 0]);
    const m2 = new Uint8Array([0, 0, 1, 0]);
    const out2 = filterMaskByBorderConnectivity(m2, 1, 4);
    expect(Array.from(out2)).toEqual([0, 0, 1, 0]);
  });

  it('returns a new Uint8Array (does not mutate input)', () => {
    const m = new Uint8Array(2 * 2);
    m[0] = 1;
    const copy = new Uint8Array(m);
    const out = filterMaskByBorderConnectivity(m, 2, 2);
    expect(Array.from(m)).toEqual(Array.from(copy));
    expect(out === m).toBe(false);
  });
});
