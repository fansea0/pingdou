/**
 * 背景检测 + 主体提取
 *
 * 适用场景：卡通/插画类图片，主体居中 + 周围纯色背景。
 *
 * 算法（先在采样图上检测，必要时退回原图）：
 *   1. 在 `sampled` 上采样 4 角各 `CORNER_PATCH × CORNER_PATCH` 平均色 + 方差
 *      （sampled 图小、已经被降采样平滑，对轻度 JPEG 噪声更鲁棒）
 *   2. 取 3+ 角"低方差 + 互相色差小"的那组 → 中位数色作背景色
 *   3. 在 `sampled` 上按欧式距离阈值 (默认 `DEFAULT_TOLERANCE`) 生成 mask
 *
 * 返回 null = 没把握，不动原图（用户应该会理解）。
 */

import type { RGB } from '@/types';

export const CORNER_PATCH = 5;

export interface BgDetection {
  readonly bg: RGB;
  readonly patchVariance: number;
}

function distSq(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function medianRgb(colors: RGB[]): RGB {
  if (colors.length === 0) return [0, 0, 0];
  const sortedR = [...colors].map(c => c[0]).sort((a, b) => a - b);
  const sortedG = [...colors].map(c => c[1]).sort((a, b) => a - b);
  const sortedB = [...colors].map(c => c[2]).sort((a, b) => a - b);
  const mid = Math.floor(sortedR.length / 2);
  return [sortedR[mid], sortedG[mid], sortedB[mid]];
}

interface CornerSample {
  avg: RGB;
  variance: number;
}

function sampleCorner(
  src: ImageData,
  corner: 'tl' | 'tr' | 'bl' | 'br',
  patchSize: number
): CornerSample {
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

/** 给定 4 角样本，挑 3+ 角一致且低方差的 → 背景色候选。 */
interface DetectOptions {
  readonly varianceMax: number;
  readonly cornerDistMaxSq: number;
  readonly requiredCorners: number;
}

const STRICT_OPTS: DetectOptions = {
  varianceMax: 400,
  cornerDistMaxSq: 64 * 64,
  requiredCorners: 3,
};

// 宽松一档：允许更大色差（深色/彩色背景 + JPEG 噪点场景）
const LOOSE_OPTS: DetectOptions = {
  varianceMax: 1500,
  cornerDistMaxSq: 110 * 110,
  requiredCorners: 3,
};

function runDetect(
  src: ImageData,
  opts: DetectOptions,
  patchSize: number
): BgDetection | null {
  const corners = (['tl', 'tr', 'bl', 'br'] as const).map(c =>
    sampleCorner(src, c, patchSize)
  );
  const lowVar = corners.filter(c => c.variance <= opts.varianceMax);
  if (lowVar.length < opts.requiredCorners) return null;

  for (let i = 0; i < lowVar.length; i++) {
    for (let j = i + 1; j < lowVar.length; j++) {
      if (distSq(lowVar[i].avg, lowVar[j].avg) > opts.cornerDistMaxSq) {
        return null;
      }
    }
  }

  const avgVar = lowVar.reduce((s, c) => s + c.variance, 0) / lowVar.length;
  return { bg: medianRgb(lowVar.map(c => c.avg)), patchVariance: avgVar };
}

/**
 * 默认颜色容差。距背景色 < tolerance^2 的格子视为背景。
 * 64 = 允许 +/-6 的 RGB 偏差（适合轻度 JPEG / WebP 压缩造成的颜色抖动）。
 */
export const DEFAULT_TOLERANCE = 36;

export interface MaskResult {
  readonly mask: Uint8Array;
  readonly bgCount: number;
}

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

/**
 * 智能背景检测：
 *   1. 在 sampling 后的网格（更干净、抗 JPEG 噪声）上跑严格检测
 *   2. 失败时退回宽松检测
 *   3. 还失败再退到原图（更精细，能识别浅背景的细节）
 *   4. 三层都失败 → null（不动原图）
 *
 * `sampled` 必须在调用前准备好；用来计算 mask。
 */
export function detectBackground(
  src: ImageData,
  sampled: ImageData
): BgDetection | null {
  return (
    runDetect(sampled, STRICT_OPTS, CORNER_PATCH) ||
    runDetect(sampled, LOOSE_OPTS, CORNER_PATCH) ||
    runDetect(sampled, STRICT_OPTS, 1) ||
    runDetect(src, STRICT_OPTS, CORNER_PATCH) ||
    runDetect(src, LOOSE_OPTS, 8) ||
    null
  );
}
