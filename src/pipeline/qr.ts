/**
 * 导出图纸右下角的二维码。
 *
 * 码本身是构建期用 scripts/gen-qr.mjs 预生成的静态 PNG（version 3 / 111×111），
 * 运行时只负责加载和绘制 —— 前端不引入任何二维码编码依赖。
 *
 * 加载链路照搬 watermark.ts 的 ensureWatermarkIcon：模块级 Map 缓存先占位
 * （避免并发导出重复发起加载）、onload/onerror 双通道、1.5s 超时兜底
 * （jsdom 根本不派发 img 事件，没有超时会一直挂着）。
 *
 * 失败一律降级为 null，绝不抛错：二维码是锦上添花，不能因为它让导出失败。
 */

import { DEFAULT_COMPOSITE_OPTIONS } from './composite';

/** 构建期产物（scripts/gen-qr.mjs 写在 public/brand/ 下，Vite 原样拷进 dist） */
export const WORKS_QR_SRC = '/brand/works-qr.png';

/** 首屏导出时资源还没进 HTTP 缓存时可能慢；超过这个时间就放弃画码 */
export const QR_LOAD_TIMEOUT_MS = 1500;

const imageCache = new Map<string, HTMLImageElement | null>();

export function ensureWorksQrImage(src: string = WORKS_QR_SRC): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  if (typeof Image === 'undefined') {
    imageCache.set(src, null);
    return Promise.resolve(null);
  }
  const promise = new Promise<HTMLImageElement | null>(resolve => {
    const settle = (value: HTMLImageElement | null) => {
      clearTimeout(timer);
      imageCache.set(src, value);
      resolve(value);
    };
    const img = new Image();
    const timer = setTimeout(() => settle(null), QR_LOAD_TIMEOUT_MS);
    img.onload = () => settle(img);
    img.onerror = () => settle(null);
    img.src = src;
  });
  // 先占位，避免并发调用重复发起加载（和 ensureWatermarkIcon 一致）
  imageCache.set(src, null);
  return promise;
}

/**
 * 把二维码画到画布右下角。
 *
 * 尺寸读 img.naturalWidth 而不是写死常量：模块边长必须是整数 px，
 * 任何非整数缩放都会把模块糊在一起，糊了就扫不出来。想换尺寸请改
 * scripts/gen-qr.mjs 重新构建，这样运行时布局自动跟上，不存在两处数字对不上。
 */
export function drawWorksQr(canvas: HTMLCanvasElement, img: HTMLImageElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = img.naturalWidth;
  if (!size) return;

  const margin = DEFAULT_COMPOSITE_OPTIONS.padding;
  const x = canvas.width - margin - size;
  const y = canvas.height - margin - size;

  ctx.save();
  // 先铺不透明白底。这块位目前天然是导出画的纯白底，但版式一旦改动
  // 让它落到色卡浅灰底 (#fbfbfc) 上，二维码对比度会掉、扫不出来。
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}
