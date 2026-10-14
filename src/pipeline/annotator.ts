import type { Palette, BackgroundMask } from '@/types';

export function pickTextColor(rgb: readonly [number, number, number]): string {
  const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return luminance > 140 ? '#000' : '#fff';
}

const CHECK_LIGHT = '#f4f4f5';
const CHECK_DARK = '#e4e4e7';
import { FONT_FAMILY as FONT_FAMILY_LEGIBLE } from './font';
const FONT_FAMILY = FONT_FAMILY_LEGIBLE;

/** 色号最小可用格子尺寸：低于此值写了也认不出来 */
const MIN_ANNOTATED_CELL_PX = 16;
/** 色号再长也至少保留的字号 */
const MIN_CODE_FONT_PX = 7;

export interface AnnotateOptions {
  readonly cellPx: number;
  readonly fontPx: number;
  readonly mask?: BackgroundMask | null;
  /**
   * checker = 网页预览用的棋盘格透明底；
   * plain = 导出用的纯色底（棋盘格真打印出来会被当成花纹）。
   */
  readonly backgroundStyle?: 'checker' | 'plain';
  readonly showCodes?: boolean;
  readonly backgroundColor?: string;
}

export const DEFAULT_BACKGROUND_COLOR = '#ffffff';

/**
 * 渲染「色块 + 色号」图层，画布尺寸 = outW × outH 格，不含网格线与行列标号。
 * 标尺/网格线由 board.ts 在外层叠加，方便在方形板子上复用同一套绘制。
 *
 * 色号按实际文本宽度自动降档（不同品牌色号有 2~5 字符），
 * 同一色号的字号只算一次——一整张图最多几十种色，不会有性能问题。
 */
export function renderAnnotatedImage(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  options: AnnotateOptions
): HTMLCanvasElement {
  const { cellPx, fontPx } = options;
  const mask = options.mask ?? null;
  const showCodes = options.showCodes ?? true;
  const plain = (options.backgroundStyle ?? 'checker') === 'plain';
  const baseColor = options.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;

  if (showCodes && cellPx < MIN_ANNOTATED_CELL_PX) {
    throw new Error(`Annotated image requires cellPx >= ${MIN_ANNOTATED_CELL_PX}`);
  }

  const w = outW * cellPx;
  const h = outH * cellPx;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = plain ? baseColor : CHECK_LIGHT;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const codeFontCache = new Map<string, number>();
  const maxCodeWidth = cellPx - 3;
  const fitCodeFont = (code: string): number => {
    const cached = codeFontCache.get(code);
    if (cached !== undefined) return cached;
    let size = fontPx;
    ctx.font = `${size}px ${FONT_FAMILY}`;
    while (size > MIN_CODE_FONT_PX && ctx.measureText(code).width > maxCodeWidth) {
      size -= 1;
      ctx.font = `${size}px ${FONT_FAMILY}`;
    }
    codeFontCache.set(code, size);
    return size;
  };

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const px = x * cellPx;
      const py = y * cellPx;
      if (mask && mask[i]) {
        if (!plain && (x + y) & 1) {
          ctx.fillStyle = CHECK_DARK;
          ctx.fillRect(px, py, cellPx, cellPx);
        }
        continue;
      }
      const idx = indices[i];
      const [r, g, b] = palette[idx].rgb;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(px, py, cellPx, cellPx);

      if (!showCodes) continue;
      const code = palette[idx].id;
      ctx.font = `bold ${fitCodeFont(code)}px ${FONT_FAMILY}`;
      ctx.fillStyle = pickTextColor([r, g, b]);
      ctx.fillText(code, px + cellPx / 2, py + cellPx / 2);
    }
  }

  return canvas;
}