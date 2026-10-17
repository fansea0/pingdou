import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeApprovedWork, makePendingWork } from '../../helpers/works.js';

let tmp = '';
let works: typeof import('../../../server/works.js');
let db: typeof import('../../../server/db.js');

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'works-search-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  // 必须 resetModules：db.ts 的 DB_PATH / paths.ts 的 PATHS 都在模块加载时定值，
  // 不重置就复用上一个用例的（已被删掉的）临时目录，导致用例之间互相污染。
  // 与 works-likes.test.ts / works.test.ts 同理。
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

/**
 * 建一件已过审的作品，返回 id。
 *
 * 走投稿真实路径（createSubmission → attachSubmissionImage → approveWork）：
 * 这里要验的正是「过审之后才进搜索结果」，用 INSERT 捷径造数据会把
 * status / published 的写入绕过去，验的就不是这条不变量了。
 */
async function seed(title: string, published = true) {
  const created = await makeApprovedWork(works, { title, published });
  return created.id;
}

const list = (o: Partial<Parameters<typeof works.listPublishedWorks>[0]> = {}) =>
  works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest', ...o });

const UA = 'Mozilla/5.0 (test) Chrome/1';

/**
 * 给作品点赞。指纹 = IP + UA + 作品 + 日期，所以每次调用换一个 IP 就是「一个新人」。
 * 签名刻意保持与旧的 ipHashOf 用法一一对应（`h('1')`、`h('2')`），
 * 让这些用例的**意图**（谁赞了几次）不被签名变化淹没。
 */
const h = (ip: string) => (workId: number, now?: number) =>
  works.likeFingerprint(ip, UA, workId, now);

describe('escapeLike', () => {
  it('转义 % _ 和反斜杠', () => {
    expect(works.escapeLike('50%')).toBe('50\\%');
    expect(works.escapeLike('a_b')).toBe('a\\_b');
    expect(works.escapeLike('c\\d')).toBe('c\\\\d');
  });

  it('普通字符不动', () => {
    expect(works.escapeLike('粉色小熊')).toBe('粉色小熊');
  });
});

describe('搜索', () => {
  it('q 按标题模糊匹配', async () => {
    await seed('粉色小熊');
    await seed('蓝色小熊');
    const r = await list({ q: '小熊' });
    expect(r.total).toBe(2);
  });

  it('q 只匹配标题，不匹配描述', async () => {
    await makeApprovedWork(works, { title: '甲', description: '这里有小熊' });
    await seed('乙');
    expect((await list({ q: '小熊' })).total).toBe(0);
  });

  it('total 与过滤后的结果一致（不是全表计数）', async () => {
    await seed('粉色小熊');
    await seed('蓝色小熊');
    await seed('绿色小猪');
    const r = await list({ q: '小熊' });
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(2);
  });

  it('q 空串等价于不搜索', async () => {
    await seed('甲');
    await seed('乙');
    expect((await list({ q: '' })).total).toBe(2);
    expect((await list({ q: '  ' })).total).toBe(2);   // 纯空格视为无查询
  });

  it('搜不到时 total 为 0', async () => {
    await seed('甲');
    expect((await list({ q: '不存在的东西' })).total).toBe(0);
  });

  it('% 被当字面量而非通配符', async () => {
    await seed('折扣 50% 的图纸');
    await seed('50 元优惠券');   // 关键 fixture：未转义的模式 `%50%%` 会命中这条
    await seed('无关作品');
    expect((await list({ q: '50%' })).total).toBe(1);
  });

  it('\\ 被当字面量而非转义引导符', async () => {
    await seed('c\\d 图纸');
    await seed('c d 图纸');
    expect((await list({ q: 'c\\d' })).items.map(i => i.title)).toEqual(['c\\d 图纸']);
  });

  it('_ 被当字面量而非单字符通配符', async () => {
    await seed('a_b 图纸');
    await seed('axb 图纸');
    expect((await list({ q: 'a_b' })).total).toBe(1);
  });

  it('草稿永远搜不到', async () => {
    await seed('小熊', false);
    expect((await list({ q: '小熊' })).total).toBe(0);
  });

  /**
   * 未过审的作品在**搜索分支**也搜不到。
   *
   * 为什么要单独一条：带 q 的 WHERE 是另一段独立 SQL 字面量，不与不搜索分支共享代码。
   * 只从搜索分支删掉 `AND w.status = 'approved'`，works.test.ts 里那两条不传 q 的
   * 用例一条都不会红 —— 而搜索恰恰是访客最容易撞见未过审内容的入口。
   *
   * 对照行（已过审、同关键词）是这条用例的关键：没有它，「搜出来是空的」既可能是
   * 过滤生效，也可能是 q 根本没匹配上任何东西，用例就成了恒真。
   */
  it('未过审的作品在搜索结果里也不出现', async () => {
    // 三行一起断，缺一不可：
    //  - 真·待审投稿：published=0，被 published 过滤挡下
    //  - 已过审又被压回 pending 的行：published=1，**只剩 status 过滤能挡它**。
    //    这种行在正常流程里造不出来（不变量① 禁止 pending + published=1），所以
    //    直接写库压状态 —— 它守的正是那道「不依赖不变量成立」的兜底过滤，
    //    拿「本来就下架的投稿」冒充它会让这条用例恒真。
    //  - 正常已过审的对照行：没有它，「搜出来是空的」也可能是 q 什么都没匹配上。
    const { id: submitted } = await makePendingWork(works, { title: '待审小熊' });
    const demoted = await seed('被压回待审小熊');
    db.runStmt(`UPDATE works SET status = 'pending' WHERE id = ?`, [demoted]);
    await seed('已过审小熊');

    const r = await list({ q: '小熊' });
    expect(r.items.map(i => i.title)).toEqual(['已过审小熊']);
    expect(r.total).toBe(1);
    expect(works.getPublishedWork(submitted)).toBeNull();
    expect(works.getPublishedWork(demoted)).toBeNull();
  });
});

describe('排序', () => {
  it('latest 按创建时间倒序（现状行为）', async () => {
    await seed('先');
    await seed('后');
    const r = await list({ sort: 'latest' });
    expect(r.items[0]?.title).toBe('后');
  });

  it('hot 按点赞数倒序', async () => {
    const a = await seed('A'); const b = await seed('B'); const c = await seed('C');
    works.addLike(a, h('1')(a)); works.addLike(a, h('2')(a)); works.addLike(a, h('3')(a));
    works.addLike(b, h('1')(b)); works.addLike(b, h('2')(b));
    works.addLike(c, h('1')(c));
    const r = await list({ sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['A', 'B', 'C']);
  });

  it('hot 下同赞数按创建时间倒序（确定性兜底）', async () => {
    const a = await seed('先'); const b = await seed('后');
    works.addLike(a, h('1')(a)); works.addLike(b, h('2')(b));
    const r = await list({ sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['后', '先']);
  });

  /**
   * 下面两条专治「确定性排序兜底零覆盖」。
   *
   * 上一轮的「同赞数按创建时间倒序」是**假覆盖**：两条作品在同一毫秒创建，
   * created_at 本来就打平，去掉 created_at 之后 id DESC 给出的顺序恰好一样，
   * 所以那条用例杀不掉任何排序变异（M4 实测 49/49 全绿）。
   *
   * 破法只有一个：**让 id 顺序与 created_at 顺序相反**，两个 sort key 才会
   * 给出可区分的答案。下面直接写库改 created_at，因为投稿路径不接受自定义时间戳。
   */
  it('hot 同赞数按 created_at DESC（id 小的那条 created_at 更大）', async () => {
    const a = await seed('AAA'); const b = await seed('BBB');
    db.runStmt(`UPDATE works SET created_at = 2000 WHERE id = ?`, [a]);
    db.runStmt(`UPDATE works SET created_at = 1000 WHERE id = ?`, [b]);
    works.addLike(a, h('x')(a)); works.addLike(b, h('y')(b));
    const r = await list({ sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['AAA', 'BBB']);
  });

  it('hot 完全打平时由 id DESC 定死（确定性）', async () => {
    const a = await seed('AAA'); const b = await seed('BBB');
    db.runStmt(`UPDATE works SET created_at = 1000 WHERE id = ?`, [a]);
    db.runStmt(`UPDATE works SET created_at = 1000 WHERE id = ?`, [b]);
    works.addLike(a, h('x')(a)); works.addLike(b, h('y')(b));
    const r = await list({ sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['BBB', 'AAA']);
  });

  it('点赞后重新排序，热图上浮', async () => {
    const a = await seed('A'); const b = await seed('B');
    works.addLike(a, h('1')(a));
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('A');
    works.addLike(b, h('1')(b)); works.addLike(b, h('2')(b));
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('B');
  });

  it('每条 summary 都带 likes 字段', async () => {
    const a = await seed('A');
    works.addLike(a, h('1')(a));
    const r = await list();
    expect(r.items[0]?.likes).toBe(1);
  });

  it('搜索 + 排序可组合', async () => {
    const a = await seed('小熊A'); const b = await seed('小猪B');
    works.addLike(a, h('1')(a));
    works.addLike(b, h('1')(b)); works.addLike(b, h('2')(b));
    const r = await list({ q: '小', sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['小猪B', '小熊A']);
  });
});

describe('详情 / 后台的 likes 口径', () => {
  /**
   * `WorkSummary.likes` 对外承诺是「总点赞数」，所有返回 WorkDetail 的路径都必须给真值。
   * 改成 works.likes 列之后这条变得**天然成立**（所有路径都是 SELECT w.*），
   * 但用例必须留着 —— 一旦某条路径写成 `SELECT id, title ...` 漏掉 likes 列，
   * 公开详情就会在作品有赞时静默返回 0，而这正是当初 I-1 发现的 bug。
   */
  it('getPublishedWork 返回真实赞数，不是默认 0', async () => {
    const id = await seed('甲');
    expect(works.getPublishedWork(id)?.likes).toBe(0);   // 还没人点赞
    works.addLike(id, h('1')(id));
    works.addLike(id, h('2')(id));
    expect(works.getPublishedWork(id)?.likes).toBe(2);
  });

  it('listAllWorks（后台）同样返回真实赞数', async () => {
    const id = await seed('甲');
    works.addLike(id, h('1')(id));
    works.addLike(id, h('2')(id));
    expect(works.listAllWorks().find(w => w.id === id)?.likes).toBe(2);
  });

  it('刚过审的作品赞数是 0（此刻确实没人点赞）', async () => {
    const created = await makeApprovedWork(works, { title: '新作品' });
    expect(created.likes).toBe(0);
  });

  it('updateWorkMeta 返回的赞数不会被抹成 0', async () => {
    const id = await seed('甲');
    works.addLike(id, h('1')(id));
    works.addLike(id, h('2')(id));
    const updated = await works.updateWorkMeta(id, { title: '乙' });
    expect(updated.likes).toBe(2);
  });
});

describe('分页', () => {
  it('limit 仍然钳到 [1,60]', async () => {
    for (let i = 0; i < 3; i++) await seed(`W${i}`);
    expect((await list({ limit: 0 })).items).toHaveLength(1);
    expect((await list({ limit: 999 })).items).toHaveLength(3);
  });

  it('offset 分页仍然工作', async () => {
    for (let i = 0; i < 5; i++) await seed(`W${i}`);
    const p1 = await list({ limit: 2, offset: 0 });
    const p2 = await list({ limit: 2, offset: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    // 已知局限（用户已接受）：hot 排序下点赞会改变排名，offset 分页可能漏图。
    // 这里只验证 latest（静态排序）下分页正确。
    expect(new Set([...p1.items, ...p2.items].map(i => i.id)).size).toBe(4);
  });
});

describe('赞数直读 works.likes，列表不再做聚合 ★', () => {
  /**
   * 本次改造的核心承诺：列表查询的赞数**来自 works.likes 这一列**。
   *
   * 钉法是「绕过 addLike 直接改列」：如果列表还在走
   * `LEFT JOIN (SELECT ... FROM work_likes GROUP BY work_id)` 聚合，
   * 直接 UPDATE works.likes 根本不会影响列表返回值（聚合读的是另一张表），
   * 断言立刻变红。而正常路径下这两者数值相同，所以这条能杀掉聚合实现、又不误伤正确实现。
   */
  it('列表返回的 likes 就是列里的值（绕过 addLike 直接改列）', async () => {
    const a = await seed('A');
    works.addLike(a, h('1')(a));
    expect((await list()).items[0]?.likes).toBe(1);

    db.runStmt(`UPDATE works SET likes = 7 WHERE id = ?`, [a]);
    expect((await list()).items[0]?.likes).toBe(7);
    // 详情与后台走的是同一列，口径一致
    expect(works.getPublishedWork(a)?.likes).toBe(7);
    expect(works.listAllWorks().find(w => w.id === a)?.likes).toBe(7);
  });

  it('hot 排序读的也是这一列（直接改列能改变排名）', async () => {
    const a = await seed('A'); await seed('B');   // B 后建，latest/hot 同赞数下 B 在前
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('B');
    db.runStmt(`UPDATE works SET likes = 5 WHERE id = ?`, [a]);
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('A');
  });

  it('work_likes 表已不存在（没有可聚合的来源）', async () => {
    const tables = db.queryAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_likes'`
    );
    expect(tables).toEqual([]);
  });

  /**
   * 把「不再聚合」钉死在 SQL 文本上：发一次列表请求，把它真正 prepare 出去的
   * 每条 SQL 都抓下来，断言没有一条提到 work_likes、没有一条带 GROUP BY。
   *
   * 上面三条都是**结果**断言 —— 如果有人把聚合换成一个写法不同但同样贵的 SQL
   * （比如 COUNT 子查询、相关子查询），它们照样绿。这条不管怎么换写法都会红。
   * 计数点选在 Database.prototype.prepare：initDb 的建表走 exec、不经过它，
   * 所以不会污染（与 works-likes-routes.test.ts 里数 SQL 条数是同一个手法）。
   */
  it('列表查询发出去的 SQL 里没有 work_likes、没有 GROUP BY', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const wasmDir = resolve(process.cwd(), 'node_modules/sql.js/dist');
    const SQL = await initSqlJs({ locateFile: (f: string) => resolve(wasmDir, f) });
    const proto = SQL.Database.prototype;
    const original = proto.prepare;
    const seen: string[] = [];
    const spy = vi.spyOn(proto, 'prepare').mockImplementation(function (
      this: import('sql.js').Database,
      ...args: Parameters<typeof original>
    ) {
      seen.push(String(args[0]));
      return original.apply(this, args);
    });
    try {
      await seed('A');
      works.addLike(1, h('1')(1));
      seen.length = 0;
      await list();
      await list({ sort: 'hot', q: 'A' });
    } finally {
      spy.mockRestore();
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter(sql => /work_likes/i.test(sql))).toEqual([]);
    expect(seen.filter(sql => /group\s+by/i.test(sql))).toEqual([]);
  });
});
