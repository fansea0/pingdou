import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp = '';

type WorksModule = typeof import('../../../server/works.js');

async function freshWorks(): Promise<{ works: WorksModule; paths: typeof import('../../../server/paths.js') }> {
  tmp = mkdtempSync(join(tmpdir(), 'review-'));
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
const CLIENT = { ip: '1.2.3.4', userAgent: 'UA' };

/**
 * media/works 下现有的文件名。目录不存在时按「空」处理，而不是抛 ENOENT。
 *
 * 目录本身是 storage.put 写第一个文件时才被建出来的，所以「用户没传图就关页面」
 * 那条投稿的目录下根本没有目录存在过。断言关心的是「磁盘上还剩几个文件」，
 * 目录压根没被创建同样是「一个都不剩」，让断言挂在目录存不存在上只会把
 * 「删除是幂等的」误测成「目录必须预先存在」。
 */
function mediaFiles(paths: typeof import('../../../server/paths.js')): string[] {
  const dir = join(paths.PATHS.mediaDir, 'works');
  return existsSync(dir) ? readdirSync(dir) : [];
}

async function makePending(works: WorksModule) {
  const created = works.createSubmission({
    title: '待审作品',
    boardW: 87, boardH: 62, beanCount: 3814, colorCount: 42, estimateMinutes: 190,
  }, CLIENT);
  await works.attachSubmissionImage(created.id, created.uploadToken, {
    image: { body: PNG, mime: 'image/png' },
    thumb: { body: WEBP, mime: 'image/webp' },
    width: 1500, height: 2200,
  });
  return created.id;
}

beforeEach(() => { delete process.env.PINGDOU_DATA_DIR; vi.resetModules(); });
afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('approveWork', () => {
  it('把 pending 变成 approved 并自动上架', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    const next = works.approveWork(id);
    expect(next.status).toBe('approved');
    expect(next.published).toBe(true);
    // 通过之后公开接口立刻能拿到
    expect(works.getPublishedWork(id)).not.toBeNull();
  });

  it('重复点「通过」是幂等的，不会把已被下架的作品重新上架', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    works.approveWork(id);
    await works.updateWorkMeta(id, { published: false });
    const again = works.approveWork(id);
    expect(again.published).toBe(false);
    expect(again.status).toBe('approved');
    // 无副作用是**持久态**的性质，光看返回值不够：approveWork 完全可以在
    // return 之前补一句 UPDATE published=1，返回值照样是 false，而作品已经
    // 偷偷回到前台了（评审实测过这个变异）。所以这里必须回库查、并且查公开接口。
    expect(works.listAllWorks()[0].published).toBe(false);
    expect(works.getPublishedWork(id)).toBeNull();
  });

  it('已拒绝的投稿不能通过（终态不可回退）', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    await works.rejectWork(id);
    expect(() => works.approveWork(id)).toThrow(/拒绝/);
  });

  it('id 不存在抛错', async () => {
    const { works } = await freshWorks();
    expect(() => works.approveWork(4242)).toThrow();
  });
});

describe('rejectWork', () => {
  it('标记 rejected、下架，并物理删除原图与缩略图', async () => {
    const { works, paths } = await freshWorks();
    const id = await makePending(works);
    expect(mediaFiles(paths)).toHaveLength(2);

    const next = await works.rejectWork(id);
    expect(next.status).toBe('rejected');
    expect(next.published).toBe(false);
    expect(mediaFiles(paths)).toHaveLength(0);
    expect(works.getPublishedWork(id)).toBeNull();
  });

  it('重复拒绝是幂等的', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    // 幂等的判据是「第二次什么都没做」，光断言返回的 status='rejected' 分不出
    // 「原样返回」和「把整条路径又跑了一遍」—— 后者会对早就删掉的文件再 unlink
    // 一次、把 updated_at 重新盖一遍。所以这里盯住副作用：delete 一次都不许多调。
    const { storage } = await import('../../../server/storage/index.js');
    const spy = vi.spyOn(storage, 'delete');
    try {
      const first = await works.rejectWork(id);
      const callsAfterFirst = spy.mock.calls.length;
      expect(callsAfterFirst).toBe(2);

      const again = await works.rejectWork(id);
      expect(again.status).toBe('rejected');
      expect(spy.mock.calls.length).toBe(callsAfterFirst);
      expect(again.updatedAt).toBe(first.updatedAt);
    } finally {
      spy.mockRestore();
    }
  });

  it('记录在文件删完之前不会被改成 rejected（删文件必须排在改记录之前）', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    const { storage } = await import('../../../server/storage/index.js');
    // 把 delete 卡住不返回，在它悬着的时候读库，就能看出两步的先后：
    // 只有「先删文件」的实现才会在这一刻还停在 pending。反过来（先改记录）
    // 在这里就已经是 rejected 了 —— 而那正是「记录已改、进程崩在删文件之前」
    // 那种孤儿文件的成因。
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(storage, 'delete').mockImplementation(async () => { await gate; });

    const settled = works.rejectWork(id);
    await Promise.resolve();
    expect(works.listAllWorks()[0].status).toBe('pending');

    release();
    await settled;
    expect(works.listAllWorks()[0].status).toBe('rejected');
    spy.mockRestore();
  });

  it('文件删不掉时仍然标记 rejected（删失败只 warn，不把投稿永远卡在 pending）', async () => {
    const { works, paths } = await freshWorks();
    const id = await makePending(works);
    const { storage } = await import('../../../server/storage/index.js');
    const spy = vi.spyOn(storage, 'delete').mockRejectedValue(new Error('EIO (simulated)'));
    try {
      await expect(works.rejectWork(id)).resolves.toBeTruthy();
    } finally {
      spy.mockRestore();
    }
    // 反过来的风险更大：删失败就不标记，这条记录既不再需要人看（站点把它当
    // 已处理），文件又确实还在磁盘上 —— 一次磁盘抖动换来一个没人认领的孤儿文件。
    // 残留文件由人工/后续清理兜底，审核队列不该被磁盘抖动堵死。
    expect(works.listAllWorks()[0].status).toBe('rejected');
    expect(mediaFiles(paths)).toHaveLength(2);
  });

  it('没有文件的孤儿 pending 行也能拒绝（用户在图生成前就关掉了页面）', async () => {
    const { works, paths } = await freshWorks();
    const created = works.createSubmission({
      title: '半途而废', boardW: 50, boardH: 50, beanCount: 100,
      colorCount: 5, estimateMinutes: 30,
    }, CLIENT);
    // 磁盘上本来就什么都没有，删除必须幂等成功而不是抛错
    await expect(works.rejectWork(created.id)).resolves.toBeTruthy();
    expect(mediaFiles(paths)).toHaveLength(0);
    // 行还在：拒绝只改状态，彻底删除归 DELETE /api/admin/works/:id 负责。
    // 后台审核列表靠这一行把「未过审」「已拒绝」两个状态分开呈现。
    expect(works.listAllWorks()).toHaveLength(1);
    expect(works.listAllWorks()[0].status).toBe('rejected');
  });

  it('拒绝后 image_key 仍留在库里（审计线索），但公开接口拿不到它', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    const before = works.getPublishedWork(id);
    expect(before).toBeNull();
    const row = works.listAllWorks().find(r => r.id === id)!;
    await works.rejectWork(id);
    // 必须在 reject **之后**重读一行：拿 reject 前的快照去断言，等于什么都没验
    // ——reject 的 UPDATE 顺手把 image_key 抹成 '' 时，这个断言照样绿（评审实测过
    // 这个变异），而那正是 spec §11.4 明令不许做的事。
    const after = works.listAllWorks().find(r => r.id === id)!;
    expect(after.imageUrl).toMatch(/^\/media\/works\/.+\.png$/);
    expect(after.imageUrl).toBe(row.imageUrl);
    expect(works.getPublishedWork(id)).toBeNull();
  });
});

describe('上架不变量', () => {
  it('未过审的作品不能被上架', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    await expect(works.updateWorkMeta(id, { published: true })).rejects.toThrow(/审核/);
    expect(works.listAllWorks()[0].published).toBe(false);
  });

  it('已过审的作品可以正常下架与重新上架', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    works.approveWork(id);
    expect((await works.updateWorkMeta(id, { published: false })).published).toBe(false);
    expect((await works.updateWorkMeta(id, { published: true })).published).toBe(true);
  });

  it('pending 作品可以在审核前改名称（审核时随通过一起公开）', async () => {
    const { works } = await freshWorks();
    const id = await makePending(works);
    expect((await works.updateWorkMeta(id, { title: ' 改好的名字 ' })).title).toBe('改好的名字');
  });
});
