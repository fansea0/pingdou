import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dbPath = '';
let origSeedPw: string | undefined;

async function freshDb() {
  dbPath = join(tmpdir(), `users-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.STATS_DB_PATH = dbPath;
  origSeedPw = process.env.ROOT_PASSWORD;
  process.env.ROOT_PASSWORD = 'test-seed-password-1234';
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db;
}

import { vi } from 'vitest';

function cleanup() {
  if (dbPath && existsSync(dbPath)) unlinkSync(dbPath);
  if (origSeedPw === undefined) delete process.env.ROOT_PASSWORD;
  else process.env.ROOT_PASSWORD = origSeedPw;
}

beforeEach(() => {
  cleanup();
});

describe('users', () => {
  it('createUser inserts and getUserByUsername retrieves', async () => {
    const db = await freshDb();
    const { createUser, getUserByUsername } = await import('../../../server/users.js');
    const u = createUser({ username: 'alice', password: 'pw1234', role: 'merchant' });
    expect(u.id).toBeGreaterThan(0);
    const fetched = getUserByUsername('alice');
    expect(fetched?.username).toBe('alice');
    expect(fetched?.role).toBe('merchant');
    expect(fetched?.disabled).toBe(0);
    expect(fetched?.mustChangePassword).toBe(0);
    db.flushNow();
  });

  it('duplicate username throws', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    createUser({ username: 'dup', password: 'pw1234', role: 'merchant' });
    expect(() => createUser({ username: 'dup', password: 'pw1234', role: 'merchant' })).toThrow();
    db.flushNow();
  });

  it('setUserDisabled toggles the disabled flag', async () => {
    const db = await freshDb();
    const { createUser, setUserDisabled, getUserById } = await import('../../../server/users.js');
    const u = createUser({ username: 'bob', password: 'pw1234', role: 'merchant' });
    setUserDisabled(u.id, true);
    expect(getUserById(u.id)?.disabled).toBe(1);
    setUserDisabled(u.id, false);
    expect(getUserById(u.id)?.disabled).toBe(0);
    db.flushNow();
  });

  it('setUserPassword replaces the hash; mustChangePassword stays as set', async () => {
    const db = await freshDb();
    const { createUser, setUserPassword, getUserById } = await import('../../../server/users.js');
    const u = createUser({ username: 'c', password: 'oldpw', role: 'merchant', mustChangePassword: true });
    const oldHash = u.passwordHash;
    setUserPassword(u.id, 'newpw1');
    const fetched = getUserById(u.id)!;
    expect(fetched.passwordHash).not.toBe(oldHash);
    expect(fetched.mustChangePassword).toBe(1);
    db.flushNow();
  });

  it('seedDefaultAdminIfEmpty inserts root once and is idempotent', async () => {
    const db = await freshDb();
    const { seedDefaultAdminIfEmpty, getUserByUsername } = await import('../../../server/users.js');
    seedDefaultAdminIfEmpty();
    seedDefaultAdminIfEmpty();
    const root = getUserByUsername('root');
    expect(root?.role).toBe('admin');
    expect(root?.expiresAt).toBeNull();
    db.flushNow();
  });

  it('seedDefaultAdminIfEmpty does nothing when another user exists', async () => {
    const db = await freshDb();
    const { createUser, seedDefaultAdminIfEmpty, getUserByUsername } = await import('../../../server/users.js');
    createUser({ username: 'preset-admin', password: 'pw1234', role: 'admin' });
    seedDefaultAdminIfEmpty();
    expect(getUserByUsername('root')).toBeNull();
    db.flushNow();
  });

  it('deleteUser removes the row', async () => {
    const db = await freshDb();
    const { createUser, deleteUser, getUserById } = await import('../../../server/users.js');
    const u = createUser({ username: 'gone', password: 'pw1234', role: 'merchant' });
    deleteUser(u.id);
    expect(getUserById(u.id)).toBeNull();
    db.flushNow();
  });

  it('deleteUser refuses to delete the last admin', async () => {
    const db = await freshDb();
    const { seedDefaultAdminIfEmpty, deleteUser, getUserByUsername } = await import('../../../server/users.js');
    seedDefaultAdminIfEmpty();
    const root = getUserByUsername('root')!;
    expect(() => deleteUser(root.id)).toThrow(/last admin/i);
    db.flushNow();
  });

  it('countAdmins returns admin total', async () => {
    const db = await freshDb();
    const { createUser, countAdmins } = await import('../../../server/users.js');
    createUser({ username: 'a1', password: 'pw1234', role: 'admin' });
    createUser({ username: 'a2', password: 'pw1234', role: 'admin' });
    createUser({ username: 'm1', password: 'pw1234', role: 'merchant' });
    expect(countAdmins()).toBe(2);
    db.flushNow();
  });

  it('seedDefaultAdminIfEmpty throws when ROOT_PASSWORD is missing', async () => {
    // 全新 db（空 users 表） + 清空 env：seedDefaultAdminIfEmpty 应该 fail
    cleanup();
    dbPath = join(tmpdir(), `users-test-noseed-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    process.env.STATS_DB_PATH = dbPath;
    delete process.env.ROOT_PASSWORD;
    vi.resetModules();
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { seedDefaultAdminIfEmpty } = await import('../../../server/users.js');
    expect(() => seedDefaultAdminIfEmpty()).toThrow(/ROOT_PASSWORD/);
  });

  it('seedDefaultAdminIfEmpty throws when ROOT_PASSWORD is too short', async () => {
    cleanup();
    dbPath = join(tmpdir(), `users-test-shortpw-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    process.env.STATS_DB_PATH = dbPath;
    process.env.ROOT_PASSWORD = 'short';
    vi.resetModules();
    const db = await import('../../../server/db.js');
    await db.initDb();
    const { seedDefaultAdminIfEmpty } = await import('../../../server/users.js');
    expect(() => seedDefaultAdminIfEmpty()).toThrow(/at least 8/i);
  });

  it('seedDefaultAdminIfEmpty is no-op when ROOT_PASSWORD missing but users already exist', async () => {
    const db = await freshDb();  // 全新 db（空 users 表）
    const { createUser, seedDefaultAdminIfEmpty, getUserByUsername } = await import('../../../server/users.js');
    // users 表非空后，seedDefaultAdminIfEmpty 应该早返回
    createUser({ username: 'preset-merchant', password: 'pw1234', role: 'merchant' });
    // 清空 env：seedDefaultAdminIfEmpty 应该不抛错（因为 users 表非空）
    delete process.env.ROOT_PASSWORD;
    expect(() => seedDefaultAdminIfEmpty()).not.toThrow();
    // root 仍不存在（说明 seedDefaultAdminIfEmpty 早返回，没有创建 root）
    expect(getUserByUsername('root')).toBeNull();
    db.flushNow();
  });
});
