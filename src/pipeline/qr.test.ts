import { describe, it, expect } from 'vitest';
import { create, toDataURL } from 'qrcode';
import { SUBMISSION_QR_PX, SUBMISSION_QR_OPTIONS } from './qr';

/** 从 PNG 的 IHDR 里读宽高（字节 16–23，大端 uint32）。
 *  纯字节解析，不依赖 canvas —— jsdom 没有 createImageBitmap。 */
function pngSize(dataUrl: string): { width: number; height: number } {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const SITE = 'https://www.xn--muu023g.xyz';

/** 加上静区之后的实际列数 —— 也就是「码在图上占多宽」 */
function columnsOf(qr: { modules: { size: number } }): number {
  return qr.modules.size + 2 * SUBMISSION_QR_OPTIONS.margin;
}

describe('投稿二维码规格', () => {
  it('version 3 + 静区 4 + 宽 111 恰好产出 111×111 的方图', async () => {
    const url = await toDataURL(`${SITE}/works/9999999`, { ...SUBMISSION_QR_OPTIONS });
    expect(pngSize(url)).toEqual({ width: 111, height: 111 });
  });

  it('id 长到 10 位仍然是 111×111（version 3 的容量够用）', async () => {
    const url = await toDataURL(`${SITE}/works/9999999999`, { ...SUBMISSION_QR_OPTIONS });
    expect(pngSize(url)).toEqual({ width: SUBMISSION_QR_PX, height: SUBMISSION_QR_PX });
  });

  it('模块边长是整数 —— 非整数会把模块插值糊掉，码扫不出来', () => {
    // 列数从库实际算出来的矩阵取，而不是把 29 写死在这里：这样「钉死的 version
    // 被谁动过」和「边长还对不对」会在同一条断言上一起变红，不会各管一半。
    // version 3 = 29 模块，加静区 4×2 = 37 列。37 必须整除 111，否则每模块
    // 不是整数 px。这是「白带预留高度」与「码的实际边长」之间的契约。
    const qr = create(`${SITE}/works/9999999`, { ...SUBMISSION_QR_OPTIONS });
    const columns = columnsOf(qr);
    expect(columns).toBe(37);
    expect(SUBMISSION_QR_PX % columns).toBe(0);
    expect(SUBMISSION_QR_PX / columns).toBe(3);
  });

  it('version 真的被库采纳：钉不钉，短 URL 出来的版本不一样', () => {
    // 这条不能写成 `expect(SUBMISSION_QR_OPTIONS.version).toBe(3)` 那种常量比常量：
    // 它恒真，证明不了库真的用了 version 3。要证明的是**去掉钉死后结果会变**。
    //
    // 生产域名下的 /works/:id 是 35~44 字节，本来就超出 version 2 的 32 字节容量，
    // 库自己也会挑到 version 3 —— 所以拿生产 URL 做反证是抓不住的。真正的风险在
    // renderSubmissionQr(id, origin) 的 origin 是**运行时参数**：本地开发/预览域名短得多，
    // 链接掉到 version 1 / 2，列数变 29 / 33，111 除不开（3.83px / 3.36px 的模块边长）。
    const short = '/works/1';
    const { version: _dropped, ...unpinned } = SUBMISSION_QR_OPTIONS;
    const loose = create(short, { ...unpinned });
    expect(loose.version).toBe(1);
    // 反证：version 1 只有 21 模块 + 8 = 29 列，111 / 29 = 3.83 —— 非整数
    expect(SUBMISSION_QR_PX % columnsOf(loose)).not.toBe(0);

    // 钉死之后，同一条短链接依然落在 version 3 上
    const pinned = create(short, { ...SUBMISSION_QR_OPTIONS });
    expect(pinned.version).toBe(3);
    expect(columnsOf(pinned)).toBe(37);
    expect(SUBMISSION_QR_PX % columnsOf(pinned)).toBe(0);
  });
});
