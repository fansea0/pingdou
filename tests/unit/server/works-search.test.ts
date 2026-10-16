import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** 建一件作品，返回 id（createWork 是 async —— 要写文件，所以 seed 也是 async） */
async function seed(title: string, published = true) {
  const created = await works.createWork({
    title,
    published,
    image: { body: Buffer.from([1, 2, 3]), mime: 'image/png' },
  });
  return created.id;
}

const list = (o: Partial<Parameters<typeof works.listPublishedWorks>[0]> = {}) =>
  works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest', ...o });

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
    await works.createWork({
      title: '甲',
      description: '这里有小熊',
      image: { body: Buffer.from([1]), mime: 'image/png' },
    });
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
    const h = works.ipHashOf;
    works.addLike(a, h('1')); works.addLike(a, h('2')); works.addLike(a, h('3'));
    works.addLike(b, h('1')); works.addLike(b, h('2'));
    works.addLike(c, h('1'));
    const r = await list({ sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['A', 'B', 'C']);
  });

  it('hot 下同赞数按创建时间倒序（确定性兜底）', async () => {
    const a = await seed('先'); const b = await seed('后');
    const h = works.ipHashOf;
    works.addLike(a, h('1')); works.addLike(b, h('2'));
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
   * 给出可区分的答案。下面直接写库改 created_at（works.test.ts 有同款先例），
   * 因为 createWork 不接受自定义时间戳。
   */
  it('hot 同赞数按 created_at DESC（id 小的那条 created_at 更大）', async () => {
    const a = await seed('AAA'); const b = await seed('BBB');
    db.runStmt(`UPDATE works SET created_at = 2000 WHERE id = ?`, [a]);
    db.runStmt(`UPDATE works SET created_at = 1000 WHERE id = ?`, [b]);
    works.addLike(a, works.ipHashOf('x')); works.addLike(b, works.ipHashOf('y'));
    const r = await list({ sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['AAA', 'BBB']);
  });

  it('hot 完全打平时由 id DESC 定死（确定性）', async () => {
    const a = await seed('AAA'); const b = await seed('BBB');
    db.runStmt(`UPDATE works SET created_at = 1000 WHERE id = ?`, [a]);
    db.runStmt(`UPDATE works SET created_at = 1000 WHERE id = ?`, [b]);
    works.addLike(a, works.ipHashOf('x')); works.addLike(b, works.ipHashOf('y'));
    const r = await list({ sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['BBB', 'AAA']);
  });

  it('点赞后重新排序，热图上浮', async () => {
    const a = await seed('A'); const b = await seed('B');
    const h = works.ipHashOf;
    works.addLike(a, h('1'));
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('A');
    works.addLike(b, h('1')); works.addLike(b, h('2'));
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('B');
  });

  it('每条 summary 都带 likes 字段', async () => {
    const a = await seed('A');
    works.addLike(a, works.ipHashOf('1'));
    const r = await list();
    expect(r.items[0]?.likes).toBe(1);
  });

  it('搜索 + 排序可组合', async () => {
    const a = await seed('小熊A'); const b = await seed('小猪B');
    const h = works.ipHashOf;
    works.addLike(a, h('1'));
    works.addLike(b, h('1')); works.addLike(b, h('2'));
    const r = await list({ q: '小', sort: 'hot' });
    expect(r.items.map(i => i.title)).toEqual(['小猪B', '小熊A']);
  });
});

describe('详情 / 后台的 likes 口径', () => {
  /**
   * I-1：`WorkSummary.likes` 对外承诺是「总点赞数」，那所有返回 WorkDetail 的
   * 路径就必须给真值。只有列表 JOIN 了 work_likes，详情/后台原本拿 toSummary 的
   * 默认 0 —— 一个有 2 个赞的作品，公开详情接口在撒谎。
   */
  it('getPublishedWork 返回真实赞数，不是默认 0', async () => {
    const id = await seed('甲');
    expect(works.getPublishedWork(id)?.likes).toBe(0);   // 还没人点赞
    works.addLike(id, works.ipHashOf('1'));
    works.addLike(id, works.ipHashOf('2'));
    expect(works.getPublishedWork(id)?.likes).toBe(2);
  });

  it('listAllWorks（后台）同样返回真实赞数', async () => {
    const id = await seed('甲');
    works.addLike(id, works.ipHashOf('1'));
    works.addLike(id, works.ipHashOf('2'));
    expect(works.listAllWorks().find(w => w.id === id)?.likes).toBe(2);
  });

  it('createWork 返回 0 赞（此刻确实没人点赞）', async () => {
    const created = await works.createWork({
      title: '新作品',
      image: { body: Buffer.from([1, 2, 3]), mime: 'image/png' },
    });
    expect(created.likes).toBe(0);
  });

  it('updateWorkMeta / replaceWorkImage 返回的赞数不会被抹成 0', async () => {
    const id = await seed('甲');
    works.addLike(id, works.ipHashOf('1'));
    works.addLike(id, works.ipHashOf('2'));
    const updated = await works.updateWorkMeta(id, { title: '乙' });
    expect(updated.likes).toBe(2);
    const replaced = await works.replaceWorkImage(
      id,
      { body: Buffer.from([9, 9]), mime: 'image/png' }
    );
    expect(replaced.likes).toBe(2);
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
