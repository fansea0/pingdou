import type { Palette } from '@/types';

function nearestIdx(r: number, g: number, b: number, palette: Palette): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i].rgb;
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Quantize each pixel of ImageData to the nearest palette color.
 * Returns Uint8Array of indices (length = w*h).
 */
export function quantizeWithCanvas2D(
  src: ImageData,
  palette: Palette
): Uint8Array {
  const { width: w, height: h, data } = src;
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = nearestIdx(data[i], data[i + 1], data[i + 2], palette);
  }
  return out;
}