import { describe, it, expect } from 'vitest';
import { parsePalette } from '@/palette/schema';

describe('parsePalette', () => {
  it('parses valid entries', () => {
    const raw = [
      { id: 'P001', rgb: [255, 255, 255], name: '白色' },
      { id: 'P128', rgb: [0, 0, 0], name: '黑色' },
    ];
    const palette = parsePalette(raw);
    expect(palette).toHaveLength(2);
    expect(palette[0].rgb).toEqual([255, 255, 255]);
  });

  it('rejects bad id format', () => {
    expect(() => parsePalette([{ id: 'p1', rgb: [0, 0, 0], name: 'x' }])).toThrow();
  });

  it('rejects out-of-range rgb', () => {
    expect(() => parsePalette([{ id: 'P001', rgb: [256, 0, 0], name: 'x' }])).toThrow();
  });

  it('rejects non-array input', () => {
    expect(() => parsePalette({} as unknown[])).toThrow();
  });
});
