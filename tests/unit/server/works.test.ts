import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46]);

beforeEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('createWork', () => {
  it('写入记录并把原图落到 media/works/ 下', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({
      title: '粉色小熊',
      width: 1200, height: 1600,
      image: { body: PNG, mime: 'image/png' },
    });
    expect(w.id).toBeGreaterThan(0);
    expect(w.title).toBe('粉色小熊');
    expect(w.bytes).toBe(4);
    expect(existsSync(join(paths.PATHS.mediaDir, 'works'))).toBe(true);
    // imageUrl 由 driver 现算，不是存在 DB 里的
    expect(w.imageUrl).toMatch(/^\/media\/works\/[0-9a-f]{16}\.png$/);
  });

  it('无标题时回落为「未命名作品」', async () => {
    const { works } = await freshWorks();
    expect((await works.createWork({ title: '   ', image: { body: PNG, mime: 'image/png' } })).title)
      .toBe('未命名作品');
  });

  it('title 缺省（非 string）也回落为「未命名作品」', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ title: undefined, image: { body: PNG, mime: 'image/png' } });
    expect(w.title).toBe('未命名作品');
  });

  it('description 超 2000 字符被截断而非报错', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({
      description: 'x'.repeat(2500),
      image: { body: PNG, mime: 'image/png' },
    });
    expect(w.description).toHaveLength(2000);
  });

  it('非法 width/height 归零', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({
      width: 'abc', height: -5,
      image: { body: PNG, mime: 'image/png' },
    });
    expect(w.width).toBe(0);
    expect(w.height).toBe(0);
  });

  it('拒绝不支持的 mime', async () => {
    const { works } = await freshWorks();
    await expect(works.createWork({ image: { body: PNG, mime: 'image/gif' } }))
      .rejects.toThrow(/mime/);
  });

  it('缩略图必须是非 webp', async () => {
    const { works } = await freshWorks();
    await expect(works.createWork({
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: PNG, mime: 'image/png' },
    })).rejects.toThrow(/webp/);
  });

  it('有缩略图时 thumbUrl 指向缩略图 key', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: WEBP, mime: 'image/webp' },
    });
    expect(w.thumbUrl).toMatch(/-t\.webp$/);
    // 原图和缩略图共享同一段随机 hex，肉眼可辨归属
    const hexOf = (u: string) => u.match(/\/([0-9a-f]{16})/)?.[1];
    expect(hexOf(w.imageUrl)).toBe(hexOf(w.thumbUrl));
  });

  it('无缩略图时 thumbUrl 回落为原图 URL', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ image: { body: PNG, mime: 'image/png' } });
    expect(w.thumbUrl).toBe(w.imageUrl);
  });

  it('published 缺省为 true，字符串 "0" 解析为 false', async () => {
    const { works } = await freshWorks();
    expect((await works.createWork({ image: { body: PNG, mime: 'image/png' } })).id).toBeGreaterThan(0);
    expect(works.listPublishedWorks(20, 0).total).toBe(1);
    const draft = await works.createWork({ published: '0', image: { body: PNG, mime: 'image/png' } });
    expect(works.listPublishedWorks(20, 0).total).toBe(1);
    expect(works.getPublishedWork(draft.id)).toBeNull();
  });
});

describe('listPublishedWorks', () => {
  it('草稿不出现在公开列表', async () => {
    const { works } = await freshWorks();
    await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    await works.createWork({ title: 'B', published: false, image: { body: PNG, mime: 'image/png' } });
    const { items, total } = works.listPublishedWorks(20, 0);
    expect(total).toBe(1);
    expect(items.map(i => i.title)).toEqual(['A']);
  });

  it('列表只暴露 summary，不含 description / imageUrl', async () => {
    const { works } = await freshWorks();
    await works.createWork({ title: 'A', description: '不该出现在列表', image: { body: PNG, mime: 'image/png' } });
    expect(works.listPublishedWorks(20, 0).items[0]).not.toHaveProperty('description');
    expect(works.listPublishedWorks(20, 0).items[0]).not.toHaveProperty('imageUrl');
  });

  it('limit 钳制到 [1,60]，offset 负数归零', async () => {
    const { works } = await freshWorks();
    for (let i = 0; i < 3; i++) {
      await works.createWork({ title: `W${i}`, image: { body: PNG, mime: 'image/png' } });
    }
    expect(works.listPublishedWorks(999, -5).items).toHaveLength(3);
    expect(works.listPublishedWorks(0, 0).items).toHaveLength(1);
  });

  it('按 created_at DESC 排序，最新在前', async () => {
    const { works } = await freshWorks();
    const a = await works.createWork({ title: 'first', image: { body: PNG, mime: 'image/png' } });
    await new Promise(r => setTimeout(r, 5));
    const b = await works.createWork({ title: 'second', image: { body: PNG, mime: 'image/png' } });
    const ids = works.listPublishedWorks(20, 0).items.map(i => i.id);
    expect(ids).toEqual([b.id, a.id]);
  });
});

describe('updateWorkMeta', () => {
  it('改标题/描述并更新 updated_at', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    const next = await works.updateWorkMeta(w.id, { title: 'B', description: 'd' });
    expect(next.title).toBe('B');
    expect(next.description).toBe('d');
    expect(next.updatedAt).toBeGreaterThanOrEqual(w.createdAt);
  });

  it('published 缺省字段不动现有值', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ published: false, image: { body: PNG, mime: 'image/png' } });
    await works.updateWorkMeta(w.id, { title: 'X' });
    expect(works.getPublishedWork(w.id)).toBeNull();
  });

  it('下架后公开详情 404', async () => {
    const { works } = await freshWorks();
    const w = await works.createWork({ image: { body: PNG, mime: 'image/png' } });
    await works.updateWorkMeta(w.id, { published: false });
    expect(works.getPublishedWork(w.id)).toBeNull();
  });

  it('对不存在的 id 抛 work not found', async () => {
    const { works } = await freshWorks();
    await expect(works.updateWorkMeta(9999, { title: 'X' })).rejects.toThrow(/not found/);
  });
});

describe('listAllWorks', () => {
  it('后台列表包含草稿', async () => {
    const { works } = await freshWorks();
    await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    await works.createWork({ title: 'B', published: false, image: { body: PNG, mime: 'image/png' } });
    expect(works.listAllWorks()).toHaveLength(2);
  });
});

describe('replaceWorkImage', () => {
  it('换图后旧文件被删、URL 改变', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({ image: { body: PNG, mime: 'image/png' } });
    const oldFile = join(paths.PATHS.mediaDir, 'works', w.imageUrl.split('/').pop()!);
    expect(existsSync(oldFile)).toBe(true);

    const next = await works.replaceWorkImage(w.id, { body: WEBP, mime: 'image/webp' });
    expect(next.imageUrl).not.toBe(w.imageUrl);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(join(paths.PATHS.mediaDir, 'works', next.imageUrl.split('/').pop()!))).toBe(true);
  });

  it('换图会清掉旧缩略图', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: WEBP, mime: 'image/webp' },
    });
    const oldThumb = join(paths.PATHS.mediaDir, 'works', w.thumbUrl.split('/').pop()!);
    const next = await works.replaceWorkImage(w.id, { body: WEBP, mime: 'image/webp' });
    expect(existsSync(oldThumb)).toBe(false);
    // 没传新缩略图 → thumbKey 清空 → thumbUrl 回落为新原图
    expect(next.thumbUrl).toBe(next.imageUrl);
  });

  it('对不存在的 id 抛 work not found', async () => {
    const { works } = await freshWorks();
    await expect(works.replaceWorkImage(9999, { body: PNG, mime: 'image/png' }))
      .rejects.toThrow(/not found/);
  });
});

describe('deleteWork', () => {
  it('记录和两个文件一起消失', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({
      image: { body: PNG, mime: 'image/png' },
      thumb: { body: WEBP, mime: 'image/webp' },
    });
    const img = join(paths.PATHS.mediaDir, 'works', w.imageUrl.split('/').pop()!);
    const thumb = join(paths.PATHS.mediaDir, 'works', w.thumbUrl.split('/').pop()!);
    expect(existsSync(img)).toBe(true);
    expect(existsSync(thumb)).toBe(true);

    await works.deleteWork(w.id);
    expect(existsSync(img)).toBe(false);
    expect(existsSync(thumb)).toBe(false);
    expect(works.listAllWorks()).toHaveLength(0);
  });

  it('无缩略图的作品也能删', async () => {
    const { works, paths } = await freshWorks();
    const w = await works.createWork({ image: { body: PNG, mime: 'image/png' } });
    const img = join(paths.PATHS.mediaDir, 'works', w.imageUrl.split('/').pop()!);
    expect(existsSync(img)).toBe(true);

    await expect(works.deleteWork(w.id)).resolves.toBeUndefined();
    // 光验「不抛错 + works/ 目录还在」是没有判别力的：目录在 createWork 阶段
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
