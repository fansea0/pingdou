import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp = '';
let works: typeof import('../../../server/works.js');

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'works-search-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  // 必须 resetModules：db.ts 的 DB_PATH / paths.ts 的 PATHS 都在模块加载时定值，
  // 不重置就复用上一个用例的（已被删掉的）临时目录，导致用例之间互相污染。
  // 与 works-likes.test.ts / works.test.ts 同理。
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
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
    await seed('无关作品');
    expect((await list({ q: '50%' })).total).toBe(1);
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

  it('点赞后重新排序，热图上浮', async () => {
    const a = await seed('A'); const b = await seed('B');
    const h = works.ipHashOf;
    works.addLike(a, h('1'));
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('A');
    works.addLike(b, h('1')); works.addLike(b, h('2'));
    expect((await list({ sort: 'hot' })).items[0]?.title).toBe('B');
    void a;
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
