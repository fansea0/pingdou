import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('ECC 钉死 L：v3 下换 ECC 不动矩阵，所以几何断言抓不到它', () => {
    // 这条不能省。version 3 的矩阵尺寸与 ECC 无关 —— 对能装下的内容，L/M/Q/H
    // 都是 29 模块、37 列、3.000px 一个模块，所以上面所有几何断言在 L→M 下
    // 照样全绿。被牺牲的是容量余量：v3 的字节模式容量 L=53 / M=42 / Q=32 /
    // H=24，而当前 URL 已经 41 字节，换成 M 只剩 1 字节余量，再长一点就抛错、
    // 降级成一条空白带。所以 ECC 必须自己有一条断言。
    expect(SUBMISSION_QR_OPTIONS.errorCorrectionLevel).toBe('L');

    // 把「为什么不靠几何断言」钉成事实：同一条装得下的内容，四档 ECC 矩阵完全一样
    const probe = 'x'.repeat(20);
    for (const ecc of ['L', 'M', 'Q', 'H'] as const) {
      expect(create(probe, { ...SUBMISSION_QR_OPTIONS, errorCorrectionLevel: ecc }).modules.size).toBe(29);
    }

    // 顺带把余量的真实形状记下来：换成 M 还能编，Q/H 当场就装不下当前链接。
    expect(() => create(`${SITE}/works/9999999`, { ...SUBMISSION_QR_OPTIONS, errorCorrectionLevel: 'M' }))
      .not.toThrow();
    expect(() => create(`${SITE}/works/9999999`, { ...SUBMISSION_QR_OPTIONS, errorCorrectionLevel: 'H' }))
      .toThrow();
  });
});

/**
 * 「码指向哪件作品」这条链路。
 *
 * 上面整组用例都是自己拼 URL 去调库，绕开了 renderSubmissionQr —— 而它才是
 * 生产代码里唯一生成链接的地方。危害方向恰恰是这个任务最该防的那类：模板写错
 * （`/works` 写成 `/work`、或漏掉 origin）不会让码消失，也不会让任何几何断言
 * 变红，只会安静地产出一张**扫得出来、但指向别的页面**的码。所以必须直接断言
 * 拼出来的字符串。
 *
 * 用 doMock + resetModules + 动态 import（沿用 tests/unit/qr.test.ts 的既有范式），
 * 只把 qrcode 换成一个记录入参的替身，renderSubmissionQr 的其余链路照走真的。
 */
describe('renderSubmissionQr 拼出来的链接', () => {
  const originalImage = globalThis.Image;

  afterEach(() => {
    globalThis.Image = originalImage;
    vi.doUnmock('qrcode');
    vi.resetModules();
  });

  /** 替换 qrcode，捕获 toDataURL 收到的文本；顺带给 Image 一个立刻 load 的替身 */
  function stubQrcode() {
    const seen: string[] = [];
    vi.doMock('qrcode', () => ({
      toDataURL: async (text: string) => {
        seen.push(text);
        return 'data:image/png;base64,iVBORw0KGgo=';
      },
    }));
    class FakeImage {
      naturalWidth = 111;
      naturalHeight = 111;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;
    return seen;
  }

  it('origin + id 拼成 origin/works/:id', async () => {
    const seen = stubQrcode();
    const { renderSubmissionQr } = await import('./qr');

    const img = await renderSubmissionQr(9999999, SITE);

    expect(seen).toEqual([`${SITE}/works/9999999`]);
    expect(img).not.toBeNull();
  });

  it('id 换成另一个值时链接跟着换，作品不会串', async () => {
    const seen = stubQrcode();
    const { renderSubmissionQr } = await import('./qr');

    await renderSubmissionQr(128, SITE);

    expect(seen).toEqual([`${SITE}/works/128`]);
  });

  it('origin 是运行时参数：换一个 origin，链接的域名跟着换', async () => {
    const seen = stubQrcode();
    const { renderSubmissionQr } = await import('./qr');

    await renderSubmissionQr(42, 'http://localhost:5173');

    expect(seen).toEqual(['http://localhost:5173/works/42']);
  });
});
