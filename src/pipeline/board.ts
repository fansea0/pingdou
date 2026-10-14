import type { Palette, BackgroundMask } from '@/types';
import { renderAnnotatedImage } from './annotator';

/**
 * 每多少格画一条加粗分隔线。
 * 用 5 而不是 10：标尺已经每一格都标了数字，粗线退到「五个一档」，
 * 既能和数字对齐数格子，又不会把图切得太碎。
 */
export const DEFAULT_BLOCK_SIZE = 5;

/** 网格线：细线压在色块上，粗线划出大区块 */
const THIN_LINE = 'rgba(110,110,110,0.45)';
const BLOCK_LINE = 'rgba(31,41,55,0.85)';

/** 标尺底色：刻意压得很浅，只做「边框」的角色，不和色块抢注意力 */
const RULER_FILL = '#f1f3f6';
const RULER_EDGE = '#d3d8e0';
/** 标尺数字 */
const RULER_COLOR = '#5a6472';
/** 左上角尺寸角标 */
const CORNER_COLOR = '#8b95a5';

import { FONT_FAMILY_ROUNDED as FONT_FAMILY } from './font';

const MIN_BAND_PX = 20;
const BAND_RATIO = 0.62;

export interface BeadBoardOptions {
  readonly cellPx: number;
  readonly fontPx: number;
  readonly mask: BackgroundMask | null;
  readonly blockSize: number;
  readonly showGrid: boolean;
  readonly showRulers: boolean;
  readonly showCodes: boolean;
}

export const DEFAULT_BEAD_BOARD_OPTIONS: BeadBoardOptions = {
  cellPx: 32,
  fontPx: 12,
  mask: null,
  blockSize: DEFAULT_BLOCK_SIZE,
  showGrid: true,
  showRulers: true,
  showCodes: true,
};

/** 标尺条厚度（同时是行号带的宽度基准） */
export function rulerBandPx(cellPx: number): number {
  return Math.max(MIN_BAND_PX, Math.round(cellPx * BAND_RATIO));
}

/**
 * 在已有画布上叠加网格线。ox/oy 是网格左上角在画布中的位置。
 * 外框 + 每 blockSize 格的粗线 + 每格的细线。
 */
export function drawGridOverlay(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  outW: number,
  outH: number,
  cellPx: number,
  blockSize: number
): void {
  const gridW = outW * cellPx;
  const gridH = outH * cellPx;

  if (cellPx >= 10) {
    ctx.strokeStyle = THIN_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < outW; c++) {
      const x = ox + Math.round(c * cellPx) + 0.5;
      ctx.moveTo(x, oy);
      ctx.lineTo(x, oy + gridH);
    }
    for (let r = 1; r < outH; r++) {
      const y = oy + Math.round(r * cellPx) + 0.5;
      ctx.moveTo(ox, y);
      ctx.lineTo(ox + gridW, y);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = BLOCK_LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let c = blockSize; c < outW; c += blockSize) {
    const x = ox + Math.round(c * cellPx);
    ctx.moveTo(x, oy);
    ctx.lineTo(x, oy + gridH);
  }
  for (let r = blockSize; r < outH; r += blockSize) {
    const y = oy + Math.round(r * cellPx);
    ctx.moveTo(ox, y);
    ctx.lineTo(ox + gridW, y);
  }
  ctx.stroke();

  ctx.strokeRect(ox + 1, oy + 1, gridW - 2, gridH - 2);
}

/**
 * 画外围标尺：顶部列号带 + 左侧行号带 + 左上角尺寸角标。
 *
 * 每一格都标数字（不再只标每 5 格一次），整条标尺带铺一层很浅的底色，
 * 和网格区之间用一条细线分开——这样「边框」在视觉上是一个整体，
 * 读数时不用在色块堆里找刻度。底色刻意压得很浅，不与图纸抢注意力。
 *
 * leftW / topH 是两条标尺带各自的厚度，画布尺寸 = (leftW+gridW) × (topH+gridH)。
 */
export function drawRulers(
  ctx: CanvasRenderingContext2D,
  leftW: number,
  topH: number,
  outW: number,
  outH: number,
  cellPx: number,
  blockSize: number
): void {
  const gridW = outW * cellPx;
  const gridH = outH * cellPx;
  const fontPx = Math.max(9, Math.min(Math.round(topH * 0.62), Math.round(cellPx * 0.42)));

  // 标尺底色（顶部一条 + 左侧一条，含左上角）
  ctx.fillStyle = RULER_FILL;
  ctx.fillRect(0, 0, leftW + gridW, topH);
  ctx.fillRect(0, 0, leftW, topH + gridH);

  // 标尺与网格的分界
  ctx.strokeStyle = RULER_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, topH + 0.5);
  ctx.lineTo(leftW + gridW, topH + 0.5);
  ctx.moveTo(leftW + 0.5, 0);
  ctx.lineTo(leftW + 0.5, topH + gridH);
  ctx.stroke();

  ctx.font = `bold ${fontPx}px ${FONT_FAMILY}`;
  ctx.fillStyle = RULER_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 顶部列号：每一格都标
  for (let c = 0; c < outW; c++) {
    const label = String(c + 1);
    const cx = leftW + c * cellPx + cellPx / 2;
    ctx.font = `${labelWidth(label, fontPx, cellPx)}px ${FONT_FAMILY}`;
    ctx.fillText(label, cx, topH / 2);
  }

  // 左侧行号：每一格都标
  for (let r = 0; r < outH; r++) {
    const label = String(r + 1);
    const cy = topH + r * cellPx + cellPx / 2;
    ctx.font = `${labelWidth(label, fontPx, cellPx)}px ${FONT_FAMILY}`;
    ctx.fillText(label, leftW / 2, cy);
  }

  // 五格一档：在数字下方补一条短刻度，和网格粗线对得上
  ctx.strokeStyle = RULER_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = blockSize; c < outW; c += blockSize) {
    const x = leftW + c * cellPx;
    ctx.moveTo(x, topH - 3);
    ctx.lineTo(x, topH - 1);
  }
  for (let r = blockSize; r < outH; r += blockSize) {
    const y = topH + r * cellPx;
    ctx.moveTo(leftW - 3, y);
    ctx.lineTo(leftW - 1, y);
  }
  ctx.stroke();

  // 左上角：成品尺寸
  ctx.font = `${Math.max(9, Math.round(leftW * 0.3))}px ${FONT_FAMILY}`;
  ctx.fillStyle = CORNER_COLOR;
  ctx.fillText(`${outW}×${outH}`, leftW / 2, topH / 2);
}

/** 数字要能塞进一格：按估算字宽收一档字号 */
function labelWidth(label: string, fontPx: number, cellPx: number): number {
  let size = fontPx;
  while (size > 7 && label.length * size * 0.6 > cellPx - 2) size -= 1;
  return size;
}

function whiteCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

/**
 * 渲染一张可直接打印的拼豆图纸：色块 + 色号 + 网格线 + 行列标尺，纯白底。
 * 画布紧贴内容（配合 crop.ts 使用），四周只有标尺带。
 */
export function renderBeadBoard(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  options?: Partial<BeadBoardOptions>
): HTMLCanvasElement {
  const opts: BeadBoardOptions = { ...DEFAULT_BEAD_BOARD_OPTIONS, ...options };

  const cells = renderAnnotatedImage(indices, outW, outH, palette, {
    cellPx: opts.cellPx,
    fontPx: opts.fontPx,
    mask: opts.mask,
    backgroundStyle: 'plain',
    showCodes: opts.showCodes,
  });

  const band = opts.showRulers ? rulerBandPx(opts.cellPx) : 0;
  const topH = band;
  const leftW = band * 2;

  const canvas = whiteCanvas(leftW + outW * opts.cellPx, topH + outH * opts.cellPx);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(cells, leftW, topH);

  if (opts.showGrid) {
    drawGridOverlay(ctx, leftW, topH, outW, outH, opts.cellPx, opts.blockSize);
  }
  if (band > 0) {
    drawRulers(ctx, leftW, topH, outW, outH, opts.cellPx, opts.blockSize);
  }

  return canvas;
}

export interface PaddedGrid {
  readonly indices: Uint8Array;
  readonly mask: BackgroundMask;
  readonly outW: number;
  readonly outH: number;
}

/**
 * 把矩形网格居中放进 boardSize × boardSize 的标准方板，
 * 空白填充格一律标记为背景（不画豆、不计入总数）。
 */
export function padToSquareGrid(
  indices: Uint8Array,
  outW: number,
  outH: number,
  mask: BackgroundMask | null,
  boardSize: number
): PaddedGrid {
  if (boardSize < 1 || !Number.isInteger(boardSize)) {
    throw new RangeError('boardSize must be a positive integer');
  }
  if (outW > boardSize || outH > boardSize) {
    throw new RangeError('boardSize must fit the sampled grid');
  }

  const dx = Math.floor((boardSize - outW) / 2);
  const dy = Math.floor((boardSize - outH) / 2);
  const total = boardSize * boardSize;
  const nextIndices = new Uint8Array(total);
  const nextMask = new Uint8Array(total).fill(1);

  for (let y = 0; y < outH; y++) {
    const srcRow = y * outW;
    const dstRow = (y + dy) * boardSize + dx;
    nextIndices.set(indices.subarray(srcRow, srcRow + outW), dstRow);
    for (let x = 0; x < outW; x++) {
      // 没有传 mask 时，内容格一律算主体（mask=0），不能留成背景
      nextMask[dstRow + x] = mask ? mask[srcRow + x] : 0;
    }
  }

  return { indices: nextIndices, mask: nextMask, outW: boardSize, outH: boardSize };
}