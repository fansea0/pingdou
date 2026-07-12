import type { Palette } from '@/types';

/**
 * Render an index matrix into a Canvas, using palette colors at cellPx per cell.
 * Canvas dimensions are outW × outH cells (rectangular grids supported).
 * Optional border color for grid lines; pass null to disable.
 */
export function renderPaletteImage(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  cellPx: number,
  borderColor: string | null = '#e5e7eb'
): HTMLCanvasElement {
  const w = outW * cellPx;
  const h = outH * cellPx;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const idx = indices[y * outW + x];
      const [r, g, b] = palette[idx].rgb;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
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