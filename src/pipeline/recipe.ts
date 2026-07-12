import type { Palette } from '@/types';

function hex(rgb: readonly [number, number, number]): string {
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
}

export function generateRecipeCSV(
  indices: Uint8Array,
  _gridSize: number,
  palette: Palette
): Blob {
  const counts = new Map<number, number>();
  for (const i of indices) {
    counts.set(i, (counts.get(i) ?? 0) + 1);
  }

  const rows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([idx, count]) => {
      const { id, name, rgb } = palette[idx];
      return `${id},${name},${hex(rgb)},${count}`;
    });

  const total = indices.length;
  const header = `色号,名称,色值,数量\n`;
  const totalRow = `\n合计,,,${total}`;
  const csv = header + rows.join('\n') + totalRow;
  return new Blob([csv], { type: 'text/csv' });
}
