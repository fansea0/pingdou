import type { BackgroundMask } from '@/types';

/** 主体在网格坐标系里的包围盒（左上角 + 尺寸，单位：格） */
export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CroppedGrid {
  readonly indices: Uint8Array;
  readonly mask: BackgroundMask;
  readonly outW: number;
  readonly outH: number;
  readonly rect: CropRect;
  /** 是否真的裁掉了空白（false = 无可裁，原样返回） */
  readonly cropped: boolean;
}

/** 主体四周保留的空白格数，方便手边裁剪 / 熨烫 */
export const DEFAULT_CROP_PADDING = 2;

/**
 * 求非背景格（mask[i] === 0）的包围盒。
 * mask 为 null、没有任何主体、或主体已占满整张网格时返回 null。
 */
export function contentBounds(
  mask: BackgroundMask | null,
  outW: number,
  outH: number
): CropRect | null {
  if (!mask) return null;

  let minX = outW;
  let minY = outH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < outH; y++) {
    const row = y * outW;
    for (let x = 0; x < outW; x++) {
      if (mask[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0 || minY < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 把包围盒按 padding 外扩，并夹回网格范围内。
 * 返回 null 表示「不需要裁」——通常是主体已铺满，或没有主体。
 */
export function paddedBounds(
  mask: BackgroundMask | null,
  outW: number,
  outH: number,
  padding: number
): CropRect | null {
  const bounds = contentBounds(mask, outW, outH);
  if (!bounds) return null;

  const pad = Math.max(0, Math.floor(padding));
  const x = Math.max(0, bounds.x - pad);
  const y = Math.max(0, bounds.y - pad);
  const right = Math.min(outW, bounds.x + bounds.w + pad);
  const bottom = Math.min(outH, bounds.y + bounds.h + pad);
  const rect: CropRect = { x, y, w: right - x, h: bottom - y };

  if (rect.w <= 0 || rect.h <= 0) return null;
  if (rect.w === outW && rect.h === outH && x === 0 && y === 0) return null;
  return rect;
}

/**
 * 裁掉主体外的空白格。indices 与 mask 同步裁剪，保证两者逐格对齐。
 * 无可裁时原样返回同一份引用（不产生额外内存分配）。
 */
export function cropGridToContent(
  indices: Uint8Array,
  mask: BackgroundMask | null,
  outW: number,
  outH: number,
  padding: number = DEFAULT_CROP_PADDING
): CroppedGrid {
  const full: CropRect = { x: 0, y: 0, w: outW, h: outH };
  const rect = paddedBounds(mask, outW, outH, padding);
  if (!rect) {
    return {
      indices,
      mask: mask ?? new Uint8Array(outW * outH),
      outW,
      outH,
      rect: full,
      cropped: false,
    };
  }

  const nextIndices = new Uint8Array(rect.w * rect.h);
  const nextMask = new Uint8Array(rect.w * rect.h);

  for (let y = 0; y < rect.h; y++) {
    const srcRow = (y + rect.y) * outW + rect.x;
    const dstRow = y * rect.w;
    nextIndices.set(indices.subarray(srcRow, srcRow + rect.w), dstRow);
    if (mask) nextMask.set(mask.subarray(srcRow, srcRow + rect.w), dstRow);
  }

  return {
    indices: nextIndices,
    mask: nextMask,
    outW: rect.w,
    outH: rect.h,
    rect,
    cropped: true,
  };
}