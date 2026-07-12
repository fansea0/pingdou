import 'fake-indexeddb/auto';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: 'srgb' = 'srgb';
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      if (data.length !== width * height * 4) {
        throw new DOMException(
          `ImageData data length (${data.length}) does not match width*height*4 (${width * height * 4})`,
          'IndexSizeError',
        );
      }
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as { ImageData: typeof ImageDataPolyfill }).ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}

if (typeof (globalThis as { Blob?: unknown }).Blob !== 'undefined'
    && typeof (Blob.prototype as { text?: unknown }).text !== 'function') {
  (Blob.prototype as { text: () => Promise<string> }).text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

if (typeof globalThis.HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (id: string) => unknown;
  };
  const probe = document.createElement('canvas');
  if (!proto.getContext.call(probe, '2d')) {
    type PixelBufferKey = { __pingdouPixels?: Uint8ClampedArray; __pingdouLastSize?: { w: number; h: number } };
    proto.getContext = function (id: string): unknown {
      if (id !== '2d') return null;
      const w = (this as HTMLCanvasElement).width;
      const h = (this as HTMLCanvasElement).height;
      const bag = this as unknown as PixelBufferKey;
      if (!bag.__pingdouPixels || !bag.__pingdouLastSize || bag.__pingdouLastSize.w !== w || bag.__pingdouLastSize.h !== h) {
        bag.__pingdouPixels = new Uint8ClampedArray(Math.max(1, w * h) * 4);
        bag.__pingdouLastSize = { w, h };
      }
      const pixels = bag.__pingdouPixels;
      const width = w;
      const height = h;
      const self = this as HTMLCanvasElement;
      const ctx = {
        canvas: self,
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        font: '10px sans-serif',
        textAlign: 'start' as const,
        textBaseline: 'alphabetic' as const,
        fillRect(x: number, y: number, ww: number, hh: number): void {
          const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(ctx.fillStyle);
          const r = m ? +m[1] : 0;
          const g = m ? +m[2] : 0;
          const b = m ? +m[3] : 0;
          const x0 = Math.max(0, Math.floor(x));
          const y0 = Math.max(0, Math.floor(y));
          const x1 = Math.min(width, Math.floor(x + ww));
          const y1 = Math.min(height, Math.floor(y + hh));
          for (let yy = y0; yy < y1; yy++) {
            for (let xx = x0; xx < x1; xx++) {
              const i = (yy * width + xx) * 4;
              pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
            }
          }
        },
        getImageData(x: number, y: number, ww: number, hh: number): { data: Uint8ClampedArray; width: number; height: number } {
          const out = new Uint8ClampedArray(ww * hh * 4);
          for (let yy = 0; yy < hh; yy++) {
            for (let xx = 0; xx < ww; xx++) {
              const srcX = Math.floor(x) + xx;
              const srcY = Math.floor(y) + yy;
              if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;
              const si = (srcY * width + srcX) * 4;
              const di = (yy * ww + xx) * 4;
              out[di] = pixels[si];
              out[di + 1] = pixels[si + 1];
              out[di + 2] = pixels[si + 2];
              out[di + 3] = pixels[si + 3];
            }
          }
          return { data: out, width: ww, height: hh };
        },
        drawImage(source: HTMLCanvasElement, dx: number, dy: number): void {
          const srcBag = source as unknown as PixelBufferKey;
          const srcPixels = srcBag.__pingdouPixels;
          if (!srcPixels) return;
          const sw = source.width;
          const sh = source.height;
          const ix = Math.floor(dx);
          const iy = Math.floor(dy);
          for (let sy = 0; sy < sh; sy++) {
            const dy2 = iy + sy;
            if (dy2 < 0 || dy2 >= height) continue;
            for (let sx = 0; sx < sw; sx++) {
              const dx2 = ix + sx;
              if (dx2 < 0 || dx2 >= width) continue;
              const si = (sy * sw + sx) * 4;
              const di = (dy2 * width + dx2) * 4;
              pixels[di] = srcPixels[si];
              pixels[di + 1] = srcPixels[si + 1];
              pixels[di + 2] = srcPixels[si + 2];
              pixels[di + 3] = srcPixels[si + 3];
            }
          }
        },
        fillText(_text: string, _x: number, _y: number): void {},
        beginPath(): void {},
        moveTo(_x: number, _y: number): void {},
        lineTo(_x: number, _y: number): void {},
        stroke(): void {},
        strokeRect(x: number, y: number, ww: number, hh: number): void {
          const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(ctx.strokeStyle);
          const r = m ? +m[1] : 0;
          const g = m ? +m[2] : 0;
          const b = m ? +m[3] : 0;
          const x0 = Math.max(0, Math.floor(x));
          const y0 = Math.max(0, Math.floor(y));
          const x1 = Math.min(width, Math.floor(x + ww));
          const y1 = Math.min(height, Math.floor(y + hh));
          for (let xx = x0; xx < x1; xx++) {
            const iT = (y0 * width + xx) * 4;
            pixels[iT] = r; pixels[iT + 1] = g; pixels[iT + 2] = b; pixels[iT + 3] = 255;
            const iB = ((y1 - 1) * width + xx) * 4;
            pixels[iB] = r; pixels[iB + 1] = g; pixels[iB + 2] = b; pixels[iB + 3] = 255;
          }
          for (let yy = y0; yy < y1; yy++) {
            const iL = (yy * width + x0) * 4;
            pixels[iL] = r; pixels[iL + 1] = g; pixels[iL + 2] = b; pixels[iL + 3] = 255;
            const iR = (yy * width + (x1 - 1)) * 4;
            pixels[iR] = r; pixels[iR + 1] = g; pixels[iR + 2] = b; pixels[iR + 3] = 255;
          }
        },
      };
      return ctx;
    };
  }
}