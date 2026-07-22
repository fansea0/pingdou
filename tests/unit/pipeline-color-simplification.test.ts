import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundMask, Palette, PipelineResult } from '@/types';

const {
  canvasToBlob,
  renderComposite,
  renderCompositeFromBoard,
  renderSquareBoard,
  triggerDownload,
} = vi.hoisted(() => ({
  canvasToBlob: vi.fn<(canvas: HTMLCanvasElement) => Promise<Blob>>(
    async () => new Blob(['board'], { type: 'image/png' }),
  ),
  renderComposite: vi.fn<
    (
      indices: Uint8Array,
      outW: number,
      outH: number,
      palette: Palette,
      options?: { readonly cellPx?: number },
      mask?: BackgroundMask | null,
    ) => HTMLCanvasElement
  >(() => document.createElement('canvas')),
  renderCompositeFromBoard: vi.fn<
    (
      boardCanvas: HTMLCanvasElement,
      indices: Uint8Array,
      palette: Palette,
      mask: BackgroundMask | null,
    ) => HTMLCanvasElement
  >(() => document.createElement('canvas')),
  renderSquareBoard: vi.fn<
    (
      indices: Uint8Array,
      outW: number,
      outH: number,
      palette: Palette,
      boardSize: number,
      cellPx: number,
      fontPx: number,
      mask?: BackgroundMask | null,
    ) => HTMLCanvasElement
  >(() => document.createElement('canvas')),
  triggerDownload: vi.fn<(blob: Blob, filename: string) => void>(),
}));

vi.mock('@/pipeline/squareBoard', () => ({ renderSquareBoard }));
vi.mock('@/pipeline/composite', () => ({
  DEFAULT_COMPOSITE_OPTIONS: { cellPx: 32 },
  renderComposite,
  renderCompositeFromBoard,
}));
vi.mock('@/pipeline/exporter', () => ({ canvasToBlob, triggerDownload }));
vi.mock('@/pipeline/watermark', () => ({ applyWatermark: vi.fn() }));

import { Pipeline } from '@/pipeline/pipeline';

const palette: Palette = [
  { id: 'A01', rgb: [100, 100, 100], name: '主灰' },
  { id: 'A02', rgb: [104, 104, 104], name: '近灰' },
  { id: 'A03', rgb: [255, 0, 0], name: '罕见红' },
];

function source(): ImageData {
  const pixels = new Uint8ClampedArray(11 * 4);
  for (let position = 0; position < 11; position += 1) {
    const value = position < 10 ? 100 : 0;
    const offset = position * 4;
    pixels[offset] = position === 10 ? 255 : value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return new ImageData(pixels, 11, 1);
}

async function process(simplifyColors: boolean): Promise<PipelineResult> {
  const pipeline = new Pipeline();
  pipeline.init(palette);
  let result: PipelineResult | undefined;

  await pipeline.process(
    source(),
    { gridSize: 11, removeBackground: false, simplifyColors },
    () => {},
    value => {
      result = value;
    },
  );

  if (!result) throw new Error('Pipeline did not return a result');
  return result;
}

describe('Pipeline color simplification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves quantized indices and reports unchanged colors when disabled', async () => {
    const result = await process(false);

    expect(result.indices).toEqual(Uint8Array.from([...Array(10).fill(0), 2]));
    expect(result.colorSimplification).toEqual({
      beforeColorCount: 2,
      afterColorCount: 2,
      mergedColorCount: 0,
      rareColorCountBefore: 1,
      rareColorCountAfter: 1,
      minimumColorCountSatisfied: false,
    });
  });

  it('forces distant rare colors in preview and export output when enabled', async () => {
    const result = await process(true);

    expect(result.indices).toEqual(new Uint8Array(11));
    expect(result.colorSimplification).toEqual({
      beforeColorCount: 2,
      afterColorCount: 1,
      mergedColorCount: 1,
      rareColorCountBefore: 1,
      rareColorCountAfter: 0,
      minimumColorCountSatisfied: true,
    });

    const pipeline = new Pipeline();
    pipeline.init(palette);

    await pipeline.exportMulti(source(), 24, 11, [], false, true);

    const boardIndices = renderSquareBoard.mock.calls[0][0];
    const compositeIndices = renderCompositeFromBoard.mock.calls[0][1];
    expect(boardIndices).toEqual(new Uint8Array(11));
    expect(compositeIndices).toEqual(new Uint8Array(11));
    expect(boardIndices).toEqual(result.indices);
    expect(compositeIndices).toEqual(result.indices);
    expect(compositeIndices).toEqual(boardIndices);
  });
});
