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
  // 内容值，不只是行数：db.export() 万一在重排页结构或改编码时把别的表的值改了，
  // 行数照样是 2，只有逐值比对才看得出来。
  const values = (sql: string): string[] =>
    db.exec(sql)[0]?.values.map((r) => (r as unknown[]).join('=')) ?? [];
  const out = {
    works: count('works'),
    userCount: count('users'),
    eventCount: count('events'),
    sessionCount: count('sessions'),
    settingCount: count('settings'),
    tables,
    usernames: values('SELECT username FROM users ORDER BY username'),
    settings: values('SELECT key, value FROM settings ORDER BY key'),
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

/**
 * root 不受文件/目录权限位限制，所以任何靠 chmod 注入的故障在 root 下都注入不进去。
 * 这类用例必须知道自己处在哪种环境，否则会写成一条在 root 下必红的断言。
 */
function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
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

  it('除了 works，别的表一行不少、内容不变、schema 一个不少', async () => {
    await seedDb();
    expect(runReset().status).toBe(0);

    const after = await readCounts();
    // db.export() 是整库二进制序列化：如果它丢了 schema、改了别的表的行数，
    // 或者**行数没变但值被改坏了**，这里都要炸。整个脚本只允许删 works。
    expect(after.userCount).toBe(2);
    expect(after.eventCount).toBe(2);
    expect(after.sessionCount).toBe(1);
    expect(after.settingCount).toBe(1);
    // 只断言行数是不够的：行数对得上但值被改坏（例如编码/页结构重排），
    // 行数断言照样全绿，而用户的 username 和站点的设置值已经变了。
    expect(after.usernames).toEqual(['admin', 'alice']);
    expect(after.settings).toEqual(['notice=hello']);
    expect(after.tables).toEqual(
      expect.arrayContaining(['works', 'users', 'events', 'sessions', 'settings']),
    );
  });

  it('再跑一次是成功的空操作，并提醒本次备份不含作品数据', async () => {
    await seedDb();
    expect(runReset().status).toBe(0);
    const second = runReset();

    expect(second.status).toBe(0);
    expect((await readCounts()).works).toBe(0);
    expect(mediaFiles()).toEqual([]);
    // 重跑时新生成的 .bak 是「空库」的副本，尺寸可能和真库一模一样，回滚时极易挑错。
    // 脚本必须把这件事喊出来，否则这份备份就是个会骗人的退路。
    expect(second.stderr).toMatch(/不含任何作品数据/);
  });
});

describe('reset-gallery.mjs 失败时的状态', () => {
  it('PINGDOU_DATA_DIR 指向文件系统根目录时直接拒绝，一个文件都不删', () => {
    // 这是唯一一处「脚本会主动删东西之前」的最后一道类型检查：
    // 运维把 PINGDOU_DATA_DIR 写错成 "/" 时，宁可什么都不做。
    const before = spawnSync(process.execPath, [SCRIPT], {
      env: { ...process.env, PINGDOU_DATA_DIR: parse(process.cwd()).root },
      cwd: parse(process.cwd()).root,
      encoding: 'utf8',
    });
    expect(before.status).toBe(1);
    expect(before.stderr).toMatch(/拒绝在根目录上执行删除/);
  });

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
    expect((await readCounts()).userCount).toBe(2);
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
   * ⚠️ 这条注入在 **root 下不成立**：root 不受 chmod 限制，目录照样读得开、
   *   文件删得掉，脚本会一路成功（exit 0、works 0、图片 0），下面
   *   `expect(r.status).toBe(1)` 会**真失败**。所以这里必须分 root / 非 root 两种断言。
   *
   * 之所以不用 chflags/uchg 那类注入：CI 跑在 ubuntu 上，用不了。
   */
  it('图片目录不可读时：库已清空、图片仍在、退出码非 0 且如实报告', async () => {
    await seedDb();
    chmodSync(worksDir(), 0o000);

    const r = runReset();
    expect((await readCounts()).works).toBe(0);

    if (isRoot()) {
      // 故障没注入进去（root 无视 chmod），退化成一次普通成功路径的验证。
      // 明确写出来，免得把这条绿当成「顺序被守住」的证据 —— 顺序由下面那条
      // 源码顺序断言守，这条只保证「真出错时状态是安全的」。
      expect(r.status).toBe(0);
      chmodSync(worksDir(), 0o755);
      expect(mediaFiles()).toEqual([]);
    } else {
      expect(r.status).toBe(1);
      // 断言「文件还在」之前得先把目录权限还回去，否则连测试自己都读不了它
      chmodSync(worksDir(), 0o755);
      expect(mediaFiles()).toHaveLength(3);
      // 失败要说人话：运维得从输出里直接看出「库空了、图还在」，而不是一坨 stack trace
      expect(r.stderr).toMatch(/库已清空/);
    }
  });

  /**
   * 把「写回必须在删文件之前」这个顺序钉死 —— 读源码断言，不靠故障注入。
   *
   * 为什么必须用源码顺序断言（这是上一轮评审指出的真问题）：
   *   之前那条「写不回 stats.db 时图片必须一个不少」用的是 chmod 444，
   *   而 **rename 在所有 rename 能成功的 POSIX 上只受目录写权限约束**，
   *   原文件可不可写根本不影响它 —— 于是这个注入在非 root 的 macOS 和
   *   ubuntu CI 上**都是空操作**，实测 exit 0、works 0、图片删光，
   *   那条断言恒真，只是第 1 条正常路径的重复品。更糟的是「删文件在前、
   *   但保留 per-item catch」的变体能让它照样全绿，而那个变体在真实写回故障下
   *   会产出 works=5 / 图片=0 的坏状态。
   *
   * 真正能让「写回」失败且跨平台的办法只有平台专属手段（macOS/BSD 的 chflags uchg），
   *   而 CI 是 ubuntu，用不了。所以顺序这件事改由下面这条源码断言来守：
   *   它在 ubuntu CI 上真的能判别、也不会因为权限模型差异而退化。
   *
   * 断言点：把库写到磁盘的语句（renameSync / writeFileSync(DB_PATH…)）
   *   在源码里必须出现在删文件语句（rmSync(p, …）**之前**。
   */
  it('源码顺序：写回 stats.db 在删文件之前', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const at = (needle: string) => src.indexOf(needle);
    // 认真正写库的那几处：写临时文件 / rename 落盘。注释里出现的同名字样不算，
    // 所以用带参数形态的完整调用串去定位。
    const writeMarkers = [
      'renameSync(tmpDbPath, DB_PATH)',
      'writeFileSync(DB_PATH,',
      'writeFileSync(tmpDbPath',
    ];
    const positions = writeMarkers.map(at).filter((i) => i >= 0);
    expect(positions.length, '脚本里一处「写回 stats.db」的语句都找不到').toBeGreaterThan(0);

    const rmAt = at('rmSync(p,');
    expect(rmAt, '脚本里找不到删文件的语句').toBeGreaterThan(-1);
    expect(Math.min(...positions)).toBeLessThan(rmAt);
  });
});
