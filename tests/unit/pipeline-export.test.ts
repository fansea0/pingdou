import { beforeEach, describe, expect, it, vi } from 'vitest';

const { applyWatermark, canvasToBlob, triggerDownload } = vi.hoisted(() => ({
  applyWatermark: vi.fn(),
  canvasToBlob: vi.fn<(canvas: HTMLCanvasElement) => Promise<Blob>>(
    async () => new Blob(['board'], { type: 'image/png' })
  ),
  triggerDownload: vi.fn(),
}));

vi.mock('@/pipeline/exporter', () => ({
  canvasToBlob,
  triggerDownload,
}));

vi.mock('@/pipeline/watermark', () => ({ applyWatermark }));

import { Pipeline } from '@/pipeline/pipeline';
import type { Palette } from '@/types';

const palette: Palette = [{ id: 'A01', rgb: [255, 0, 0], name: '红' }];

function source(width: number, height: number): ImageData {
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.fill(255);
  return new ImageData(pixels, width, height);
}

describe('Pipeline.exportMulti', () => {
  beforeEach(() => {
    canvasToBlob.mockClear();
    triggerDownload.mockClear();
    applyWatermark.mockClear();
  });

  it('exports the selected square board with its legend and watermark', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    await pipeline.exportMulti(source(40, 20), 24, 4, [], false, false);

    const compositeCanvas = canvasToBlob.mock.calls[0][0];
    expect(compositeCanvas).toEqual(expect.objectContaining({ width: expect.any(Number) }));
    expect(compositeCanvas.width).toBeGreaterThan(96);
    expect(applyWatermark).toHaveBeenCalledWith(compositeCanvas);
    expect(applyWatermark.mock.invocationCallOrder[0]).toBeLessThan(
      canvasToBlob.mock.invocationCallOrder[0]
    );
    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), 'pingdou-4x4.png');
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
    await pipeline.exportComposite({
      indices: new Uint8Array([0]),
      gridSize: 1,
      outW: 1,
      outH: 1,
      token: 1,
      mask: new Uint8Array(1),
      colorSimplification: {
        beforeColorCount: 1,
        afterColorCount: 1,
        mergedColorCount: 0,
        rareColorCountBefore: 0,
        rareColorCountAfter: 0,
        minimumColorCountSatisfied: true,
      },
    });

    const compositeCanvas = canvasToBlob.mock.calls[0][0];
    expect(applyWatermark).toHaveBeenCalledWith(compositeCanvas);
    expect(applyWatermark.mock.invocationCallOrder[0]).toBeLessThan(
      canvasToBlob.mock.invocationCallOrder[0]
    );
  });
});
