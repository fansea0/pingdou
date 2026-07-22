import type { ColorSimplificationStats, Palette, RGB } from '@/types';

export const RARE_COLOR_COUNT_LIMIT = 10;

export type Lab = readonly [number, number, number];

export interface ColorSimplificationResult {
  readonly indices: Uint8Array;
  readonly stats: ColorSimplificationStats;
}

function linearizeSrgbChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function labTransform(value: number): number {
  const delta = 6 / 29;
  return value > delta ** 3
    ? Math.cbrt(value)
    : value / (3 * delta ** 2) + 4 / 29;
}

export function rgbToLab(rgb: RGB): Lab {
  const red = linearizeSrgbChannel(rgb[0]);
  const green = linearizeSrgbChannel(rgb[1]);
  const blue = linearizeSrgbChannel(rgb[2]);

  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;

  const transformedX = labTransform(x);
  const transformedY = labTransform(y);
  const transformedZ = labTransform(z);

  return [
    116 * transformedY - 16,
    500 * (transformedX - transformedY),
    200 * (transformedY - transformedZ),
  ];
}

export function deltaE76(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function validateInput(indices: Uint8Array, palette: Palette, mask: Uint8Array): void {
  if (mask.length !== indices.length) {
    throw new Error('Mask length must match indices length');
  }

  for (const paletteIndex of indices) {
    if (paletteIndex >= palette.length) {
      throw new Error(`Palette index ${paletteIndex} is out of range`);
    }
  }
}

function countVisibleColors(indices: Uint8Array, palette: Palette, mask: Uint8Array): number[] {
  const counts = new Array<number>(palette.length).fill(0);
  for (let position = 0; position < indices.length; position += 1) {
    if (mask[position] === 0) {
      counts[indices[position]] += 1;
    }
  }
  return counts;
}

function usedColorCount(counts: readonly number[]): number {
  return counts.reduce((total, count) => total + Number(count > 0), 0);
}

function rareColorCount(counts: readonly number[]): number {
  return counts.reduce(
    (total, count) => total + Number(count > 0 && count < RARE_COLOR_COUNT_LIMIT),
    0,
  );
}

function visibleCellCount(counts: readonly number[]): number {
  return counts.reduce((total, count) => total + count, 0);
}

function createStats(
  beforeCounts: readonly number[],
  afterCounts: readonly number[],
  mergedColorCount: number,
): ColorSimplificationStats {
  const totalVisibleCells = visibleCellCount(afterCounts);
  const rareColorCountAfter = rareColorCount(afterCounts);

  return {
    beforeColorCount: usedColorCount(beforeCounts),
    afterColorCount: usedColorCount(afterCounts),
    mergedColorCount,
    rareColorCountBefore: rareColorCount(beforeCounts),
    rareColorCountAfter,
    minimumColorCountSatisfied: totalVisibleCells >= RARE_COLOR_COUNT_LIMIT && rareColorCountAfter === 0,
  };
}

export function summarizeColors(
  indices: Uint8Array,
  palette: Palette,
  mask: Uint8Array,
): ColorSimplificationStats {
  validateInput(indices, palette, mask);
  const counts = countVisibleColors(indices, palette, mask);
  return createStats(counts, counts, 0);
}

export function simplifyRareColors(
  indices: Uint8Array,
  palette: Palette,
  mask: Uint8Array,
): ColorSimplificationResult {
  validateInput(indices, palette, mask);

  const visibleCounts = countVisibleColors(indices, palette, mask);
  const beforeCounts = [...visibleCounts];
  const labs = palette.map(({ rgb }) => rgbToLab(rgb));
  const simplifiedIndices = indices.slice();

  let mergedColorCount = 0;
  while (usedColorCount(visibleCounts) > 1) {
    let sourceIndex = -1;
    for (let paletteIndex = 0; paletteIndex < visibleCounts.length; paletteIndex += 1) {
      const count = visibleCounts[paletteIndex];
      if (
        count > 0
        && count < RARE_COLOR_COUNT_LIMIT
        && (sourceIndex < 0 || count < visibleCounts[sourceIndex])
      ) {
        sourceIndex = paletteIndex;
      }
    }

    if (sourceIndex < 0) {
      break;
    }

    let targetIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let paletteIndex = 0; paletteIndex < visibleCounts.length; paletteIndex += 1) {
      if (paletteIndex === sourceIndex || visibleCounts[paletteIndex] === 0) {
        continue;
      }

      const distance = deltaE76(labs[sourceIndex], labs[paletteIndex]);
      if (distance < bestDistance) {
        bestDistance = distance;
        targetIndex = paletteIndex;
      }
    }

    for (let position = 0; position < simplifiedIndices.length; position += 1) {
      if (mask[position] === 0 && simplifiedIndices[position] === sourceIndex) {
        simplifiedIndices[position] = targetIndex;
      }
    }
    visibleCounts[targetIndex] += visibleCounts[sourceIndex];
    visibleCounts[sourceIndex] = 0;
    mergedColorCount += 1;
  }

  return {
    indices: simplifiedIndices,
    stats: createStats(beforeCounts, visibleCounts, mergedColorCount),
  };
}
