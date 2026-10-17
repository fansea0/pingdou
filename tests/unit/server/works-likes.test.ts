import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs from 'sql.js';

let tmp = '';
let works: typeof import('../../../server/works.js');
let db: typeof import('../../../server/db.js');

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'works-likes-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  // 必须 resetModules：db.ts 的 DB_PATH / paths.ts 的 PATHS 都在模块加载时定值，
  // 不重置就复用上一个用例的（已被删掉的）临时目录。仓库里 works.test.ts 同理。
  vi.resetModules();
  const dbMod = await import('../../../server/db.js');
  await dbMod.initDb();
  db = dbMod;
  works = await import('../../../server/works.js');
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

/** 建一件已上架作品，返回 id（createWork 是 async，所以 seedWork 也是 async） */
async function seedWork(title = '小熊'): Promise<number> {
  const created = await works.createWork({
    title,
    image: { body: Buffer.from([1, 2, 3]), mime: 'image/png' },
  });
  return created.id;
}

describe('ipHashOf', () => {
  it('同 IP 稳定、不同 IP 不同', () => {
    expect(works.ipHashOf('1.2.3.4')).toBe(works.ipHashOf('1.2.3.4'));
    expect(works.ipHashOf('1.2.3.4')).not.toBe(works.ipHashOf('1.2.3.5'));
  });

  it('不泄露明文 IP（输出是固定长度 hex）', () => {
    const h = works.ipHashOf('203.0.113.7');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain('203');
  });
});

describe('addLike 幂等', () => {
  it('首次点赞 liked=true、计数 1', async () => {
    const id = await seedWork();
    expect(works.addLike(id, 'iphash-a')).toEqual({ likes: 1, liked: true });
  });

  it('同一 IP 同一天重复点赞 liked=false、计数不变', async () => {
    const id = await seedWork();
    works.addLike(id, 'iphash-a');
    expect(works.addLike(id, 'iphash-a')).toEqual({ likes: 1, liked: false });
    expect(works.addLike(id, 'iphash-a')).toEqual({ likes: 1, liked: false });
  });

  it('不同 IP 可以各赞一次', async () => {
    const id = await seedWork();
    works.addLike(id, 'iphash-a');
    works.addLike(id, 'iphash-b');
    expect(works.likeStateOf(id, 'iphash-b')).toEqual({ likes: 2, liked: true });
  });

  it('同 IP 对不同作品可以各赞一次', async () => {
    const a = await seedWork('A');
    const b = await seedWork('B');
    expect(works.addLike(a, 'iphash-x').liked).toBe(true);
    expect(works.addLike(b, 'iphash-x').liked).toBe(true);
  });

  it('跨天可以再次点赞（计数累加到 2）', async () => {
    const id = await seedWork();
    works.addLike(id, 'iphash-a', Date.parse('2026-10-17T10:00:00Z'));
    const next = works.addLike(id, 'iphash-a', Date.parse('2026-10-18T10:00:00Z'));
    expect(next).toEqual({ likes: 2, liked: true });
  });

  it('赞数按作品隔离，不串号', async () => {
    const a = await seedWork('A');
    const b = await seedWork('B');
    works.addLike(a, 'iphash-a');
    works.addLike(b, 'iphash-b');
    expect(works.likeStateOf(a, 'iphash-a').likes).toBe(1);
  });

  it('昨天点过赞，今天 liked 仍为 false', async () => {
    const id = await seedWork();
    works.addLike(id, 'iphash-a', Date.parse('2026-10-17T10:00:00Z'));
    expect(works.likeStateOf(id, 'iphash-a', Date.parse('2026-10-18T10:00:00Z')))
      .toEqual({ likes: 1, liked: false });
  });
});

describe('不存在的作品', () => {
  it('addLike 对非法 id 不写行、不返回虚假赞数', async () => {
    expect(works.addLike(9999, 'iphash-x')).toEqual({ likes: 0, liked: false });
    expect(db.queryAll('SELECT 1 FROM work_likes WHERE work_id = ?', [9999]).length).toBe(0);
  });

  it('likeStateOf 对非法 id 返回 0 / false', async () => {
    expect(works.likeStateOf(9999, 'iphash-x')).toEqual({ likes: 0, liked: false });
  });
});

describe('likeStateOf', () => {
  it('未点赞时 liked=false、计数 0', async () => {
    const id = await seedWork();
    expect(works.likeStateOf(id, 'iphash-z')).toEqual({ likes: 0, liked: false });
  });

  it('读操作不改变计数（幂等读取）', async () => {
    const id = await seedWork();
    works.addLike(id, 'iphash-a');
    works.likeStateOf(id, 'iphash-a');
    works.likeStateOf(id, 'iphash-a');
    expect(works.likeStateOf(id, 'iphash-a').likes).toBe(1);
  });
});

describe('deleteWork 清理 work_likes', () => {
  /**
   * 直查 work_likes 表而不是看 likeStateOf() 的返回。
   *
   * 作品已经没了，likeStateOf(已删 id) 本来就返回 { likes: 0, liked: false } ——
   * 那是 countLikes 查不到行时的默认值，跟「行被真的删掉」不可区分。
   * 而 rowById / addLike 又都会拒绝这个 id，于是赞数行删没删，这个 API 层面看不出来。
   * 必须落到表上数行数。
   */
  it('删作品会带走它的赞数行', async () => {
    const id = await seedWork();
    works.addLike(id, 'iphash-a');
    works.addLike(id, 'iphash-b');
    expect(db.queryAll('SELECT 1 FROM work_likes WHERE work_id = ?', [id]).length).toBe(2);

    await works.deleteWork(id);

    expect(db.queryAll('SELECT 1 FROM work_likes WHERE work_id = ?', [id]).length).toBe(0);
  });

  /**
   * 「只删这一件」的判别力用例。
   *
   * 实现若写成不带 WHERE 的 DELETE FROM work_likes，上面那条用例照样绿
   * （删完确实是 0 行），但 B 的赞数会被一起清掉。这条钉住 WHERE。
   */
  it('删 A 不影响 B 的赞数行', async () => {
    const a = await seedWork('A');
    const b = await seedWork('B');
    works.addLike(a, 'iphash-a');
    works.addLike(b, 'iphash-b');

    await works.deleteWork(a);

    expect(db.queryAll('SELECT 1 FROM work_likes WHERE work_id = ?', [a]).length).toBe(0);
    expect(db.queryAll('SELECT 1 FROM work_likes WHERE work_id = ?', [b]).length).toBe(1);
    expect(works.likeStateOf(b, 'iphash-b')).toEqual({ likes: 1, liked: true });
  });
});

describe('DB 里不落明文 IP', () => {
  it('work_likes.ip_hash 存的是 hash 不是明文', async () => {
    const id = await seedWork();
    const raw = '203.0.113.99';
    works.addLike(id, works.ipHashOf(raw));
    const rows = db.queryAll<{ ip_hash: string }>('SELECT ip_hash FROM work_likes');
    expect(rows[0]?.ip_hash).not.toBe(raw);
    expect(rows[0]?.ip_hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('落盘', () => {
  /**
   * 真正去磁盘上的 stats.db 里数行数（用只读的第二个连接），而不是查内存库。
   *
   * 查内存库是查不出问题的：不管 flushNow 有没有真的写文件，sql.js 的内存实例里
   * 那行都还在，断言照样通过 —— 换成损坏实现（execReturning → queryAll）也是绿的。
   * 只有重开磁盘文件才能证明这行真的被写出去了。
   */
  async function likesOnDisk(workId: number): Promise<number> {
    const distDir = resolve(process.cwd(), 'node_modules/sql.js/dist');
    const SQL = await initSqlJs({ locateFile: (f: string) => resolve(distDir, f) });
    const disk = new SQL.Database(new Uint8Array(readFileSync(join(tmp, 'stats.db'))));
    const stmt = disk.prepare(`SELECT COUNT(*) AS c FROM work_likes WHERE work_id = ?`);
    try {
      stmt.bind([workId]);
      let n = 0;
      while (stmt.step()) n = Number(stmt.getAsObject().c);
      return n;
    } finally {
      stmt.free();
      disk.close();
    }
  }

  it('点赞会落盘（不依赖后续无关写操作）', async () => {
    const id = await seedWork();
    works.addLike(id, 'iphash-a');
    // seedWork 里的 createWork 自己调过 flushNow，那时 dirty 已被复位成 false，
    // 所以之后没有任何别的写操作在标脏。这里能写出去，只能是 addLike 自己标了脏
    // —— 这正是 execReturning 存在的理由。
    db.flushNow();
    expect(await likesOnDisk(id)).toBe(1);
  });

  it('重复点赞不落新行（内存与磁盘一致）', async () => {
    const id = await seedWork();
    works.addLike(id, 'iphash-a');
    works.addLike(id, 'iphash-a');
    db.flushNow();
    expect(await likesOnDisk(id)).toBe(1);
  });
});
