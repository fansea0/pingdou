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
    const { indices, outW, outH } = result;

    const canvas = renderComposite(indices, outW, outH, this.palette, {
      cellPx: DEFAULT_COMPOSITE_OPTIONS.cellPx,
    });
    const blob = await canvasToBlob(canvas);
    triggerDownload(blob, `pingdou-${outW}x${outH}-composite.png`);
  }

  renderPreview(result: PipelineResult, cellPx: number): HTMLCanvasElement | null {
    if (!this.palette) return null;
    return renderPaletteImage(
      result.indices,
      result.outW,
      result.outH,
      this.palette,
      cellPx,
      null
    );
  }

  /**
   * Export multiple composite images in sequence.
   * Re-samples for each extra gridSize (preserving source aspect ratio).
   * Triggers downloads 100ms apart so the browser does not block.
   */
  async exportMulti(
    src: ImageData,
    currentResult: PipelineResult,
    exportCellPx: number,
    extraGridSizes: number[],
    enableDither: boolean
  ): Promise<{ success: number; failed: number }> {
    if (!this.palette) throw new Error('Pipeline not initialized');

    const sizes = [currentResult.gridSize, ...extraGridSizes.filter(n => n !== currentResult.gridSize)];
    let success = 0;
    let failed = 0;

    for (let i = 0; i < sizes.length; i++) {
      const gridSize = sizes[i];
      try {
        const sampled = sampleImage(src, gridSize);
        const indices = quantizeWithCanvas2D(sampled, this.palette, enableDither);
        const compositeCanvas = renderComposite(
          indices,
          sampled.width,
          sampled.height,
          this.palette,
          { cellPx: exportCellPx }
        );
        const blob = await canvasToBlob(compositeCanvas);
        triggerDownload(blob, `pingdou-${sampled.width}x${sampled.height}.png`);
        success++;
        if (i < sizes.length - 1) {
          await new Promise(r => setTimeout(r, 100));
        }
      } catch (err) {
        failed++;
        console.error(`exportMulti failed for gridSize ${gridSize}:`, err);
      }
    }

    return { success, failed };
  }
}
