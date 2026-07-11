import { describe, it, expect } from 'vitest';
import { parsePalette } from '@/palette/schema';

describe('parsePalette', () => {
  it('parses valid entries', () => {
    const raw = [
      { id: 'A01', rgb: [255, 255, 255], name: '白' },
      { id: 'A99', rgb: [0, 0, 0], name: '黑' },
    ];
    const palette = parsePalette(raw);
    expect(palette).toHaveLength(2);
    expect(palette[0].rgb).toEqual([255, 255, 255]);
  });

  it('rejects bad id format', () => {
    expect(() => parsePalette([{ id: 'p1', rgb: [0, 0, 0], name: 'x' }])).toThrow();
    expect(() => parsePalette([{ id: 'P001', rgb: [0, 0, 0], name: 'x' }])).toThrow();
  });

  it('rejects out-of-range rgb', () => {
    expect(() => parsePalette([{ id: 'A01', rgb: [256, 0, 0], name: 'x' }])).toThrow();
  });

  it('rejects non-array input', () => {
    expect(() => parsePalette({} as unknown[])).toThrow();
  });

  it('loads palette with substantial entry count', () => {
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const big = Array.from({ length: 291 }, (_, i) => {
      const letter = LETTERS[Math.floor(i / 99)];
      const num = String((i % 99) + 1).padStart(2, '0');
      return {
        id: `${letter}${num}`,
        rgb: [(i * 7) % 256, (i * 13) % 256, (i * 19) % 256] as [number, number, number],
        name: `色${i + 1}`,
      };
    });
    const palette = parsePalette(big);
    expect(palette.length).toBeGreaterThanOrEqual(100);
  });
});