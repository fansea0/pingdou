/**
 * Draw the "拼豆.xyz" brand mark on a canvas.
 *
 * Placement matters: the bottom strip of an exported chart is the color-card
 * list, and a bottom-right watermark lands right on top of it. `header-right`
 * parks the mark in the header band, horizontally separated from the
 * size/color-count/bean-count text, so nothing is ever occluded.
 *
 * The mark is a brand icon plus the text. The icon is drawn at the same height
 * as the text, sitting to its left on the same optical line, so the pair reads
 * as one logo lockup instead of "image floating next to a caption".
 *
 * Pure side-effect on the canvas's 2D context. If the canvas has no 2D
 * context, the call is a silent no-op (matches the rest of the pipeline's
 * "fail conservatively" stance — better no watermark than a broken export).
 * A missing/!failed icon load degrades to text-only, never to a throw.
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
  /** 品牌图标路径。 */
  readonly iconSrc?: string;
  /** 图标高度 = fontPx * iconRatio。默认 1.0，即与水印文字同高。 */
  readonly iconRatio?: number;
  /** 图标与文字的间距 = fontPx * iconGapRatio。 */
  readonly iconGapRatio?: number;
  readonly iconShadowColor?: string;
  readonly iconShadowBlur?: number;
}

/** 站点图标：放在 public/brand/ 下，由 Vite 原样拷贝到构建产物根目录 */
export const WATERMARK_ICON_SRC = '/brand/globe-www.png';

export const DEFAULT_WATERMARK_OPTIONS = {
  text: '拼豆.xyz',
  fontRatio: 0.025,
  marginRatio: 0.6,
  anchor: 'bottom-right' as WatermarkAnchor,
  // 导出底色是纯白（composite.ts 里 ctx.fillStyle = '#ffffff'），所以水印必须
  // 用深色而不是白色：旧版 rgba(255,255,255,0.65) 在白底上只剩一层灰影，几乎
  // 看不见。改成品牌陶土色 #c95f3f，醒目但不刺眼，和站点主色同一套。
  fillStyle: 'rgba(201, 95, 63, 0.95)',
  shadowColor: 'rgba(45, 42, 38, 0.22)',
  shadowBlur: 3,
  iconSrc: WATERMARK_ICON_SRC,
  // 1.15 而不是 1.0：图标本体四周有圆角留白，1.0 时视觉上比文字矮一截
  iconRatio: 1.15,
  iconGapRatio: 0.22,
  iconShadowColor: 'rgba(45, 42, 38, 0.25)',
  iconShadowBlur: 4,
} as const;

const FONT_MIN = 14;
const FONT_MAX = 64;

/** 首行视觉中心约在基线上方 0.34em，用它把图标和文字对齐到同一条视线上 */
const BASELINE_TO_CENTER = 0.34;

const iconCache = new Map<string, HTMLImageElement | null>();

/** 加载兜底上限：某些环境（如 jsdom）根本不派发 img 事件，不能让导出一直等 */
const ICON_LOAD_TIMEOUT_MS = 1500;

/**
 * 预加载品牌图标。导出前 await 一次，保证第一张导出就带图标。
 * 加载失败或超时返回 null，调用方据此降级为「只有文字」，不抛错。
 */
export function ensureWatermarkIcon(src: string = WATERMARK_ICON_SRC): Promise<HTMLImageElement | null> {
  const cached = iconCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  if (typeof Image === 'undefined') {
    iconCache.set(src, null);
    return Promise.resolve(null);
  }
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const settle = (value: HTMLImageElement | null) => {
      clearTimeout(timer);
      iconCache.set(src, value);
      resolve(value);
    };
    const img = new Image();
    const timer = setTimeout(() => settle(null), ICON_LOAD_TIMEOUT_MS);
    img.onload = () => settle(img);
    img.onerror = () => settle(null);
    img.src = src;
  });
  // 先占位，避免并发调用重复发起加载
  iconCache.set(src, null);
  return promise;
}

function measure(ctx: CanvasRenderingContext2D, text: string): number {
  if (typeof ctx.measureText !== 'function') return 0;
  return ctx.measureText(text).width;
}

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
  const right = canvas.width - margin;
  const baselineY = headerRight
    ? (opts.insetY ?? margin + fontPx / 2)
    : canvas.height - margin;

  ctx.save();
  ctx.font = font(fontPx, 'bold', FONT_FAMILY_ROUNDED);
  ctx.textAlign = 'right';
  ctx.textBaseline = headerRight ? 'middle' : 'alphabetic';
  ctx.fillStyle = opts.fillStyle;
  ctx.shadowColor = opts.shadowColor;
  ctx.shadowBlur = opts.shadowBlur;
  ctx.fillText(opts.text, right, baselineY);

  // 图标：与文字同高，贴在文字左侧、共享同一条视觉中线
  const icon = iconCache.get(opts.iconSrc) ?? null;
  if (icon && icon.naturalWidth > 0 && icon.naturalHeight > 0) {
    const textW = measure(ctx, opts.text);
    const aspect = icon.naturalWidth / icon.naturalHeight;
    const gap = fontPx * opts.iconGapRatio;
    let iconH = fontPx * opts.iconRatio;
    let iconW = iconH * aspect;
    let x = right - textW - gap - iconW;

    // 画布太窄时等比缩小，宁可变小也不越过左边距去压住页眉里的其它信息
    const minX = margin;
    if (x < minX) {
      const avail = right - textW - gap - minX;
      if (avail > 0) {
        iconH *= avail / iconW;
        iconW = avail;
        x = minX;
      }
    }

    const centerY = headerRight ? baselineY : baselineY - fontPx * BASELINE_TO_CENTER;
    ctx.save();
    ctx.shadowColor = opts.iconShadowColor;
    ctx.shadowBlur = opts.iconShadowBlur;
    ctx.drawImage(icon, x, centerY - iconH / 2, iconW, iconH);
    ctx.restore();
  }

  ctx.restore();
}
