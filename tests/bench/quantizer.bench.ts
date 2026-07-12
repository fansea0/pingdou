import { describe, it } from 'vitest';
import { quantizeWithCanvas2D } from '@/pipeline/quantizer.canvas';
import type { Palette } from '@/types';

const palette: Palette = Array.from({ length: 128 }, (_, i) => ({
  id: `A${String(i + 1).padStart(2, '0')}`,
  rgb: [(i * 7) % 256, (i * 13) % 256, (i * 19) % 256] as [number, number, number],
  name: `色${i + 1}`,
}));

function makeImage(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 7919) % 256;
    data[i + 1] = (i * 6151) % 256;
    data[i + 2] = (i * 2971) % 256;
    data[i + 3] = 255;
  }
  return new ImageData(data, w, h);
}

describe('performance benchmark (jsdom, indicative only)', () => {
  it('100x100 quantization', () => {
    const src = makeImage(100, 100);
    const t0 = performance.now();
    quantizeWithCanvas2D(src, palette, false);
    const t1 = performance.now();
    console.log(`[bench] 100×100 quantize: ${(t1 - t0).toFixed(1)}ms`);
  });

  it('200x200 quantization', () => {
    const src = makeImage(200, 200);
    const t0 = performance.now();
    quantizeWithCanvas2D(src, palette, false);
    const t1 = performance.now();
    console.log(`[bench] 200×200 quantize: ${(t1 - t0).toFixed(1)}ms`);
  });

  it('500x500 quantization', () => {
    const src = makeImage(500, 500);
    const t0 = performance.now();
    quantizeWithCanvas2D(src, palette, false);
    const t1 = performance.now();
    console.log(`[bench] 500×500 quantize: ${(t1 - t0).toFixed(1)}ms`);
  });
});
