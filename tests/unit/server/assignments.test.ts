import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dbPath = '';

async function freshDb() {
  dbPath = join(tmpdir(), `assign-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.STATS_DB_PATH = dbPath;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db;
}

beforeEach(() => {
  if (dbPath && existsSync(dbPath)) unlinkSync(dbPath);
});

describe('assignments', () => {
  it('reconcileAssignments inserts new + revokes removed + keeps intersection', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments, getActiveAssignmentsForUser, hasActiveAssignment } = await import('../../../server/assignments.js');
    const u = createUser({ username: 'm', password: 'pw1234', role: 'merchant' });

    reconcileAssignments(u.id, ['a', 'b']);
    expect(getActiveAssignmentsForUser(u.id).map(a => a.productId).sort()).toEqual(['a', 'b']);

    reconcileAssignments(u.id, ['b', 'c']);
    const active = getActiveAssignmentsForUser(u.id);
    expect(active.map(a => a.productId).sort()).toEqual(['b', 'c']);
    expect(hasActiveAssignment(u.id, 'a')).toBe(false);
    expect(hasActiveAssignment(u.id, 'b')).toBe(true);
    expect(hasActiveAssignment(u.id, 'c')).toBe(true);

    db.flushNow();
  });

  it('unique index prevents two merchants holding the same product active at once', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments } = await import('../../../server/assignments.js');
    const u1 = createUser({ username: 'u1', password: 'pw1234', role: 'merchant' });
    const u2 = createUser({ username: 'u2', password: 'pw1234', role: 'merchant' });

    reconcileAssignments(u1.id, ['shared']);
    expect(() => reconcileAssignments(u2.id, ['shared'])).toThrow();

    db.flushNow();
  });

  it('reconcileAssignments is idempotent on a no-op call', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments, getActiveAssignmentsForUser } = await import('../../../server/assignments.js');
    const u = createUser({ username: 'm', password: 'pw1234', role: 'merchant' });
    reconcileAssignments(u.id, ['a']);
    reconcileAssignments(u.id, ['a']);
    expect(getActiveAssignmentsForUser(u.id).length).toBe(1);
    db.flushNow();
  });

  it('revokeAllForProduct ends every active row for that product', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments, revokeAllForProduct, hasActiveAssignment } = await import('../../../server/assignments.js');
    const u = createUser({ username: 'm', password: 'pw1234', role: 'merchant' });
    reconcileAssignments(u.id, ['a', 'b']);
    revokeAllForProduct('a');
    expect(hasActiveAssignment(u.id, 'a')).toBe(false);
    expect(hasActiveAssignment(u.id, 'b')).toBe(true);
    db.flushNow();
  });
});