import { describe, it, expect } from 'vitest';
import {
  applyColorBudget,
  resolveColorBudget,
  MAX_CLUSTER_DELTA_E,
} from '@/pipeline/colorBudget';
import { deltaE76, rgbToLab } from '@/pipeline/colorSimplifier';
import type { Palette } from '@/types';

function paletteOf(rgbs: readonly (readonly [number, number, number])[]): Palette {
  return rgbs.map((rgb, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    rgb,
    name: `色 ${index + 1}`,
  }));
}

/** 每行一个色号，重复 count 次；全部为可见格（mask 全 0）。 */
function gridOf(rows: readonly (readonly [number, number])[]): Uint8Array {
  const indices = new Uint8Array(rows.length * rows[0].length);
  let cursor = 0;
  for (const row of rows) for (const value of row) indices[cursor++] = value;
  return indices;
}

function expand(spec: readonly { index: number; count: number }[], columns = 10): {
  indices: Uint8Array;
  mask: Uint8Array;
} {
  const values: number[] = [];
  for (const { index, count } of spec) {
    for (let i = 0; i < count; i += 1) values.push(index);
  }
  const rows = Math.ceil(values.length / columns);
  const size = rows * columns;
  while (values.length < size) values.push(values[0]);
  return { indices: Uint8Array.from(values), mask: new Uint8Array(size) };
}

function usedColorCount(indices: Uint8Array, mask: Uint8Array): number {
  const seen = new Set<number>();
  for (let i = 0; i < indices.length; i += 1) if (!mask[i]) seen.add(indices[i]);
  return seen.size;
}

describe('resolveColorBudget', () => {
  it('returns 0 when level is off', () => {
    expect(resolveColorBudget(5000, 'off')).toBe(0);
  });

  it('caps K at the level target on large images', () => {
    // 大图完全由档位决定：格子再多也不会放宽，否则等于不压缩
    expect(resolveColorBudget(2100, 'minimal')).toBe(6);
    expect(resolveColorBudget(2100, 'relaxed')).toBe(12);
    expect(resolveColorBudget(2100, 'standard')).toBe(20);
    expect(resolveColorBudget(100000, 'standard')).toBe(20);
  });

  it('falls back to a size-derived bound on tiny images', () => {
    expect(resolveColorBudget(200, 'standard')).toBe(5);
    expect(resolveColorBudget(400, 'standard')).toBe(10);
    expect(resolveColorBudget(10, 'minimal')).toBe(4);
  });

  it('returns 0 when there are no visible cells', () => {
    expect(resolveColorBudget(0, 'standard')).toBe(0);
  });
});

describe('applyColorBudget', () => {
  it('leaves indices untouched when level is off', () => {
    const palette = paletteOf([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
    const { indices, mask } = expand([
      { index: 0, count: 500 },
      { index: 1, count: 500 },
      { index: 2, count: 500 },
    ]);
    const before = indices.slice();
    const result = applyColorBudget(indices, palette, mask, 'off');

    expect(result.indices).toBe(indices);
    expect(Array.from(result.indices)).toEqual(Array.from(before));
    expect(result.targetColorCount).toBe(0);
    expect(result.colorCount).toBe(3);
    expect(result.fidelityLimited).toBe(false);
  });

  it('compresses many near-identical colors down to the budget', () => {
    // 30 个几乎相同的红色系，内部 Delta E 远小于上限
    const palette = paletteOf(
      Array.from({ length: 30 }, (_, i) => [200 + i, 20 + i, 20 + i] as const)
    );
    const spec = Array.from({ length: 30 }, (_, i) => ({ index: i, count: 400 }));
    const { indices, mask } = expand(spec);

    const result = applyColorBudget(indices, palette, mask, 'standard');

    expect(result.targetColorCount).toBe(20);
    expect(result.colorCount).toBe(20);
    expect(result.fidelityLimited).toBe(false);
    expect(result.colorCount).toBeLessThan(30);
  });

  it('compresses harder at tighter levels', () => {
    const palette = paletteOf(
      Array.from({ length: 30 }, (_, i) => [200 + i, 20 + i, 20 + i] as const)
    );
    const spec = Array.from({ length: 30 }, (_, i) => ({ index: i, count: 400 }));
    const { indices, mask } = expand(spec);

    const minimal = applyColorBudget(indices, palette, mask, 'minimal');
    const relaxed = applyColorBudget(indices, palette, mask, 'relaxed');
    const standard = applyColorBudget(indices, palette, mask, 'standard');

    expect(minimal.colorCount).toBe(6);
    expect(relaxed.colorCount).toBe(12);
    expect(standard.colorCount).toBe(20);
    expect(minimal.colorCount).toBeLessThan(relaxed.colorCount);
  });

  it('keeps heavily used dominant colors as representatives', () => {
    // 16 个色号：8 个红色系 + 8 个蓝色系，每系内部极其接近
    const red = Array.from({ length: 8 }, (_, i) => [220 + i, 20 + i, 20 + i] as const);
    const blue = Array.from({ length: 8 }, (_, i) => [20 + i, 20 + i, 220 + i] as const);
    const palette = paletteOf([...red, ...blue]);
    const spec = [
      { index: 0, count: 9000 },
      ...Array.from({ length: 7 }, (_, i) => ({ index: 1 + i, count: 10 })),
      { index: 8, count: 9000 },
      ...Array.from({ length: 7 }, (_, i) => ({ index: 9 + i, count: 10 })),
    ];
    const { indices, mask } = expand(spec);

    const result = applyColorBudget(indices, palette, mask, 'relaxed');
    const remaining = new Set<number>();
    for (let i = 0; i < result.indices.length; i += 1) {
      if (!mask[i]) remaining.add(result.indices[i]);
    }

    expect(result.targetColorCount).toBe(12);
    expect(result.colorCount).toBeLessThan(16);
    // 两个大主色都必须还在，稀有色被就近吸收
    expect(remaining.has(0)).toBe(true);
    expect(remaining.has(8)).toBe(true);
    // 每个幸存色都必须留在原来的色系里，不能跨系合并（红系不会变蓝）
    const redSurvivors = [...remaining].filter(index => index < 8);
    const blueSurvivors = [...remaining].filter(index => index >= 8);
    expect(redSurvivors.length).toBeGreaterThan(0);
    expect(blueSurvivors.length).toBeGreaterThan(0);
    expect(redSurvivors.length + blueSurvivors.length).toBe(remaining.size);
  });

  it('keeps far-apart accent colors instead of crushing them', () => {
    // 16 个色号：两个大主色 + 14 个彼此相距很远的强调色
    const accents = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [255, 0, 255],
      [0, 255, 255],
      [255, 128, 0],
      [128, 255, 0],
      [0, 128, 255],
      [128, 0, 255],
      [255, 0, 128],
      [0, 255, 128],
      [128, 128, 0],
      [128, 0, 128],
    ] as const;
    const palette = paletteOf([[250, 250, 250], ...accents]);
    const spec = [
      { index: 0, count: 12000 },
      ...accents.map((_, i) => ({ index: 1 + i, count: 12 })),
    ];
    const { indices, mask } = expand(spec);

    const result = applyColorBudget(indices, palette, mask, 'relaxed');

    // 白底 + 14 个远距强调色，任何两个强调色之间 Delta E 都远超上限
    expect(result.targetColorCount).toBe(12);
    expect(result.fidelityLimited).toBe(true);
    expect(result.colorCount).toBe(15);
    expect(result.colorCount).toBeGreaterThan(result.targetColorCount);
  });

  it('is deterministic across repeated runs', () => {
    const palette = paletteOf(
      Array.from({ length: 24 }, (_, i) => [i * 10, 255 - i * 10, (i * 37) % 256] as const)
    );
    const spec = Array.from({ length: 24 }, (_, i) => ({ index: i, count: 30 + i * 7 }));
    const { indices, mask } = expand(spec);

    const a = applyColorBudget(indices, palette, mask, 'standard');
    const b = applyColorBudget(indices, palette, mask, 'standard');

    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(a.colorCount).toBe(b.colorCount);
  });

  it('does not modify the input array', () => {
    const palette = paletteOf([[255, 0, 0], [250, 0, 0], [0, 0, 255]]);
    const { indices, mask } = expand([
      { index: 0, count: 4000 },
      { index: 1, count: 4000 },
      { index: 2, count: 4000 },
    ]);
    const before = indices.slice();

    applyColorBudget(indices, palette, mask, 'relaxed');

    expect(Array.from(indices)).toEqual(Array.from(before));
  });

  it('ignores background cells entirely', () => {
    const palette = paletteOf([[255, 0, 0], [250, 0, 0], [0, 0, 255]]);
    const { indices, mask } = expand([
      { index: 0, count: 4000 },
      { index: 1, count: 4000 },
      { index: 2, count: 4000 },
    ]);
    // 把 index 1 的所有格子标成背景
    for (let i = 0; i < indices.length; i += 1) {
      if (indices[i] === 1) mask[i] = 1;
    }
    const before = indices.slice();

    const result = applyColorBudget(indices, palette, mask, 'standard');

    for (let i = 0; i < result.indices.length; i += 1) {
      if (mask[i]) expect(result.indices[i]).toBe(before[i]);
    }
    expect(result.colorCount).toBe(2);
  });

  it('returns the original array when active colors already fit the budget', () => {
    const palette = paletteOf([[255, 0, 0], [250, 0, 0]]);
    const { indices, mask } = expand([
      { index: 0, count: 400 },
      { index: 1, count: 400 },
    ]);

    const result = applyColorBudget(indices, palette, mask, 'relaxed');

    expect(result.indices).toBe(indices);
    expect(result.colorCount).toBe(2);
    expect(result.fidelityLimited).toBe(false);
  });

  it('handles a single visible color without changes', () => {
    const palette = paletteOf([[255, 0, 0], [0, 255, 0]]);
    const { indices, mask } = expand([{ index: 1, count: 300 }]);

    const result = applyColorBudget(indices, palette, mask, 'standard');

    expect(result.colorCount).toBe(1);
    expect(Array.from(result.indices)).toEqual(Array.from(indices));
  });

  it('returns an empty result when every cell is background', () => {
    const palette = paletteOf([[255, 0, 0], [0, 255, 0]]);
    const indices = gridOf([
      [0, 1],
      [1, 0],
    ]);
    const mask = new Uint8Array([1, 1, 1, 1]);

    const result = applyColorBudget(indices, palette, mask, 'standard');

    expect(result.colorCount).toBe(0);
    expect(result.targetColorCount).toBe(0);
    expect(usedColorCount(result.indices, mask)).toBe(0);
  });

  it('rejects a mask whose length does not match indices', () => {
    const palette = paletteOf([[255, 0, 0]]);
    expect(() =>
      applyColorBudget(Uint8Array.from([0, 0]), palette, new Uint8Array([0]), 'standard')
    ).toThrow(/Mask length/);
  });

  it('rejects out-of-range palette indices', () => {
    const palette = paletteOf([[255, 0, 0]]);
    expect(() =>
      applyColorBudget(Uint8Array.from([0, 5]), palette, new Uint8Array([0, 0]), 'standard')
    ).toThrow(/out of range/);
  });

  it('exposes a fidelity cap that is meaningful in Lab space', () => {
    // 上限必须落在「可感知」量级：1 级差异远小于上限，红绿差异远大于上限
    const tiny = deltaE76(rgbToLab([100, 100, 100]), rgbToLab([101, 100, 100]));
    const huge = deltaE76(rgbToLab([255, 0, 0]), rgbToLab([0, 255, 0]));
    expect(tiny).toBeLessThan(MAX_CLUSTER_DELTA_E);
    expect(huge).toBeGreaterThan(MAX_CLUSTER_DELTA_E);
  });
});