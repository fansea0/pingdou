import { describe, it, expect } from 'vitest';
import { Pipeline } from '@/pipeline/pipeline';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 255, 255], name: '白' },
  { id: 'A02', rgb: [220, 40, 40], name: '红' },
  { id: 'A03', rgb: [40, 40, 220], name: '蓝' },
];

/** Build an RGBA ImageData where subject pixels are *{220, 40, 40}*
 *  on pure white background; alpha always 255. */
function buildCartoon(W: number, H: number, boxes: Array<[number, number, number, number]>): ImageData {
  const arr = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] = 255; arr[i + 1] = 255; arr[i + 2] = 255; arr[i + 3] = 255;
  }
  for (const [x0, y0, x1, y1] of boxes) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        arr[i] = 220; arr[i + 1] = 40; arr[i + 2] = 40; arr[i + 3] = 255;
      }
    }
  }
  return new ImageData(arr, W, H);
}

async function runProcess(
  pipeline: Pipeline,
  src: ImageData,
  removeBackground: boolean
) {
  let result: unknown;
  await pipeline.process(
    src,
    {
      gridSize: 30,
      removeBackground,
    },
    () => {},
    r => {
      result = r;
    }
  );
  return result as {
    indices: Uint8Array;
    gridSize: number;
    outW: number;
    outH: number;
    token: number;
    mask: Uint8Array;
  };
}

function maskCount(m: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) n++;
  return n;
}

describe('Pipeline.process — auto background removal', () => {
  it('when removeBackground=false, mask is all zeros (no removal)', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    const src = buildCartoon(200, 200, [[75, 75, 125, 125]]);
    const r = await runProcess(pipeline, src, false);
    expect(r.mask.length).toBe(r.outW * r.outH);
    expect(maskCount(r.mask)).toBe(0);
  });

  it('when removeBackground=true and subject is small on white bg, most cells are bg-masked', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    const src = buildCartoon(200, 200, [[75, 75, 125, 125]]);
    const r = await runProcess(pipeline, src, true);
    // subject = 50×50 = 2500 in original; on a 30×30 grid it shrinks to ~6×6 ≈ 36 cells
    // bg-masked should be > 80% of total
    const total = r.outW * r.outH;
    const bgRemoved = maskCount(r.mask);
    expect(bgRemoved).toBeGreaterThan(total * 0.8);
    expect(bgRemoved).toBeLessThan(total);
  });

  it('mask length matches indices length (1:1 to grid cells)', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    const src = buildCartoon(200, 200, [[50, 50, 150, 150]]);
    const r = await runProcess(pipeline, src, true);
    expect(r.mask.length).toBe(r.indices.length);
    expect(r.mask.length).toBe(r.outW * r.outH);
  });

  it('indices in bg-masked cells are still valid palette indices (does not error)', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    const src = buildCartoon(200, 200, [[50, 50, 150, 150]]);
    const r = await runProcess(pipeline, src, true);
    for (const idx of r.indices) {
      expect(idx).toBeLessThan(palette.length);
      expect(idx).toBeGreaterThanOrEqual(0);
    }
  });
});
