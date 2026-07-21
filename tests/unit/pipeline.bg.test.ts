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

describe('Pipeline.process — internal-white preservation', () => {
  it('keeps an internal white region inside the subject (eyes/negative space)', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    const W = 200, H = 200;
    const arr = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < arr.length; i += 4) {
      arr[i] = 255; arr[i + 1] = 255; arr[i + 2] = 255; arr[i + 3] = 255;
    }
    for (let y = 50; y < 150; y++) {
      for (let x = 50; x < 150; x++) {
        const i = (y * W + x) * 4;
        arr[i] = 220; arr[i + 1] = 40; arr[i + 2] = 40;
      }
    }
    for (let y = 90; y < 110; y++) {
      for (let x = 90; x < 110; x++) {
        const i = (y * W + x) * 4;
        arr[i] = 255; arr[i + 1] = 255; arr[i + 2] = 255;
      }
    }
    const src = new ImageData(arr, W, H);

    const r = await runProcess(pipeline, src, true);

    const cellIdx = (cy: number, cx: number): number => cy * r.outW + cx;
    const cellAtImg = (imgX: number, imgY: number): { gx: number; gy: number } => ({
      gx: Math.floor((imgX / W) * r.outW),
      gy: Math.floor((imgY / H) * r.outH),
    });
    const eye = cellAtImg(100, 100);
    const body = cellAtImg(60, 60);
    const outerBg = cellAtImg(5, 5);

    expect(r.mask[cellIdx(eye.gy, eye.gx)]).toBe(0);
    expect(r.mask[cellIdx(body.gy, body.gx)]).toBe(0);
    expect(r.mask[cellIdx(outerBg.gy, outerBg.gx)]).toBe(1);
  });
});

describe('Pipeline.process — thin outline preservation', () => {
  it('keeps a white interior when the outline is thinner than one sampled cell', async () => {
    // Reproduces a real cartoon: 1-pixel black outline around a white interior,
    // on a white background. At gridSize=30 on a 600x600 source, each sampled
    // cell is 20x20 source pixels. The 1px outline occupies 1 row of one
    // sampled cell. Box-averaging on the sampled grid dilutes the outline to
    // ~242 grey, which is still within tolerance of white bg — so the
    // sampled-grid mask has NO outline at all and the white interior is
    // border-connected through the leak.
    //
    // The fix: build the mask at source resolution where the outline pixels
    // stay black, then downsample with "all pixels must be bg" logic so the
    // outline cells stay non-bg and break the connectivity.
    const pipeline = new Pipeline();
    pipeline.init(palette);
    const W = 600, H = 600;
    const arr = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < arr.length; i += 4) {
      arr[i] = 255; arr[i + 1] = 255; arr[i + 2] = 255; arr[i + 3] = 255; // white bg + white interior
    }
    // 1-pixel black outline at 200..400 x 200..400 (top, bottom, left, right)
    for (let i = 200; i < 400; i++) {
      const top = (200 * W + i) * 4;
      const bot = (399 * W + i) * 4;
      const lft = (i * W + 200) * 4;
      const rgt = (i * W + 399) * 4;
      for (const p of [top, bot, lft, rgt]) {
        arr[p] = 0; arr[p + 1] = 0; arr[p + 2] = 0;
      }
    }
    const src = new ImageData(arr, W, H);

    const r = await runProcess(pipeline, src, true);

    // Center of the white interior should NOT be masked.
    const cx = Math.floor(r.outW / 2);
    const cy = Math.floor(r.outH / 2);
    expect(r.mask[cy * r.outW + cx]).toBe(0);
    // Outer bg (corner) should still be masked.
    expect(r.mask[0]).toBe(1);
  });
});
