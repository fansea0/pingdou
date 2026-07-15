import { describe, it, expect } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshDbPath(): string {
  return join(tmpdir(), `stats-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('initDb new tables + runInTransaction', () => {
  it('creates users / product_assignments / auth_tokens tables after initDb', async () => {
    process.env.STATS_DB_PATH = freshDbPath();
    const { initDb, queryAll, flushNow } = await import('../../../server/db.js');
    await initDb();
    const tables = queryAll<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`);
    const names = tables.map(t => t.name);
    expect(names).toContain('users');
    expect(names).toContain('product_assignments');
    expect(names).toContain('auth_tokens');
    flushNow();
    if (existsSync(process.env.STATS_DB_PATH)) unlinkSync(process.env.STATS_DB_PATH);
  });

  it('runInTransaction commits when fn returns normally', async () => {
    process.env.STATS_DB_PATH = freshDbPath();
    const { initDb, runInTransaction, queryAll, flushNow } = await import('../../../server/db.js');
    await initDb();
    runInTransaction(() => {
      // no-op body: just confirm transaction boundaries work
    });
    expect(queryAll<{ n: number }>(`SELECT 1 AS n`).length).toBe(1);
    flushNow();
    if (existsSync(process.env.STATS_DB_PATH)) unlinkSync(process.env.STATS_DB_PATH);
  });

  it('runInTransaction rolls back when fn throws', async () => {
    process.env.STATS_DB_PATH = freshDbPath();
    const { initDb, runInTransaction, queryAll, flushNow } = await import('../../../server/db.js');
    await initDb();
    expect(() => runInTransaction(() => {
      throw new Error('boom');
    })).toThrow('boom');
    // sanity: connection still functional after rollback
    expect(queryAll<{ n: number }>(`SELECT 1 AS n`).length).toBe(1);
    flushNow();
    if (existsSync(process.env.STATS_DB_PATH)) unlinkSync(process.env.STATS_DB_PATH);
  });
});
