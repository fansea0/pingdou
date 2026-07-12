import type { Palette } from '@/types';

export function pickTextColor(rgb: readonly [number, number, number]): string {
  const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return luminance > 140 ? '#000' : '#fff';
}

export function renderAnnotatedImage(
  indices: Uint8Array,
  gridSize: number,
  palette: Palette,
  cellPx: number,
  fontPx: number
): HTMLCanvasElement {
  if (cellPx < 24) {
    throw new Error('Annotated image requires cellPx >= 24');
  }

  const w = gridSize * cellPx;
  const h = gridSize * cellPx;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.font = `bold ${fontPx}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = indices[y * gridSize + x];
      const [r, g, b] = palette[idx].rgb;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      ctx.fillStyle = pickTextColor([r, g, b]);
      const code = palette[idx].id;
      ctx.fillText(code, x * cellPx + cellPx / 2, y * cellPx + cellPx / 2);
    }
  }

  return canvas;
}
