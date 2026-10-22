import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundMask, Palette, PipelineResult, ProcessParams } from '@/types';

const { renderBeadBoard, renderCompositeFromBoard, canvasToBlob, triggerDownload } = vi.hoisted(
  () => ({
    renderBeadBoard: vi.fn<
      (
        indices: Uint8Array,
        outW: number,
        outH: number,
        palette: Palette,
        options?: { readonly mask?: BackgroundMask | null },
      ) => HTMLCanvasElement
    >(() => document.createElement('canvas')),
    renderCompositeFromBoard: vi.fn<
      (
        boardCanvas: HTMLCanvasElement,
        indices: Uint8Array,
        outW: number,
        outH: number,
        palette: Palette,
        mask: BackgroundMask | null,
      ) => HTMLCanvasElement
    >(() => document.createElement('canvas')),
    canvasToBlob: vi.fn<(canvas: HTMLCanvasElement) => Promise<Blob>>(
      async () => new Blob(['board'], { type: 'image/png' })
    ),
    triggerDownload: vi.fn<(blob: Blob, filename: string) => void>(),
  })
);

vi.mock('@/pipeline/board', async () => {
  const actual = await vi.importActual<typeof import('@/pipeline/board')>('@/pipeline/board');
  return { ...actual, renderBeadBoard };
});
vi.mock('@/pipeline/composite', () => ({
  DEFAULT_COMPOSITE_OPTIONS: { cellPx: 32 },
  renderComposite: vi.fn(() => document.createElement('canvas')),
  renderCompositeFromBoard,
}));
vi.mock('@/pipeline/exporter', () => ({ canvasToBlob, triggerDownload }));
vi.mock('@/pipeline/watermark', () => ({ applyWatermark: vi.fn() }));

import { Pipeline } from '@/pipeline/pipeline';

/**
 * 色板里特意放了一个灰：红绿各半的边界格平均出来是 (128,128,0)，
 * 它离红、绿都远，只有灰色这一档能接住 —— 于是「渐变」和「同步相近色」
 * 两种模式会落在不同的色号上，差异在索引里看得见。
 */
const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 255, 0], name: '绿' },
  { id: 'A03', rgb: [128, 128, 128], name: '灰' },
];

/** 4x4 原图 → 2x2 网格，每格红绿各半；每格第一个像素是红，吸附结果因此稳定 */
function halfAndHalfSource(): ImageData {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const local = (y % 2) * 2 + (x % 2);
      const i = (y * 4 + x) * 4;
      const isRed = local < 2;
      pixels[i] = isRed ? 255 : 0;
      pixels[i + 1] = isRed ? 0 : 255;
      pixels[i + 2] = 0;
      pixels[i + 3] = 255;
    }
  }
  return new ImageData(pixels, 4, 4);
}

function params(sampleMode: ProcessParams['sampleMode']): ProcessParams {
  return {
    gridSize: 2,
    removeBackground: false,
    simplifyColors: false,
    tightCrop: true,
    colorBudget: 'off',
    sampleMode,
  };
}

async function processWith(sampleMode: ProcessParams['sampleMode']): Promise<PipelineResult> {
  const pipeline = new Pipeline();
  pipeline.init(palette);
  let result: PipelineResult | undefined;
  await pipeline.process(
    halfAndHalfSource(),
    params(sampleMode),
    () => {},
    value => {
      result = value;
    }
  );
  if (!result) throw new Error('pipeline did not produce a result');
  return result;
}

describe('Pipeline 采样模式', () => {
  beforeEach(() => {
    renderBeadBoard.mockClear();
    renderCompositeFromBoard.mockClear();
    canvasToBlob.mockClear();
    triggerDownload.mockClear();
  });

  it('渐变色模式下边界格保留混合色，落到了灰色那一档', async () => {
    const result = await processWith('gradient');

    expect(result.sampleMode).toBe('gradient');
    expect(Array.from(result.indices)).toEqual([2, 2, 2, 2]);
  });

  it('同步相近色模式下边界格吸附主色，落到了红色那一档', async () => {
    const result = await processWith('similar');

    expect(result.sampleMode).toBe('similar');
    expect(Array.from(result.indices)).toEqual([0, 0, 0, 0]);
  });

  it('导出按传入的采样模式出图，不会退回默认的渐变模式', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    const src = halfAndHalfSource();

    await pipeline.exportMulti(src, 24, 2, [], false, false, true, 'off', 'gradient', false);
    await pipeline.exportMulti(src, 24, 2, [], false, false, true, 'off', 'similar', false);

    const exported = renderBeadBoard.mock.calls.map(call => Array.from(call[0]));
    expect(exported).toHaveLength(2);
    expect(exported[0]).not.toEqual(exported[1]);
    expect(exported[0]).toEqual([2, 2, 2, 2]);
    expect(exported[1]).toEqual([0, 0, 0, 0]);
  });
});
