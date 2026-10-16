import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ensureWorksQrImage, drawWorksQr, WORKS_QR_SRC } from '@/pipeline/qr';
import type { Palette, PipelineResult } from '@/types';

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
  const calls: { fillRect: number[][]; drawImage: number[][]; fillStyles: string[]; smoothing: boolean[] } =
    { fillRect: [], drawImage: [], fillStyles: [], smoothing: [] };
  const ctx = {
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillRect(...a: number[]) {
      // 记录落笔时的填色：只看坐标的话，把白底改成半透明也测不出来
      calls.fillStyles.push(ctx.fillStyle);
      calls.fillRect.push(a);
    },
    drawImage(...a: number[]) {
      calls.smoothing.push(ctx.imageSmoothingEnabled);
      calls.drawImage.push(a);
    },
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
    // 光断言坐标不够：白底被改成半透明同样会让码扫不出来
    expect(calls.fillStyles[0]).toBe('#ffffff');
  });

  it('关闭平滑再画，模块边缘不被插值糊掉', () => {
    const { canvas, calls } = spyCanvas(1000, 2000);
    drawWorksQr(canvas, fakeImg(111));
    // 开着平滑会让非整数缩放把相邻模块混色，直接影响可扫性
    expect(calls.smoothing[0]).toBe(false);
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

/**
 * pipeline 接入层覆盖。
 *
 * 没有这一组，删掉 pipeline.ts 里那两行 qrBandPx / drawWorksQr，整套单测照样全绿，
 * 而那正是本任务唯一真正改变成品图的改动。所以这里必须断言「两条导出路径拿到的
 * 画布高度确实多了二维码那条带子」。
 *
 * 用 doMock 而不是顶层 vi.mock：文件上半部分的 ensureWorksQrImage 用例要跑真实现，
 * 顶层 mock 会把它一起换掉。resetModules + 动态 import 才能让新加载的 pipeline
 * 模块看到 mock，同时不影响上面已经绑定好的真实导入。
 */
describe('pipeline 接入：二维码留白带真的进了成品图', () => {
  interface FakeQr {
    naturalWidth: number;
    naturalHeight: number;
  }

  const QR: FakeQr = { naturalWidth: 111, naturalHeight: 111 };
  const palette: Palette = [{ id: 'A01', rgb: [255, 0, 0], name: '红' }];

  let ensureWorksQrImage: Mock<() => Promise<FakeQr | null>>;
  let drawWorksQr: Mock<(canvas: HTMLCanvasElement, img: FakeQr) => void>;
  let canvasToBlob: Mock<(canvas: HTMLCanvasElement) => Promise<Blob>>;
  let triggerDownload: Mock;

  beforeEach(() => {
    vi.resetModules();
    ensureWorksQrImage = vi.fn(async (): Promise<FakeQr | null> => null);
    drawWorksQr = vi.fn();
    // 序列化是唯一能拿到「pipeline 内部渲染出的那张画布」的入口
    canvasToBlob = vi.fn(async () => new Blob(['board'], { type: 'image/png' }));
    triggerDownload = vi.fn();

    vi.doMock('@/pipeline/qr', () => ({
      ensureWorksQrImage,
      drawWorksQr,
      WORKS_QR_SRC,
      QR_LOAD_TIMEOUT_MS: 1500,
    }));
    vi.doMock('@/pipeline/exporter', () => ({ canvasToBlob, triggerDownload }));
    // 水印图标在 jsdom 里同样不派发事件，会白等 1.5s；这里换成即时的 null。
    // composite.ts 依赖 DEFAULT_WATERMARK_OPTIONS，所以保留原模块其余导出。
    vi.doMock('@/pipeline/watermark', async importOriginal => ({
      ...(await importOriginal<typeof import('@/pipeline/watermark')>()),
      applyWatermark: vi.fn(),
      ensureWatermarkIcon: vi.fn(async () => null),
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/pipeline/qr');
    vi.doUnmock('@/pipeline/exporter');
    vi.doUnmock('@/pipeline/watermark');
  });

  function baseResult(): PipelineResult {
    return {
      indices: new Uint8Array([0]),
      gridSize: 1,
      outW: 1,
      outH: 1,
      sourceW: 1,
      sourceH: 1,
      cropped: false,
      token: 1,
      mask: new Uint8Array(1),
      simplifyColors: false,
      colorBudget: 'off',
      colorSimplification: {
        beforeColorCount: 1,
        afterColorCount: 1,
        mergedColorCount: 0,
        rareColorCountBefore: 0,
        rareColorCountAfter: 0,
        minimumColorCountSatisfied: false,
        budgetLevel: 'off',
        budgetTargetColorCount: 0,
        budgetSatisfied: true,
        budgetFidelityLimited: false,
      },
    };
  }

  function source(width: number, height: number): ImageData {
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels.fill(255);
    return new ImageData(pixels, width, height);
  }

  /** 跑一次导出，返回 pipeline 交给序列化那一步的画布 */
  async function exportedCanvas(
    qr: FakeQr | null,
    // 返回类型放宽到 unknown：exportMulti 会返回 { success, failed } 统计
    exportOne: (pipeline: InstanceType<
      typeof import('@/pipeline/pipeline')['Pipeline']
    >) => Promise<unknown>
  ): Promise<HTMLCanvasElement> {
    ensureWorksQrImage.mockResolvedValue(qr);
    const { Pipeline } = await import('@/pipeline/pipeline');
    const pipeline = new Pipeline();
    pipeline.init(palette);
    await exportOne(pipeline);
    expect(canvasToBlob).toHaveBeenCalled();
    return canvasToBlob.mock.calls[0][0];
  }

  it('exportComposite 的成品高度比无码时恰好多出二维码高度', async () => {
    const base = await exportedCanvas(null, p => p.exportComposite(baseResult()));
    canvasToBlob.mockClear();
    drawWorksQr.mockClear();

    const withQr = await exportedCanvas(QR, p => p.exportComposite(baseResult()));

    expect(withQr.height - base.height).toBe(QR.naturalWidth);
    // 码要画在这张最终画布上，并且画在序列化之前
    expect(drawWorksQr).toHaveBeenCalledWith(withQr, QR);
    expect(drawWorksQr.mock.invocationCallOrder[0]).toBeLessThan(
      canvasToBlob.mock.invocationCallOrder[0]
    );
  });

  it('exportMulti 的成品高度比无码时恰好多出二维码高度', async () => {
    const base = await exportedCanvas(null, p => p.exportMulti(source(40, 20), 24, 4, [], false, false));
    canvasToBlob.mockClear();
    drawWorksQr.mockClear();

    const withQr = await exportedCanvas(QR, p => p.exportMulti(source(40, 20), 24, 4, [], false, false));

    expect(withQr.height - base.height).toBe(QR.naturalWidth);
    expect(drawWorksQr).toHaveBeenCalledWith(withQr, QR);
    expect(drawWorksQr.mock.invocationCallOrder[0]).toBeLessThan(
      canvasToBlob.mock.invocationCallOrder[0]
    );
  });

  it('二维码拿不到时静默降级：留白带为 0 且不调用 drawWorksQr', async () => {
    const canvas = await exportedCanvas(null, p => p.exportComposite(baseResult()));
    expect(drawWorksQr).not.toHaveBeenCalled();
    // 版式与二维码功能上线前完全一致，画布宽度也不受影响
    expect(canvas.width).toBeGreaterThan(0);
    expect(triggerDownload).toHaveBeenCalledTimes(1);
  });

  it('留白带高度取 naturalWidth，与 drawWorksQr 画的边长同源', async () => {
    // 非方码：留白带若误取 naturalHeight，高度差就会跟着变形
    const tall: FakeQr = { naturalWidth: 60, naturalHeight: 200 };
    const base = await exportedCanvas(null, p => p.exportComposite(baseResult()));
    canvasToBlob.mockClear();

    const withQr = await exportedCanvas(tall, p => p.exportComposite(baseResult()));

    expect(withQr.height - base.height).toBe(60);
  });
});
