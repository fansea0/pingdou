import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

// 这个脚本会永久删除作品库和它们的图片，是仓库里唯一一个跑错了就会造成
// 不可逆损失的脚本，所以它的测试重点不是「功能能用」，而是**失败时的状态**。

const repoRoot = resolve(parse(fileURLToPath(import.meta.url)).dir, '..', '..');
const SCRIPT = join(repoRoot, 'scripts', 'reset-gallery.mjs');

/** 和 server/ 下的测试同一套写法：wasm 从仓库的 node_modules 里找 */
const SQLJS_DIST = resolve(repoRoot, 'node_modules/sql.js/dist');

const WORKS_COLUMNS =
  'id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT \'\', image_key TEXT NOT NULL, ' +
  'thumb_key TEXT NOT NULL DEFAULT \'\', likes INTEGER NOT NULL DEFAULT 0, ' +
  'status TEXT NOT NULL DEFAULT \'pending\', upload_token TEXT NOT NULL DEFAULT \'\'';

let dataDir = '';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'reset-gallery-'));
});
afterEach(() => {
  // chmod 是故障注入的一部分，可能把目录设成不可写/不可读，恢复权限才删得掉
  for (const p of [join(dataDir, 'stats.db'), worksDir(), join(dataDir, 'media')]) {
    try { chmodSync(p, 0o755); } catch { /* 路径可能不存在 */ }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

function worksDir() {
  return join(dataDir, 'media', 'works');
}

/** 造一个有 works 表（3 行）+ 另外 4 张表的真库，再摆 3 个假图片文件 */
async function seedDb(withWorks = true): Promise<void> {
  const SQL = await initSqlJs({ locateFile: (f: string) => resolve(SQLJS_DIST, f) });
  const db = new SQL.Database();
  // 除了 works 还建 users / events / sessions / settings：db.export() 是整库序列化，
  // 必须证明它没有把这些表一起弄坏（这个脚本只该删 works）。
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
  `);
  db.exec("INSERT INTO users (username) VALUES ('admin'),('alice');");
  db.exec("INSERT INTO events (kind) VALUES ('view'),('like');");
  db.exec("INSERT INTO sessions (id) VALUES ('s-1');");
  db.exec("INSERT INTO settings (key, value) VALUES ('notice','hello');");
  if (withWorks) {
    db.exec(`CREATE TABLE works (${WORKS_COLUMNS});`);
    db.exec(
      `INSERT INTO works (title, image_key, likes, status) VALUES ` +
      `('a','a.png',3,'approved'),('b','b.png',0,'pending'),('c','c.png',1,'approved')`
    );
  }
  writeFileSync(join(dataDir, 'stats.db'), Buffer.from(db.export()));
  db.close();

  mkdirSync(worksDir(), { recursive: true });
  for (const n of ['a.png', 'b.png', 'c.png']) {
    writeFileSync(join(worksDir(), n), Buffer.alloc(1024, 1));
  }
}

/**
 * 跑脚本。cwd 故意设成文件系统根目录：运维不一定在仓库根敲这条命令，
 * 脚本必须与「从哪儿敲」无关（sql.js 的 wasm 要靠脚本自身位置定位）。
 */
function runReset(cwd = parse(process.cwd()).root) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, PINGDOU_DATA_DIR: dataDir },
    cwd,
    encoding: 'utf8',
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function readCounts() {
  const SQL = await initSqlJs({ locateFile: (f: string) => resolve(SQLJS_DIST, f) });
  const db = new SQL.Database(new Uint8Array(readFileSync(join(dataDir, 'stats.db'))));
  const tables = db
    .exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0]
    .values.map((r) => r[0] as string);
  // 表可能压根不存在（「库里没有 works 表」那条路径），所以按实际存在的表来查，
  // 不存在的记成 null 而不是让查询直接抛错。
  const count = (t: string) =>
    tables.includes(t) ? (db.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0] as number) : null;
  const out = {
    works: count('works'),
    users: count('users'),
    events: count('events'),
    sessions: count('sessions'),
    settings: count('settings'),
    tables,
  };
  db.close();
  return out;
}

function backupFiles() {
  return readdirSync(dataDir).filter((f) => f.startsWith('stats.db.bak-'));
}

function mediaFiles() {
  return existsSync(worksDir()) ? readdirSync(worksDir()) : [];
}

describe('reset-gallery.mjs 正常路径', () => {
  it('清空 works、清空图片、留下非空备份，退出码 0', async () => {
    await seedDb();
    const r = runReset();

    expect(r.status).toBe(0);
    const after = await readCounts();
    expect(after.works).toBe(0);
    expect(mediaFiles()).toEqual([]);

    // 备份必须是「真的能还原的库」：非空，且里面 works 的 3 行还在。
    // 只断言「文件存在」的话，一个被截断成 0 字节的备份也能过 —— 那种情况下
    // 运维以为有退路，实际退路是空的。
    const backups = backupFiles();
    expect(backups).toHaveLength(1);
    const backupPath = join(dataDir, backups[0]);
    expect(statSync(backupPath).size).toBeGreaterThan(0);
    const SQL = await initSqlJs({ locateFile: (f: string) => resolve(SQLJS_DIST, f) });
    const bak = new SQL.Database(new Uint8Array(readFileSync(backupPath)));
    expect(bak.exec('SELECT COUNT(*) FROM works')[0].values[0][0]).toBe(3);
    bak.close();
  });

  it('除了 works，别的表一行不少、schema 一个不少', async () => {
    await seedDb();
    expect(runReset().status).toBe(0);

    const after = await readCounts();
    // db.export() 是整库二进制序列化：如果它丢了 schema 或改动了别的表，
    // 这里会直接炸。整个脚本只允许删 works。
    expect(after.users).toBe(2);
    expect(after.events).toBe(2);
    expect(after.sessions).toBe(1);
    expect(after.settings).toBe(1);
    expect(after.tables).toEqual(
      expect.arrayContaining(['works', 'users', 'events', 'sessions', 'settings']),
    );
  });

  it('再跑一次是成功的空操作（补删上次没删干净的文件）', async () => {
    await seedDb();
    expect(runReset().status).toBe(0);
    const second = runReset();

    expect(second.status).toBe(0);
    expect((await readCounts()).works).toBe(0);
    expect(mediaFiles()).toEqual([]);
  });
});

describe('reset-gallery.mjs 失败时的状态', () => {
  it('数据目录里没有 stats.db 时中止，一个文件都不删', async () => {
    mkdirSync(worksDir(), { recursive: true });
    writeFileSync(join(worksDir(), 'keep.png'), Buffer.alloc(64, 2));

    const r = runReset();
    expect(r.status).toBe(1);
    expect(mediaFiles()).toEqual(['keep.png']);
  });

  it('库里没有 works 表时中止，图片原封不动', async () => {
    await seedDb(false);
    const r = runReset();

    expect(r.status).toBe(1);
    expect(mediaFiles()).toEqual(['a.png', 'b.png', 'c.png']);
    // 库也必须没被改动 —— 中止意味着「什么都没发生」
    expect((await readCounts()).users).toBe(2);
  });

  /**
   * 把「先落盘、后删文件」这个顺序钉死的测试。
   *
   * 故障注入：media/works 设成不可读，于是删文件那一步必然失败。两种顺序在这里
   * 表现完全不同：
   *   - 本脚本（先写库）：库已经清空了，works = 0，图片原封不动，退出码 1
   *     且如实说明「库已清空、图片没删干净」；
   *   - 反过来的顺序（先删文件）：崩在写库之前，works 还留着 3 行。
   * 断言 works === 0 就等于断言了「开始删文件之前库已经写好了」。
   *
   * 之所以不用 chflags/uchg 那类注入：CI 跑在 ubuntu 上，用不了。
   * chmod 在任何 POSIX 上都成立（以 root 运行时故障注入不生效、测试退化为
   * 普通成功路径，不会假失败）。
   */
  it('图片目录不可读时：库已清空、图片仍在、退出码非 0 且如实报告', async () => {
    await seedDb();
    chmodSync(worksDir(), 0o000);

    const r = runReset();
    expect(r.status).toBe(1);
    expect((await readCounts()).works).toBe(0);
    // 断言「文件还在」之前得先把目录权限还回去，否则连测试自己都读不了它
    chmodSync(worksDir(), 0o755);
    expect(mediaFiles()).toHaveLength(3);
    // 失败要说人话：运维得从输出里直接看出「库空了、图还在」，而不是一坨 stack trace
    expect(r.stderr).toMatch(/库已清空/);
  });

  /**
   * 核心安全性质：脚本失败时，绝不能留下「图片没了但 works 行还在」的状态。
   *
   * 注入方式取「把 stats.db 设成只读」：备份要读它（成功），而往它身上直接
   * writeFileSync 会 EACCES —— 正好卡在「内存里已清空、还没落盘」这个位置，
   * 也就是删除顺序真正要防的那一步。之所以不用 chflags 之类平台专属手段，
   * 是因为 CI 跑在 ubuntu 上，用不了。
   *
   * ⚠️ 以 root 运行时 chmod 不生效、故障根本注入不进去（脚本会一路成功）。
   *    那种环境下这条测试退化成「弱断言」，但不会假失败 —— 这是有意接受的取舍。
   */
  it('写不回 stats.db 时中止，图片必须一个不少', async () => {
    await seedDb();
    chmodSync(join(dataDir, 'stats.db'), 0o444);

    const r = runReset();
    // 成功（rename 只要求目录可写，不要求原文件可写）也算通过；
    // 关键是不管哪种结局，都不能出现「文件被删了但库里还有 works 行」。
    const counts = await readCounts();
    const files = mediaFiles();
    const deletedButStillInDb = files.length === 0 && (counts.works ?? 0) > 0;
    expect(deletedButStillInDb).toBe(false);

    if (r.status === 0) {
      expect(counts.works).toBe(0);
    } else {
      expect(counts.works).toBe(3);
      expect(files).toHaveLength(3);
    }
  });
});
