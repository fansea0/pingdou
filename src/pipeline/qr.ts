/**
 * 投稿成品图右下角的二维码。
 *
 * 码在用户点投稿时才现场编码出来，内容是这一件作品自己的详情页地址
 * （`${origin}/works/${id}`），规格由 SUBMISSION_QR_OPTIONS 钉死，见文件末尾。
 * 它依赖 qrcode，因此用动态 import，不进首屏 bundle。
 *
 * 导出/下载路径**不**画码：那张图不进作品库，没有可指回去的地方，
 * 预留的白带也只是打印时的空白边。所以本文件没有「全站码」这种形态，
 * 也就没有构建期产物、没有静态资源路径常量。
 *
 * 加载链路照搬 watermark.ts 的 ensureWatermarkIcon：onload/onerror 双通道
 * + 1.5s 超时兜底（jsdom 根本不派发 img 事件，没有超时会一直挂着）。
 *
 * 失败一律降级为 null，绝不抛错：二维码是锦上添花，不能因为它让投稿失败。
 */

import { DEFAULT_COMPOSITE_OPTIONS } from './composite';

/** 首屏导出时资源还没进 HTTP 缓存时可能慢；超过这个时间就放弃画码 */
export const QR_LOAD_TIMEOUT_MS = 1500;

/**
 * 把一个图片地址加载成 HTMLImageElement，在 Image 存在的前提下永不 reject、
 * 永不挂住。
 *
 * 「永不 reject」这句只对着 Image 存在时成立：`new Image()` 本身在 Image 未定义
 * 时会抛 ReferenceError，而它就发生在 Promise executor 里，异常会直接把返回的
 * Promise 变成 rejected，而不是 resolve 成 null。调用方 renderSubmissionQr 自己也
 * 守了一句 `typeof Image === 'undefined'`，这一层不重复守。
 *
 * 用 toDataURL 而不是 QRCode.toCanvas：drawWorksQr 吃的是 HTMLImageElement，
 * 把 dataURL 灌进 new Image() 之后得到的对象与 <img src> 完全同型。
 *
 * 1.5s 超时兜底不是多余的：jsdom 根本不派发 img 的 load/error 事件，
 * 没有超时会永远挂住 —— 投稿会卡死。
 *
 * 这里不做任何缓存：本文件只剩投稿一条加载链路，每次调用都从新生成的 dataURL
 * 起步，模块级 Map 缓存对它没有命中可言。
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

/**
 * 把二维码画到画布右下角。
 *
 * 尺寸读 img.naturalWidth 而不是写死常量：模块边长必须是整数 px，
 * 任何非整数缩放都会把模块糊在一起，糊了就扫不出来。上游保证传进来的是
 * 正方图（SUBMISSION_QR_PX 钉死了版本与静区），所以只读一个边长就够。
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
 * 白带高度和码的实际边长靠**同一个常量**对齐，中间不再有别的换算：
 * `submission.ts` 预留白带时用的就是 `qrBandPx: SUBMISSION_QR_PX`，而码的实际
 * 边长来自 `SUBMISSION_QR_OPTIONS.width`，后者也等于 `SUBMISSION_QR_PX`，
 * drawWorksQr 读的 `img.naturalWidth` 就是它的落地结果。两端同源，
 * 谁要是对不上，是有人把 111 写死进了别处，不是这里。
 *
 * 这个常量的**真正**契约只有一条：**必须能被二维码的矩阵列数整除**，
 * 否则模块边长不是整数 px，图上看着有个码、真扫扫不出来。
 *
 * 两条下游断言守着这段同源关系，别删：
 *   - `src/pipeline/submission.test.ts`「底部留出 SUBMISSION_QR_PX 高的白带给二维码」
 *     —— 守住白带这一端；
 *   - `src/pipeline/qr.test.ts`「version 3 + 静区 4 + 宽 111 恰好产出 111×111 的方图」
 *     —— 守住「width 选项真的被库采纳、真图确实是 111×111」这一端。
 * 只留后者会漏掉白带被改小；只留前者会漏掉 qrcode 升级后 width 语义变化。
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
 * 失败一律降级为 null，绝不抛错：二维码是锦上添花，不能因为它让投稿失败。
 * 降级后成品图会留一条空的白带，这比整次投稿失败好得多。
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
