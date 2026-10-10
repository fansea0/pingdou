import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'seed-test-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('seedDefaultAdminIfEmpty', () => {
  it('seeds root/12345678/mustChangePassword=true on empty users table', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { seedDefaultAdminIfEmpty, getUserByUsername } = await import('../../../server/users.js');
    seedDefaultAdminIfEmpty();
    const root = getUserByUsername('root');
    expect(root).not.toBeNull();
    expect(root!.role).toBe('admin');
    expect(root!.mustChangePassword).toBe(1);
    expect(root!.expiresAt).toBeNull();
  });

  it('logs the default credentials to console on seed', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { seedDefaultAdminIfEmpty } = await import('../../../server/users.js');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedDefaultAdminIfEmpty();
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/12345678/));
    spy.mockRestore();
  });

  it('is a no-op when users table is non-empty', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { createUser, seedDefaultAdminIfEmpty, getUserByUsername } =
      await import('../../../server/users.js');
    createUser({ username: 'preset', password: 'pw1234', role: 'admin' });
    seedDefaultAdminIfEmpty();
    expect(getUserByUsername('root')).toBeNull();
  });

  it('is idempotent across repeated calls', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { seedDefaultAdminIfEmpty, getUserByUsername } = await import('../../../server/users.js');
    seedDefaultAdminIfEmpty();
    seedDefaultAdminIfEmpty();
    expect(getUserByUsername('root')).not.toBeNull();
  });
});
