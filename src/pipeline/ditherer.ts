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
 * Floyd-Steinberg dithering on a copy of ImageData pixels.
 * Returns a Uint8Array of palette indices (length = width*height).
 */
export function floydSteinbergDither(src: ImageData, palette: Palette): Uint8Array {
  const { width: w, height: h, data } = src;
  const buf = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) buf[i] = data[i];

  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const oldR = buf[idx];
      const oldG = buf[idx + 1];
      const oldB = buf[idx + 2];

      const palIdx = nearestIdx(oldR, oldG, oldB, palette);
      out[y * w + x] = palIdx;

      const [nr, ng, nb] = palette[palIdx].rgb;
      const errR = oldR - nr;
      const errG = oldG - ng;
      const errB = oldB - nb;

      const distribute = (dx: number, dy: number, weight: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
        const ni = (ny * w + nx) * 4;
        buf[ni]     += errR * weight;
        buf[ni + 1] += errG * weight;
        buf[ni + 2] += errB * weight;
      };

      distribute( 1,  0, 7 / 16);
      distribute(-1,  1, 3 / 16);
      distribute( 0,  1, 5 / 16);
      distribute( 1,  1, 1 / 16);
    }
  }

  return out;
}