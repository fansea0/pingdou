export type RGB = readonly [number, number, number];

export interface PaletteEntry {
  readonly id: string;
  readonly rgb: RGB;
  readonly name: string;
}

export type Palette = ReadonlyArray<PaletteEntry>;

export interface ProcessParams {
  readonly gridSize: number;
  readonly enableDither: boolean;
}

export interface PipelineResult {
  readonly indices: Uint8Array;
  readonly gridSize: number;
  readonly outW: number;
  readonly outH: number;
  readonly token: number;
}

export type UIStatus = 'idle' | 'loading' | 'ready' | 'recomputing' | 'exporting';

export interface ExportItem {
  readonly name: string;
  readonly blob: Blob;
  readonly filename: string;
}
