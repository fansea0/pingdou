import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { drawWorksQr } from '@/pipeline/qr';
import type { Palette, PipelineResult } from '@/types';

const originalImage = globalThis.Image;

afterEach(() => {
  globalThis.Image = originalImage;
  vi.useRealTimers();
});

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
 * 导出/下载路径不带二维码。
 *
 * 这一组是**反着**写的。之前导出图右下角贴着一枚指向 /works 的全站码，
 * 撤掉之后如果不留这道闸，谁都能顺手加回去 —— 而且两处改动（pipeline.ts 里
 * 的 drawWorksQr 调用和 qrBandPx 预留）都会让成品高度悄悄涨回去，肉眼很难发现。
 *
 * 断言的是「导出全程没碰 qr 模块」，而不是「画出来的图上看不见码」：
 * 后者在 1×1 的夹具上根本分辨不出来。这里把 composite 的两个渲染函数换成
 * 记录版，直接检查它们收到的 options 里有没有那条白带。
 *
 * 用 doMock 而不是顶层 vi.mock：文件上半部分的 drawWorksQr 用例要跑真实现，
 * 顶层 mock 会把它一起换掉。resetModules + 动态 import 才能让新加载的
 * pipeline 模块看到 mock，同时不影响上面已经绑定好的真实导入。
 */
describe('导出路径：既不预留二维码白带，也不画码', () => {
  const palette: Palette = [{ id: 'A01', rgb: [255, 0, 0], name: '红' }];

  /** composite 两个渲染函数各自收到的 options 里的 qrBandPx */
  let bandHeights: (number | null | undefined)[];
  let drawWorksQrMock: Mock;
  let canvasToBlob: Mock<(canvas: HTMLCanvasElement) => Promise<Blob>>;
  let triggerDownload: Mock;

  beforeEach(() => {
    vi.resetModules();
    bandHeights = [];
    drawWorksQrMock = vi.fn();
    canvasToBlob = vi.fn(async () => new Blob(['board'], { type: 'image/png' }));
    triggerDownload = vi.fn();

    vi.doMock('@/pipeline/qr', () => ({ drawWorksQr: drawWorksQrMock }));
    vi.doMock('@/pipeline/exporter', () => ({ canvasToBlob, triggerDownload }));
    // 水印图标在 jsdom 里同样不派发事件，会白等 1.5s；这里换成即时的 null。
    // composite.ts 依赖 DEFAULT_WATERMARK_OPTIONS，所以保留原模块其余导出。
    vi.doMock('@/pipeline/watermark', async importOriginal => ({
      ...(await importOriginal<typeof import('@/pipeline/watermark')>()),
      applyWatermark: vi.fn(),
      ensureWatermarkIcon: vi.fn(async () => null),
    }));
    // 只换掉两个出图的入口：换成记录版后既能抓到 options，
    // 又不必让 1×1 的夹具真的渲染出什么像素。
    vi.doMock('@/pipeline/composite', async importOriginal => ({
      ...(await importOriginal<typeof import('@/pipeline/composite')>()),
      renderComposite: (...a: unknown[]) => {
        bandHeights.push((a[4] as { qrBandPx?: number } | undefined)?.qrBandPx);
        return { width: 800, height: 1200, getContext: () => null } as unknown as HTMLCanvasElement;
      },
      renderCompositeFromBoard: (...a: unknown[]) => {
        bandHeights.push((a[6] as { qrBandPx?: number } | undefined)?.qrBandPx);
        return { width: 800, height: 1200, getContext: () => null } as unknown as HTMLCanvasElement;
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/pipeline/qr');
    vi.doUnmock('@/pipeline/exporter');
    vi.doUnmock('@/pipeline/watermark');
    vi.doUnmock('@/pipeline/composite');
  });

  async function runExport(
    exportOne: (pipeline: InstanceType<typeof import('@/pipeline/pipeline')['Pipeline']>) => Promise<unknown>,
  ) {
    const { Pipeline } = await import('@/pipeline/pipeline');
    const pipeline = new Pipeline();
    pipeline.init(palette);
    await exportOne(pipeline);
  }

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
      sampleMode: 'gradient' as const,
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

  it('exportComposite 不传 qrBandPx、也不调用 drawWorksQr', async () => {
    await runExport(p => p.exportComposite(baseResult()));

    expect(bandHeights).toHaveLength(1);
    expect(bandHeights[0] ?? 0).toBe(0);
    expect(drawWorksQrMock).not.toHaveBeenCalled();
  });

  it('exportMulti 每张尺寸都不传 qrBandPx、也不调用 drawWorksQr', async () => {
    // 显式关掉紧裁剪：这条用例只想验「有没有白带」，不该跟着裁剪链路的改动一起变红
    await runExport(p =>
      p.exportMulti(source(40, 20), 24, 2, [16], false, false, false)
    );

    // 2 张（主尺寸 24 + 额外 16），两张都得查 —— 只查第一张会漏掉循环体里的改动
    expect(bandHeights).toHaveLength(2);
    for (const h of bandHeights) expect(h ?? 0).toBe(0);
    expect(drawWorksQrMock).not.toHaveBeenCalled();
  });

  it('导出照常成功：拿掉二维码不能连带把下载弄坏', async () => {
    await runExport(p => p.exportComposite(baseResult()));
    expect(canvasToBlob).toHaveBeenCalledTimes(1);
    expect(triggerDownload).toHaveBeenCalledTimes(1);
  });
});
