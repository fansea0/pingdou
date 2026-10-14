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
  /**
   * 裁掉主体外的空白格，让图纸边界紧贴内容。
   * 仅在 removeBackground 开启（mask 有内容）时才会真的产生裁剪。
   */
  readonly tightCrop: boolean;
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
  /** 采样时的长边豆子数（裁剪前的原始网格宽度） */
  readonly gridSize: number;
  /** 实际输出网格宽度（紧裁后可能小于 gridSize） */
  readonly outW: number;
  readonly outH: number;
  /** 裁剪前的原始网格高度，仅用于 UI 展示「100×100 → 57×63」 */
  readonly sourceW: number;
  readonly sourceH: number;
  /** 是否真的裁掉了空白（false = 原样输出或无可裁） */
  readonly cropped: boolean;
  readonly token: number;
  readonly mask: BackgroundMask;
  readonly simplifyColors: boolean;
  readonly colorSimplification: ColorSimplificationStats;
}

export type UIStatus = 'idle' | 'loading' | 'ready' | 'recomputing' | 'exporting';

export interface ExportItem {
  readonly name: string;
  readonly blob: Blob;
  readonly filename: string;
}

export interface Product {
  readonly id: number;
  readonly name: string;
  readonly image: string;
  readonly price: number;        // 单位：分
  readonly description: string;
  readonly url: string;          // 外部购买链接
  readonly badge?: string;
  readonly order: number;
}
