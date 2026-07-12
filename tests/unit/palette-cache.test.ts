import { describe, it, expect, beforeEach } from 'vitest';
import { cachePalette, readCachedPalette, clearPaletteCache } from '@/data/palette';

beforeEach(async () => {
  await clearPaletteCache();
});

describe('palette cache', () => {
  it('stores and retrieves palette', async () => {
    const palette = [{ id: 'A01', rgb: [1, 2, 3] as [number, number, number], name: 'x' }];
    await cachePalette(palette, 'v1');
    const got = await readCachedPalette();
    expect(got?.version).toBe('v1');
    expect(got?.palette[0].id).toBe('A01');
  });

  it('returns null when empty', async () => {
    const got = await readCachedPalette();
    expect(got).toBeNull();
  });

  it('rejects different version', async () => {
    await cachePalette(
      [{ id: 'A01', rgb: [1, 2, 3] as [number, number, number], name: 'x' }],
      'v1'
    );
    const got = await readCachedPalette('v2');
    expect(got).toBeNull();
  });
});