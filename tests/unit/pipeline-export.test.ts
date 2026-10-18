import { beforeEach, describe, expect, it, vi } from 'vitest';

const { applyWatermark, ensureWatermarkIcon, canvasToBlob, triggerDownload } = vi.hoisted(() => ({
  applyWatermark: vi.fn(),
  ensureWatermarkIcon: vi.fn(async () => null),
  canvasToBlob: vi.fn<(canvas: HTMLCanvasElement) => Promise<Blob>>(
    async () => new Blob(['board'], { type: 'image/png' })
  ),
  triggerDownload: vi.fn(),
}));

vi.mock('@/pipeline/exporter', () => ({
  canvasToBlob,
  triggerDownload,
}));

// composite.ts 读 DEFAULT_WATERMARK_OPTIONS 算页眉右侧的品牌预留位，
// 所以这里必须保留真实导出，只把两个绘制/加载入口换成 spy。
vi.mock('@/pipeline/watermark', async importOriginal => ({
  ...(await importOriginal<typeof import('@/pipeline/watermark')>()),
  applyWatermark,
  ensureWatermarkIcon,
}));

import { Pipeline } from '@/pipeline/pipeline';
import type { Palette, PipelineResult } from '@/types';

const palette: Palette = [{ id: 'A01', rgb: [255, 0, 0], name: '红' }];

function source(width: number, height: number): ImageData {
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.fill(255);
  return new ImageData(pixels, width, height);
}

/** 白底 + 居中一块深色主体，用于验证去背景 + 裁边 */
function paddedSubjectSource(): ImageData {
  const width = 100;
  const height = 100;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const isSubject = x >= 40 && x < 60 && y >= 30 && y < 50;
      const value = isSubject ? 20 : 255;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return new ImageData(pixels, width, height);
}

function baseResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
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
      budgetLevel: 'off' as const,
      budgetTargetColorCount: 0,
      budgetSatisfied: true,
      budgetFidelityLimited: false,
    },
    ...overrides,
  };
}

describe('Pipeline.exportMulti', () => {
  beforeEach(() => {
    canvasToBlob.mockClear();
    triggerDownload.mockClear();
    applyWatermark.mockClear();
  });

  it('exports the board with its legend and watermark', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    await pipeline.exportMulti(source(40, 20), 24, 4, [], false, false);

    const compositeCanvas = canvasToBlob.mock.calls[0][0];
    expect(compositeCanvas).toEqual(expect.objectContaining({ width: expect.any(Number) }));
    expect(compositeCanvas.width).toBeGreaterThan(96);
    expect(applyWatermark).toHaveBeenCalledWith(compositeCanvas, {
      anchor: 'header-right',
      insetY: expect.any(Number),
    });
    expect(applyWatermark.mock.invocationCallOrder[0]).toBeLessThan(
      canvasToBlob.mock.invocationCallOrder[0]
    );
  });

  it('skips the watermark when it is turned off, but still exports the image', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    // watermark = false 是最后一位：关掉水印后图照样出，只是页眉不再有品牌标识。
    // 图标是异步资源，漏调 ensureWatermarkIcon 也不会让这条变慢 —— 这里断的是
    // 「有没有调 applyWatermark」，删掉那行 if 时唯一会红的地方。
    await pipeline.exportMulti(source(40, 20), 24, 4, [], false, false, true, 'off', false);

    expect(applyWatermark).not.toHaveBeenCalled();
    expect(triggerDownload).toHaveBeenCalledTimes(1);
  });

  it('names the file after the real output size, not the board preset', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    // 40x20 源图 → 采样成 4x2（非方图）
    await pipeline.exportMulti(source(40, 20), 24, 4, [], false, false);

    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), 'pingdou-4x2.png');
  });

  it('names the file with the square board size when tight crop is off', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    await pipeline.exportMulti(source(40, 20), 24, 4, [], false, false, false);

    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), 'pingdou-4x4.png');
  });

  it('exports one image per requested grid size', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    await pipeline.exportMulti(source(40, 20), 24, 8, [4], false, false);

    expect(triggerDownload).toHaveBeenCalledTimes(2);
  });
});

describe('Pipeline tight crop', () => {
  beforeEach(() => {
    canvasToBlob.mockClear();
    triggerDownload.mockClear();
    applyWatermark.mockClear();
  });

  it('shrinks the output grid to the subject plus padding', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    let result: PipelineResult | undefined;

    await pipeline.process(
      paddedSubjectSource(),
      { gridSize: 20, removeBackground: true, simplifyColors: false, tightCrop: true,
    colorBudget: 'off',
  },
      () => {},
      value => {
        result = value;
      }
    );

    expect(result).toBeDefined();
    expect(result!.cropped).toBe(true);
    // 主体 20x20 + 四周各 2 格 padding
    expect(result!.outW).toBeLessThan(result!.sourceW);
    expect(result!.indices).toHaveLength(result!.outW * result!.outH);
    expect(result!.mask).toHaveLength(result!.outW * result!.outH);
  });

  it('keeps the sampled grid untouched when tight crop is off', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    let result: PipelineResult | undefined;

    await pipeline.process(
      paddedSubjectSource(),
      { gridSize: 20, removeBackground: true, simplifyColors: false, tightCrop: false,
    colorBudget: 'off',
  },
      () => {},
      value => {
        result = value;
      }
    );

    expect(result!.cropped).toBe(false);
    expect([result!.outW, result!.outH]).toEqual([result!.sourceW, result!.sourceH]);
  });

  it('never crops when background removal is off (nothing to detect)', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    let result: PipelineResult | undefined;

    await pipeline.process(
      paddedSubjectSource(),
      { gridSize: 20, removeBackground: false, simplifyColors: false, tightCrop: true,
    colorBudget: 'off',
  },
      () => {},
      value => {
        result = value;
      }
    );

    expect(result!.cropped).toBe(false);
  });
});

describe('Pipeline.exportComposite', () => {
  beforeEach(() => {
    canvasToBlob.mockClear();
    triggerDownload.mockClear();
    applyWatermark.mockClear();
  });

  it('applies the watermark before serializing the composite', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    await pipeline.exportComposite(baseResult());

    const compositeCanvas = canvasToBlob.mock.calls[0][0];
    expect(applyWatermark).toHaveBeenCalledWith(compositeCanvas, {
      anchor: 'header-right',
      insetY: expect.any(Number),
    });
    expect(applyWatermark.mock.invocationCallOrder[0]).toBeLessThan(
      canvasToBlob.mock.invocationCallOrder[0]
    );
  });
});