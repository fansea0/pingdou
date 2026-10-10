import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { runStmt, queryAll } from '../../../server/db.js';

type DbApi = { runStmt: typeof runStmt; queryAll: typeof queryAll; flushNow: () => void };

let tmp: string;
let dbPath = '';

async function freshDb(): Promise<DbApi> {
  tmp = mkdtempSync(join(tmpdir(), `assign-test-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  dbPath = join(tmp, 'stats.db');
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db as unknown as DbApi;
}

function seedProduct(db: DbApi, name: string, order: number): number {
  const now = Date.now();
  db.runStmt(
    `INSERT INTO products (name, image, price, description, url, "order", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, '', 100, '', '', order, now, now],
  );
  const row = db.queryAll<{ id: number }>(
    `SELECT id FROM products WHERE name = ? ORDER BY id DESC LIMIT 1`,
    [name],
  );
  return row[0].id;
}

beforeEach(() => {
  if (dbPath && existsSync(dbPath)) unlinkSync(dbPath);
  delete process.env.PINGDOU_DATA_DIR;
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('assignments', () => {
  it('reconcileAssignments inserts new + revokes removed + keeps intersection', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments, getActiveAssignmentsForUser, hasActiveAssignment } = await import('../../../server/assignments.js');
    const u = createUser({ username: 'm', password: 'pw1234', role: 'merchant' });
    const idA = seedProduct(db, 'a', 1);
    const idB = seedProduct(db, 'b', 2);
    const idC = seedProduct(db, 'c', 3);

    reconcileAssignments(u.id, [idA, idB]);
    expect(getActiveAssignmentsForUser(u.id).map(a => a.productId).sort((x, y) => x - y)).toEqual([idA, idB].sort((x, y) => x - y));

    reconcileAssignments(u.id, [idB, idC]);
    const active = getActiveAssignmentsForUser(u.id);
    expect(active.map(a => a.productId).sort((x, y) => x - y)).toEqual([idB, idC].sort((x, y) => x - y));
    expect(hasActiveAssignment(u.id, idA)).toBe(false);
    expect(hasActiveAssignment(u.id, idB)).toBe(true);
    expect(hasActiveAssignment(u.id, idC)).toBe(true);

    db.flushNow();
  });

  it('unique index prevents two merchants holding the same product active at once', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments } = await import('../../../server/assignments.js');
    const u1 = createUser({ username: 'u1', password: 'pw1234', role: 'merchant' });
    const u2 = createUser({ username: 'u2', password: 'pw1234', role: 'merchant' });
    const idShared = seedProduct(db, 'shared', 1);

    reconcileAssignments(u1.id, [idShared]);
    expect(() => reconcileAssignments(u2.id, [idShared])).toThrow();

    db.flushNow();
  });

  it('reconcileAssignments is idempotent on a no-op call', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments, getActiveAssignmentsForUser } = await import('../../../server/assignments.js');
    const u = createUser({ username: 'm', password: 'pw1234', role: 'merchant' });
    const idA = seedProduct(db, 'a', 1);
    reconcileAssignments(u.id, [idA]);
    reconcileAssignments(u.id, [idA]);
    expect(getActiveAssignmentsForUser(u.id).length).toBe(1);
    db.flushNow();
  });

  it('revokeAllForProduct ends every active row for that product', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments, revokeAllForProduct, hasActiveAssignment } = await import('../../../server/assignments.js');
    const u = createUser({ username: 'm', password: 'pw1234', role: 'merchant' });
    const idA = seedProduct(db, 'a', 1);
    const idB = seedProduct(db, 'b', 2);
    reconcileAssignments(u.id, [idA, idB]);
    revokeAllForProduct(idA);
    expect(hasActiveAssignment(u.id, idA)).toBe(false);
    expect(hasActiveAssignment(u.id, idB)).toBe(true);
    db.flushNow();
  });
});
