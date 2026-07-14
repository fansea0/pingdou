import type { Palette, BackgroundMask } from '@/types';

/**
 * Render an index matrix into a Canvas, using palette colors at cellPx per cell.
 * Canvas dimensions are outW × outH cells (rectangular grids supported).
 * Optional border color for grid lines; pass null to disable.
 *
 * Background cells (mask[i] === 1) are drawn as transparent (checkerboard) so
 * the user can tell which cells will not consume beads.
 */
const CHECK_LIGHT = '#f4f4f5';
const CHECK_DARK = '#e4e4e7';

export function renderPaletteImage(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  cellPx: number,
  borderColor: string | null = '#e5e7eb',
  mask: BackgroundMask | null = null
): HTMLCanvasElement {
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
    }
  }

  if (borderColor && cellPx >= 6) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= outW; i++) {
      ctx.moveTo(i * cellPx + 0.5, 0);
      ctx.lineTo(i * cellPx + 0.5, h);
    }
    for (let i = 0; i <= outH; i++) {
      ctx.moveTo(0, i * cellPx + 0.5);
      ctx.lineTo(w, i * cellPx + 0.5);
    }
    ctx.stroke();
  }

  return canvas;
}
