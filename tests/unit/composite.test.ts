import { describe, it, expect } from 'vitest';
import {
  renderComposite,
  renderCompositeFromBoard,
  DEFAULT_COMPOSITE_OPTIONS,
} from '@/pipeline/composite';
import { rulerBandPx } from '@/pipeline/board';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 255, 0], name: '绿' },
  { id: 'A03', rgb: [0, 0, 255], name: '蓝' },
];

const CELL_PX = 32;

function countRedPixels(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number
): number {
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = ctx.getImageData(x, y, 1, 1).data;
      if (px[0] === 255 && px[1] === 0 && px[2] === 0 && px[3] === 255) n++;
    }
  }
  return n;
}

/** 图纸在成品画布上的左上角坐标（含标尺带偏移） */
function boardOrigin(outW: number): { x: number; y: number } {
  const opts = DEFAULT_COMPOSITE_OPTIONS;
  const band = rulerBandPx(opts.cellPx);
  const beadW = band * 2 + outW * opts.cellPx;
  const contentW = Math.max(beadW, 300);
  return {
    x: opts.padding + Math.floor((contentW - beadW) / 2) + band * 2,
    y: opts.padding + opts.headerHeight + opts.sectionGap + band,
  };
}

function boardBottom(): number {
  const opts = DEFAULT_COMPOSITE_OPTIONS;
  return opts.padding + opts.headerHeight + opts.sectionGap;
}

describe('renderComposite', () => {
  it('keeps the header band free of subject colors', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, 3, palette, { cellPx: CELL_PX });
    const ctx = canvas.getContext('2d')!;

    const headerBottom = DEFAULT_COMPOSITE_OPTIONS.padding + DEFAULT_COMPOSITE_OPTIONS.headerHeight;
    expect(countRedPixels(ctx, 0, 0, canvas.width, headerBottom)).toBe(0);
  });

  it('draws the board below the header, sized to the grid', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, 3, palette, { cellPx: CELL_PX });
    const ctx = canvas.getContext('2d')!;
    const { x, y } = boardOrigin(3);

    expect([...ctx.getImageData(x + 4, y + 4, 1, 1).data.slice(0, 3)]).toEqual([255, 0, 0]);
    expect([...ctx.getImageData(x + CELL_PX + 4, y + CELL_PX + 4, 1, 1).data.slice(0, 3)])
      .toEqual([0, 255, 0]);
  });

  it('is wider than the board because of the outer padding', () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const canvas = renderComposite(indices, 3, 3, palette, { cellPx: CELL_PX });
    expect(canvas.width).toBeGreaterThan(3 * CELL_PX);
  });

  it('keeps a minimum content width even for tiny boards', () => {
    const canvas = renderComposite(new Uint8Array([0]), 1, 1, palette, { cellPx: CELL_PX });
    const band = rulerBandPx(CELL_PX);
    const expectedContent = Math.max(band * 2 + CELL_PX, 300);
    expect(canvas.width).toBe(expectedContent + DEFAULT_COMPOSITE_OPTIONS.padding * 2);
  });

  it('grows taller than the board to fit header and legend', () => {
    const indices = new Uint8Array(9);
    indices.fill(0);
    const canvas = renderComposite(indices, 3, 3, palette, { cellPx: CELL_PX });
    const band = rulerBandPx(CELL_PX);
    const beadH = band + 3 * CELL_PX;
    expect(canvas.height).toBeGreaterThan(beadH);
  });

  it('non-square (6x4) keeps the rectangle instead of stretching to a square', () => {
    const indices = new Uint8Array(24);
    indices.fill(0);
    const canvas = renderComposite(indices, 6, 4, palette, { cellPx: CELL_PX });
    const ctx = canvas.getContext('2d')!;
    const { x, y } = boardOrigin(6);

    const topLeft = [...ctx.getImageData(x + 4, y + 4, 1, 1).data.slice(0, 3)];
    const bottomRight = [
      ...ctx.getImageData(x + 6 * CELL_PX - 4, y + 4 * CELL_PX - 4, 1, 1).data.slice(0, 3),
    ];
    expect(topLeft).toEqual([255, 0, 0]);
    expect(bottomRight).toEqual([255, 0, 0]);
  });

  it('never paints the subject band into the legend strip', () => {
    // 6x4 全红：图纸区是 6*32=192 宽的大色块，底部色号表只有一个 22px 色块
    const indices = new Uint8Array(24);
    indices.fill(0);
    const canvas = renderComposite(indices, 6, 4, palette, { cellPx: CELL_PX });
    const ctx = canvas.getContext('2d')!;
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const band = rulerBandPx(opts.cellPx);

    const legendTop = boardBottom() + band + 4 * opts.cellPx + opts.sectionGap;
    const redInLegend = countRedPixels(ctx, 0, legendTop, canvas.width, canvas.height);

    // 只有色号表的色块允许是红色（22*22 一小块）
    expect(redInLegend).toBeLessThan(opts.swatchSize * opts.swatchSize);
  });
});

describe('renderCompositeFromBoard', () => {
  it('reuses a provided board and reserves room above and below it', () => {
    const board = document.createElement('canvas');
    board.width = 200;
    board.height = 160;
    board.getContext('2d')!.fillRect(0, 0, board.width, board.height);

    const canvas = renderCompositeFromBoard(board, new Uint8Array([0]), 2, 2, palette, null);
    const opts = DEFAULT_COMPOSITE_OPTIONS;

    expect(canvas.width).toBeGreaterThanOrEqual(board.width);
    expect(canvas.height).toBeGreaterThan(board.height + opts.headerHeight);
  });

  it('draws a swatch for every used palette entry in the bottom strip', () => {
    const board = document.createElement('canvas');
    board.width = 320;
    board.height = 320;
    board.getContext('2d')!.fillRect(0, 0, board.width, board.height);

    const canvas = renderCompositeFromBoard(board, new Uint8Array([0, 1, 2]), 3, 1, palette, null);
    const ctx = canvas.getContext('2d')!;
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const legendTop = opts.padding + opts.headerHeight + opts.sectionGap + board.height + opts.sectionGap;

    const colors = new Set<string>();
    for (let x = opts.padding; x < canvas.width - opts.padding; x++) {
      const px = ctx.getImageData(x, legendTop + opts.chipHeight / 2, 1, 1).data;
      colors.add(`${px[0]},${px[1]},${px[2]}`);
    }
    expect(colors.has('255,0,0')).toBe(true);
    expect(colors.has('0,255,0')).toBe(true);
    expect(colors.has('0,0,255')).toBe(true);
  });

  it('wraps a long palette list onto multiple rows', () => {
    const manyColors: Palette = Array.from({ length: 40 }, (_, i) => ({
      id: `C${String(i).padStart(2, '0')}`,
      rgb: [i * 6, 40, 200] as [number, number, number],
      name: `色${i}`,
    }));
    const board = document.createElement('canvas');
    board.width = 320;
    board.height = 320;
    board.getContext('2d')!.fillRect(0, 0, board.width, board.height);

    const indices = Uint8Array.from({ length: 40 }, (_, i) => i);
    const canvas = renderCompositeFromBoard(board, indices, 40, 1, manyColors, null);
    const opts = DEFAULT_COMPOSITE_OPTIONS;

    expect(canvas.width).toBe(320 + opts.padding * 2);

    // 单行色号表的高度 = 页眉 + 图纸 + 分隔 + 一行
    const singleRow =
      opts.padding +
      opts.headerHeight +
      opts.sectionGap +
      board.height +
      opts.sectionGap +
      opts.chipHeight +
      opts.padding;
    expect(canvas.height).toBeGreaterThan(singleRow);
    // 条目再多也不能超出左右留白
    expect(canvas.width).toBe(board.width + opts.padding * 2);
  });

  it('excludes masked cells from the color strip', () => {
    const board = document.createElement('canvas');
    board.width = 320;
    board.height = 320;
    board.getContext('2d')!.fillRect(0, 0, board.width, board.height);

    const withMask = renderCompositeFromBoard(
      board,
      new Uint8Array([0, 0, 0, 0]),
      4,
      1,
      palette,
      new Uint8Array([0, 0, 1, 1])
    );
    const allContent = renderCompositeFromBoard(
      board,
      new Uint8Array([0, 0, 0, 0]),
      4,
      1,
      palette,
      null
    );
    expect(withMask.height).toBe(allContent.height);
  });
});