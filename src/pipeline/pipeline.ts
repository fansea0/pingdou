import { sampleImage } from './sampler';
import { quantizeWithCanvas2D } from './quantizer.canvas';
import { renderPaletteImage } from './renderer';
import { renderComposite, DEFAULT_COMPOSITE_OPTIONS } from './composite';
import { canvasToBlob, triggerDownload } from './exporter';
import type { Palette, ProcessParams, PipelineResult, UIStatus } from '@/types';

export class Pipeline {
  private token = 0;
  private palette: Palette | null = null;

  init(palette: Palette): void {
    this.palette = palette;
  }

  async process(
    src: ImageData,
    params: ProcessParams,
    onStatus: (s: UIStatus) => void,
    onResult: (r: PipelineResult) => void
  ): Promise<void> {
    if (!this.palette) throw new Error('Pipeline not initialized');
    const myToken = ++this.token;

    try {
      onStatus('recomputing');
      const sampled = sampleImage(src, params.gridSize);
      if (myToken !== this.token) return;

      const indices = quantizeWithCanvas2D(sampled, this.palette, params.enableDither);
      if (myToken !== this.token) return;

      onStatus('ready');
      onResult({
        indices,
        gridSize: sampled.width,
        outW: sampled.width,
        outH: sampled.height,
        token: myToken,
      });
    } catch (err) {
      onStatus('ready');
      throw err;
    }
  }

  /**
   * Export a single composite image (bead image with color-code annotations + legend table).
   */
  async exportComposite(result: PipelineResult): Promise<void> {
    if (!this.palette) throw new Error('Pipeline not initialized');
    const { indices, gridSize } = result;

    const canvas = renderComposite(indices, gridSize, this.palette, {
      cellPx: DEFAULT_COMPOSITE_OPTIONS.cellPx,
    });
    const blob = await canvasToBlob(canvas);
    triggerDownload(blob, `pingdou-${gridSize}x${gridSize}-composite.png`);
  }

  renderPreview(result: PipelineResult, cellPx: number): HTMLCanvasElement | null {
    if (!this.palette) return null;
    return renderPaletteImage(
      result.indices,
      result.gridSize,
      this.palette,
      cellPx,
      null
    );
  }
}
