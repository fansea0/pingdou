export type RGB = readonly [number, number, number];

export interface PaletteEntry {
  readonly id: string;
  readonly rgb: RGB;
  readonly name: string;
}

export type Palette = ReadonlyArray<PaletteEntry>;

export interface ProcessParams {
  readonly gridSize: number;
  readonly removeBackground: boolean;
  readonly simplifyColors: boolean;
}

export interface ColorSimplificationStats {
  readonly beforeColorCount: number;
  readonly afterColorCount: number;
  readonly mergedColorCount: number;
  readonly rareColorCountBefore: number;
  readonly rareColorCountAfter: number;
  readonly minimumColorCountSatisfied: boolean;
}

/**
 * 1 表示被识别为背景的格子，对应位置不绘制 + 不计入豆子数。
 * length = outW * outH。当 removeBackground 关闭时为全零数组。
 */
export type BackgroundMask = Uint8Array;

export interface PipelineResult {
  readonly indices: Uint8Array;
  readonly gridSize: number;
  readonly outW: number;
  readonly outH: number;
  readonly token: number;
  readonly mask: BackgroundMask;
  readonly colorSimplification: ColorSimplificationStats;
}

export type UIStatus = 'idle' | 'loading' | 'ready' | 'recomputing' | 'exporting';

export interface ExportItem {
  readonly name: string;
  readonly blob: Blob;
  readonly filename: string;
}

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly price: number;
  readonly currency: 'CNY';
  readonly description: string;
  readonly url: string;
  readonly badge?: string;
}
