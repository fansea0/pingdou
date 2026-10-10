import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;

async function freshDb() {
  tmp = mkdtempSync(join(tmpdir(), `settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db;
}

beforeEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('settings table', () => {
  it('seeds showProducts=true on first init', async () => {
    const { getSetting, flushNow } = await freshDb();
    const row = getSetting('showProducts');
    expect(row).not.toBeNull();
    expect(row?.value).toBe('true');
    expect(row?.updatedBy).toBe('');
    flushNow();
  });

  it('setSetting writes and updates cache; getSetting returns updated value', async () => {
    const { getSetting, setSetting, listAllSettings, flushNow } = await freshDb();
    setSetting('showProducts', 'false', 'admin');
    const row = getSetting('showProducts');
    expect(row?.value).toBe('false');
    expect(row?.updatedBy).toBe('admin');
    expect(row?.updatedAt).toBeGreaterThan(0);

    const all = listAllSettings();
    expect(all.find(r => r.key === 'showProducts')?.value).toBe('false');
    flushNow();
  });

  it('getSetting returns null for unknown keys without throwing', async () => {
    const { getSetting, flushNow } = await freshDb();
    expect(getSetting('nope')).toBeNull();
    flushNow();
  });

  it('loadAllSettings hydrates cache from disk after a fresh db reload', async () => {
    const first = await freshDb();
    first.setSetting('showProducts', 'false', 'alice');
    first.flushNow();

    // simulate restart by switching to a fresh tmpdir with the persisted db copied in
    const tmp2 = mkdtempSync(join(tmpdir(), `settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    process.env.PINGDOU_DATA_DIR = tmp2;
    vi.resetModules();

    const { copyFileSync } = await import('node:fs');
    copyFileSync(join(tmp, 'stats.db'), join(tmp2, 'stats.db'));
    const second = await import('../../../server/db.js');
    await second.initDb();
    const row = second.getSetting('showProducts');
    expect(row?.value).toBe('false');
    expect(row?.updatedBy).toBe('alice');
    second.flushNow();
    rmSync(tmp2, { recursive: true, force: true });
  });
});