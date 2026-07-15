import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dbPath = '';

async function freshDb() {
  dbPath = join(tmpdir(), `users-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.STATS_DB_PATH = dbPath;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db;
}

import { vi } from 'vitest';

function cleanup() {
  if (dbPath && existsSync(dbPath)) unlinkSync(dbPath);
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
});
