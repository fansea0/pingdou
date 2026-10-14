import { describe, expect, it } from 'vitest';
import {
  contentBounds,
  cropGridToContent,
  DEFAULT_CROP_PADDING,
} from '@/pipeline/crop';

/** 3x3：只有中心 (1,1) 是主体，其余为背景 */
function ringMask(): Uint8Array {
  return new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
}

describe('contentBounds', () => {
  it('returns null without a mask', () => {
    expect(contentBounds(null, 3, 3)).toBeNull();
  });

  it('returns null when every cell is background', () => {
    expect(contentBounds(new Uint8Array(9).fill(1), 3, 3)).toBeNull();
  });

  it('finds the tight box around non-masked cells', () => {
    expect(contentBounds(ringMask(), 3, 3)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });

  it('returns null-equivalent bounds when the subject fills the grid', () => {
    const mask = new Uint8Array(4);
    expect(contentBounds(mask, 2, 2)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });
});

describe('cropGridToContent', () => {
  it('shrinks the grid to the subject plus padding', () => {
    const indices = new Uint8Array(9);
    const result = cropGridToContent(indices, ringMask(), 3, 3);

    // 3x3 全被 2 格 padding 夹住 → 无法收缩，保持原样
    expect([result.outW, result.outH]).toEqual([3, 3]);
    expect(result.rect).toEqual({ x: 0, y: 0, w: 3, h: 3 });
  });

  it('crops a large empty margin down to the subject', () => {
    const w = 12;
    const h = 12;
    const mask = new Uint8Array(w * h).fill(1);
    // 主体占 x∈[4,8), y∈[5,9)
    for (let y = 5; y < 9; y++) {
      for (let x = 4; x < 8; x++) mask[y * w + x] = 0;
    }
    const indices = new Uint8Array(w * h);

    const result = cropGridToContent(indices, mask, w, h);
    const expectedW = 4 + DEFAULT_CROP_PADDING * 2;
    const expectedH = 4 + DEFAULT_CROP_PADDING * 2;

    expect([result.outW, result.outH]).toEqual([expectedW, expectedH]);
    expect(result.indices).toHaveLength(expectedW * expectedH);
    expect(result.mask).toHaveLength(expectedW * expectedH);
    // 裁完的边缘应仍是背景（padding 保住了）
    expect(result.mask[0]).toBe(1);
  });

  it('keeps indices and mask row-aligned after cropping', () => {
    const w = 10;
    const h = 10;
    const mask = new Uint8Array(w * h).fill(1);
    const indices = new Uint8Array(w * h);
    for (let y = 3; y < 6; y++) {
      for (let x = 6; x < 9; x++) {
        mask[y * w + x] = 0;
        indices[y * w + x] = x + 1; // 逐格不同的标记值
      }
    }

    const result = cropGridToContent(indices, mask, w, h, 0);
    expect([result.outW, result.outH]).toEqual([3, 3]);

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(result.mask[y * 3 + x]).toBe(0);
        expect(result.indices[y * 3 + x]).toBe(x + 7); // 6..8 → 7..9
      }
    }
  });

  it('never crops below one cell', () => {
    const mask = new Uint8Array(25).fill(1);
    mask[12] = 0;
    const result = cropGridToContent(new Uint8Array(25), mask, 5, 5, 0);
    expect(result.outW).toBeGreaterThanOrEqual(1);
    expect(result.outH).toBeGreaterThanOrEqual(1);
  });

  it('passes the data through untouched when there is no mask', () => {
    const indices = new Uint8Array([0, 1, 2]);
    const result = cropGridToContent(indices, null, 3, 1);
    expect(result.indices).toBe(indices);
    expect([result.outW, result.outH]).toEqual([3, 1]);
  });

  it('passes the data through when every cell is background', () => {
    const indices = new Uint8Array(4);
    const mask = new Uint8Array(4).fill(1);
    const result = cropGridToContent(indices, mask, 2, 2);
    expect([result.outW, result.outH]).toEqual([2, 2]);
  });
});