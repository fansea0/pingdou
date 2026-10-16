import { describe, it, expect, afterEach } from 'vitest';
import {
  renderComposite,
  renderCompositeFromBoard,
  headerSummary,
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

describe('headerSummary', () => {
  it('puts the size, color count and bean count in the main line', () => {
    const summary = headerSummary(58, 40, 12, 12345);

    expect(summary.main).toBe('58 × 40　·　12 色　·　共 12,345 颗');
  });

  it('estimates assembly time from the bean count', () => {
    // 600 颗/小时：1800 颗 → 3.0 小时
    expect(headerSummary(58, 40, 12, 1800).time).toBe('· 约 3.0 小时');
  });

  it('omits the estimate when there is nothing to make', () => {
    expect(headerSummary(1, 1, 1, 0).time).toBeNull();
  });
});

describe('header estimate placement', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  /** 记录所有 fillText，jsdom 的 canvas 桩不落像素，只能从调用侧断言 */
  function captureFillText(): { text: string; x: number }[] {
    const calls: { text: string; x: number }[] = [];
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string) {
      const ctx = originalGetContext.call(this, id) as unknown as
        | { fillText: (t: string, x: number, y: number) => void }
        | null;
      if (!ctx) return null;
      return new Proxy(ctx, {
        get(target, prop) {
          if (prop === 'fillText') {
            return (t: string, x: number, y: number) => {
              calls.push({ text: String(t), x });
              target.fillText(t, x, y);
            };
          }
          const value = (target as unknown as Record<string | symbol, unknown>)[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    } as typeof HTMLCanvasElement.prototype.getContext;
    return calls;
  }

  it('draws the estimate to the right of the main header line', () => {
    const calls = captureFillText();
    const indices = new Uint8Array(400);
    indices.fill(0);
    renderComposite(indices, 20, 20, palette, { cellPx: CELL_PX });

    const timeCall = calls.find(call => /小时/.test(call.text));
    const mainCall = calls.find(call => call.text.includes('共 400 颗'));

    expect(mainCall).toBeDefined();
    expect(timeCall?.text).toBe('· 约 0.7 小时');
    expect(timeCall!.x).toBeGreaterThan(mainCall!.x);
  });

  it('skips the estimate rather than colliding with the header brand mark', () => {
    const calls = captureFillText();
    const indices = new Uint8Array(9);
    indices.fill(0);
    // 3×3：页眉左边被主信息占满，右边又被品牌位留着，放不下就不画
    renderComposite(indices, 3, 3, palette, { cellPx: CELL_PX });

    expect(calls.some(call => /小时/.test(call.text))).toBe(false);
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

describe('qrBandPx 底部留白带', () => {
  const OUT_W = 30;
  const OUT_H = 14;
  // palette 只有 3 项，按 i % 3 取色：既铺满整块图纸，又不会越界取到 undefined
  const indices = Uint8Array.from(
    { length: OUT_W * OUT_H },
    (_, i) => i % palette.length
  );
  const mask = new Uint8Array(OUT_W * OUT_H);

  // 图纸取 1000×450（横向大板）：成品画布约 1040×598，短边 598 正好落进
  // brandKeepOutPx「不被 14px 字号下限压平」的区间（短边×0.025 > 14 即短边 > 560），
  // 也就是底部加 111px 留白带真的会改变品牌预留宽的区间。
  // 旧的 120×120 fixture 短边只有 340，被 max(14, …) 压平，留白带怎么加
  // keepOut 都不动，这条守卫用例等于没有判别力。
  function board(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 450;
    return c;
  }

  it('fixture 确实落在 keepOut 会变的横向区间内（否则下面的守卫用例是空跑）', () => {
    const base = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask);
    const withBand = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask, { qrBandPx: 111 });
    expect(base.width).toBeGreaterThan(base.height);           // 横向：短边是高度
    expect(Math.min(base.width, base.height)).toBeGreaterThan(560);
    expect(Math.min(withBand.width, withBand.height)).toBeLessThan(2560); // 未触到 64px 上限
  });

  it('不传 qrBandPx 时输出与改动前一致（向后兼容）', () => {
    const a = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask);
    const b = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask, {});
    expect(b.height).toBe(a.height);
  });

  it('传 qrBandPx 时画布高度恰好增加该值', () => {
    const base = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask);
    const withBand = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask, { qrBandPx: 111 });
    expect(withBand.height - base.height).toBe(111);
  });

  it('图纸与色卡的纵向位置完全不变 —— 留白带只加在底部', () => {
    // 版心用到的第一条色卡上边：padding + headerHeight + sectionGap + beadH + sectionGap/2
    const base = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask);
    const withBand = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask, { qrBandPx: 111 });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadH = 450;
    const legendTop =
      opts.padding + opts.headerHeight + opts.sectionGap + beadH + opts.sectionGap / 2;
    // 两张图在顶部条带内应逐像素一致 —— 证明留白带没有挤动任何既有内容
    const ctxA = base.getContext('2d')!;
    const ctxB = withBand.getContext('2d')!;
    const stripH = Math.min(legendTop + 60, base.height);
    expect(stripH).toBeGreaterThan(legendTop); // 确认比对范围真的覆盖到第一条色卡
    expect(ctxA.getImageData(0, 0, base.width, stripH).data)
      .toEqual(ctxB.getImageData(0, 0, withBand.width, stripH).data);
  }, 20000); // 逐像素比对 1040×596×4 ≈ 250 万个元素，超出默认 5s 时限

  it('宽度不因留白带而变化', () => {
    const base = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask);
    const withBand = renderCompositeFromBoard(board(), indices, OUT_W, OUT_H, palette, mask, { qrBandPx: 111 });
    expect(withBand.width).toBe(base.width);
  });

  it('DEFAULT_COMPOSITE_OPTIONS.qrBandPx 默认 0', () => {
    expect(DEFAULT_COMPOSITE_OPTIONS.qrBandPx).toBe(0);
  });
});