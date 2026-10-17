import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApprovedWork, makePendingWork, makeRejectedWork } from '../../helpers/works.js';

let tmp = '';

type WorksModule = typeof import('../../../server/works.js');
type PathsModule = typeof import('../../../server/paths.js');

async function freshWorks(): Promise<{ works: WorksModule; paths: PathsModule }> {
  tmp = mkdtempSync(join(tmpdir(), 'works-test-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  const paths = await import('../../../server/paths.js');
  const works = await import('../../../server/works.js');
  return { works, paths };
}

beforeEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

/**
 * 造数据的入口只剩投稿，所以「原图/缩略图落到 media/works/ 下、key 按 mime 派生」
 * 这层断言在这里继续成立 —— 它守的是 storage 与 key 派生本身，不是投稿参数校验
 * （后者由 submissions.test.ts 负责）。
 */
describe('投稿造出的作品：落盘与缩略图 key', () => {
  it('写入记录并把原图落到 media/works/ 下', async () => {
    const { works, paths } = await freshWorks();
    const w = await makeApprovedWork(works, { title: '粉色小熊' });
    expect(w.id).toBeGreaterThan(0);
    expect(w.title).toBe('粉色小熊');
    expect(w.bytes).toBe(4);
    expect(existsSync(join(paths.PATHS.mediaDir, 'works'))).toBe(true);
    // imageUrl 由 driver 现算，不是存在 DB 里的
    expect(w.imageUrl).toMatch(/^\/media\/works\/[0-9a-f]{16}\.png$/);
    expect(existsSync(join(paths.PATHS.mediaDir, 'works', w.imageUrl.split('/').pop()!))).toBe(true);
  });

  it('有缩略图时 thumbUrl 指向缩略图 key，与原图共享同一段随机 hex', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works);
    expect(w.thumbUrl).toMatch(/-t\.webp$/);
    // 原图和缩略图共享同一段随机 hex，肉眼可辨归属
    const hexOf = (u: string) => u.match(/\/([0-9a-f]{16})/)?.[1];
    expect(hexOf(w.imageUrl)).toBe(hexOf(w.thumbUrl));
  });

  it('图纸参数原样透传给详情（投稿时填什么就是什么）', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works, { boardW: 87, boardH: 62 });
    const d = works.getPublishedWork(w.id)!;
    expect(d.boardW).toBe(87);
    expect(d.boardH).toBe(62);
    expect(d.beanCount).toBe(1234);
    expect(d.estimateMinutes).toBe(60);
  });

  it('过审默认上架，公开列表立刻可见', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works);
    expect(w.published).toBe(true);
    expect(works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' }).total).toBe(1);
    expect(works.getPublishedWork(w.id)).not.toBeNull();
  });

  it('published: false 造出的是「已过审 + 已下架」，公开列表仍然只有一件', async () => {
    const { works } = await freshWorks();
    await makeApprovedWork(works, { title: 'A' });
    const draft = await makeApprovedWork(works, { title: 'B', published: false });
    // 断言 status：下架必须建立在已过审之上，否则就是「未过审且下架」的含混数据
    expect(draft.status).toBe('approved');
    expect(draft.published).toBe(false);
    expect(works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' }).total).toBe(1);
    expect(works.getPublishedWork(draft.id)).toBeNull();
  });
});

describe('listPublishedWorks', () => {
  it('草稿不出现在公开列表', async () => {
    const { works } = await freshWorks();
    await makeApprovedWork(works, { title: 'A' });
    await makeApprovedWork(works, { title: 'B', published: false });
    const { items, total } = works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' });
    expect(total).toBe(1);
    expect(items.map(i => i.title)).toEqual(['A']);
  });

  it('列表只暴露 summary，不含 description / imageUrl', async () => {
    const { works } = await freshWorks();
    await makeApprovedWork(works, { title: 'A', description: '不该出现在列表' });
    expect(works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' }).items[0]).not.toHaveProperty('description');
    expect(works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' }).items[0]).not.toHaveProperty('imageUrl');
  });

  it('limit 钳制到 [1,60]，offset 负数归零', async () => {
    const { works } = await freshWorks();
    for (let i = 0; i < 3; i++) {
      await makeApprovedWork(works, { title: `W${i}` });
    }
    expect(works.listPublishedWorks({ limit: 999, offset: -5, sort: 'latest' }).items).toHaveLength(3);
    expect(works.listPublishedWorks({ limit: 0, offset: 0, sort: 'latest' }).items).toHaveLength(1);
  });

  it('按 created_at DESC 排序，最新在前', async () => {
    const { works } = await freshWorks();
    const a = await makeApprovedWork(works, { title: 'first' });
    await new Promise(r => setTimeout(r, 5));
    const b = await makeApprovedWork(works, { title: 'second' });
    const ids = works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' }).items.map(i => i.id);
    expect(ids).toEqual([b.id, a.id]);
  });
});

describe('updateWorkMeta', () => {
  it('改标题/描述并更新 updated_at', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works, { title: 'A' });
    const next = await works.updateWorkMeta(w.id, { title: 'B', description: 'd' });
    expect(next.title).toBe('B');
    expect(next.description).toBe('d');
    expect(next.updatedAt).toBeGreaterThanOrEqual(w.createdAt);
  });

  // 归一化逻辑没有随后台上传通道一起消失：updateWorkMeta 是它现在唯一的调用方。
  it('空标题回落为「未命名作品」，不把空串写进库', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works, { title: 'A' });
    expect((await works.updateWorkMeta(w.id, { title: '   ' })).title).toBe('未命名作品');
  });

  it('description 超 2000 字符被截断而非报错', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works);
    expect((await works.updateWorkMeta(w.id, { description: 'x'.repeat(2500) })).description)
      .toHaveLength(2000);
  });

  it('published 缺省字段不动现有值', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works, { published: false });
    await works.updateWorkMeta(w.id, { title: 'X' });
    expect(works.getPublishedWork(w.id)).toBeNull();
  });

  it('下架后公开详情 404', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works);
    await works.updateWorkMeta(w.id, { published: false });
    expect(works.getPublishedWork(w.id)).toBeNull();
  });

  it('对不存在的 id 抛 work not found', async () => {
    const { works } = await freshWorks();
    await expect(works.updateWorkMeta(9999, { title: 'X' })).rejects.toThrow(/not found/);
  });
});

describe('listAllWorks', () => {
  it('后台列表同时返回上架件与已下架件', async () => {
    const { works } = await freshWorks();
    await makeApprovedWork(works, { title: 'A' });
    await makeApprovedWork(works, { title: 'B', published: false });
    expect(works.listAllWorks()).toHaveLength(2);
  });
});

describe('deleteWork', () => {
  it('记录和两个文件一起消失', async () => {
    const { works, paths } = await freshWorks();
    const w = await makeApprovedWork(works);
    const img = join(paths.PATHS.mediaDir, 'works', w.imageUrl.split('/').pop()!);
    const thumb = join(paths.PATHS.mediaDir, 'works', w.thumbUrl.split('/').pop()!);
    expect(existsSync(img)).toBe(true);
    expect(existsSync(thumb)).toBe(true);

    await works.deleteWork(w.id);
    expect(existsSync(img)).toBe(false);
    expect(existsSync(thumb)).toBe(false);
    expect(works.listAllWorks()).toHaveLength(0);
  });

  it('无缩略图的作品也能删（thumb_key 为空时删文件那一路要早退）', async () => {
    const { works, paths } = await freshWorks();
    const w = await makeApprovedWork(works, { thumb: false });
    expect(w.thumbUrl).toBe(w.imageUrl);
    const img = join(paths.PATHS.mediaDir, 'works', w.imageUrl.split('/').pop()!);
    expect(existsSync(img)).toBe(true);

    await expect(works.deleteWork(w.id)).resolves.toBeUndefined();
    // 光验「不抛错 + works/ 目录还在」是没有判别力的：目录在投稿挂图阶段
    // 就已经是 true，删成功删失败都过。必须验记录真没了、原图真没了。
    expect(works.listAllWorks()).toHaveLength(0);
    expect(existsSync(img)).toBe(false);
  });

  it('对不存在的 id 抛 work not found', async () => {
    const { works } = await freshWorks();
    await expect(works.deleteWork(9999)).rejects.toThrow(/not found/);
  });
});

describe('normalizePublished', () => {
  it('接受 multipart 的字符串形式', async () => {
    const { works } = await freshWorks();
    expect(works.normalizePublished('1', false)).toBe(true);
    expect(works.normalizePublished('true', false)).toBe(true);
    expect(works.normalizePublished('on', false)).toBe(true);
    expect(works.normalizePublished('0', true)).toBe(false);
    expect(works.normalizePublished('false', true)).toBe(false);
    expect(works.normalizePublished('', true)).toBe(false);
  });

  it('undefined/null 走 fallback', async () => {
    const { works } = await freshWorks();
    expect(works.normalizePublished(undefined, true)).toBe(true);
    expect(works.normalizePublished(null, false)).toBe(false);
  });

  it('接受真正的 boolean', async () => {
    const { works } = await freshWorks();
    expect(works.normalizePublished(true, false)).toBe(true);
    expect(works.normalizePublished(false, true)).toBe(false);
  });

  it('JSON 接口送来的数字 0/1 语义正确', async () => {
    const { works } = await freshWorks();
    expect(works.normalizePublished(0, true)).toBe(false);
    expect(works.normalizePublished(1, false)).toBe(true);
  });
});

describe('作品响应形状与公开可见性', () => {
  it('过审后的作品是 approved 且公开可见', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works, { title: '老作品' });
    expect(w.status).toBe('approved');
    expect(works.getPublishedWork(w.id)).not.toBeNull();
  });

  it('status 为 pending 的作品不出现在公开列表，total 也不含它', async () => {
    const { works } = await freshWorks();
    // 真·待审投稿：published=0，被 published 过滤挡下
    const { id: submitted } = await makePendingWork(works, { title: '待审' });
    // 已过审又被压回 pending 的行：published=1，唯一能挡它的是 status 过滤。
    // 这种行正常流程造不出来（不变量① 禁止 pending + published=1），所以直接写库
    // 压状态 —— 守的正是那道「不依赖不变量成立」的兜底过滤。
    const demoted = await makeApprovedWork(works, { title: '压回待审' });
    const db = await import('../../../server/db.js');
    db.runStmt(`UPDATE works SET status='pending' WHERE id=?`, [demoted.id]);

    const list = works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' });
    // items 与 total 都要断。只断 total 是空断言的一半：今天两处共用同一个
    // where 变量，结论成立；但一旦有人把列表查询的 WHERE 内联改写、只给 COUNT
    // 保留过滤，待审作品就会带着 total=0 一起渲染进图库，而只断 total 全绿。
    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
    expect(works.getPublishedWork(submitted)).toBeNull();
    expect(works.getPublishedWork(demoted.id)).toBeNull();
  });

  it('status 为 rejected 的作品同样不可见', async () => {
    const { works } = await freshWorks();
    // 真·被拒投稿（published=0）与「过审后被压回 rejected」（published=1）都要断：
    // 后者只可能被 status 过滤挡下，是独立于 published 的第二道闸。
    await makeRejectedWork(works, { title: '被拒' });
    const w = await makeApprovedWork(works, { title: '被拒但已上架' });
    const db = await import('../../../server/db.js');
    db.runStmt(`UPDATE works SET status='rejected' WHERE id=?`, [w.id]);
    const list = works.listPublishedWorks({ limit: 20, offset: 0, sort: 'latest' });
    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
    expect(works.getPublishedWork(w.id)).toBeNull();
  });

  it('后台形状带 status，公开形状不带（与 published 同样的隔离理由）', async () => {
    const { works } = await freshWorks();
    const w = await makeApprovedWork(works, { title: 'x' });
    const admin = works.listAllWorks().find(x => x.id === w.id)!;
    expect(admin.status).toBe('approved');
    expect(admin.published).toBe(true);
    // 公开 detail 不含 status —— 恒为 approved 的字段写进响应只是废话，
    // 还让客户端误以为「拿不到该字段 = 已上架」这种反向推断成立
    expect('status' in works.getPublishedWork(w.id)!).toBe(false);
  });
});
