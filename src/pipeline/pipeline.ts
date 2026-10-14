import { sampleImage } from './sampler';
import { quantizeWithCanvas2D } from './quantizer.canvas';
import { renderPaletteImage } from './renderer';
import {
  renderComposite,
  renderCompositeFromBoard,
  DEFAULT_COMPOSITE_OPTIONS,
} from './composite';
import { renderBeadBoard, padToSquareGrid } from './board';
import { cropGridToContent, DEFAULT_CROP_PADDING } from './crop';
import { canvasToBlob, triggerDownload } from './exporter';
import { applyWatermark } from './watermark';
import { simplifyRareColors, summarizeColors } from './colorSimplifier';
import {
  buildBackgroundMask,
  detectBackground,
  downsampleMaskByAll,
  filterMaskByBorderConnectivity,
} from './bgRemover';
import type {
  Palette,
  ProcessParams,
  PipelineResult,
  UIStatus,
  BackgroundMask,
  RGB,
} from '@/types';
import type { ColorSimplificationResult } from './colorSimplifier';

/** 水印落在页眉右侧，绝不遮挡底部色卡 */
function watermarkPlacement(): { anchor: 'header-right'; insetY: number } {
  return {
    anchor: 'header-right',
    insetY: DEFAULT_COMPOSITE_OPTIONS.padding + DEFAULT_COMPOSITE_OPTIONS.headerHeight / 2,
  };
}

export class Pipeline {
  private token = 0;
  private palette: Palette | null = null;

  init(palette: Palette): void {
    this.palette = palette;
  }

  private applyColorSimplification(
    indices: Uint8Array,
    mask: BackgroundMask,
    enabled: boolean
  ): ColorSimplificationResult {
    if (!this.palette) throw new Error('Pipeline not initialized');
    if (enabled) return simplifyRareColors(indices, this.palette, mask);
    return {
      indices,
      stats: summarizeColors(indices, this.palette, mask),
    };
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

      const indices = quantizeWithCanvas2D(sampled, this.palette);
      if (myToken !== this.token) return;

      const outW = sampled.width;
      const outH = sampled.height;
      const n = outW * outH;
      const mask: BackgroundMask = new Uint8Array(n);
      let detectedBg: RGB | null = null;

      if (params.removeBackground) {
        const detected = detectBackground(src, sampled);
        if (detected) {
          detectedBg = detected.bg;
          // Build mask at source resolution so thin outlines (1-2 px) keep
          // their true dark color. Then AND-downsample to grid: a cell is
          // bg only if EVERY source pixel in its area is bg, so any cell
          // touching the outline stays non-bg and breaks the leak.
          const { mask: srcMask, bgCount: srcBgCount } = buildBackgroundMask(
            src,
            detected.bg
          );
          const gridMask = downsampleMaskByAll(
            srcMask,
            src.width,
            src.height,
            outW,
            outH
          );
          const filtered = filterMaskByBorderConnectivity(gridMask, outW, outH);
          let kept = 0;
          filtered.forEach((v, i) => {
            if (v) kept++;
            mask[i] = v;
          });
          console.info(
            `[pingdou] bg detected = rgb(${detected.bg.join(',')}), ` +
              `kept ${kept}/${n} border-connected cells ` +
              `(src ${srcBgCount}/${src.width * src.height} → grid ${gridMask.reduce((s, v) => s + v, 0)}/${n})`
          );
        } else {
          console.warn(
            `[pingdou] 自动去背景：未能识别纯色背景。请确保四角为同色背景，或关闭此开关。`
          );
        }
      }

      if (myToken !== this.token) return;

      const colorSimplification = this.applyColorSimplification(
        indices,
        mask,
        params.simplifyColors
      );

      // 裁边必须在简化之后：先让主体外的空白格不再干扰 rare color 统计，
      // 再把 bbox 外扩几格空白裁掉，图纸边界才真正贴住内容。
      const cropped = params.tightCrop
        ? cropGridToContent(
            colorSimplification.indices,
            mask,
            outW,
            outH,
            DEFAULT_CROP_PADDING,
            detectedBg && this.palette
              ? { palette: this.palette, color: detectedBg }
              : undefined
          )
        : null;
      const didCrop = cropped?.cropped ?? false;
      const finalIndices = cropped ? cropped.indices : colorSimplification.indices;
      const finalMask = cropped ? cropped.mask : mask;
      const finalW = cropped ? cropped.outW : outW;
      const finalH = cropped ? cropped.outH : outH;

      onStatus('ready');
      onResult({
        indices: finalIndices,
        gridSize: outW,
        outW: finalW,
        outH: finalH,
        sourceW: outW,
        sourceH: outH,
        cropped: didCrop,
        token: myToken,
        mask: finalMask,
        simplifyColors: params.simplifyColors,
        colorSimplification: colorSimplification.stats,
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
    const { indices, outW, outH, mask } = result;

    const canvas = renderComposite(indices, outW, outH, this.palette, {
      cellPx: DEFAULT_COMPOSITE_OPTIONS.cellPx,
    }, mask);
    applyWatermark(canvas, watermarkPlacement());
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
      null,
      result.mask
    );
  }

  /**
   * Export multiple composite images in sequence.
   * Re-samples for each extra gridSize (preserving source aspect ratio).
   * Triggers downloads 100ms apart so the browser does not block.
   *
   * tightCrop = true（默认）→ 裁掉主体外空白，图纸紧贴内容。
   * tightCrop = false       → 保留原采样网格，并居中贴到 gridSize 标准方板。
   */
  async exportMulti(
    src: ImageData,
    exportCellPx: number,
    selectedGridSize: number,
    extraGridSizes: number[],
    removeBackground: boolean,
    simplifyColors: boolean,
    tightCrop = true
  ): Promise<{ success: number; failed: number }> {
    if (!this.palette) throw new Error('Pipeline not initialized');

    const sizes = [selectedGridSize, ...extraGridSizes.filter(n => n !== selectedGridSize)];
    let success = 0;
    let failed = 0;

    for (let i = 0; i < sizes.length; i++) {
      const gridSize = sizes[i];
      try {
        const sampled = sampleImage(src, gridSize);
        const indices = quantizeWithCanvas2D(sampled, this.palette);
        const outW = sampled.width;
        const outH = sampled.height;
        const mask: BackgroundMask = new Uint8Array(outW * outH);
        let detectedBg: RGB | null = null;
        if (removeBackground) {
          const detected = detectBackground(src, sampled);
          if (detected) {
            detectedBg = detected.bg;
            const { mask: srcMask, bgCount: srcBgCount } = buildBackgroundMask(
              src,
              detected.bg
            );
            const gridMask = downsampleMaskByAll(
              srcMask,
              src.width,
              src.height,
              outW,
              outH
            );
            const filtered = filterMaskByBorderConnectivity(gridMask, outW, outH);
            let kept = 0;
            filtered.forEach((v, j) => {
              if (v) kept++;
              mask[j] = v;
            });
            console.info(
              `[pingdou] bg detected = rgb(${detected.bg.join(',')}), ` +
                `kept ${kept}/${outW * outH} border-connected cells ` +
                `(src ${srcBgCount}/${src.width * src.height} → grid ${gridMask.reduce((s, v) => s + v, 0)}/${outW * outH}, gridSize=${gridSize})`
            );
          } else {
            console.warn(
              `[pingdou] 自动去背景：未能识别纯色背景 (gridSize=${gridSize})。`
            );
          }
        }
        const colorSimplification = this.applyColorSimplification(
          indices,
          mask,
          simplifyColors
        );

        const cropped = tightCrop
          ? cropGridToContent(
              colorSimplification.indices,
              mask,
              outW,
              outH,
              DEFAULT_CROP_PADDING,
              detectedBg && this.palette
                ? { palette: this.palette, color: detectedBg }
                : undefined
            )
          : null;
        // 紧裁路径直接按内容出图；关闭紧裁时居中贴到 gridSize 标准方板，
        // 补出来的格子标记为背景（不画豆、不计入总数）。
        const padded = tightCrop
          ? null
          : padToSquareGrid(colorSimplification.indices, outW, outH, mask, gridSize);

        const boardIndices = padded ? padded.indices : cropped ? cropped.indices : colorSimplification.indices;
        const boardMask = padded ? padded.mask : cropped ? cropped.mask : mask;
        const boardW = padded ? padded.outW : cropped ? cropped.outW : outW;
        const boardH = padded ? padded.outH : cropped ? cropped.outH : outH;

        const boardCanvas = renderBeadBoard(boardIndices, boardW, boardH, this.palette, {
          cellPx: exportCellPx,
          fontPx: 12,
          mask: boardMask,
        });
        const compositeCanvas = renderCompositeFromBoard(
          boardCanvas,
          boardIndices,
          boardW,
          boardH,
          this.palette,
          boardMask
        );
        applyWatermark(compositeCanvas, watermarkPlacement());
        const blob = await canvasToBlob(compositeCanvas);
        // 文件名用实际输出尺寸：非方图 / 紧裁后都可能不等于 gridSize
        triggerDownload(blob, `pingdou-${boardW}x${boardH}.png`);
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
