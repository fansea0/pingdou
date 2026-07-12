import { describe, it, expect } from 'vitest';
import { generateRecipeCSV } from '@/pipeline/recipe';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 0, 255], name: '蓝' },
];

describe('generateRecipeCSV', () => {
  it('counts each color correctly', async () => {
    const indices = new Uint8Array([0, 0, 1, 0, 1, 1]);
    const blob = generateRecipeCSV(indices, 3, palette);
    expect(blob.type).toBe('text/csv');
    const text = await blob.text();
    expect(text).toContain('A01,红,#ff0000,3');
    expect(text).toContain('A02,蓝,#0000ff,3');
  });

  it('total count equals grid area', async () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    const blob = generateRecipeCSV(indices, 2, palette);
    const text = await blob.text();
    const lines = text.split('\n').filter(l => l && !l.startsWith('色号'));
    const total = lines
      .map(l => Number(l.split(',').pop()))
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
  });

  it('skips unused colors', async () => {
    const indices = new Uint8Array([0, 0, 0, 0]);
    const blob = generateRecipeCSV(indices, 2, palette);
    const text = await blob.text();
    const dataLines = text.split('\n').filter(l => l && !l.startsWith('色号'));
    expect(dataLines.length).toBe(1);
  });
});
