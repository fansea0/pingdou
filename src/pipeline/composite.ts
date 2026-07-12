import type { Palette } from '@/types';
import { renderAnnotatedImage } from './annotator';

export interface CompositeOptions {
  readonly cellPx: number;
  readonly fontPx: number;
  readonly cellGap: number;
  readonly legendRowHeight: number;
  readonly legendColWidth: number;
  readonly legendPadding: number;
}

export const DEFAULT_COMPOSITE_OPTIONS: CompositeOptions = {
  cellPx: 32,
  fontPx: 12,
  cellGap: 40,
  legendRowHeight: 36,
  legendColWidth: 60,
  legendPadding: 16,
};

interface InternalRow {
  readonly id: string;
  readonly name: string;
  readonly rgb: readonly [number, number, number];
  readonly count: number;
}

function buildRows(indices: Uint8Array, palette: Palette): InternalRow[] {
  const counts = new Map<number, number>();
  for (const i of indices) counts.set(i, (counts.get(i) ?? 0) + 1);
  const rows: InternalRow[] = [];
  for (const [idx, count] of counts) {
    const { id, name, rgb } = palette[idx];
    rows.push({ id, name, rgb, count });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

/**
 * Render a composite image: bead image (with color-code annotations) on the LEFT
 * and legend table on the RIGHT. Both vertically centered.
 *
 * Layout:
 *   canvasW = beadW + cellGap + legendW
 *   canvasH = max(beadH, legendH)
 *   beadX = 0
 *   beadY = floor((canvasH - beadH) / 2)
 *   legendX = beadW + cellGap
 *   legendY = floor((canvasH - legendH) / 2)
 */
export function renderComposite(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  options?: Partial<CompositeOptions>
): HTMLCanvasElement {
  const opts: CompositeOptions = { ...DEFAULT_COMPOSITE_OPTIONS, ...options };

  const beadCanvas = renderAnnotatedImage(
    indices,
    gridSize,
    palette,
    opts.cellPx,
    opts.fontPx
  );
  const beadW = beadCanvas.width;
  const beadH = beadCanvas.height;

  const rows = buildRows(indices, palette);
  const legendRowsCount = 1 + rows.length + 1;
  const labelColW = 100;
  const nameColW = 100;
  const countColW = 80;
  const legendInnerW = opts.legendColWidth + labelColW + nameColW + countColW;
  const legendW = legendInnerW + opts.legendPadding * 2;
  const legendH = legendRowsCount * opts.legendRowHeight + opts.legendPadding * 2;

  const canvasW = beadW + opts.cellGap + legendW;
  const canvasH = Math.max(beadH, legendH);

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const beadX = 0;
  const beadY = Math.floor((canvasH - beadH) / 2);
  ctx.drawImage(beadCanvas, beadX, beadY);

  const legendTop = Math.floor((canvasH - legendH) / 2);
  const legendLeft = beadW + opts.cellGap;

  ctx.strokeStyle = '#e5e5e5';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendLeft + 0.5, legendTop + 0.5, legendW - 1, legendH - 1);

  const colWidths = [opts.legendColWidth, labelColW, nameColW, countColW];
  const colXs: number[] = [legendLeft + opts.legendPadding];
  for (let i = 0; i < colWidths.length - 1; i++) colXs.push(colXs[i] + colWidths[i]);

  ctx.font = `bold 13px -apple-system, "PingFang SC", sans-serif`;
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const headerY = legendTop + opts.legendPadding + opts.legendRowHeight / 2;
  const headers = ['', '色号', '名称', '数量'];
  for (let i = 0; i < headers.length; i++) {
    if (i > 0) ctx.fillText(headers[i], colXs[i] + 8, headerY);
  }

  ctx.beginPath();
  ctx.moveTo(colXs[0], legendTop + opts.legendPadding + opts.legendRowHeight);
  ctx.lineTo(colXs[0] + legendInnerW, legendTop + opts.legendPadding + opts.legendRowHeight);
  ctx.strokeStyle = '#333';
  ctx.stroke();

  ctx.font = `13px -apple-system, "PingFang SC", sans-serif`;
  let rowY = legendTop + opts.legendPadding + opts.legendRowHeight + opts.legendRowHeight / 2;
  for (const row of rows) {
    ctx.fillStyle = `rgb(${row.rgb[0]},${row.rgb[1]},${row.rgb[2]})`;
    ctx.fillRect(
      colXs[0] + 4,
      rowY - opts.legendRowHeight / 2 + 4,
      opts.legendColWidth - 8,
      opts.legendRowHeight - 8
    );
    ctx.strokeStyle = '#ccc';
    ctx.strokeRect(
      colXs[0] + 4.5,
      rowY - opts.legendRowHeight / 2 + 4.5,
      opts.legendColWidth - 8,
      opts.legendRowHeight - 8
    );
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(row.id, colXs[1] + 8, rowY);
    ctx.fillText(row.name, colXs[2] + 8, rowY);
    ctx.textAlign = 'right';
    ctx.fillText(String(row.count), colXs[3] + countColW - 8, rowY);
    ctx.textAlign = 'left';
    rowY += opts.legendRowHeight;
  }

  ctx.font = `bold 13px -apple-system, "PingFang SC", sans-serif`;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('合计', colXs[0] + 8, rowY);
  ctx.textAlign = 'right';
  ctx.fillText(String(indices.length), colXs[3] + countColW - 8, rowY);
  ctx.textAlign = 'left';

  return canvas;
}