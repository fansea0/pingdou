import { describe, it, expect } from 'vitest';
import { sampleImage } from '@/pipeline/sampler';
import type { RGB } from '@/types';

function makeImageData(w: number, h: number, fill: [number, number, number, number]): ImageData {
  const arr = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] = fill[0]; arr[i + 1] = fill[1]; arr[i + 2] = fill[2]; arr[i + 3] = fill[3];
  }
  return new ImageData(arr, w, h);
}

/** 逐像素构造：fn 返回该点的 RGB */
function makePainted(w: number, h: number, fn: (x: number, y: number) => RGB): ImageData {
  const arr = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      arr[i] = r; arr[i + 1] = g; arr[i + 2] = b; arr[i + 3] = 255;
    }
  }
  return new ImageData(arr, w, h);
}

/** 取采样图某格的 RGB */
function cellAt(out: ImageData, x: number, y: number): RGB {
  const o = (y * out.width + x) * 4;
  return [out.data[o], out.data[o + 1], out.data[o + 2]];
}

const RED: RGB = [220, 30, 40];
const BLUE: RGB = [30, 60, 220];

/** 构造一张 16x16 图：每格 4x4，redCounts[格号] = 该格内红色像素个数，其余为蓝 */
function gridWithCells(redCounts: number[]): ImageData {
  return makePainted(16, 16, (x, y) => {
    const cx = Math.floor(x / 4);
    const cy = Math.floor(y / 4);
    // 在这一格内部按行序铺 redCounts 个红，其余为蓝
    const local = (y % 4) * 4 + (x % 4);
    return local < redCounts[cy * 4 + cx] ? RED : BLUE;
  });
}

describe('sampleImage', () => {
  it('keeps a uniform image unchanged', () => {
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

  describe('边界格不再产出混合色', () => {
    it('两色各半时输出其中之一，而不是平均色', () => {
      // 4x4 → 2x2，每格 2x2 上半红下半蓝
      const src = makePainted(4, 4, (_x, y) => (y % 2 === 0 ? RED : BLUE));
      const out = sampleImage(src, 2);

      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const rgb = cellAt(out, x, y);
        const isRed = rgb.every((v, i) => v === RED[i]);
        const isBlue = rgb.every((v, i) => v === BLUE[i]);
        expect(isRed || isBlue).toBe(true);
      }
    });

    it('次色占到 1/4 时吸附到主色', () => {
      // 16x16 → 4x4，每格 4x4 = 16px，格 (1,1) 内 12 红 4 蓝
      const src = gridWithCells([
        16, 16, 16, 16,
        16, 12, 16, 16,
        16, 16, 16, 16,
        16, 16, 16, 16,
      ]);
      const out = sampleImage(src, 4);

      expect(cellAt(out, 1, 1)).toEqual(RED);
    });

    it('次色只占 1/16 时保留原来的混色（细描边仍表现成深色调）', () => {
      // 同一张图，格 (1,1) 内 15 红 1 蓝：混合色离红很近，不该被判成第三种颜色
      const src = gridWithCells([
        16, 16, 16, 16,
        16, 15, 16, 16,
        16, 16, 16, 16,
        16, 16, 16, 16,
      ]);
      const out = sampleImage(src, 4);

      const rgb = cellAt(out, 1, 1);
      // 仍按比例往蓝里混了一点，既没被吸成纯红，也没被吸成纯蓝
      expect(rgb[0]).toBeLessThan(RED[0]);
      expect(rgb[0]).toBeGreaterThan(BLUE[0]);
      expect(rgb[0]).toBe(208);
    });
  });

  describe('不该被改动的地方', () => {
    it('真实渐变整段保留', () => {
      const src = makePainted(64, 4, (x) => {
        const t = x / 63;
        return [
          Math.round(RED[0] + (BLUE[0] - RED[0]) * t),
          Math.round(RED[1] + (BLUE[1] - RED[1]) * t),
          Math.round(RED[2] + (BLUE[2] - RED[2]) * t),
        ];
      });
      const out = sampleImage(src, 16);

      const seen = new Set<string>();
      for (let x = 0; x < out.width; x++) seen.add(cellAt(out, x, 0).join(','));
      expect(seen.size).toBeGreaterThan(3);
    });

    it('压缩噪声切出的近色次簇不触发吸附，格子保持原来的平均值', () => {
      // 4x4 → 2x2，格 (0,0) 内 3 像素主色 + 1 像素近色（JPEG 噪声量级）。
      // 两者 ΔE 过不了 20 的边界门，因此这一格仍按 box-average 出值。
      const base: RGB = [200, 100, 50];
      const noisy: RGB = [208, 104, 53];
      const src = makePainted(4, 4, (x, y) => (x === 0 && y === 0 ? noisy : base));
      const out = sampleImage(src, 2);

      expect(cellAt(out, 0, 0)).toEqual([202, 101, 51]);
    });

    it('大片纯色区逐字节保持 box-average 结果', () => {
      const src = makeImageData(64, 64, [128, 64, 200, 255]);
      const out = sampleImage(src, 16);
      for (let y = 0; y < out.height; y++)
        for (let x = 0; x < out.width; x++) expect(cellAt(out, x, y)).toEqual([128, 64, 200]);
    });
  });

  it('rejects gridSize < 1', () => {
    const src = makeImageData(2, 2, [1, 2, 3, 255]);
    expect(() => sampleImage(src, 0)).toThrow();
  });
});
