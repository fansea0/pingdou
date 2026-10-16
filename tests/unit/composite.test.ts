import { describe, it, expect, afterEach } from 'vitest';
import {
  renderComposite,
  renderCompositeFromBoard,
  headerSummary,
  DEFAULT_COMPOSITE_OPTIONS,
} from '@/pipeline/composite';
import { rulerBandPx } from '@/pipeline/board';
import { applyWatermark } from '@/pipeline/watermark';
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

const originalGetContext = HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

/**
 * 记录所有 fillText（连同当时的 font），jsdom 的 canvas 桩不落像素，只能从调用侧断言。
 * 调用方负责在渲染前调用；每个用例结束由上面的 afterEach 恢复 getContext。
 */
function captureFillText(): { text: string; x: number; font: string }[] {
  const calls: { text: string; x: number; font: string }[] = [];
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string) {
    const ctx = originalGetContext.call(this, id) as unknown as
      | { fillText: (t: string, x: number, y: number) => void; font: string }
      | null;
    if (!ctx) return null;
    return new Proxy(ctx, {
      get(target, prop) {
        if (prop === 'fillText') {
          return (t: string, x: number, y: number) => {
            calls.push({ text: String(t), x, font: target.font });
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

describe('header estimate placement', () => {
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
  const BAND = 111;
  // palette 只有 3 项，按 i % 3 取色：既铺满整块图纸，又不会越界取到 undefined
  const indices = Uint8Array.from(
    { length: OUT_W * OUT_H },
    (_, i) => i % palette.length
  );
  const mask = new Uint8Array(OUT_W * OUT_H);

  /**
   * 横向大图纸（成品画布约 1040×598）。只给「只读 canvas.width / canvas.height
   * 的数值断言」和 fillText 观测用 —— 这两类断言都不做 getImageData，开销可忽略。
   * 短边（高度）598 落在 brandKeepOutPx「不被 14px 下限压平」的区间里
   * （min(W,H)*0.025 > 14），所以加留白带后预留宽真的会跟着变。
   */
  function bigLandscapeBoard(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 450;
    return c;
  }

  /**
   * 小图纸（成品画布约 340×268）。逐像素比对那条必须用它：
   * 「加留白带后图纸与色卡的纵向位置一像素未动」这个命题在小画布上同样成立，
   * 但大 fixture 下这一条要 5.9s，越过 vitest 默认 5s 阈值，只能靠用例级
   * timeout 补救 —— 那是隐患不是余量，慢机器 / CI 上直接红。
   * 这里刻意不加用例级 timeout：默认 5s 阈值本身就是这道用例的性能护栏，
   * 哪天有人把 fixture 换回大板，它会因超时变红，正是我们想要的。
   */
  function smallBoard(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 120;
    return c;
  }

  it('横向大 fixture 的短边（高度）随留白带变长，且仍在 brandKeepOutPx 的比例区间内', () => {
    const base = renderCompositeFromBoard(bigLandscapeBoard(), indices, OUT_W, OUT_H, palette, mask);
    const withBand = renderCompositeFromBoard(bigLandscapeBoard(), indices, OUT_W, OUT_H, palette, mask, { qrBandPx: BAND });
    // 横向板：短边是高度
    expect(base.width).toBeGreaterThan(base.height);
    // 短边 × 0.025 落在 (14, 64) 内 → brandKeepOutPx 按比例缩放，既没被下限压平
    // 也没被上限封顶，留白带一变，预留宽就跟着变（下面 keepOut 用例的前提）
    expect(Math.min(base.width, base.height) * 0.025).toBeGreaterThan(14);
    expect(Math.min(withBand.width, withBand.height) * 0.025).toBeLessThan(64);
  });

  it('不传 qrBandPx 时输出与改动前一致（向后兼容）', () => {
    const a = renderCompositeFromBoard(bigLandscapeBoard(), indices, OUT_W, OUT_H, palette, mask);
    const b = renderCompositeFromBoard(bigLandscapeBoard(), indices, OUT_W, OUT_H, palette, mask, {});
    expect(b.height).toBe(a.height);
  });

  it('传 qrBandPx 时画布高度恰好增加该值', () => {
    const base = renderCompositeFromBoard(bigLandscapeBoard(), indices, OUT_W, OUT_H, palette, mask);
    const withBand = renderCompositeFromBoard(bigLandscapeBoard(), indices, OUT_W, OUT_H, palette, mask, { qrBandPx: BAND });
    expect(withBand.height - base.height).toBe(BAND);
  });

  it('图纸与色卡的纵向位置完全不变 —— 留白带只加在底部', () => {
    // 版心用到的第一条色卡上边：padding + headerHeight + sectionGap + beadH + sectionGap/2
    const base = renderCompositeFromBoard(smallBoard(), indices, OUT_W, OUT_H, palette, mask);
    const withBand = renderCompositeFromBoard(smallBoard(), indices, OUT_W, OUT_H, palette, mask, { qrBandPx: BAND });
    const opts = DEFAULT_COMPOSITE_OPTIONS;
    const beadH = 120;
    const legendTop =
      opts.padding + opts.headerHeight + opts.sectionGap + beadH + opts.sectionGap / 2;
    // 两张图在顶部条带内应逐像素一致 —— 证明留白带没有挤动任何既有内容
    const ctxA = base.getContext('2d')!;
    const ctxB = withBand.getContext('2d')!;
    const stripH = Math.min(legendTop + 60, base.height);
    expect(stripH).toBeGreaterThan(legendTop); // 确认比对范围真的覆盖到第一条色卡
    expect(ctxA.getImageData(0, 0, base.width, stripH).data)
      .toEqual(ctxB.getImageData(0, 0, withBand.width, stripH).data);
  });

  it('宽度不因留白带而变化', () => {
    const base = renderCompositeFromBoard(bigLandscapeBoard(), indices, OUT_W, OUT_H, palette, mask);
    const withBand = renderCompositeFromBoard(bigLandscapeBoard(), indices, OUT_W, OUT_H, palette, mask, { qrBandPx: BAND });
    expect(withBand.width).toBe(base.width);
  });

  it('DEFAULT_COMPOSITE_OPTIONS.qrBandPx 默认 0', () => {
    expect(DEFAULT_COMPOSITE_OPTIONS.qrBandPx).toBe(0);
  });

  describe('品牌预留位（brandKeepOutPx）永不与页眉信息重叠', () => {
    // mask 全 0 → 三种颜色都用上、420 颗全部计入，与 headerSummary 的入参一致
    const MAIN_TEXT = headerSummary(OUT_W, OUT_H, palette.length, OUT_W * OUT_H).main;
    const BRAND_TEXT = '拼豆.xyz'; // DEFAULT_WATERMARK_OPTIONS.text

    /** 走渲染层同一个 measureText 实现量出某次 fillText 的文字宽度 */
    function textWidth(call: { text: string; font: string }): number {
      const probe = document.createElement('canvas').getContext('2d')!;
      probe.font = call.font;
      return probe.measureText(call.text).width;
    }

    /**
     * 合成一张成品图，再按 pipeline 的方式贴品牌标识，返回 fillText 记录。
     * 品牌标识的落笔位置就是「品牌预留位」的真实边界 —— 不在测试里复刻
     * brandKeepOutPx 的公式：公式一改，测试里的常量不会跟着改，断言就成了摆设。
     */
    function renderMarked(qrBandPx?: number): { text: string; x: number; font: string }[] {
      const calls = captureFillText();
      const canvas = renderCompositeFromBoard(
        bigLandscapeBoard(),
        indices,
        OUT_W,
        OUT_H,
        palette,
        mask,
        qrBandPx === undefined ? undefined : { qrBandPx }
      );
      // jsdom 下图标不会加载，观测到的品牌左边缘只含文字；真图标还会再往左占
      // 约 1.4em，由 composite 的 6.2em 预留宽一起兜住。
      applyWatermark(canvas, { anchor: 'header-right' });
      return calls;
    }

    /** 品牌标识右对齐，x 是它的右锚点，左边缘要减去文字宽 */
    function brandMarkLeft(calls: { text: string; x: number; font: string }[]): number {
      const mark = calls.find(call => call.text === BRAND_TEXT);
      if (!mark) throw new Error('品牌标识没有落笔，applyWatermark 的调用方式变了？');
      return mark.x - textWidth(mark);
    }

    /**
     * keepOut 一律用 fillText 观测，不用逐像素：tests/setup.ts 的 canvas 桩里
     * fillText 是空实现、不落像素，所以无论预留宽涨多少，页眉区域像素都是同一片，
     * 逐像素比对在两种情况下必然相等 —— 大 fixture 对「观测 keepOut」零收益，
     * 只会让用例慢十几倍。
     */
    it('页眉主信息整段落在品牌标识左侧，留白带把预留位撑宽也压不到它', () => {
      const base = renderMarked();
      const withBand = renderMarked(BAND);
      const opts = DEFAULT_COMPOSITE_OPTIONS;

      const [baseMain, bandMain] = [base, withBand].map(calls =>
        calls.filter(call => call.text === MAIN_TEXT)
      );
      expect(baseMain).toHaveLength(1);
      expect(bandMain).toHaveLength(1);

      for (const [calls, main] of [[base, baseMain[0]], [withBand, bandMain[0]]] as const) {
        const markLeft = brandMarkLeft(calls);
        expect(main.x).toBe(opts.padding); // 主信息左对齐在 padding
        expect(main.x).toBeLessThan(markLeft);
        expect(main.x + textWidth(main)).toBeLessThan(markLeft);
      }
    });

    it('预估工时被画出来时，也整段落在品牌标识左侧（宁缺勿叠）', () => {
      const base = renderMarked();
      const withBand = renderMarked(BAND);

      const [baseTime, bandTime] = [base, withBand].map(calls =>
        calls.filter(call => /小时/.test(call.text))
      );
      // 这个 fixture 下工时右侧还有约 450px 余量，两张画布都画得下 ——
      // 这条断言同时锁住了「预留宽不会被算得过大、把工时整段吃掉」
      expect(baseTime).toHaveLength(1);
      expect(bandTime).toHaveLength(1);

      for (const [calls, time] of [[base, baseTime[0]], [withBand, bandTime[0]]] as const) {
        const markLeft = brandMarkLeft(calls);
        expect(time.x).toBeGreaterThan(DEFAULT_COMPOSITE_OPTIONS.padding);
        expect(time.x + textWidth(time)).toBeLessThan(markLeft);
      }
    });
  });
});