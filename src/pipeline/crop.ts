import type { BackgroundMask, Palette, RGB } from '@/types';

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
 * 「看起来就是背景色」的判定阈值（RGB 欧氏距离）。
 *
 * 色板里有一批近白豆（T01/H01/H02/P01 都在 252 以上）。照片里只要边角
 * 有一点杂色或压缩噪点，这些格子就会被判成主体，从而把裁剪框撑满整行
 * 整列 —— 结果就是「只裁掉上下、左右完全不贴合」。这里把接近检出背景
 * 色的格子排除在 bbox 之外，让框重新贴回真正的轮廓。
 */
export const NEAR_BACKGROUND_DISTANCE = 46;

function colorDistance(rgb: RGB, bg: RGB): number {
  return Math.hypot(rgb[0] - bg[0], rgb[1] - bg[1], rgb[2] - bg[2]);
}

/**
 * 求非背景格（mask[i] === 0）的包围盒。
 * mask 为 null、没有任何主体、或主体已占满整张网格时返回 null。
 */
export function contentBounds(
  mask: BackgroundMask | null,
  outW: number,
  outH: number,
  skip?: (i: number) => boolean
): CropRect | null {
  if (!mask) return null;

  let minX = outW;
  let minY = outH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < outH; y++) {
    const row = y * outW;
    for (let x = 0; x < outW; x++) {
      const i = row + x;
      if (mask[i]) continue;
      if (skip?.(i)) continue;
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
 * 稀疏行列剔除。
 *
 * 实拍图主体轮廓外常留着一圈抗锯齿过渡带，或像「贯通整行的浅色底边」这种
 * 一条噪声。任何一格落在最外侧，整个 bbox 就被撑满 —— 结果就是只裁掉一个
 * 方向、另一个方向完全不贴合。
 *
 * 这里先统计每列/每行的主体格数，低于阈值（绝对下限 2 格，避免把触角、
 * 胡须这类细长部件整根切掉）的行列视为噪声边，不参与定框。
 */
export function supportBounds(
  mask: BackgroundMask | null,
  outW: number,
  outH: number,
  skip?: (i: number) => boolean
): CropRect | null {
  if (!mask) return null;

  const colSupport = new Int32Array(outW);
  const rowSupport = new Int32Array(outH);
  for (let y = 0; y < outH; y++) {
    const row = y * outW;
    for (let x = 0; x < outW; x++) {
      const i = row + x;
      if (mask[i]) continue;
      if (skip?.(i)) continue;
      colSupport[x]++;
      rowSupport[y]++;
    }
  }

  const colThreshold = Math.max(2, Math.ceil(outH * 0.04));
  const rowThreshold = Math.max(2, Math.ceil(outW * 0.04));

  const span = (support: Int32Array, threshold: number): { start: number; length: number } | null => {
    let first = -1;
    let last = -1;
    for (let i = 0; i < support.length; i++) {
      if (support[i] < threshold) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0 || last < 0) return null;
    return { start: first, length: last - first + 1 };
  };

  const cols = span(colSupport, colThreshold);
  const rows = span(rowSupport, rowThreshold);
  if (!cols || !rows) return null;
  return { x: cols.start, y: rows.start, w: cols.length, h: rows.length };
}

/**
 * 包围盒按 padding 外扩，并夹回网格范围内。
 * 返回 null 表示「不需要裁」——通常是主体已铺满，或没有主体。
 */
export function paddedBounds(
  mask: BackgroundMask | null,
  outW: number,
  outH: number,
  padding: number,
  skip?: (i: number) => boolean
): CropRect | null {
  const base = contentBounds(mask, outW, outH, skip);
  if (!base) return null;

  // 只在噪声判定有效且确实能收窄时采纳，避免把浅色主体整块切掉
  const support = supportBounds(mask, outW, outH, skip);
  const bounds: CropRect = support
    ? {
        x: Math.max(base.x, support.x),
        y: Math.max(base.y, support.y),
        w: Math.min(base.x + base.w, support.x + support.w) - Math.max(base.x, support.x),
        h: Math.min(base.y + base.h, support.y + support.h) - Math.max(base.y, support.y),
      }
    : base;
  if (bounds.w <= 0 || bounds.h <= 0) return null;

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
 *
 * near 给出检出背景色时，bbox 会忽略与它足够接近的格子——照片噪点和
 * 近白豆不该把裁剪框撑满整行整列。求不出框时自动退回原框，
 * 保证不会把浅色主体裁掉。
 */
export function cropGridToContent(
  indices: Uint8Array,
  mask: BackgroundMask | null,
  outW: number,
  outH: number,
  padding: number = DEFAULT_CROP_PADDING,
  near?: { readonly palette: Palette; readonly color: RGB }
): CroppedGrid {
  const full: CropRect = { x: 0, y: 0, w: outW, h: outH };
  const skip = near
    ? (i: number) => colorDistance(near.palette[indices[i]].rgb, near.color) <= NEAR_BACKGROUND_DISTANCE
    : undefined;
  const rect =
    paddedBounds(mask, outW, outH, padding, skip) ?? paddedBounds(mask, outW, outH, padding);
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