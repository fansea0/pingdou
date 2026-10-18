import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { makeApprovedWork } from '../../helpers/works.js';

let tmp = '';
let works: typeof import('../../../server/works.js');
let db: typeof import('../../../server/db.js');

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'works-likes-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  // 必须 resetModules：db.ts 的 DB_PATH / paths.ts 的 PATHS 都在模块加载时定值，
  // 不重置就复用上一个用例的（已被删掉的）临时目录。仓库里 works.test.ts 同理。
  // 点赞去重的 Set 是 works.ts 的模块级状态，重置顺带把它清空 ——
  // 「跨天」「上限」那些用例依赖从空集起步，否则会互相污染。
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

/** 建一件已过审上架的作品，返回 id。走投稿真实路径：投稿 → 挂图 → 过审。 */
async function seedWork(title = '小熊'): Promise<number> {
  const created = await makeApprovedWork(works, { title });
  return created.id;
}

/** 固定的一组「用户身份」。UA 必须显式给 —— 它是点赞指纹的输入之一。 */
const fp = (ip: string, ua: string, workId: number, now?: number) =>
  works.likeFingerprint(ip, ua, workId, now);

const UA_A = 'Mozilla/5.0 (Macintosh) Chrome/1';
const UA_B = 'Mozilla/5.0 (iPhone) Safari/1';

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

describe('likeFingerprint', () => {
  it('同一组输入稳定', () => {
    expect(fp('1.2.3.4', UA_A, 7)).toBe(fp('1.2.3.4', UA_A, 7));
  });

  it('四个输入项各自都能改变指纹', () => {
    // 基准也显式钉死日期。isoDay 取的是 **UTC** 日期，而基准默认用 Date.now()，
    // 于是只要「另一个日期」刚好等于今天的 UTC 日（北京时间每天 08:00 之后），
    // 这条断言就必然失败 —— 它曾是个定时炸弹：每天绿一次、红一整天，还正好在
    // 提交合并到 main 的当天下午炸出来。基准与变体都固定，与墙上时钟彻底无关。
    const DAY = Date.parse('2026-10-18T10:00:00Z');
    const base = fp('1.2.3.4', UA_A, 7, DAY);
    expect(fp('1.2.3.5', UA_A, 7, DAY)).not.toBe(base);   // IP 变
    expect(fp('1.2.3.4', UA_B, 7, DAY)).not.toBe(base);   // UA 变
    expect(fp('1.2.3.4', UA_A, 8, DAY)).not.toBe(base);   // 作品变
    expect(fp('1.2.3.4', UA_A, 7, DAY + 86_400_000)).not.toBe(base); // 日期变（下一个 UTC 日）
  });

  /**
   * 这条钉的是**去重被有意放宽**这个语义，不是「hash 会不会碰撞」。
   *
   * 用户明确要求把 UA 纳入指纹：同一 IP 换浏览器算两个人，多人共用一个出口 IP
   * （公司/学校/运营商 NAT）时也各自能赞。所以「同 IP 不同 UA 指纹不同」是设计，
   * 不是实现细节 —— 它决定了下面 describe('addLike') 里那条用例的方向。
   */
  it('同 IP 换 UA 得到不同指纹（用户有意接受的放宽）', () => {
    expect(fp('1.2.3.4', UA_A, 7)).not.toBe(fp('1.2.3.4', UA_B, 7));
  });

  it('不泄露明文 IP（输出是固定长度 hex）', () => {
    const h = fp('203.0.113.7', UA_A, 1);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain('203');
  });

  /**
   * 分隔符不能省，也不能用可被输入构造出来的字符。
   * 没有分隔符时，`ip="a\u0000b", ua="c"` 与 `ip="a", ua="b\u0000c"` 会拼出同一个串，
   * 指纹相同 → 两个**不同的**访客被当成同一个人，去重失效。
   * HTTP 头里不可能出现 NUL，所以用 NUL 分隔是安全的。
   */
  it('拼接歧义不会造成指纹撞车（NUL 分隔）', () => {
    // 不加分隔符时这两组的拼接串都是 "abc"，指纹会相同 → 两个不同的访客
    // 被当成同一个人，去重失效。NUL 在 HTTP 头里不可能出现，是安全的分隔符。
    expect(fp('ab', 'c', 1)).not.toBe(fp('a', 'bc', 1));
  });
});

// ---------------------------------------------------------------------------
// addLike
// ---------------------------------------------------------------------------

describe('addLike 幂等与计数', () => {
  it('首次点赞 liked=true、计数 1', async () => {
    const id = await seedWork();
    expect(works.addLike(id, fp('1.1.1.1', UA_A, id))).toEqual({ likes: 1, liked: true });
  });

  it('同一 fingerprint 当天重复点赞 liked=false、计数不变', async () => {
    const id = await seedWork();
    const f = fp('1.1.1.1', UA_A, id);
    works.addLike(id, f);
    expect(works.addLike(id, f)).toEqual({ likes: 1, liked: false });
    expect(works.addLike(id, f)).toEqual({ likes: 1, liked: false });
    expect(works.getPublishedWork(id)?.likes).toBe(1);
  });

  /**
   * 本次改造最核心的一条：去重只认「IP + UA + 作品 + 日期」这个整体。
   * 同 IP 不同 UA 算两次 —— 这是用户主动要的放宽（多人共用一个出口 IP 时，
   * 只有第一个能赞是明显的坏体验）。实现若退化成只按 IP 去重（老口径），
   * 这里第二发会返回 liked=false、计数停在 1，用例立刻变红。
   */
  it('同一 IP 不同 UA 算两次 ★', async () => {
    const id = await seedWork();
    expect(works.addLike(id, fp('1.1.1.1', UA_A, id))).toEqual({ likes: 1, liked: true });
    expect(works.addLike(id, fp('1.1.1.1', UA_B, id))).toEqual({ likes: 2, liked: true });
    expect(works.getPublishedWork(id)?.likes).toBe(2);
  });

  it('不同 IP 各赞一次', async () => {
    const id = await seedWork();
    works.addLike(id, fp('1.1.1.1', UA_A, id));
    expect(works.addLike(id, fp('2.2.2.2', UA_A, id))).toEqual({ likes: 2, liked: true });
  });

  it('同一人对不同作品可以各赞一次', async () => {
    const a = await seedWork('A');
    const b = await seedWork('B');
    expect(works.addLike(a, fp('1.1.1.1', UA_A, a)).liked).toBe(true);
    expect(works.addLike(b, fp('1.1.1.1', UA_A, b)).liked).toBe(true);
    // 指纹含作品 id，所以这是两个不同的指纹、两次独立的 +1
    expect(works.getPublishedWork(a)?.likes).toBe(1);
    expect(works.getPublishedWork(b)?.likes).toBe(1);
  });

  it('赞数按作品隔离，不串号', async () => {
    const a = await seedWork('A');
    const b = await seedWork('B');
    works.addLike(a, fp('1.1.1.1', UA_A, a));
    works.addLike(b, fp('2.2.2.2', UA_A, b));
    expect(works.getPublishedWork(a)?.likes).toBe(1);
    expect(works.getPublishedWork(b)?.likes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 跨天轮转
// ---------------------------------------------------------------------------

describe('跨天重置', () => {
  it('第二天同一 fingerprint 可以再赞（计数累加到 2）', async () => {
    const id = await seedWork();
    const day1 = Date.parse('2026-10-17T10:00:00Z');
    const day2 = Date.parse('2026-10-18T10:00:00Z');
    const f = fp('1.1.1.1', UA_A, id, day1);
    expect(works.addLike(id, f, day1)).toEqual({ likes: 1, liked: true });
    expect(works.addLike(id, f, day2)).toEqual({ likes: 2, liked: true });
  });

  it('跨天后 liked 状态归 false ★', async () => {
    const id = await seedWork();
    const day1 = Date.parse('2026-10-17T10:00:00Z');
    const day2 = Date.parse('2026-10-18T10:00:00Z');
    const f = fp('1.1.1.1', UA_A, id, day1);
    works.addLike(id, f, day1);
    // 同一天再问仍是已赞
    expect(works.likeStateOf(id, f, day1)).toEqual({ likes: 1, liked: true });
    // 第二天问：不是已赞，但累计赞数仍然在
    expect(works.likeStateOf(id, f, day2)).toEqual({ likes: 1, liked: false });
  });

  /**
   * 边界钉在 UTC 日界：10:00Z 与次日 00:00Z 之间还差 14 小时，
   * 但对 isoDay 来说已经是两天。若实现按本地时区或按 24 小时窗口轮转，
   * 这条会给出不同答案（前者仍算同一天）。
   */
  it('轮转边界是 UTC 日界，不是 24 小时窗口', async () => {
    const id = await seedWork();
    const lateNight = Date.parse('2026-10-17T23:59:59Z');
    const nextDay = Date.parse('2026-10-18T00:00:01Z');
    const f = fp('1.1.1.1', UA_A, id, lateNight);
    works.addLike(id, f, lateNight);
    expect(works.addLike(id, f, nextDay)).toEqual({ likes: 2, liked: true });
  });
});

// ---------------------------------------------------------------------------
// Set 上限
// ---------------------------------------------------------------------------

describe('去重 Set 的上限', () => {
  /**
   * 上限存在的理由：IP 和 UA 都由客户端控制，「伪造 UA × 伪造 XFF」能让 Set 无界增长，
   * 内存被撑爆比 DB 慢严重得多。
   *
   * 触顶行为是**整份丢弃**（fail-open）：去重失效、可以重复赞，但进程活着。
   * 反过来 fail-closed（拒绝所有新赞）会把一次异常流量变成「当天全站不可点赞」，更糟。
   *
   * **灌集合只能用 addLike**：likeStateOf 只做 `Set.has()`，它是纯读，
   * **不会把指纹登记进去**。用 likeStateOf 灌集合是本文件第一版的写法，
   * 那版两条上限用例全是空转（详见下面「未到上限」那条的注释）——
   * 集合里根本没东西，「上限触发后怎样」自然测不出任何差别。
   * 20_000 次带 DB 写入的 addLike 实测 ~0.9s，可以接受。
   */
  async function fillSet(id: number, count: number, now: number, skipFirst = true) {
    for (let i = skipFirst ? 1 : 0; i < count; i++) {
      works.addLike(id, fp(`10.0.${(i >> 8) % 256}.${i % 256}`, `UA-${i}`, id, now), now);
    }
  }

  it('超过上限后仍然能正常点赞（fail-open，不是拒绝新赞）', async () => {
    const id = await seedWork();
    const t0 = Date.parse('2026-10-17T10:00:00Z');
    const limit = works.LIKES_FINGERPRINT_MAX;

    // 灌到远超上限。中途会触发若干次清空，这正是被测的路径。
    await fillSet(id, limit + 500, t0);

    // 触顶之后来的正常访客必须还能点赞，且幂等仍然成立
    const fresh = fp('1.1.1.1', UA_A, id, t0);
    const first = works.addLike(id, fresh, t0);
    expect(first.liked).toBe(true);
    expect(works.addLike(id, fresh, t0)).toEqual({ likes: first.likes, liked: false });
  }, 30_000);

  /**
   * 触顶策略本身的判别力用例。
   *
   * 上一版这里只钉「触顶后仍能点赞」，实测**杀不掉「把上限检查整段删掉」的变异**
   * （M3 全绿）：删掉之后集合只是继续涨，上面那几条断言照样成立 ——
   * 集合变大不影响 `has()` 的结果。集合大小在产品形状之外，测试观测不到。
   *
   * 破法靠「整份丢弃」这个策略的**代价本身是可观测的**：清空之后，
   * 早期登记过的指纹也一起忘了，那位访客可以再赞一次。
   * 上限检查若被摘掉，清空永不发生，被忘掉的指纹仍然记得 → 断言立刻变红。
   *
   * 时序要点：触发清空的是**一条新指纹**的写入。若拿早期那条去 addLike，
   * 它此刻还在集合里，会在 `has()` 那一支直接返回、根本走不到清空逻辑。
   */
  it('触顶时整份丢弃：早期指纹被一起清掉 ★', async () => {
    const id = await seedWork();
    const t0 = Date.parse('2026-10-17T10:00:00Z');
    const early = fp('1.1.1.1', UA_A, id, t0);

    works.addLike(id, early, t0);          // 最早登记的一条
    await fillSet(id, works.LIKES_FINGERPRINT_MAX, t0);
    // 再来一条新指纹：此时 size 已达上限 → 整份集合被丢弃
    expect(works.addLike(id, fp('2.2.2.2', UA_B, id, t0), t0).liked).toBe(true);

    expect(works.likeStateOf(id, early, t0).liked).toBe(false);
    expect(works.addLike(id, early, t0).liked).toBe(true);   // 忘了 → 当新赞
  }, 30_000);

  /**
   * 对照：没到上限时**不许**清空。
   *
   * 这条同时是上面那条的判别力前提 —— 若实现写成「每次写入都清空」，
   * 两条都会绿（本条在 1000 条时就忘了 early，上条则仍然成立），
   * 所以本条必须保留。
   *
   * 顺带钉住上一版用错的那点：这里的填充也走 addLike 而不是 likeStateOf。
   */
  it('未到上限时不去重失效（对照）', async () => {
    const id = await seedWork();
    const t0 = Date.parse('2026-10-17T10:00:00Z');
    const early = fp('1.1.1.1', UA_A, id, t0);
    works.addLike(id, early, t0);
    await fillSet(id, 1000, t0);
    expect(works.likeStateOf(id, early, t0)).toEqual({ likes: 1000, liked: true });   // early 1 + 后续 999
  });
});

// ---------------------------------------------------------------------------
// 不存在的作品
// ---------------------------------------------------------------------------

describe('不存在的作品', () => {
  it('addLike 对非法 id 不改计数、不返回虚假赞数', async () => {
    expect(works.addLike(9999, fp('1.1.1.1', UA_A, 9999))).toEqual({ likes: 0, liked: false });
    expect(db.queryAll('SELECT 1 FROM works WHERE id = 9999').length).toBe(0);
  });

  /**
   * 写入顺序的钉子：先 UPDATE、成功后才登记指纹。反过来的话，给不存在的作品
   * 点赞也会往 Set 里塞一条永远命中不了真实请求的垃圾指纹（纯内存泄漏），
   * 且「赞过」的记录与「加过计数」的记录会脱钩。
   * 这里只能从行为上看出来：非法 id 不该让 Set 记住这个指纹 ——
   * 之后用一个**作品确实存在**的场景没法验证，但可以验证它没污染真实作品的计数。
   */
  it('对非法 id 的调用不会把计数算到别的作品上', async () => {
    const real = await seedWork('真实');
    for (let i = 0; i < 3; i++) works.addLike(9999, fp('1.1.1.1', UA_A, 9999, undefined));
    expect(works.getPublishedWork(real)?.likes).toBe(0);
  });

  it('likeStateOf 对非法 id 返回 0 / false', async () => {
    expect(works.likeStateOf(9999, fp('1.1.1.1', UA_A, 9999))).toEqual({ likes: 0, liked: false });
  });
});

describe('likeStateOf', () => {
  it('未点赞时 liked=false、计数 0', async () => {
    const id = await seedWork();
    expect(works.likeStateOf(id, fp('9.9.9.9', UA_A, id))).toEqual({ likes: 0, liked: false });
  });

  it('读操作不改变计数（幂等读取）', async () => {
    const id = await seedWork();
    const f = fp('1.1.1.1', UA_A, id);
    works.addLike(id, f);
    works.likeStateOf(id, f);
    works.likeStateOf(id, f);
    expect(works.likeStateOf(id, f).likes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 落盘
// ---------------------------------------------------------------------------

describe('落盘', () => {
  /**
   * 真正去磁盘上的 stats.db 里读，而不是查内存库。
   *
   * 查内存库是查不出问题的：不管 flushNow 有没有真的写文件，sql.js 的内存实例里
   * 那行都还在，断言照样通过。只有重开磁盘文件才能证明 likes 列真的写下去了。
   *
   * 改用计数列之后不再有「写入不标脏」的风险（UPDATE 与老实现一样走 execReturning），
   * 但这条用例保留 —— 它现在守的是**另一个**真实故障：迁移/回填如果只在内存里累加、
   * 没标脏，重启后赞数会全部消失。
   */
  async function readDiskWorks(): Promise<{ id: number; likes: number }[]> {
    const distDir = resolve(process.cwd(), 'node_modules/sql.js/dist');
    const SQL = await initSqlJs({ locateFile: (f: string) => resolve(distDir, f) });
    const disk = new SQL.Database(new Uint8Array(readFileSync(join(tmp, 'stats.db'))));
    try {
      const out: { id: number; likes: number }[] = [];
      const stmt = disk.prepare(`SELECT id, likes FROM works ORDER BY id`);
      try {
        while (stmt.step()) out.push(stmt.getAsObject() as { id: number; likes: number });
      } finally {
        stmt.free();
      }
      return out;
    } finally {
      disk.close();
    }
  }

  it('点赞会落盘到 works.likes（不依赖后续无关写操作）', async () => {
    const id = await seedWork();
    works.addLike(id, fp('1.1.1.1', UA_A, id));
    // seedWork 里的投稿入库自己调过 flushNow，那时 dirty 已被复位成 false。
    // 这里能写出去，只能是 addLike 自己标了脏 —— 这正是 execReturning 存在的理由。
    db.flushNow();
    expect((await readDiskWorks()).find(w => w.id === id)?.likes).toBe(1);
  });

  it('重复点赞不改动磁盘上的计数', async () => {
    const id = await seedWork();
    const f = fp('1.1.1.1', UA_A, id);
    works.addLike(id, f);
    works.addLike(id, f);
    db.flushNow();
    expect((await readDiskWorks()).find(w => w.id === id)?.likes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 迁移
// ---------------------------------------------------------------------------

describe('work_likes → works.likes 迁移', () => {
  /**
   * 造一个**真的带 work_likes 行、works 表没有 likes 列**的老库文件，
   * 让 initDb 在它上面跑一遍迁移。
   *
   * 为什么必须造磁盘文件而不是在内存库里手搓：迁移路径的入口是
   * 「磁盘上已存在 stats.db」，而 ensureColumn 只在老库上才有意义
   * （新库 CREATE TABLE 直接带 likes 列，迁移函数根本不执行）。
   * 在已经 init 过的内存库上手搓 work_likes 表，跑到的还是新库路径，
   * 测到的「通过」毫无意义。
   */
  async function writeLegacyDb(): Promise<void> {
    const distDir = resolve(process.cwd(), 'node_modules/sql.js/dist');
    const SQL = await initSqlJs({ locateFile: (f: string) => resolve(distDir, f) });
    const legacy = new SQL.Database();
    // 老 schema：works 完全没有 likes 列
    legacy.run(`
      CREATE TABLE works (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL DEFAULT '',
        description TEXT    NOT NULL DEFAULT '',
        image_key   TEXT    NOT NULL,
        thumb_key   TEXT    NOT NULL DEFAULT '',
        width       INTEGER NOT NULL DEFAULT 0,
        height      INTEGER NOT NULL DEFAULT 0,
        bytes       INTEGER NOT NULL DEFAULT 0,
        published   INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE TABLE work_likes (
        work_id    INTEGER NOT NULL,
        day        TEXT    NOT NULL,
        ip_hash    TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (work_id, day, ip_hash)
      );
      INSERT INTO works VALUES (1,'被赞过两次','d','k1','',10,10,3,1,1000,1000);
      INSERT INTO works VALUES (2,'被赞过五次','d','k2','',10,10,3,1,2000,2000);
      INSERT INTO works VALUES (3,'没人赞','d','k3','',10,10,3,1,3000,3000);
      INSERT INTO works VALUES (4,'草稿但有赞','d','k4','',10,10,3,0,4000,4000);
    `);
    // 作品 2 攒 5 条：跨 3 个 day、含同一 ip 同一天的多条（复合主键允许）。
    const rows = [
      [1, '2026-10-15', 'h1'], [1, '2026-10-16', 'h2'],
      [2, '2026-10-15', 'h1'], [2, '2026-10-15', 'h2'], [2, '2026-10-15', 'h3'],
      [2, '2026-10-16', 'h1'], [2, '2026-10-16', 'h2'],
      [4, '2026-10-16', 'h9'],
    ] as const;
    for (const [workId, day, ip] of rows) {
      legacy.run(`INSERT INTO work_likes (work_id, day, ip_hash, created_at) VALUES (${workId}, '${day}', '${ip}', 1)`);
    }
    writeFileSync(join(tmp, 'stats.db'), Buffer.from(legacy.export()));
    legacy.close();
  }

  /** 把内存里那套模块整个丢掉，按「磁盘上有个老库」重新起一次 */
  async function bootOverLegacyDb() {
    vi.resetModules();
    const dbMod = await import('../../../server/db.js');
    await dbMod.initDb();
    return dbMod;
  }

  it('历史赞数被累加进 works.likes，而不是归零 ★', async () => {
    await writeLegacyDb();
    const dbMod = await bootOverLegacyDb();

    const rows = dbMod.queryAll<{ id: number; likes: number }>(
      `SELECT id, likes FROM works ORDER BY id`
    );
    // 最关键的一条：2 必须是 2、4 必须是 4。回填漏了的话全是 0 ——
    // 而且不报任何错，是「升级后历史赞数凭空消失」这种最坏的失败形态。
    expect(rows).toEqual([
      { id: 1, likes: 2 },
      { id: 2, likes: 5 },
      { id: 3, likes: 0 },   // 没有赞数的作品保持 0，不是 NULL
      { id: 4, likes: 1 },   // 草稿的赞数同样要回填，否则后台看不到
    ]);
  }, 20_000);

  it('work_likes 表被删掉（列表查询不再有聚合可做）', async () => {
    await writeLegacyDb();
    const dbMod = await bootOverLegacyDb();
    const tables = dbMod.queryAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_likes'`
    );
    expect(tables).toEqual([]);
  }, 20_000);

  it('迁移结果会落盘（重启后不回滚）', async () => {
    await writeLegacyDb();
    const dbMod = await bootOverLegacyDb();
    dbMod.flushNow();
    // 用第二个只读连接重开磁盘文件
    const distDir = resolve(process.cwd(), 'node_modules/sql.js/dist');
    const SQL = await initSqlJs({ locateFile: (f: string) => resolve(distDir, f) });
    const disk = new SQL.Database(new Uint8Array(readFileSync(join(tmp, 'stats.db'))));
    try {
      const stmt = disk.prepare(`SELECT likes FROM works WHERE id = 2`);
      let likes = -1;
      try {
        while (stmt.step()) likes = Number(stmt.getAsObject().likes);
      } finally {
        stmt.free();
      }
      expect(likes).toBe(5);
      const t = disk.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_likes'`);
      let stillThere = false;
      try {
        while (t.step()) stillThere = true;
      } finally {
        t.free();
      }
      expect(stillThere).toBe(false);
    } finally {
      disk.close();
    }
  }, 20_000);

  it('迁移是幂等的：已删表的老库再启动一次不会出错、也不会把赞数加两遍', async () => {
    await writeLegacyDb();
    await bootOverLegacyDb();
    const dbMod = await bootOverLegacyDb();   // 第二次启动
    expect(dbMod.queryAll<{ likes: number }>(`SELECT likes FROM works WHERE id = 2`))
      .toEqual([{ likes: 5 }]);
  }, 20_000);

  it('迁移后的老作品可以正常点赞（点赞只 +1，不会翻倍）', async () => {
    await writeLegacyDb();
    await bootOverLegacyDb();
    const worksMod = await import('../../../server/works.js');
    const r = worksMod.addLike(1, 'brand-new-fingerprint');
    expect(r).toEqual({ likes: 3, liked: true });
  }, 20_000);
});
