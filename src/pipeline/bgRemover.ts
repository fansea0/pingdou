/**
 * 背景检测 + 主体提取
 *
 * 适用场景：卡通/插画类图片，主体居中 + 四角纯色背景。
 * 算法：
 *   1. 采样原图 4 个角，每角取小 patch（如 5x5）求平均色 + 计算标准差
 *   2. 选 3 个以上"低方差"的角 → 取这组角落颜色的中位数作为背景色
 *   3. 在采样后的网格上，将平均色到背景色欧式距离 < tolerance 的格子视为背景
 *   4. 输出 mask: Uint8Array，0 = 主体, 1 = 背景，1:1 对应网格格子
 */

import type { RGB } from '@/types';

export const CORNER_PATCH = 5;

/** 标记 index 中"被去除的背景格子"用的 sentinel 值。
 *  MARD 178 色 palette 远小于 255，因此 0xFF 一定不会被实际占用。 */
export const BG_INDEX = 0xff;

export interface BgDetection {
  readonly bg: RGB;
  readonly patchVariance: number;
}

/** 距离平方（避免 sqrt，仅做比较用） */
function distSq(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** 中位数颜色（按 R/G/B 排序后取中位） */
function medianRgb(colors: RGB[]): RGB {
  if (colors.length === 0) return [0, 0, 0];
  const sortedR = [...colors].map(c => c[0]).sort((a, b) => a - b);
  const sortedG = [...colors].map(c => c[1]).sort((a, b) => a - b);
  const sortedB = [...colors].map(c => c[2]).sort((a, b) => a - b);
  const mid = Math.floor(sortedR.length / 2);
  return [sortedR[mid], sortedG[mid], sortedB[mid]];
}

/** 计算 patch 的颜色平均值 + 平均色方差。
 *  数据从 src.data 中读取；patchSize 为边长。 */
function sampleCorner(
  src: ImageData,
  corner: 'tl' | 'tr' | 'bl' | 'br',
  patchSize: number
): { avg: RGB; variance: number } {
  const { width, height, data } = src;
  const x0 = corner === 'tl' || corner === 'bl' ? 0 : Math.max(0, width - patchSize);
  const y0 = corner === 'tl' || corner === 'tr' ? 0 : Math.max(0, height - patchSize);

  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + patchSize && y < height; y++) {
    for (let x = x0; x < x0 + patchSize && x < width; x++) {
      const i = (y * width + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  const avg: RGB = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];

  let varSum = 0;
  for (let y = y0; y < y0 + patchSize && y < height; y++) {
    for (let x = x0; x < x0 + patchSize && x < width; x++) {
      const i = (y * width + x) * 4;
      varSum += distSq([data[i], data[i + 1], data[i + 2]], avg);
    }
  }
  return { avg, variance: varSum / n };
}

/** 给定 4 角的采样，挑出 3+ 角"低方差 + 互相色差小"的那组，作为背景色。
 *  如果不一致（≥3 角明显不同），返回 null 表示无法自动检测。 */
const VARIANCE_MAX = 400;
const CORNER_DIST_MAX_SQ = 64 * 64;

export function detectBackground(src: ImageData): BgDetection | null {
  const corners = (['tl', 'tr', 'bl', 'br'] as const).map(c =>
    sampleCorner(src, c, CORNER_PATCH)
  );
  const lowVar = corners.filter(c => c.variance <= VARIANCE_MAX);
  if (lowVar.length < 3) return null;

  for (let i = 0; i < lowVar.length; i++) {
    for (let j = i + 1; j < lowVar.length; j++) {
      if (distSq(lowVar[i].avg, lowVar[j].avg) > CORNER_DIST_MAX_SQ) {
        return null;
      }
    }
  }

  const avgVar = lowVar.reduce((s, c) => s + c.variance, 0) / lowVar.length;
  return { bg: medianRgb(lowVar.map(c => c.avg)), patchVariance: avgVar };
}

/** 默认颜色容差。距背景色 < tolerance^2 的格子视为背景。 */
export const DEFAULT_TOLERANCE = 24;

export interface MaskResult {
  readonly mask: Uint8Array;
  readonly bgCount: number;
}

/** 对采样后的网格 ImageData 应用背景遮罩。
 *  bg 为检测到的背景色；toleranceSq 为距离阈值平方（>0 即可）。
 *  返回 mask（1=背景, 0=主体）和被去除格子数。 */
export function buildBackgroundMask(
  sampled: ImageData,
  bg: RGB,
  tolerance: number = DEFAULT_TOLERANCE
): MaskResult {
  const { width, height, data } = sampled;
  const mask = new Uint8Array(width * height);
  const tolSq = tolerance * tolerance;
  let bgCount = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    const d2 = dr * dr + dg * dg + db * db;
    if (d2 <= tolSq) {
      mask[p] = 1;
      bgCount++;
    }
  }

  return { mask, bgCount };
}
