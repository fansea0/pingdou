import type { Palette, BackgroundMask } from '@/types';
import { renderBeadBoard, DEFAULT_BLOCK_SIZE } from './board';

export interface CompositeOptions {
  readonly cellPx: number;
  readonly fontPx: number;
  readonly blockSize: number;
  readonly padding: number;
  readonly headerHeight: number;
  readonly sectionGap: number;
  readonly legendRowHeight: number;
  readonly legendRowGap: number;
  readonly swatchSize: number;
  readonly itemGap: number;
}

export const DEFAULT_COMPOSITE_OPTIONS: CompositeOptions = {
  cellPx: 32,
  fontPx: 12,
  blockSize: DEFAULT_BLOCK_SIZE,
  padding: 20,
  headerHeight: 34,
  sectionGap: 14,
  legendRowHeight: 30,
  legendRowGap: 6,
  swatchSize: 22,
  itemGap: 22,
};

/** 图纸很小时（比如 3×3 试跑），版式宽度至少给到这么多 */
const MIN_CONTENT_WIDTH = 300;

const FONT_FAMILY = '-apple-system, "PingFang SC", sans-serif';
const HEADER_FONT_PX = 16;
const LEGEND_FONT_PX = 13;

const SWATCH_BORDER = '#b8bcc2';
const SEPARATOR = '#e5e7eb';

interface InternalRow {
  readonly id: string;
  readonly name: string;
  readonly rgb: readonly [number, number, number];
  readonly count: number;
}

function buildRows(
  indices: Uint8Array,
  palette: Palette,
  mask: BackgroundMask | null
): { rows: InternalRow[]; bodyTotal: number } {
  const counts = new Map<number, number>();
  let bodyTotal = 0;
  for (let i = 0; i < indices.length; i++) {
    if (mask && mask[i]) continue;
    const idx = indices[i];
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
    bodyTotal++;
  }
  const rows: InternalRow[] = [];
  for (const [idx, count] of counts) {
    const { id, name, rgb } = palette[idx];
    rows.push({ id, name, rgb, count });
  }
  rows.sort((a, b) => b.count - a.count);
  return { rows, bodyTotal };
}

function codeFont(): string {
  return `bold ${LEGEND_FONT_PX}px ${FONT_FAMILY}`;
}

function countFont(): string {
  return `${LEGEND_FONT_PX}px ${FONT_FAMILY}`;
}

/** 一个「色块 + 色号 × 数量」条目的宽度 */
function measureItem(
  ctx: CanvasRenderingContext2D,
  row: InternalRow,
  swatchSize: number
): number {
  ctx.font = codeFont();
  const codeW = ctx.measureText(row.id).width;
  ctx.font = countFont();
  const countW = ctx.measureText(`×${row.count}`).width;
  return swatchSize + 6 + codeW + 8 + countW;
}

interface LegendItem {
  readonly row: InternalRow;
  readonly x: number;
}

/** 按可用宽度把色号条目折行 */
function layoutLegend(
  rows: InternalRow[],
  widths: Map<string, number>,
  contentWidth: number,
  itemGap: number
): LegendItem[][] {
  const lines: LegendItem[][] = [];
  let current: LegendItem[] = [];
  let cursor = 0;

  for (const row of rows) {
    const w = widths.get(row.id) ?? 0;
    const needed = current.length === 0 ? w : cursor + itemGap + w;
    if (current.length > 0 && needed > contentWidth) {
      lines.push(current);
      current = [];
      cursor = 0;
    }
    current.push({ row, x: current.length === 0 ? 0 : cursor + itemGap });
    cursor = current[current.length - 1].x + w;
  }
  if (current.length > 0) lines.push(current);

  return lines;
}

/**
 * 导出图纸版式（对齐商家的成品图）：
 *   顶部页眉 —— 成品尺寸 / 色数 / 总颗数
 *   中间图纸 —— 色块 + 色号 + 网格线 + 行列标尺
 *   底部色号表 —— 每种颜色的色块、色号与数量
 *
 * 传入 board 可复用已渲染好的图纸（例如标准方板路径）。
 */
export function renderComposite(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  options?: Partial<CompositeOptions>,
  mask: BackgroundMask | null = null,
  board?: HTMLCanvasElement
): HTMLCanvasElement {
  const opts: CompositeOptions = { ...DEFAULT_COMPOSITE_OPTIONS, ...options };

  const beadCanvas =
    board ??
    renderBeadBoard(indices, outW, outH, palette, {
      cellPx: opts.cellPx,
      fontPx: opts.fontPx,
      mask,
      blockSize: opts.blockSize,
      showGrid: true,
      showRulers: true,
      showCodes: true,
    });

  return renderCompositeFromBoard(beadCanvas, indices, outW, outH, palette, mask, opts);
}

/**
 * 把现成的图纸与底部色号表、顶部页眉合成一张完整成品图。
 */
export function renderCompositeFromBoard(
  beadCanvas: HTMLCanvasElement,
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  mask: BackgroundMask | null,
  options?: Partial<CompositeOptions>
): HTMLCanvasElement {
  const opts: CompositeOptions = { ...DEFAULT_COMPOSITE_OPTIONS, ...options };
  const { rows, bodyTotal } = buildRows(indices, palette, mask);

  const probe = document.createElement('canvas').getContext('2d')!;
  const widths = new Map<string, number>();
  for (const row of rows) {
    widths.set(row.id, measureItem(probe, row, opts.swatchSize));
  }

  const contentW = Math.max(beadCanvas.width, MIN_CONTENT_WIDTH);
  const lines = layoutLegend(rows, widths, contentW, opts.itemGap);
  const legendH =
    lines.length * opts.legendRowHeight +
    Math.max(0, lines.length - 1) * opts.legendRowGap;

  const canvasW = contentW + opts.padding * 2;
  const canvasH =
    opts.padding +
    opts.headerHeight +
    opts.sectionGap +
    beadCanvas.height +
    opts.sectionGap +
    legendH +
    opts.padding;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 页眉：成品尺寸 / 色数 / 总颗数
  ctx.font = `bold ${HEADER_FONT_PX}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const headerY = opts.padding + opts.headerHeight / 2;
  ctx.fillText(
    `${outW} × ${outH}　·　${rows.length} 色　·　共 ${bodyTotal.toLocaleString()} 颗`,
    opts.padding,
    headerY
  );

  // 图纸
  const beadX = opts.padding + Math.floor((contentW - beadCanvas.width) / 2);
  const beadY = opts.padding + opts.headerHeight + opts.sectionGap;
  ctx.drawImage(beadCanvas, beadX, beadY);

  // 底部色号表
  ctx.strokeStyle = SEPARATOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const separatorY = beadY + beadCanvas.height + opts.sectionGap;
  ctx.moveTo(opts.padding, separatorY + 0.5);
  ctx.lineTo(canvasW - opts.padding, separatorY + 0.5);
  ctx.stroke();

  const legendLeft = opts.padding;
  lines.forEach((items, lineIndex) => {
    const rowY =
      separatorY + opts.sectionGap / 2 + opts.legendRowHeight / 2 + lineIndex * (opts.legendRowHeight + opts.legendRowGap);
    for (const item of items) {
      const { row } = item;
      const swatchX = legendLeft + item.x;
      const swatchY = rowY - opts.swatchSize / 2;

      ctx.fillStyle = `rgb(${row.rgb[0]},${row.rgb[1]},${row.rgb[2]})`;
      ctx.fillRect(swatchX, swatchY, opts.swatchSize, opts.swatchSize);
      ctx.strokeStyle = SWATCH_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(swatchX + 0.5, swatchY + 0.5, opts.swatchSize - 1, opts.swatchSize - 1);

      const codeX = swatchX + opts.swatchSize + 6;
      ctx.font = codeFont();
      ctx.fillStyle = '#111827';
      ctx.textAlign = 'left';
      ctx.fillText(row.id, codeX, rowY);
      const codeW = widths.get(row.id)! - opts.swatchSize - 6 - 8;

      ctx.font = countFont();
      ctx.fillStyle = '#4b5563';
      ctx.fillText(`×${row.count}`, codeX + codeW + 8, rowY);
    }
  });

  return canvas;
}