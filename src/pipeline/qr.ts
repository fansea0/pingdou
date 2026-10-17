/**
 * 导出图纸右下角的二维码。
 *
 * 码分两种，都走同一条加载链路、同一支 drawWorksQr：
 *   1. 构建期用 scripts/gen-qr.mjs 预生成的静态 PNG（全站码，version 3 / 111×111），
 *      运行时只负责加载和绘制；
 *   2. 投稿时按当前作品的 id 现场编码出来的码（renderSubmissionQr），规格由
 *      SUBMISSION_QR_OPTIONS 钉死，见文件末尾。
 * 第 2 种依赖 qrcode，但它只在用户真的点投稿时才动态 import，不进首屏 bundle。
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

/**
 * 把一个图片地址加载成 HTMLImageElement，在 Image 存在的前提下永不 reject、
 * 永不挂住。
 *
 * 「永不 reject」这句只对着 Image 存在时成立：`new Image()` 本身在 Image 未定义
 * 时会抛 ReferenceError，而它就发生在 Promise executor 里，异常会直接把返回的
 * Promise 变成 rejected，而不是 resolve 成 null。所以两个公开入口
 * （ensureWorksQrImage / renderSubmissionQr）都各自守了一句
 * `typeof Image === 'undefined'`，这一层不重复守。
 *
 * 单独抽出来是为了让「构建期静态码」和「运行时生成的码」共用同一条加载链路：
 * dataURL 灌进 new Image() 之后，得到的对象与 <img src> 完全同型，于是
 * drawWorksQr 一行都不用改就能画两者。
 *
 * 1.5s 超时兜底不是多余的：jsdom 根本不派发 img 的 load/error 事件，
 * 没有超时会永远挂住 —— 导出与投稿两条路径都会卡死。
 *
 * 这里不做任何缓存：缓存归 ensureWorksQrImage 管。缓存命中与否是它自己的事，
 * 这里只负责「拿到 src，给回一个图或 null」。
 */
function loadImageOnce(src: string, timeoutMs: number = QR_LOAD_TIMEOUT_MS): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const settle = (value: HTMLImageElement | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    const img = new Image();
    const timer = setTimeout(() => settle(null), timeoutMs);
    img.onload = () => settle(img);
    img.onerror = () => settle(null);
    img.src = src;
  });
}

export function ensureWorksQrImage(src: string = WORKS_QR_SRC): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  if (typeof Image === 'undefined') {
    imageCache.set(src, null);
    return Promise.resolve(null);
  }
  // 先占位，避免并发调用重复发起加载（和 ensureWatermarkIcon 一致）。
  // 注意这个占位是 null，所以**并发调用的第二个 caller 会拿到 null**，而不是同一个
  // img 实例 —— 既有行为，新旧一致，不是本次引入的。想让并发安全要等真图落地后
  // 再发第二次加载，这里不做。
  imageCache.set(src, null);
  return loadImageOnce(src).then((img) => {
    imageCache.set(src, img);
    return img;
  });
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

// ---- 投稿成品图的「这一件作品自己的」二维码 ----

/**
 * 投稿图上那枚码的输出边长。
 *
 * 注意区分两条不同的契约，别把它们混成一条：
 *
 *   1. 「白带预留高度 ↔ 码的实际边长」是**同源**的，不靠这个常量保证。
 *      pipeline.ts 里两条导出路径都是 `qrBandPx: qrImage ? qrImage.naturalWidth : 0`
 *      （exportComposite 与 exportMulti 各一处），跟 drawWorksQr 读的
 *      img.naturalWidth 取的是同一个数，结构上就对不上不了 —— 谁要是哪天真
 *      对不上了，那是 pipeline.ts 写死了 111，不是这里。这条由
 *      tests/unit/qr.test.ts（「留白带高度取 naturalWidth，与 drawWorksQr 画的
 *      边长同源」，用 60×200 的非方图替身验的）守着，本文件不重复断言。
 *
 *   2. 本文件自己的契约是：**这个数字必须能被二维码的矩阵列数整除**，
 *      否则模块边长不是整数 px，码扫不出来。src/pipeline/qr.test.ts 守这条。
 *
 * 把 1 说成 2 是危险的：后续任务读到会以为白带↔边长没人测，反过来把 qrBandPx
 * 写死成 111「加固」，反而真的造出漂移。
 */
export const SUBMISSION_QR_PX = 111;

/**
 * 投稿二维码的固定规格。
 *
 * **version 必须钉死 3，不能让库自己挑。** 理由是列数必须整除输出边长：
 * version 3 = 29 模块 + 静区 4×2 = 37 列，37 × 3px = 111 整；而 version 1 / 2
 * 只有 29 / 33 列，111 除不开（3.83px / 3.36px 的模块边长）—— 非整数缩放会把
 * 模块边缘插值糊掉，图上看着有个码、真扫扫不出来。
 *
 * 注意暴露面在哪：生产域名下的 /works/:id 是 35~44 字节，本来就超出 version 2
 * 的 32 字节容量，库自己也会挑到 version 3（这条路径上钉不钉都一样）。真正会被
 * 打中的是 renderSubmissionQr 的 origin —— 它是运行时参数：本地开发/预览域名短
 * （http://localhost:5173/works/1 只有 29 字节 → version 2），在 Node 侧跑时
 * 默认 origin 为空串（/works/1 只有 8 字节 → version 1）。所以钉 version 不是给
 * 生产兜底，是给「origin 不等于生产域名」兜底。
 *
 * 容量余量：version 3 @ ECC L 的字节模式容量是 53 字节，当前 URL 是 41 字节
 * （https://www.xn--muu023g.xyz/works/9999999）。id 涨到 10 位之前都安全 —— 实际
 * 更宽裕，因为纯数字 id 会走数字模式高压缩（实测 20 位 id、整串 54 字节仍落在
 * version 3 内）。超出容量时库会**抛错**而不是静默降级 —— 显式失败比糊码好，
 * renderSubmissionQr 会把它接成降级成 null。
 *
 * 与构建期 scripts/gen-qr.mjs 的全站码同规格（同为 version 3 / 静区 4 / 3px 模块
 * / 111×111），所以同一个 drawWorksQr 能画两者。
 */
export const SUBMISSION_QR_OPTIONS = {
  version: 3,
  errorCorrectionLevel: 'L',
  margin: 4,
  width: SUBMISSION_QR_PX,
} as const;

/**
 * 生成指向 /works/:id 的二维码。
 *
 * 用 toDataURL 而不是 toCanvas：drawWorksQr 吃的是 HTMLImageElement，把 dataURL
 * 灌进 new Image() 就得到同型对象，于是画码那段代码完全不用动。
 *
 * 失败一律降级为 null，绝不抛错 —— 与 ensureWorksQrImage 同一个立场：
 * 二维码是锦上添花，不能因为它让投稿失败。降级后成品图会留一条空的白带，
 * 这比整次投稿失败好得多。
 */
export async function renderSubmissionQr(
  id: number,
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return null;
  try {
    // 动态 import：只在用户真的点投稿时把编码库拉进来，主 bundle 不背这个体积
    const QR = await import('qrcode');
    const dataUrl = await QR.toDataURL(`${origin}/works/${id}`, { ...SUBMISSION_QR_OPTIONS });
    return await loadImageOnce(dataUrl);
  } catch (e) {
    console.warn('[qr] 投稿二维码生成失败，成品图将不带码', e);
    return null;
  }
}
