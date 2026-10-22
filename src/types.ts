export type RGB = readonly [number, number, number];

export interface PaletteEntry {
  readonly id: string;
  readonly rgb: RGB;
  readonly name: string;
}

export type Palette = ReadonlyArray<PaletteEntry>;

/**
 * 颜色预算档位。off = 不压缩；其余档位按每色平均格子数推导颜色数上限 K。
 * 见 docs/superpowers/specs/2026-10-14-color-count-budget-design.md
 */
export type ColorBudgetLevel = 'off' | 'minimal' | 'relaxed' | 'standard';

/**
 * 采样模式，决定格子撞上两种颜色时怎么办。
 *
 * - `gradient`：格子取该格所有像素的平均色。边界格因此会得到一个源图里并不存在的
 *   混合色（渐变带），换来的是真实的渐变过渡被如实保留。
 * - `similar`：边界格在判定为「两种颜色在争这一格」时吸附到主色簇均值，
 *   不再产出混合色。描边干净的平涂图更省色号。
 */
export type SampleMode = 'gradient' | 'similar';

export interface ProcessParams {
  readonly gridSize: number;
  readonly removeBackground: boolean;
  readonly simplifyColors: boolean;
  readonly sampleMode: SampleMode;
  /**
   * 裁掉主体外的空白格，让图纸边界紧贴内容。
   * 仅在 removeBackground 开启（mask 有内容）时才会真的产生裁剪。
   */
  readonly tightCrop: boolean;
  readonly colorBudget: ColorBudgetLevel;
}

export interface ColorBudgetResult {
  readonly indices: Uint8Array;
  /** 推导出的颜色数上限 K；level 为 off 时为 0 */
  readonly targetColorCount: number;
  /** 压缩后实际颜色数 */
  readonly colorCount: number;
  /** 为保住保真度（簇内色差超上限）而未能压到 K */
  readonly fidelityLimited: boolean;
}

export interface ColorSimplificationStats {
  readonly beforeColorCount: number;
  readonly afterColorCount: number;
  readonly mergedColorCount: number;
  readonly rareColorCountBefore: number;
  readonly rareColorCountAfter: number;
  readonly minimumColorCountSatisfied: boolean;
  readonly budgetLevel: ColorBudgetLevel;
  readonly budgetTargetColorCount: number;
  /** 预算开启且实际色数 ≤ K 时为 true */
  readonly budgetSatisfied: boolean;
  readonly budgetFidelityLimited: boolean;
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
  readonly colorBudget: ColorBudgetLevel;
  readonly sampleMode: SampleMode;
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
