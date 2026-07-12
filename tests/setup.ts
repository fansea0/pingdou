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