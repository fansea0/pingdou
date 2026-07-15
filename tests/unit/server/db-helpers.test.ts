import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dbPath = '';

async function freshDb() {
  dbPath = join(tmpdir(), `stats-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.STATS_DB_PATH = dbPath;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db;
}

beforeEach(() => {
  if (dbPath && existsSync(dbPath)) unlinkSync(dbPath);
});

describe('initDb new tables + runInTransaction', () => {
  it('creates users / product_assignments / auth_tokens tables after initDb', async () => {
    const { queryAll, flushNow } = await freshDb();
    const tables = queryAll<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`);
    const names = tables.map(t => t.name);
    expect(names).toContain('users');
    expect(names).toContain('product_assignments');
    expect(names).toContain('auth_tokens');
    flushNow();
  });

  it('runInTransaction commits when fn returns normally', async () => {
    const { runInTransaction, queryAll, flushNow } = await freshDb();
    runInTransaction(() => {});
    expect(queryAll<{ n: number }>(`SELECT 1 AS n`).length).toBe(1);
    flushNow();
  });

  it('runInTransaction rolls back when fn throws', async () => {
    const { runInTransaction, queryAll, flushNow } = await freshDb();
    expect(() => runInTransaction(() => {
      throw new Error('boom');
    })).toThrow('boom');
    expect(queryAll<{ n: number }>(`SELECT 1 AS n`).length).toBe(1);
    flushNow();
  });
});
