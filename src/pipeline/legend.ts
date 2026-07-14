import type { Palette, BackgroundMask } from '@/types';

export interface LegendRow {
  readonly id: string;
  readonly name: string;
  readonly rgb: readonly [number, number, number];
  readonly count: number;
  readonly index: number;
}

/**
 * Derive legend rows from a quantization result.
 * - Counts occurrences of each palette index among NON-BACKGROUND cells.
 * - Sorts rows by count descending.
 * - Skips colors with count === 0.
 */
export function computeLegend(
  indices: Uint8Array,
  palette: Palette,
  mask: BackgroundMask | null = null
): LegendRow[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < indices.length; i++) {
    if (mask && mask[i]) continue;
    const idx = indices[i];
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }

  const rows: LegendRow[] = [];
  for (const [idx, count] of counts) {
    if (count === 0) continue;
    const { id, name, rgb } = palette[idx];
    rows.push({ id, name, rgb, count, index: idx });
  }

  rows.sort((a, b) => b.count - a.count);
  return rows;
}
