import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs from 'sql.js';

let tmp = '';

/**
 * 2026-10-16 版的老 works 表：没有 status / 四个参数列 / upload_token。
 * 用它验证 ensureColumn 这条老库升级路径 —— 新库路径由下面另一个用例覆盖。
 *
 * legacy_marker 是刻意加的**新库 DDL 里不存在**的列，作用是给「老库升级路径」
 * 这个用例一个不可伪造的标记：升级成功后它必须还在。如果 seedOldWorksDb 的
 * writeFileSync 路径写错或静默失败，initDb 会当成空库走新建表路径，标记列
 * 随之消失，用例立刻变红。
 * 没有它的话，老库 DDL 除那 7 列外与新库完全同形，两条路径产出的 schema
 * 长得一样 —— 老库用例会悄悄退化成新库用例的复制品，测了半天其实没测老库。
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
  legacy_marker TEXT NOT NULL DEFAULT '',
  CHECK (published IN (0, 1))
);`;

const NEW_COLUMNS = [
  'status', 'board_w', 'board_h', 'bean_count', 'color_count',
  'estimate_minutes', 'upload_token',
];

/**
 * 非法 status 的报错形态，2026-10-17 实测（不凭猜）：
 * runStmt 不吞异常，直接抛 Error，message 形如
 *   CHECK constraint failed: status IN ('pending', 'approved', 'rejected')
 * 抛错后该行不会落库（不是「抛了但写进去了」）。
 *
 * 消息里逗号后的空格两条路径不一样 —— 新库 DDL 内联写的是 'pending', 'approved'
 * （有空格），老库 ALTER 追加的类型串是 'pending','approved'（无空格），
 * 所以这里用 ? 兼容可选空格，而不是把其中一条的字面量写死。
 */
const STATUS_CHECK_VIOLATION = /CHECK constraint failed: status IN \('pending', ?'approved', ?'rejected'\)/;

/** 先在磁盘上造一个带一行存量作品的老 works 表，让 initDb 走 CREATE TABLE 之外的那条路。 */
async function seedOldWorksDb(dir: string): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => resolve(process.cwd(), 'node_modules/sql.js/dist', file),
  });
  const db = new SQL.Database();
  db.exec(OLD_WORKS_DDL);
  // 必须真的存一行：老库升级最该守住的是「存量作品不丢」，空表验证不出这件事。
  // 如果迁移里出现 DROP TABLE 重建、或者多一句 DELETE FROM works，这里就是第一个
  // 被发现的地方 —— 升级后这行连同它的 id=1 必须原样还在。
  db.run(`INSERT INTO works (image_key, created_at, updated_at, legacy_marker) VALUES ('works/old.png', 1, 1, 'LEGACY')`);
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

  /**
   * 新库路径的 CHECK 枚举约束。
   *
   * 少了这个用例的话，两处 CHECK 子句一起删掉也没人发现 —— 而 Task 2 的审核队列
   * 正靠这个枚举在库层挡脏 status，写错的路径会被数据库默默收下。
   */
  it('新库的 status CHECK 枚举：三种合法值放行，bogus 被拒且不落库', async () => {
    const db = await import('../../../server/db.js');
    await db.initDb();

    for (const s of ['pending', 'approved', 'rejected']) {
      db.runStmt(
        `INSERT INTO works (image_key, created_at, updated_at, status) VALUES (?, 1, 1, ?)`,
        [`works/${s}.png`, s],
      );
    }
    expect(db.queryAll(`SELECT status FROM works ORDER BY id`).map(r => r.status))
      .toEqual(['pending', 'approved', 'rejected']);

    expect(() =>
      db.runStmt(
        `INSERT INTO works (image_key, created_at, updated_at, status) VALUES ('works/bad.png', 1, 1, 'bogus')`,
        [],
      ),
    ).toThrow(STATUS_CHECK_VIOLATION);

    // 只抛错不够 —— 还得确认这行没被写进去（约束要是"警告式"的就没意义了）
    expect(db.queryAll(`SELECT COUNT(*) AS n FROM works WHERE status = 'bogus'`)[0].n).toBe(0);
  });

  it('老库走 ensureColumn 幂等补齐全部 7 列，且不丢已有行', async () => {
    await seedOldWorksDb(tmp);
    vi.resetModules();
    const db = await import('../../../server/db.js');
    await db.initDb();

    const cols = db.queryAll<{ name: string }>(`PRAGMA table_info(works)`).map(r => r.name);
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);

    // 确认真的走了老库那条路（而不是 writeFileSync 失败后走了新建表路径）
    expect(cols).toContain('legacy_marker');

    // 升级前就存在的那一行：id 原样、image_key 原样，且新列按默认落成 pending。
    // id 一起断言，是因为 DROP TABLE + 重建之后 AUTOINCREMENT 会从头开始，
    // 只看 status 的话「重建后新插的一行也是 pending」照样能骗过断言。
    const rows = db.queryAll<{ id: number; image_key: string; status: string }>(
      `SELECT id, image_key, status FROM works`,
    );
    expect(rows).toEqual([{ id: 1, image_key: 'works/old.png', status: 'pending' }]);
  });

  /**
   * 老库路径的 CHECK 枚举约束。ALTER TABLE ADD COLUMN 追加来的约束与新库 DDL
   * 内联的那个**来源不同**，是两次独立的 DDL 决策，所以值得单独断一次 ——
   * 删掉 ALTER 类型串里的 CHECK，当前其余用例照样全绿。
   */
  it('老库 ALTER 追加的 status CHECK 枚举：合法放行，bogus 被拒且不落库', async () => {
    await seedOldWorksDb(tmp);
    vi.resetModules();
    const db = await import('../../../server/db.js');
    await db.initDb();

    db.runStmt(
      `INSERT INTO works (image_key, created_at, updated_at, status) VALUES ('works/ok.png', 2, 2, 'approved')`,
      [],
    );
    expect(db.queryAll(`SELECT status FROM works ORDER BY id`).map(r => r.status))
      .toEqual(['pending', 'approved']);

    expect(() =>
      db.runStmt(
        `INSERT INTO works (image_key, created_at, updated_at, status) VALUES ('works/bad.png', 2, 2, 'bogus')`,
        [],
      ),
    ).toThrow(STATUS_CHECK_VIOLATION);

    // 存量老行也不能因为约束是"后来补的"而被顺手清掉
    expect(db.queryAll(`SELECT COUNT(*) AS n FROM works`)[0].n).toBe(2);
    expect(db.queryAll(`SELECT COUNT(*) AS n FROM works WHERE status = 'bogus'`)[0].n).toBe(0);
  });
});
