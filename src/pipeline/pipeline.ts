import { sampleImage } from './sampler';
import { quantizeWithCanvas2D } from './quantizer.canvas';
import { renderPaletteImage } from './renderer';
import { renderAnnotatedImage } from './annotator';
import { generateRecipeCSV } from './recipe';
import { exportTriptych } from './exporter';
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
      onResult({ indices, gridSize: sampled.width, token: myToken });
    } catch (err) {
      onStatus('ready');
      throw err;
    }
  }

  async exportAll(
    result: PipelineResult,
    exportCellPx: number
  ): Promise<void> {
    if (!this.palette) throw new Error('Pipeline not initialized');
    const { indices, gridSize } = result;

    const canvasNoAnn = renderPaletteImage(indices, gridSize, this.palette, exportCellPx, null);

    let canvasAnn: HTMLCanvasElement | null = null;
    if (exportCellPx >= 24) {
      canvasAnn = renderAnnotatedImage(indices, gridSize, this.palette, exportCellPx, Math.floor(exportCellPx / 2.5));
    }

    const recipeBlob = generateRecipeCSV(indices, gridSize, this.palette);

    await exportTriptych(gridSize, canvasNoAnn, canvasAnn, recipeBlob);
  }
}
