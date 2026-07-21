/**
 * Draw a small "拼豆.xyz" watermark in the bottom-right corner of a canvas.
 *
 * Used at the very end of the export pipeline (right before canvas → blob)
 * so every downloaded composite PNG carries the brand mark. Not applied to
 * the on-screen preview.
 *
 * Pure side-effect on the canvas's 2D context. If the canvas has no 2D
 * context, the call is a silent no-op (matches the rest of the pipeline's
 * "fail conservatively" stance — better no watermark than a broken export).
 */

export interface WatermarkOptions {
  /** Override the watermark text. Default: '拼豆.xyz' */
  readonly text?: string;
  /** Font size = min(W,H) * fontRatio, clamped to [14, 64]. Default 0.025 */
  readonly fontRatio?: number;
  /** Distance from canvas edge = fontPx * marginRatio. Default 0.6 */
  readonly marginRatio?: number;
  /** Default 'rgba(255,255,255,0.65)' */
  readonly fillStyle?: string;
  /** Default 'rgba(0,0,0,0.45)' */
  readonly shadowColor?: string;
  /** Default 4 */
  readonly shadowBlur?: number;
}

export const DEFAULT_WATERMARK_OPTIONS = {
  text: '拼豆.xyz',
  fontRatio: 0.025,
  marginRatio: 0.6,
  fillStyle: 'rgba(255,255,255,0.65)',
  shadowColor: 'rgba(0,0,0,0.45)',
  shadowBlur: 4,
} as const;

const FONT_MIN = 14;
const FONT_MAX = 64;
const FONT_FAMILY = '-apple-system, "PingFang SC", sans-serif';

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

  ctx.save();
  ctx.font = `bold ${fontPx}px ${FONT_FAMILY}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = opts.fillStyle;
  ctx.shadowColor = opts.shadowColor;
  ctx.shadowBlur = opts.shadowBlur;
  ctx.fillText(opts.text, canvas.width - margin, canvas.height - margin);
  ctx.restore();
}
