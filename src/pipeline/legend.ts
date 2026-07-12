import type { Palette } from '@/types';

export interface LegendRow {
  readonly id: string;
  readonly name: string;
  readonly rgb: readonly [number, number, number];
  readonly count: number;
  readonly index: number;
}

/**
 * Derive legend rows from a quantization result.
 * - Counts occurrences of each palette index.
 * - Sorts rows by count descending.
 * - Skips colors with count === 0.
 */
export function computeLegend(indices: Uint8Array, palette: Palette): LegendRow[] {
  const counts = new Map<number, number>();
  for (const i of indices) {
    counts.set(i, (counts.get(i) ?? 0) + 1);
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
