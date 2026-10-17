import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs from 'sql.js';

let tmp = '';

/**
 * 2026-10-16 版的老 works 表：没有 status / 四个参数列 / upload_token。
 * 用它验证 ensureColumn 这条老库升级路径 —— 新库路径由下面另一个用例覆盖。
 */
const OLD_WORKS_DDL = `
CREATE TABLE works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  CHECK (published IN (0, 1))
);`;

const NEW_COLUMNS = [
  'status', 'board_w', 'board_h', 'bean_count', 'color_count',
  'estimate_minutes', 'upload_token',
];

/** 先在磁盘上造一个只有老 works 表的 stats.db，让 initDb 走 CREATE TABLE 之外的那条路。 */
async function seedOldWorksDb(dir: string): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => resolve(process.cwd(), 'node_modules/sql.js/dist', file),
  });
  const db = new SQL.Database();
  db.exec(OLD_WORKS_DDL);
  writeFileSync(join(dir, 'stats.db'), Buffer.from(db.export()));
  db.close();
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'works-schema-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('works 表 schema', () => {
  it('新库直接建出全部 7 个新列', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const cols = db.queryAll<{ name: string }>(`PRAGMA table_info(works)`).map(r => r.name);
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);
  });

  it('status 默认 pending（失败安全：漏写 status 的行不会被公开）', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const info = db.queryAll<{ name: string; dflt_value: string | null }>(
      `PRAGMA table_info(works)`,
    );
    const defaults = new Map(info.map(r => [r.name, r.dflt_value]));
    expect(defaults.get('status')).toBe("'pending'");
    expect(defaults.get('upload_token')).toBe("''");
    for (const c of ['board_w', 'board_h', 'bean_count', 'color_count', 'estimate_minutes']) {
      expect(defaults.get(c)).toBe('0');
    }
  });

  it('建出 idx_works_status_created 索引', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();
    const rows = db.queryAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_works_status_created'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('老库走 ensureColumn 幂等补齐全部 7 列，且不丢已有行', async () => {
    await seedOldWorksDb(tmp);
    vi.resetModules();
    const db = await import('../../../server/db.js');
    await db.initDb();

    const cols = db.queryAll<{ name: string }>(`PRAGMA table_info(works)`).map(r => r.name);
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);

    // 老行仍在，且按默认落成 pending —— 公开查询会把它挡住（部署后图库为空是预期的）
    db.runStmt(
      `INSERT INTO works (image_key, created_at, updated_at) VALUES ('works/x.png', 1, 1)`,
      [],
    );
    const rows = db.queryAll<{ status: string }>(`SELECT status FROM works`);
    expect(rows).toEqual([{ status: 'pending' }]);
  });
});
