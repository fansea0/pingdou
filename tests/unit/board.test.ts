import { describe, expect, it, vi } from 'vitest';
import {
  renderBeadBoard,
  padToSquareGrid,
  rulerBandPx,
  drawGridOverlay,
  ROW_BAND_FACTOR,
  drawRulers,
} from '@/pipeline/board';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 0, 255], name: '蓝' },
];

function pixel(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  return [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
}

describe('rulerBandPx', () => {
  it('never collapses below the readable minimum', () => {
    expect(rulerBandPx(4)).toBeGreaterThanOrEqual(20);
  });

  it('scales with the cell size on large boards', () => {
    expect(rulerBandPx(64)).toBeGreaterThan(rulerBandPx(32));
  });
});

describe('renderBeadBoard', () => {
  it('surrounds the grid with ruler bands', () => {
    const cellPx = 32;
    const outW = 4;
    const outH = 3;
    const canvas = renderBeadBoard(new Uint8Array(outW * outH), outW, outH, palette, { cellPx });

    const band = rulerBandPx(cellPx);
    expect(canvas.width).toBe(Math.round(band * ROW_BAND_FACTOR) + outW * cellPx);
    expect(canvas.height).toBe(band + outH * cellPx);
  });

  it('renders exactly grid-sized without rulers when they are turned off', () => {
    const canvas = renderBeadBoard(new Uint8Array(6), 3, 2, palette, {
      cellPx: 32,
      showRulers: false,
    });
    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(64);
  });

  it('paints an opaque white background even for masked cells', () => {
    const indices = new Uint8Array([0, 1]);
    const mask = new Uint8Array([0, 1]);
    const canvas = renderBeadBoard(indices, 2, 1, palette, { cellPx: 32, mask });

    const band = rulerBandPx(32);
    // 第二格是背景格，应该是纯白而不是棋盘格
    const maskedPixel = pixel(canvas, Math.round(band * ROW_BAND_FACTOR) + 32 + 8, band + 8);
    expect(maskedPixel).toEqual([255, 255, 255, 255]);
  });

  it('keeps subject colors intact inside the grid', () => {
    const indices = new Uint8Array([0, 1]);
    const canvas = renderBeadBoard(indices, 2, 1, palette, { cellPx: 32 });
    const band = rulerBandPx(32);
    // 网格区左移了行号带（ROW_BAND_FACTOR × band）
    expect(pixel(canvas, Math.round(band * ROW_BAND_FACTOR) + 8, band + 8).slice(0, 3)).toEqual([255, 0, 0]);
    expect(pixel(canvas, Math.round(band * ROW_BAND_FACTOR) + 32 + 8, band + 8).slice(0, 3)).toEqual([0, 0, 255]);
  });

  it('rules every cell and every blockSize cells', () => {
    const stroke = vi.fn();
    const moveTo = vi.fn();
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    getContextSpy.mockImplementation(
      (function (this: HTMLCanvasElement, id: string) {
        const ctx = originalGetContext.call(this, id as '2d') as CanvasRenderingContext2D | null;
        if (ctx) {
          const originalStroke = ctx.stroke.bind(ctx);
          const originalMoveTo = ctx.moveTo.bind(ctx);
          ctx.stroke = ((path?: Path2D) => {
            stroke();
            originalStroke(path as Path2D);
          }) as typeof ctx.stroke;
          ctx.moveTo = ((x: number, y: number) => {
            moveTo();
            originalMoveTo(x, y);
          }) as typeof ctx.moveTo;
        }
        return ctx;
      }) as typeof HTMLCanvasElement.prototype.getContext
    );

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      stroke.mockClear();
      moveTo.mockClear();

      drawGridOverlay(ctx, 0, 0, 12, 2, 32, 10);

      // 细线：11 条内部竖线 + 1 条内部横线；粗线：10 格处 1 条竖线
      expect(stroke).toHaveBeenCalledTimes(2);
      expect(moveTo).toHaveBeenCalledTimes(13);
    } finally {
      getContextSpy.mockRestore();
    }
  });

  it('paints a dark frame around the grid', () => {
    const canvas = renderBeadBoard(new Uint8Array(8), 2, 2, palette, { cellPx: 32 });
    const band = rulerBandPx(32);
    const frame = pixel(canvas, Math.round(band * ROW_BAND_FACTOR) + 1, band + 1);
    expect(frame[3]).toBe(255);
    expect(frame[0]).toBeLessThan(120);
  });

  it('draws the size corner label bold inside the ruler corner', () => {
    const outW = 60;
    const outH = 40;
    const band = rulerBandPx(32);
    const leftW = Math.round(band * ROW_BAND_FACTOR);
    const canvas = renderBeadBoard(new Uint8Array(outW * outH), outW, outH, palette, { cellPx: 32 });
    const ctx = canvas.getContext('2d')!;

    const seen: Array<{ text: string; font: string }> = [];
    const spy = vi.spyOn(ctx, 'fillText').mockImplementation((text: unknown) => {
      seen.push({ text: String(text), font: ctx.font });
    });

    try {
      drawRulers(ctx, leftW, band, outW, outH, 32, 5);

      const corner = seen.find(c => c.text === `${outW}×${outH}`);
      expect(corner, '角标应绘制「宽×高」').toBeDefined();
      expect(corner!.font).toMatch(/^bold /);
      // 加粗字宽必须放得进行号带，否则会压到第一列刻度上
      const size = Number(/bold (\d+(?:\.\d+)?)px/.exec(corner!.font)?.[1]);
      expect(size).toBeGreaterThanOrEqual(10);
      ctx.font = corner!.font;
      expect(ctx.measureText(corner!.text).width).toBeLessThanOrEqual(leftW - 6);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('padToSquareGrid', () => {
  it('centers a rectangular grid and marks the padding as background', () => {
    const indices = new Uint8Array([0, 1]);
    const result = padToSquareGrid(indices, 2, 1, null, 4);

    expect([result.outW, result.outH]).toEqual([4, 4]);
    // (4-2)/2 = 1 → 内容从 x=1,y=1 开始
    expect(result.indices[1 * 4 + 1]).toBe(0);
    expect(result.indices[1 * 4 + 2]).toBe(1);
    expect(result.mask[0]).toBe(1);
    expect(result.mask[1 * 4 + 1]).toBe(0);
  });

  it('carries subject mask values through the offset', () => {
    const indices = new Uint8Array([0, 0]);
    const mask = new Uint8Array([0, 1]);
    const result = padToSquareGrid(indices, 2, 1, mask, 4);
    expect(result.mask[1 * 4 + 1]).toBe(0);
    expect(result.mask[1 * 4 + 2]).toBe(1);
  });

  it('rejects a board smaller than the sampled grid', () => {
    expect(() => padToSquareGrid(new Uint8Array([0, 0]), 2, 1, null, 1)).toThrow(RangeError);
  });

  it('rejects a non-positive board size', () => {
    expect(() => padToSquareGrid(new Uint8Array([0]), 1, 1, null, 0)).toThrow(RangeError);
  });
});