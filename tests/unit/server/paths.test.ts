import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ORIG = process.env.PINGDOU_DATA_DIR;

beforeEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  vi.resetModules();
});

afterEach(() => {
  if (ORIG === undefined) delete process.env.PINGDOU_DATA_DIR;
  else process.env.PINGDOU_DATA_DIR = ORIG;
});

describe('PATHS', () => {
  it('falls back to /var/lib/pingdou when PINGDOU_DATA_DIR is missing', async () => {
    // @ts-expect-error -- query string busts module cache; runtime resolves fine, TS static analysis doesn't
    const { PATHS } = await import('../../../server/paths.js?default=1');
    expect(PATHS.dataDir).toBe(resolve('/var/lib/pingdou'));
    expect(PATHS.imagesDir).toBe(join(resolve('/var/lib/pingdou'), 'images'));
    expect(PATHS.dbPath).toBe(join(resolve('/var/lib/pingdou'), 'stats.db'));
  });

  it('derives imagesDir and dbPath from PINGDOU_DATA_DIR', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'paths-test-'));
    try {
      process.env.PINGDOU_DATA_DIR = tmp;
      // @ts-expect-error -- query string busts module cache; runtime resolves fine, TS static analysis doesn't
      const { PATHS } = await import('../../../server/paths.js?ok=1');
      expect(PATHS.dataDir).toBe(resolve(tmp));
      expect(PATHS.imagesDir).toBe(join(resolve(tmp), 'images'));
      expect(PATHS.dbPath).toBe(join(resolve(tmp), 'stats.db'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});