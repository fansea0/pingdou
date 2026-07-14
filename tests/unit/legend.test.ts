import { describe, it, expect } from 'vitest';
import { computeLegend } from '@/pipeline/legend';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 255, 0], name: '绿' },
  { id: 'A03', rgb: [0, 0, 255], name: '蓝' },
];

describe('computeLegend', () => {
  it('counts each color correctly', () => {
    const indices = new Uint8Array([0, 0, 1, 2, 1, 0]);
    const legend = computeLegend(indices, palette);
    const a01 = legend.find(r => r.id === 'A01')!;
    const a02 = legend.find(r => r.id === 'A02')!;
    const a03 = legend.find(r => r.id === 'A03')!;
    expect(a01.count).toBe(3);
    expect(a02.count).toBe(2);
    expect(a03.count).toBe(1);
  });

  it('sorts by count descending', () => {
    const indices = new Uint8Array([0, 1, 1, 1, 2, 2]);
    const legend = computeLegend(indices, palette);
    expect(legend[0].count).toBe(3);
    expect(legend[1].count).toBe(2);
    expect(legend[2].count).toBe(1);
  });

  it('skips colors with count zero', () => {
    const indices = new Uint8Array([0, 0, 0, 0]);
    const legend = computeLegend(indices, palette);
    expect(legend).toHaveLength(1);
    expect(legend[0].id).toBe('A01');
  });

  it('returns empty array for empty indices', () => {
    const legend = computeLegend(new Uint8Array(0), palette);
    expect(legend).toEqual([]);
  });

  it('each row carries palette index for hover linkage', () => {
    const indices = new Uint8Array([2, 2, 0]);
    const legend = computeLegend(indices, palette);
    const a03 = legend.find(r => r.id === 'A03')!;
    const a01 = legend.find(r => r.id === 'A01')!;
    expect(a03.index).toBe(2);
    expect(a01.index).toBe(0);
  });

  it('skips cells where mask===1', () => {
    const indices = new Uint8Array([0, 0, 1, 2]);
    const mask = new Uint8Array([1, 0, 0, 0]);
    const legend = computeLegend(indices, palette, mask);
    const a01 = legend.find(r => r.id === 'A01')!;
    expect(a01.count).toBe(1);
    expect(legend.find(r => r.id === 'A02')?.count).toBe(1);
    expect(legend.find(r => r.id === 'A03')?.count).toBe(1);
  });
});
