import { describe, it, expect, vi } from 'vitest';
import {
  applyWatermark,
  DEFAULT_WATERMARK_OPTIONS,
} from '@/pipeline/watermark';

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const fillText = vi.fn();
  // jsdom polyfill (tests/setup.ts) leaves these as undefined AND creates a
  // fresh ctx object on every getContext() call. Stub them once, then pin
  // the canvas's getContext to return the stubbed ctx so applyWatermark's
  // own getContext('2d') sees the stubs.
  (ctx as unknown as { fillText: typeof fillText }).fillText = fillText;
  (ctx as unknown as { save: () => void }).save = vi.fn();
  (ctx as unknown as { restore: () => void }).restore = vi.fn();
  (ctx as unknown as { shadowColor: string }).shadowColor = '';
  (ctx as unknown as { shadowBlur: number }).shadowBlur = 0;
  canvas.getContext = vi.fn(() => ctx) as unknown as typeof canvas.getContext;
  return { canvas, ctx, fillText };
}

describe('applyWatermark', () => {
  it('draws the default text 拼豆.xyz in the bottom-right corner', () => {
    const { canvas, fillText } = makeCanvas(400, 300);
    applyWatermark(canvas);
    expect(fillText).toHaveBeenCalledTimes(1);
    const [text, x, y] = fillText.mock.calls[0]!;
    expect(text).toBe('拼豆.xyz');
    const margin = DEFAULT_WATERMARK_OPTIONS.marginRatio *
      Math.max(14, Math.min(64, Math.min(canvas.width, canvas.height) * DEFAULT_WATERMARK_OPTIONS.fontRatio));
    expect(x).toBeCloseTo(canvas.width - margin, 5);
    expect(y).toBeCloseTo(canvas.height - margin, 5);
  });

  it('uses a custom text when provided', () => {
    const { canvas, fillText } = makeCanvas(200, 200);
    applyWatermark(canvas, { text: 'CustomMark' });
    expect(fillText.mock.calls[0]![0]).toBe('CustomMark');
  });

  it('font size scales with canvas size (fontRatio default 0.025, clamped [14, 64])', () => {
    const small = makeCanvas(200, 200);
    applyWatermark(small.canvas);
    const smallPx = parseInt((small.ctx.font as string).match(/bold (\d+)px/)?.[1] ?? '0', 10);

    const big = makeCanvas(2000, 2000);
    applyWatermark(big.canvas);
    const bigPx = parseInt((big.ctx.font as string).match(/bold (\d+)px/)?.[1] ?? '0', 10);

    expect(smallPx).toBe(14);
    expect(bigPx).toBe(50);
    expect(bigPx).toBeGreaterThan(smallPx);
  });

  it('respects custom fontRatio', () => {
    const { canvas, ctx } = makeCanvas(1000, 1000);
    applyWatermark(canvas, { fontRatio: 0.05 });
    expect((ctx.font as string)).toContain('bold 50px');
  });

  it('respects custom marginRatio', () => {
    const { canvas, fillText } = makeCanvas(500, 500);
    applyWatermark(canvas, { fontRatio: 0.1, marginRatio: 2 });
    const [, x, y] = fillText.mock.calls[0]!;
    expect(x).toBeCloseTo(500 - 100, 5);
    expect(y).toBeCloseTo(500 - 100, 5);
  });

  it('uses a semi-transparent white fill style by default', () => {
    const { canvas, ctx } = makeCanvas(400, 400);
    applyWatermark(canvas);
    expect(ctx.fillStyle).toBe(DEFAULT_WATERMARK_OPTIONS.fillStyle);
    expect(ctx.fillStyle as string).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.\d+\)/);
  });

  it('does not throw on a 1×1 canvas (clamp keeps text inside)', () => {
    const { canvas, fillText } = makeCanvas(1, 1);
    expect(() => applyWatermark(canvas)).not.toThrow();
    expect(fillText).toHaveBeenCalledTimes(1);
  });

  it('returns silently if getContext returns null', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const orig = canvas.getContext.bind(canvas);
    canvas.getContext = vi.fn(() => null) as unknown as typeof canvas.getContext;
    expect(() => applyWatermark(canvas)).not.toThrow();
    canvas.getContext = orig;
  });
});
