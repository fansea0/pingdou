/**
 * Box-average downsample to gridSize × gridSize while preserving aspect ratio.
 * Output width/height will be computed to fit the source aspect into gridSize long edge.
 */
export function sampleImage(src: ImageData, gridSize: number): ImageData {
  if (gridSize < 1) throw new Error('gridSize must be >= 1');

  const aspect = src.height / src.width;
  const outW = aspect >= 1 ? gridSize : Math.max(1, Math.round(gridSize / aspect));
  const outH = aspect >= 1 ? Math.max(1, Math.round(gridSize * aspect)) : gridSize;

  const dst = new Uint8ClampedArray(outW * outH * 4);
  const xScale = src.width / outW;
  const yScale = src.height / outH;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * xScale);
      const y0 = Math.floor(y * yScale);
      const x1 = Math.min(src.width, Math.ceil((x + 1) * xScale));
      const y1 = Math.min(src.height, Math.ceil((y + 1) * yScale));
      const count = (x1 - x0) * (y1 - y0);

      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
        }
      }
      const o = (y * outW + x) * 4;
      dst[o] = Math.round(r / count);
      dst[o + 1] = Math.round(g / count);
      dst[o + 2] = Math.round(b / count);
      dst[o + 3] = Math.round(a / count);
    }
  }

  return new ImageData(dst, outW, outH);
}