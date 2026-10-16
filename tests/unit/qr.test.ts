import { describe, it, expect, vi, afterEach } from 'vitest';
import { ensureWorksQrImage, drawWorksQr, WORKS_QR_SRC } from '@/pipeline/qr';

const originalImage = globalThis.Image;

afterEach(() => {
  globalThis.Image = originalImage;
  vi.useRealTimers();
});

/** 造一个可控加载结果的 Image 替身 */
function stubImage(opts: { fail?: boolean; natural?: number } = {}) {
  class FakeImage {
    naturalWidth = opts.natural ?? 0;
    naturalHeight = opts.natural ?? 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      // 同步派发，模拟资源已缓存的情况
      if (opts.fail) queueMicrotask(() => this.onerror?.());
      else queueMicrotask(() => this.onload?.());
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image;
}

/** 一个只记录调用、不碰真实像素的画布 */
function spyCanvas(width: number, height: number) {
  const calls: { fillRect: number[][]; drawImage: number[][] } = { fillRect: [], drawImage: [] };
  const ctx = {
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillRect(...a: number[]) { calls.fillRect.push(a); },
    drawImage(...a: number[]) { calls.drawImage.push(a); },
    save() {}, restore() {},
  };
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('ensureWorksQrImage', () => {
  it('资源加载成功后 resolve 出图片对象', async () => {
    stubImage({ natural: 111 });
    const img = await ensureWorksQrImage('/brand/test-ok.png');
    expect(img).not.toBeNull();
    expect(img!.naturalWidth).toBe(111);
  });

  it('加载失败 resolve null 而不是 reject', async () => {
    stubImage({ fail: true });
    expect(await ensureWorksQrImage('/brand/test-fail.png')).toBeNull();
  });

  it('Image 事件永不派发时靠超时兜底，不挂起', async () => {
    vi.useFakeTimers();
    class SilentImage {
      naturalWidth = 0; naturalHeight = 0;
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(_v: string) { /* 什么都不做，模拟 jsdom 不派发事件 */ }
    }
    globalThis.Image = SilentImage as unknown as typeof Image;
    const p = ensureWorksQrImage('/brand/test-silent.png');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBeNull();
  });

  it('默认资源路径是构建期产物', () => {
    expect(WORKS_QR_SRC).toBe('/brand/works-qr.png');
  });
});

describe('drawWorksQr', () => {
  function fakeImg(size: number) {
    return { naturalWidth: size, naturalHeight: size } as HTMLImageElement;
  }

  it('按 1:1 原尺寸画在右下角，距边 = padding(20)', () => {
    const { canvas, calls } = spyCanvas(1000, 2000);
    drawWorksQr(canvas, fakeImg(111));
    // 1000 - 20 - 111 = 869 ; 2000 - 20 - 111 = 1869
    expect(calls.drawImage[0].slice(1)).toEqual([869, 1869, 111, 111]);
  });

  it('先铺不透明白底再画，保证与色卡底色不混色', () => {
    const { canvas, calls } = spyCanvas(1000, 2000);
    drawWorksQr(canvas, fakeImg(111));
    expect(calls.fillRect[0]).toEqual([869, 1869, 111, 111]);
    expect(calls.fillRect[0].length).toBe(4);
  });

  it('naturalWidth 为 0 时是 no-op', () => {
    const { canvas, calls } = spyCanvas(1000, 2000);
    drawWorksQr(canvas, fakeImg(0));
    expect(calls.drawImage).toHaveLength(0);
    expect(calls.fillRect).toHaveLength(0);
  });

  it('拿不到 2D context 时不抛错', () => {
    const canvas = {
      width: 1000, height: 2000,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    expect(() => drawWorksQr(canvas, fakeImg(111))).not.toThrow();
  });
});
