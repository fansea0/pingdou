import { describe, expect, it } from 'vitest';
import {
  deltaE76,
  MAX_SIMILAR_COLOR_DELTA_E,
  rgbToLab,
  simplifyRareColors,
  summarizeColors,
} from '@/pipeline/colorSimplifier';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [100, 100, 100], name: '灰 100' },
  { id: 'A02', rgb: [104, 104, 104], name: '灰 104' },
  { id: 'A03', rgb: [255, 0, 0], name: '红' },
];

function cells(...groups: ReadonlyArray<readonly [paletteIndex: number, count: number]>): Uint8Array {
  return Uint8Array.from(groups.flatMap(([paletteIndex, count]) => Array(count).fill(paletteIndex)));
}

function visibleMask(length: number): Uint8Array {
  return new Uint8Array(length);
}

describe('rgbToLab', () => {
  it('maps black to Lab zero and white approximately to neutral Lab 100', () => {
    expect(rgbToLab([0, 0, 0])).toEqual([0, 0, 0]);

    const white = rgbToLab([255, 255, 255]);
    expect(white[0]).toBeCloseTo(100, 4);
    expect(white[1]).toBeCloseTo(0, 4);
    expect(white[2]).toBeCloseTo(0, 4);
  });

  it('maps pure red to the known D65 CIE Lab reference', () => {
    const red = rgbToLab([255, 0, 0]);

    expect(red[0]).toBeCloseTo(53.24, 2);
    expect(red[1]).toBeCloseTo(80.09, 2);
    expect(red[2]).toBeCloseTo(67.2, 2);
  });
});

describe('deltaE76', () => {
  it('is symmetric and returns zero for identical colors', () => {
    const gray = rgbToLab([100, 100, 100]);
    const red = rgbToLab([255, 0, 0]);

    expect(deltaE76(gray, gray)).toBe(0);
    expect(deltaE76(gray, red)).toBeCloseTo(deltaE76(red, gray), 12);
  });
});

describe('simplifyRareColors', () => {
  it('merges a similar color used 9 times into a similar color used 10 times', () => {
    const indices = cells([0, 10], [1, 9]);

    const result = simplifyRareColors(indices, palette, visibleMask(indices.length));

    expect(result.indices).toEqual(cells([0, 19]));
    expect(result.stats).toEqual({ beforeColorCount: 2, afterColorCount: 1, mergedColorCount: 1 });
  });

  it('does not treat a color used exactly 10 times as rare', () => {
    const indices = cells([0, 10], [1, 10]);

    const result = simplifyRareColors(indices, palette, visibleMask(indices.length));

    expect(result.indices).toEqual(indices);
    expect(result.stats).toEqual({ beforeColorCount: 2, afterColorCount: 2, mergedColorCount: 0 });
  });

  it('keeps a perceptually distant rare accent unchanged', () => {
    const indices = cells([0, 10], [2, 1]);

    const result = simplifyRareColors(indices, palette, visibleMask(indices.length));

    expect(result.indices).toEqual(indices);
    expect(result.stats).toEqual({ beforeColorCount: 2, afterColorCount: 2, mergedColorCount: 0 });
  });

  it('merges a rare color immediately below the Delta E boundary', () => {
    const boundaryPalette: Palette = [
      { id: 'A01', rgb: [100, 100, 100], name: '主灰' },
      { id: 'A02', rgb: [119, 119, 119], name: '临界内灰' },
    ];
    const distance = deltaE76(
      rgbToLab(boundaryPalette[0].rgb),
      rgbToLab(boundaryPalette[1].rgb),
    );
    const indices = cells([0, 10], [1, 9]);

    expect(distance).toBeCloseTo(7.659835790667, 10);
    expect(distance).toBeLessThan(MAX_SIMILAR_COLOR_DELTA_E);
    expect(simplifyRareColors(indices, boundaryPalette, visibleMask(indices.length)).indices)
      .toEqual(cells([0, 19]));
  });

  it('keeps a rare color immediately above the Delta E boundary', () => {
    const boundaryPalette: Palette = [
      { id: 'A01', rgb: [100, 100, 100], name: '主灰' },
      { id: 'A02', rgb: [120, 120, 120], name: '临界外灰' },
    ];
    const distance = deltaE76(
      rgbToLab(boundaryPalette[0].rgb),
      rgbToLab(boundaryPalette[1].rgb),
    );
    const indices = cells([0, 10], [1, 9]);

    expect(distance).toBeCloseTo(8.056663148062, 10);
    expect(distance).toBeGreaterThan(MAX_SIMILAR_COLOR_DELTA_E);
    expect(simplifyRareColors(indices, boundaryPalette, visibleMask(indices.length)).indices)
      .toEqual(indices);
  });

  it('does not merge when every used color has fewer than 10 visible cells', () => {
    const indices = cells([0, 9], [1, 9]);

    const result = simplifyRareColors(indices, palette, visibleMask(indices.length));

    expect(result.indices).toEqual(indices);
    expect(result.stats).toEqual({ beforeColorCount: 2, afterColorCount: 2, mergedColorCount: 0 });
  });

  it('excludes background cells from counts and leaves their stored indices unchanged', () => {
    const indices = cells([0, 10], [1, 10]);
    const mask = visibleMask(indices.length);
    mask[indices.length - 1] = 1;

    const result = simplifyRareColors(indices, palette, mask);

    expect(result.indices.slice(0, 19)).toEqual(cells([0, 19]));
    expect(result.indices[19]).toBe(1);
    expect(result.stats).toEqual({ beforeColorCount: 2, afterColorCount: 1, mergedColorCount: 1 });
  });

  it('does not mutate source indices', () => {
    const indices = cells([0, 10], [1, 9]);
    const original = indices.slice();

    const result = simplifyRareColors(indices, palette, visibleMask(indices.length));

    expect(indices).toEqual(original);
    expect(result.indices).not.toBe(indices);
  });

  it('returns zero color counts when every cell is masked', () => {
    const indices = cells([0, 1], [1, 1], [2, 1]);

    const result = simplifyRareColors(indices, palette, Uint8Array.from([1, 1, 1]));

    expect(result.indices).toEqual(indices);
    expect(result.stats).toEqual({ beforeColorCount: 0, afterColorCount: 0, mergedColorCount: 0 });
  });

  it('leaves a single visible color unchanged', () => {
    const indices = cells([1, 1]);

    const result = simplifyRareColors(indices, palette, visibleMask(indices.length));

    expect(result.indices).toEqual(indices);
    expect(result.stats).toEqual({ beforeColorCount: 1, afterColorCount: 1, mergedColorCount: 0 });
  });

  it('chooses the lower palette index when eligible targets have equal distance', () => {
    const tiePalette: Palette = [
      { id: 'A01', rgb: [100, 100, 100], name: '灰一' },
      { id: 'A02', rgb: [100, 100, 100], name: '灰二' },
      { id: 'A03', rgb: [104, 104, 104], name: '稀有灰' },
    ];
    const indices = cells([0, 10], [1, 10], [2, 9]);

    const result = simplifyRareColors(indices, tiePalette, visibleMask(indices.length));

    expect(result.indices.slice(20)).toEqual(cells([0, 9]));
  });

  it('throws clear errors for a mismatched mask length and an out-of-range palette index', () => {
    expect(() => simplifyRareColors(cells([0, 1]), palette, new Uint8Array(0)))
      .toThrow('Mask length must match indices length');
    expect(() => simplifyRareColors(cells([3, 1]), palette, Uint8Array.from([1])))
      .toThrow('Palette index 3 is out of range');
  });
});

describe('summarizeColors', () => {
  it('reports visible color counts without merging', () => {
    const indices = cells([0, 2], [1, 1], [2, 1]);
    const mask = Uint8Array.from([0, 0, 0, 1]);

    expect(summarizeColors(indices, palette, mask)).toEqual({
      beforeColorCount: 2,
      afterColorCount: 2,
      mergedColorCount: 0,
    });
  });
});
