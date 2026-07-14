import type { Palette, BackgroundMask } from '@/types';

function hex(rgb: readonly [number, number, number]): string {
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
}

export function generateRecipeCSV(
  indices: Uint8Array,
  _gridSize: number,
  palette: Palette,
  mask: BackgroundMask | null = null
): Blob {
  const counts = new Map<number, number>();
  let bodyTotal = 0;
  for (let i = 0; i < indices.length; i++) {
    if (mask && mask[i]) continue;
    const idx = indices[i];
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
    bodyTotal++;
  }

  const rows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([idx, count]) => {
      const { id, name, rgb } = palette[idx];
      return `${id},${name},${hex(rgb)},${count}`;
    });

  const header = `色号,名称,色值,数量\n`;
  const totalRow = `\n合计,,,${bodyTotal}`;
  const csv = header + rows.join('\n') + totalRow;
  return new Blob([csv], { type: 'text/csv' });
}
