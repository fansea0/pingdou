import { beforeEach, describe, expect, it, vi } from 'vitest';

const { canvasToBlob, triggerDownload } = vi.hoisted(() => ({
  canvasToBlob: vi.fn(async () => new Blob(['board'], { type: 'image/png' })),
  triggerDownload: vi.fn(),
}));

vi.mock('@/pipeline/exporter', () => ({
  canvasToBlob,
  triggerDownload,
}));

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
  });

  it('exports the selected square board size instead of PipelineResult.gridSize', async () => {
    const pipeline = new Pipeline();
    pipeline.init(palette);
    await pipeline.exportMulti(source(40, 20), 24, 4, [], false);

    expect(canvasToBlob).toHaveBeenCalledWith(expect.objectContaining({ width: 96, height: 96 }));
    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), 'pingdou-4x4.png');
  });
});
