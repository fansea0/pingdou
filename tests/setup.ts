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

    /** jsdom 的 canvas 桩要支持渲染层实际用到的颜色写法：hex / rgb() / rgba() */
    function parseColor(input: string): [number, number, number] {
      const value = (input || '').trim();
      const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
      if (rgbMatch) {
        return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
      }
      const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
      if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
        ];
      }
      return [0, 0, 0];
    }

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

      // fillText/stroke 不落像素，但渲染层依赖 font/measureText 做色号排版与
      // 底部色号表折行，所以状态必须真的被 get/set。
      interface DrawState {
        fillStyle: string;
        strokeStyle: string;
        lineWidth: number;
        font: string;
        textAlign: CanvasTextAlign;
        textBaseline: CanvasTextBaseline;
      }
      let state: DrawState = {
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        font: '10px sans-serif',
        textAlign: 'start',
        textBaseline: 'alphabetic',
      };
      const stack: DrawState[] = [];

      const ctx = {
        canvas: self,
        get fillStyle() { return state.fillStyle; },
        set fillStyle(v: string) { state.fillStyle = v; },
        get strokeStyle() { return state.strokeStyle; },
        set strokeStyle(v: string) { state.strokeStyle = v; },
        get lineWidth() { return state.lineWidth; },
        set lineWidth(v: number) { state.lineWidth = v; },
        get font() { return state.font; },
        set font(v: string) { state.font = v; },
        get textAlign() { return state.textAlign; },
        set textAlign(v: CanvasTextAlign) { state.textAlign = v; },
        get textBaseline() { return state.textBaseline; },
        set textBaseline(v: CanvasTextBaseline) { state.textBaseline = v; },
        save(): void { stack.push({ ...state }); },
        restore(): void { const prev = stack.pop(); if (prev) state = prev; },
        /** 近似字宽：够用来触发色号降档与色号表折行，不必像素级精确 */
        measureText(text: string): { width: number } {
          const size = parseFloat(state.font) || 10;
          let width = 0;
          for (const ch of text) width += ch.charCodeAt(0) > 255 ? size : size * 0.55;
          return { width };
        },
        fillRect(x: number, y: number, ww: number, hh: number): void {
          const [r, g, b] = parseColor(state.fillStyle);
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
        closePath(): void {},
        moveTo(_x: number, _y: number): void {},
        lineTo(_x: number, _y: number): void {},
        quadraticCurveTo(_cx: number, _cy: number, _x: number, _y: number): void {},
        arc(_x: number, _y: number, _r: number, _s: number, _e: number): void {},
        /** 桩只关心路径是否被提交，不还原真实圆角 */
        roundRect(x: number, y: number, ww: number, hh: number, _r?: number | DOMPointInit): void {
          ctx.moveTo(x, y);
          ctx.lineTo(x + ww, y);
          ctx.lineTo(x + ww, y + hh);
          ctx.lineTo(x, y + hh);
          ctx.closePath();
        },
        stroke(): void {},
        /** 桩不还原路径填充；色卡/色块断言走的是 fillRect，不受影响 */
        fill(): void {},
        strokeRect(x: number, y: number, ww: number, hh: number): void {
          const [r, g, b] = parseColor(state.strokeStyle);
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