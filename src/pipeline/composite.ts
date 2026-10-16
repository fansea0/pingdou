import type { Palette, BackgroundMask } from '@/types';
import { renderBeadBoard } from './board';
import { DEFAULT_BLOCK_SIZE } from './board';
import { font, FONT_FAMILY_ROUNDED } from './font';
import { estimateAssemblyHours, formatAssemblyHours } from './timeEstimate';
import { DEFAULT_WATERMARK_OPTIONS } from './watermark';

export interface CompositeOptions {
  readonly cellPx: number;
  readonly fontPx: number;
  readonly blockSize: number;
  readonly padding: number;
  readonly headerHeight: number;
  readonly sectionGap: number;
  /** 色卡卡片高度（含内边距） */
  readonly chipHeight: number;
  readonly chipGap: number;
  readonly chipPaddingX: number;
  readonly swatchSize: number;
  /** 底部为二维码预留的额外留白带高度（px）。缺省 / 0 = 不预留。 */
  readonly qrBandPx?: number;
}

export const DEFAULT_COMPOSITE_OPTIONS: CompositeOptions = {
  cellPx: 32,
  fontPx: 12,
  blockSize: DEFAULT_BLOCK_SIZE,
  padding: 20,
  headerHeight: 42,
  sectionGap: 16,
  chipHeight: 34,
  chipGap: 10,
  chipPaddingX: 10,
  swatchSize: 18,
  qrBandPx: 0,
};

/** 图纸很小时（比如 3×3 试跑），版式宽度至少给到这么多 */
const MIN_CONTENT_WIDTH = 300;

/** 顶部页眉字号：成品尺寸 / 色数 / 总颗数，是全图第一眼要读到的信息 */
const HEADER_FONT_PX = 22;
/** 预估工时是次要信息：小一号灰字，挂在主信息右边，不抢页眉的层级 */
const HEADER_TIME_PX = 16;
const HEADER_TIME_COLOR = '#6b7280';
/** 主信息与预估工时之间的间隔 */
const HEADER_TIME_GAP = 14;
/**
 * 页眉右侧品牌位预留宽度，单位 = 水印字号。
 * 水印是「图标 + 拼豆.xyz + 右边距」，约 6.2em；宁可预留多一点，
 * 也不能让预估工时和品牌标识挤在一起。
 */
const BRAND_KEEP_OUT_EM = 6.2;
const CHIP_CODE_PX = 13;
const CHIP_COUNT_PX = 13;
const CODE_FONT = `bold ${CHIP_CODE_PX}px ${FONT_FAMILY_ROUNDED}`;
const COUNT_FONT = `${CHIP_COUNT_PX}px ${FONT_FAMILY_ROUNDED}`;

const CHIP_BORDER = '#d9dce1';
const CHIP_FILL = '#fbfbfc';
const SEPARATOR = '#e8eaed';
const CODE_COLOR = '#111827';
const COUNT_COLOR = '#6b7280';

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

interface Chip {
  readonly row: InternalRow;
  readonly w: number;
}

/** 页眉文案：主信息 + 预估工时。抽成纯函数方便单测直接断言文字。 */
export interface HeaderSummary {
  readonly main: string;
  /** 已带前置分隔点；beanCount 非法时为 null */
  readonly time: string | null;
}

export function headerSummary(
  outW: number,
  outH: number,
  colorCount: number,
  beanCount: number
): HeaderSummary {
  const main = `${outW} × ${outH}　·　${colorCount} 色　·　共 ${beanCount.toLocaleString()} 颗`;
  const hours = formatAssemblyHours(estimateAssemblyHours(beanCount));
  return { main, time: hours === null ? null : `· ${hours}` };
}

function measure(ctx: CanvasRenderingContext2D, text: string): number {
  if (typeof ctx.measureText !== 'function') return 0;
  return ctx.measureText(text).width;
}

/** 页眉右侧品牌位的预留像素宽度，按水印实际字号折算 */
function brandKeepOutPx(canvasW: number, canvasH: number): number {
  const shortSide = Math.min(canvasW, canvasH);
  const brandFontPx = Math.max(
    14,
    Math.min(64, shortSide * DEFAULT_WATERMARK_OPTIONS.fontRatio)
  );
  return brandFontPx * BRAND_KEEP_OUT_EM;
}

/** 色卡宽度 = 左右内边距 + 色块 + 间距 + 色号 + 弹性间隙 + 数量 */
function measureChips(
  ctx: CanvasRenderingContext2D,
  rows: InternalRow[],
  opts: CompositeOptions
): Chip[] {
  return rows.map(row => {
    ctx.font = CODE_FONT;
    const codeW = ctx.measureText(row.id).width;
    ctx.font = COUNT_FONT;
    const countW = ctx.measureText(String(row.count)).width;
    const w =
      opts.chipPaddingX * 2 + opts.swatchSize + 8 + codeW + 14 + countW;
    return { row, w };
  });
}

interface PlacedChip extends Chip {
  readonly x: number;
}

/** 按可用宽度把色卡折行 */
function layoutChips(chips: Chip[], contentWidth: number, gap: number): PlacedChip[][] {
  const lines: PlacedChip[][] = [];
  let current: PlacedChip[] = [];
  let cursor = 0;

  for (const chip of chips) {
    const needed = current.length === 0 ? chip.w : cursor + gap + chip.w;
    if (current.length > 0 && needed > contentWidth) {
      lines.push(current);
      current = [];
      cursor = 0;
    }
    current.push({ ...chip, x: current.length === 0 ? 0 : cursor + gap });
    cursor = current[current.length - 1].x + chip.w;
  }
  if (current.length > 0) lines.push(current);

  return lines;
}

/** roundRect 在老 Safari 上不一定有，退回直角矩形 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

/**
 * 导出图纸版式（对齐商家的成品图）：
 *   顶部页眉 —— 成品尺寸 / 色数 / 总颗数 / 预估工时（右端留出品牌位）
 *   中间图纸 —— 色块 + 色号 + 网格线 + 行列标尺
 *   底部色卡 —— 每种颜色一个带边框的圆角卡片，色块、色号、数量同框，
 *               数量右对齐，不会再和隔壁卡片的色块混在一起
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
 * 把现成的图纸与底部色卡、顶部页眉合成一张完整成品图。
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
  const chips = measureChips(probe, rows, opts);

  const contentW = Math.max(beadCanvas.width, MIN_CONTENT_WIDTH);
  const lines = layoutChips(chips, contentW, opts.chipGap);
  const legendH = lines.length * opts.chipHeight + Math.max(0, lines.length - 1) * opts.chipGap;

  const canvasW = contentW + opts.padding * 2;
  // 底部边距单独算：二维码的留白带加在这里，页眉/图纸/色卡的纵向布局一律不动，
  // 所以色卡既不会被压、也不会重排。色卡折行只看 contentW（= canvasW - padding*2），
  // 与底部边距无关。
  const bottomPad = opts.padding + (opts.qrBandPx ?? 0);
  const canvasH =
    opts.padding +
    opts.headerHeight +
    opts.sectionGap +
    beadCanvas.height +
    opts.sectionGap +
    legendH +
    bottomPad;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 页眉：成品尺寸 / 色数 / 总颗数 + 预估工时。右侧留出品牌位，二者不会挤在一起。
  ctx.font = font(HEADER_FONT_PX, 'bold');
  ctx.fillStyle = CODE_COLOR;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const headerY = opts.padding + opts.headerHeight / 2;
  const summary = headerSummary(outW, outH, rows.length, bodyTotal);
  ctx.fillText(summary.main, opts.padding, headerY);

  // 预估工时：紧贴主信息右侧，小一号灰字；顶到品牌位就整段省略，宁缺勿叠
  if (summary.time) {
    const timeX = opts.padding + measure(ctx, summary.main) + HEADER_TIME_GAP;
    ctx.font = font(HEADER_TIME_PX, 'bold');
    const fits =
      timeX + measure(ctx, summary.time) <=
      canvasW - opts.padding - brandKeepOutPx(canvasW, canvasH);
    if (fits) {
      ctx.fillStyle = HEADER_TIME_COLOR;
      ctx.fillText(summary.time, timeX, headerY);
      ctx.fillStyle = CODE_COLOR;
    }
  }

  // 图纸
  const beadX = opts.padding + Math.floor((contentW - beadCanvas.width) / 2);
  const beadY = opts.padding + opts.headerHeight + opts.sectionGap;
  ctx.drawImage(beadCanvas, beadX, beadY);

  // 色卡区上方的分隔线
  ctx.strokeStyle = SEPARATOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const separatorY = beadY + beadCanvas.height + opts.sectionGap / 2;
  ctx.moveTo(opts.padding, separatorY + 0.5);
  ctx.lineTo(canvasW - opts.padding, separatorY + 0.5);
  ctx.stroke();

  const legendLeft = opts.padding;
  const legendTop = separatorY + opts.sectionGap / 2;
  lines.forEach((items, lineIndex) => {
    const cardY = legendTop + lineIndex * (opts.chipHeight + opts.chipGap);
    const midY = cardY + opts.chipHeight / 2;

    for (const item of items) {
      const { row } = item;
      const cardX = legendLeft + item.x;

      // 卡片底 + 边框：色号与数量被框在一起，归属一目了然
      roundRect(ctx, cardX + 0.5, cardY + 0.5, item.w - 1, opts.chipHeight - 1, 7);
      ctx.fillStyle = CHIP_FILL;
      ctx.fill();
      ctx.strokeStyle = CHIP_BORDER;
      ctx.lineWidth = 1;
      ctx.stroke();

      const swatchX = cardX + opts.chipPaddingX;
      const swatchY = midY - opts.swatchSize / 2;
      ctx.fillStyle = `rgb(${row.rgb[0]},${row.rgb[1]},${row.rgb[2]})`;
      ctx.fillRect(swatchX, swatchY, opts.swatchSize, opts.swatchSize);
      ctx.strokeStyle = CHIP_BORDER;
      ctx.strokeRect(swatchX + 0.5, swatchY + 0.5, opts.swatchSize - 1, opts.swatchSize - 1);

      const codeX = swatchX + opts.swatchSize + 8;
      ctx.font = CODE_FONT;
      ctx.fillStyle = CODE_COLOR;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.id, codeX, midY);

      // 数量右对齐到卡片内边距，永远不会跑到隔壁卡片上
      ctx.font = COUNT_FONT;
      ctx.fillStyle = COUNT_COLOR;
      ctx.textAlign = 'right';
      ctx.fillText(String(row.count), cardX + item.w - opts.chipPaddingX, midY);
      ctx.textAlign = 'left';
    }
  });

  return canvas;
}