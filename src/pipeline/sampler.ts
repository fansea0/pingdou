/**
 * Box-average downsample to gridSize × gridSize while preserving aspect ratio.
 * Output width/height will be computed to fit the source aspect into gridSize long edge.
 *
 * 唯一的改动：边界格不再输出混合色。
 *
 * 算术平均的通病：格子正好压在两个色块的交界上时，会把两边的像素揉成一个覆盖率
 * 加权的中间色 —— 比如黑描边压上黄身体，平均出一圈灰橄榄色。这个颜色在源图里
 * 根本不存在，量化后还得为它单独买一颗豆子，于是每条边都镶上一圈渐变带。实测
 * 一张平涂像素画，100×100 网格里有 9% 的格子是这种幻觉色。
 *
 * 判据是「混合色离主色有多远」，而不是「次色占了多少」：
 *   - 90% 暗灰 + 10% 亮 —— 混合色几乎就是暗灰，本来就是这一格的正常色调，不动；
 *   - 77% 黄 + 23% 黑  —— 混合色既不像黄也不像黑，是个凭空多出来的第三色，必须吸附。
 * 同一个次色占比，该不该处理完全相反，用占比去卡必然顾此失彼。ΔE76 把「肉眼能不能
 * 看出这是第三种颜色」直接量化出来，也不受两种颜色本身色差大小的影响。
 *
 * 改动范围刻意做得很窄：只有同时满足下面三条的格子结果才会变，其余格子与原来的
 * box-average 逐字节一致。
 *   1. 格子里确实存在第二个色块（次色簇非空）；
 *   2. 两个色块本身差别够大（ΔE76 ≥ 20），否则它们本来就分不清，不值得动；
 *   3. 混合色明显偏离主色（ΔE76 ≥ 12），即它真的看起来是第三种颜色。
 */
import { rgbToLab, deltaE76 } from './colorSimplifier';
import type { RGB } from '@/types';

/** 每通道分桶位数：16 级，桶宽 16，合计 4096 个桶 */
const BUCKET_BITS = 4;
const BUCKET_SHIFT = 8 - BUCKET_BITS;
const BUCKET_COUNT = 1 << (BUCKET_BITS * 3);

/** 两个色块至少要差这么多，才算「两种颜色在争这一格」 */
const BOUNDARY_MIN_DELTA_E = 20;

/** 混合色至少要偏离主色这么多，才算「真的变成了第三种颜色」 */
const BLEND_MIN_DELTA_E = 12;

export function sampleImage(src: ImageData, gridSize: number): ImageData {
  if (gridSize < 1) throw new Error('gridSize must be >= 1');

  const aspect = src.height / src.width;
  const outW = aspect >= 1 ? Math.max(1, Math.round(gridSize / aspect)) : gridSize;
  const outH = aspect >= 1 ? gridSize : Math.max(1, Math.round(gridSize * aspect));

  const dst = new Uint8ClampedArray(outW * outH * 4);
  const xScale = src.width / outW;
  const yScale = src.height / outH;

  // 桶直方图跨格复用：只清空本格用到的桶，避免每格重新分配。
  const counts = new Uint16Array(BUCKET_COUNT);
  const sumR = new Int32Array(BUCKET_COUNT);
  const sumG = new Int32Array(BUCKET_COUNT);
  const sumB = new Int32Array(BUCKET_COUNT);
  const touched: number[] = [];

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * xScale);
      const y0 = Math.floor(y * yScale);
      const x1 = Math.min(src.width, Math.ceil((x + 1) * xScale));
      const y1 = Math.min(src.height, Math.ceil((y + 1) * yScale));
      const count = (x1 - x0) * (y1 - y0);

      let r = 0, g = 0, b = 0, a = 0;
      touched.length = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
          const key =
            ((src.data[i] >> BUCKET_SHIFT) << (BUCKET_BITS * 2)) |
            ((src.data[i + 1] >> BUCKET_SHIFT) << BUCKET_BITS) |
            (src.data[i + 2] >> BUCKET_SHIFT);
          if (counts[key] === 0) touched.push(key);
          counts[key] += 1;
          sumR[key] += src.data[i];
          sumG[key] += src.data[i + 1];
          sumB[key] += src.data[i + 2];
        }
      }

      // 计数最高的两个色簇
      let dominant = -1;
      let dominantCount = 0;
      let runnerUp = -1;
      let runnerUpCount = 0;
      for (const key of touched) {
        const c = counts[key];
        if (c > dominantCount) {
          runnerUp = dominant;
          runnerUpCount = dominantCount;
          dominant = key;
          dominantCount = c;
        } else if (c > runnerUpCount) {
          runnerUp = key;
          runnerUpCount = c;
        }
      }

      let outR = Math.round(r / count);
      let outG = Math.round(g / count);
      let outB = Math.round(b / count);

      // 边界格改取主色簇均值：宁可让边界偏保守，也不再造出源图里没有的颜色
      if (runnerUp >= 0) {
        const dominantRgb: RGB = [
          sumR[dominant] / dominantCount,
          sumG[dominant] / dominantCount,
          sumB[dominant] / dominantCount,
        ];
        const dominantLab = rgbToLab(dominantRgb);
        const runnerUpRgb: RGB = [
          sumR[runnerUp] / runnerUpCount,
          sumG[runnerUp] / runnerUpCount,
          sumB[runnerUp] / runnerUpCount,
        ];
        const blendLab = rgbToLab([outR, outG, outB]);
        if (
          deltaE76(dominantLab, rgbToLab(runnerUpRgb)) >= BOUNDARY_MIN_DELTA_E &&
          deltaE76(blendLab, dominantLab) >= BLEND_MIN_DELTA_E
        ) {
          outR = Math.round(dominantRgb[0]);
          outG = Math.round(dominantRgb[1]);
          outB = Math.round(dominantRgb[2]);
        }
      }

      const o = (y * outW + x) * 4;
      dst[o] = outR;
      dst[o + 1] = outG;
      dst[o + 2] = outB;
      dst[o + 3] = Math.round(a / count);

      // 只清空本格用到的桶
      for (const key of touched) {
        counts[key] = 0;
        sumR[key] = 0;
        sumG[key] = 0;
        sumB[key] = 0;
      }
    }
  }

  return new ImageData(dst, outW, outH);
}
