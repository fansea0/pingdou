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
  { id: 'A01', rgb: [20, 20, 20], name: '主灰' },
  { id: 'A02', rgb: [104, 104, 104], name: '近灰' },
  { id: 'A03', rgb: [255, 0, 0], name: '罕见红' },
  { id: 'A04', rgb: [255, 255, 255], name: '背景白' },
];

function source(): ImageData {
  const pixels = new Uint8ClampedArray(11 * 4);
  for (let position = 0; position < 11; position += 1) {
    const value = position < 10 ? 20 : 0;
    const offset = position * 4;
    pixels[offset] = position === 10 ? 255 : value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return new ImageData(pixels, 11, 1);
}

function backgroundMaskedSource(): ImageData {
  const width = 200;
  const height = 100;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isSubject = x >= 40 && x < 160 && y >= 20 && y < 80;
      const isRareRed = x >= 112 && x < 136 && y >= 36 && y < 60;
      const [red, green, blue] = isRareRed
        ? [255, 0, 0]
        : isSubject
          ? [20, 20, 20]
          : [255, 255, 255];
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
  }

  return new ImageData(pixels, width, height);
}

function visibleColorCounts(indices: Uint8Array, mask: Uint8Array): number[] {
  const counts: number[] = [];
  for (let position = 0; position < indices.length; position += 1) {
    if (mask[position] === 0) {
      counts[indices[position]] = (counts[indices[position]] ?? 0) + 1;
    }
  }
  return counts.filter(Boolean);
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

  it('forces distant rare colors in the preview output when enabled', async () => {
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
  });

  it('simplifies independently sampled and background-masked export sizes', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);

    await pipeline.exportMulti(backgroundMaskedSource(), 24, 11, [8], true, true);

    expect(renderSquareBoard).toHaveBeenCalledTimes(2);
    expect(renderCompositeFromBoard).toHaveBeenCalledTimes(2);
    expect(renderSquareBoard.mock.calls.map(([, , , , gridSize]) => gridSize)).toEqual([11, 8]);

    const expectedDimensions = [[11, 6], [8, 4]];
    for (let callIndex = 0; callIndex < renderSquareBoard.mock.calls.length; callIndex += 1) {
      const [indices, outW, outH, , , , , mask] = renderSquareBoard.mock.calls[callIndex];
      const compositeCall = renderCompositeFromBoard.mock.calls[callIndex];

      expect([outW, outH]).toEqual(expectedDimensions[callIndex]);
      expect(mask).toBeInstanceOf(Uint8Array);
      expect(mask).toHaveLength(indices.length);
      const visibleCounts = visibleColorCounts(indices, mask!);
      expect(visibleCounts).not.toHaveLength(0);
      expect(visibleCounts.every(count => count >= 10)).toBe(true);
      expect(compositeCall[1]).toEqual(indices);
      expect(compositeCall[3]).toEqual(mask);
    }
  });
});
