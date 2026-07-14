import type { Palette, BackgroundMask } from '@/types';

export function pickTextColor(rgb: readonly [number, number, number]): string {
  const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return luminance > 140 ? '#000' : '#fff';
}

const CHECK_LIGHT = '#f4f4f5';
const CHECK_DARK = '#e4e4e7';

/**
 * Render a bead image with color-code annotations on each cell.
 * Canvas dimensions are outW × outH cells (rectangular grids supported).
 * mask[i]===1 的格子渲染为棋盘格透明背景（不打码色 + 不写字）。
 */
export function renderAnnotatedImage(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  cellPx: number,
  fontPx: number,
  mask: BackgroundMask | null = null
): HTMLCanvasElement {
  if (cellPx < 24) {
    throw new Error('Annotated image requires cellPx >= 24');
  }

  const w = outW * cellPx;
  const h = outH * cellPx;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  if (mask) {
    ctx.fillStyle = CHECK_LIGHT;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.font = `bold ${fontPx}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const px = x * cellPx;
      const py = y * cellPx;
      if (mask && mask[i]) {
        if ((x + y) & 1) {
          ctx.fillStyle = CHECK_DARK;
          ctx.fillRect(px, py, cellPx, cellPx);
        }
        continue;
      }
      const idx = indices[i];
      const [r, g, b] = palette[idx].rgb;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(px, py, cellPx, cellPx);
      ctx.fillStyle = pickTextColor([r, g, b]);
      const code = palette[idx].id;
      ctx.fillText(code, px + cellPx / 2, py + cellPx / 2);
    }
  }

  return canvas;
}