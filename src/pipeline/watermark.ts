/**
 * Draw the "拼豆.xyz" brand mark on a canvas.
 *
 * Placement matters: the bottom strip of an exported chart is the color-card
 * list, and a bottom-right watermark lands right on top of it. `header-right`
 * parks the mark in the header band, horizontally separated from the
 * size/color-count/bean-count text, so nothing is ever occluded.
 *
 * Pure side-effect on the canvas's 2D context. If the canvas has no 2D
 * context, the call is a silent no-op (matches the rest of the pipeline's
 * "fail conservatively" stance — better no watermark than a broken export).
 */

import { font, FONT_FAMILY_ROUNDED } from './font';

export type WatermarkAnchor = 'bottom-right' | 'header-right';

export interface WatermarkOptions {
  /** Override the watermark text. Default: '拼豆.xyz' */
  readonly text?: string;
  /** Font size = min(W,H) * fontRatio, clamped to [14, 64]. Default 0.025 */
  readonly fontRatio?: number;
  /** Distance from canvas edge = fontPx * marginRatio. Default 0.6 */
  readonly marginRatio?: number;
  readonly anchor?: WatermarkAnchor;
  /** header-right 时的垂直中心线（absolute px）。默认贴近顶边。 */
  readonly insetY?: number;
  readonly fillStyle?: string;
  readonly shadowColor?: string;
  readonly shadowBlur?: number;
}

export const DEFAULT_WATERMARK_OPTIONS = {
  text: '拼豆.xyz',
  fontRatio: 0.025,
  marginRatio: 0.6,
  anchor: 'bottom-right' as WatermarkAnchor,
  fillStyle: 'rgba(255,255,255,0.65)',
  shadowColor: 'rgba(0,0,0,0.45)',
  shadowBlur: 4,
} as const;

const FONT_MIN = 14;
const FONT_MAX = 64;

export function applyWatermark(
  canvas: HTMLCanvasElement,
  options?: WatermarkOptions
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const opts = { ...DEFAULT_WATERMARK_OPTIONS, ...(options ?? {}) };
  const shortSide = Math.min(canvas.width, canvas.height);
  const fontPx = Math.max(FONT_MIN, Math.min(FONT_MAX, shortSide * opts.fontRatio));
  const margin = fontPx * opts.marginRatio;
  const headerRight = opts.anchor === 'header-right';

  ctx.save();
  ctx.font = font(fontPx, 'bold', FONT_FAMILY_ROUNDED);
  ctx.textAlign = 'right';
  ctx.textBaseline = headerRight ? 'middle' : 'alphabetic';
  ctx.fillStyle = opts.fillStyle;
  ctx.shadowColor = opts.shadowColor;
  ctx.shadowBlur = opts.shadowBlur;
  ctx.fillText(
    opts.text,
    canvas.width - margin,
    headerRight ? (opts.insetY ?? margin + fontPx / 2) : canvas.height - margin
  );
  ctx.restore();
}