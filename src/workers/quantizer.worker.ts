import type { Palette } from '@/types';

interface RenderRequest {
  type: 'render';
  id: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

interface InitRequest {
  type: 'init';
  id: number;
  palette: Palette;
}

interface WorkerResponse {
  type: 'ready' | 'rendered' | 'error';
  id: number;
  error?: string;
}

let palette: Palette | null = null;
let paletteRGB: Uint8ClampedArray | null = null;

self.onmessage = async (e: MessageEvent<InitRequest | RenderRequest>) => {
  const msg = e.data;
  const respond = (r: WorkerResponse) => (self as unknown as Worker).postMessage(r);

  try {
    if (msg.type === 'init') {
      palette = msg.palette;
      paletteRGB = new Uint8ClampedArray(palette.length * 3);
      for (let i = 0; i < palette.length; i++) {
        paletteRGB[i * 3]     = palette[i].rgb[0];
        paletteRGB[i * 3 + 1] = palette[i].rgb[1];
        paletteRGB[i * 3 + 2] = palette[i].rgb[2];
      }
      respond({ type: 'ready', id: msg.id });
      return;
    }

    if (msg.type === 'render') {
      // GPU color rendering happens in the WebGL path; index extraction
      // for accuracy stays in JS (see src/pipeline/README.md).
      respond({ type: 'rendered', id: msg.id });
    }
  } catch (err) {
    respond({ type: 'error', id: msg.id, error: String(err) });
  }
};
