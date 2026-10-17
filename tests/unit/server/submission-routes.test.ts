import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let tmp = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'submission-routes-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

async function bootApp() {
  const db = await import('../../../server/db.js');
  await db.initDb();
  const works = await import('../../../server/works.js');
  const { app } = await import('../../../server/index.js');
  return { app, works };
}

async function loginAdmin(app: unknown): Promise<string> {
  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  const admin = users.getUserByUsername('root')!;
  users.setUserPassword(admin.id, 'testpass1');
  const r = await request(app as never).post('/api/auth/login')
    .send({ username: 'root', password: 'testpass1' });
  const cookies = r.headers['set-cookie'] as unknown as string[];
  return cookies.map(c => c.split(';')[0]).join('; ');
}

/** 商户账号。用来把「403」和「401」分开断言 —— 两者都是拒绝，但含义不同：
 * 401 是「你没登录」，403 是「你登录了但不是管理员」。只测 401 的用例，
 * 在有人把两道守卫整体摘掉时不一定变红。 */
async function loginMerchant(app: unknown): Promise<string> {
  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  users.createUser({
    username: 'mike',
    password: 'pw1234',
    role: 'merchant',
    mustChangePassword: true,
  });
  const r = await request(app as never)
    .post('/api/auth/login')
    .send({ username: 'mike', password: 'pw1234' });
  const cookies = r.headers['set-cookie'] as unknown as string[];
  return cookies.map(c => c.split(';')[0]).join('; ');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46]);

const GOOD = {
  title: '粉色小熊', boardW: 87, boardH: 62,
  beanCount: 3814, colorCount: 42, estimateMinutes: 190,
};

describe('POST /api/public/works', () => {
  it('免登录创建投稿，返回 201 与令牌', async () => {
    const { app } = await bootApp();
    const r = await request(app).post('/api/public/works').send(GOOD);
    expect(r.status).toBe(201);
    expect(r.body.id).toBeGreaterThan(0);
    expect(r.body.uploadToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('参数非法返回 400 与中文文案', async () => {
    const { app } = await bootApp();
    const r = await request(app).post('/api/public/works').send({ ...GOOD, title: '  ' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('名称');
  });

  it('第 4 件投稿返回 429 与中文文案', async () => {
    const { app } = await bootApp();
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post('/api/public/works').send(GOOD);
      expect(ok.status).toBe(201);
    }
    const over = await request(app).post('/api/public/works').send(GOOD);
    expect(over.status).toBe(429);
    expect(over.body.error).toContain('投稿次数');
  });

  it('POST 后作品立刻不可见（还没审核）', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const list = await request(app).get('/api/public/works');
    expect(list.body.total).toBe(0);
    const detail = await request(app).get(`/api/public/works/${created.body.id}`);
    expect(detail.status).toBe(404);
  });
});

describe('POST /api/public/works/:id/image', () => {
  it('带令牌上传成功，返回 { ok, id }', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const r = await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken)
      .field('width', '1500')
      .field('height', '2200')
      .attach('image', PNG, 'image.png')
      .attach('thumb', WEBP, 'thumb.webp');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, id: created.body.id });
  });

  it('令牌不对返回 400，且没有文件落盘', async () => {
    const { app, works } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const r = await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', 'wrong')
      .attach('image', PNG, 'image.png');
    expect(r.status).toBe(400);

    // 「没有落盘」用两条互相独立的证据断言，而不是只看状态码：
    // (a) 该行的 imageUrl 与「同样没传过图的另一条投稿」逐字相等 —— 空 image_key 派生出
    //     的是 /media/ 这种占位前缀而不是 ''，写死占位串等于把测试绑在存储布局上；
    // (b) media/works/ 目录里一个文件都没有。
    const control = await request(app).post('/api/public/works').send({ ...GOOD, title: '对照行' });
    const rowOf = (id: number) => works.listAllWorks().find(w => w.id === id)!;
    const controlRow = rowOf(control.body.id);
    expect(rowOf(created.body.id).imageUrl).toBe(controlRow.imageUrl);
    const worksDir = join(tmp, 'media', 'works');
    expect(existsSync(worksDir) ? readdirSync(worksDir) : []).toEqual([]);

    // 正向对照：同一个 id + 真正的令牌能传上去，并真的改写了 imageUrl。
    // 少了这一步，「路由把 uploadToken 传空串」这种实现也能过：空串与错令牌在服务层
    // 落到同一条报错、同样不落盘、同样 400 —— 只断言失败态的用例会恒真。
    const ok = await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken)
      .attach('image', PNG, 'image.png');
    expect(ok.status).toBe(200);
    expect(rowOf(created.body.id).imageUrl).not.toBe(controlRow.imageUrl);
  });

  it('缺 image 字段返回 400', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const r = await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken);
    expect(r.status).toBe(400);
  });

  it('id 不存在返回 404', async () => {
    const { app } = await bootApp();
    const r = await request(app)
      .post('/api/public/works/99999/image')
      .field('uploadToken', 'x')
      .attach('image', PNG, 'image.png');
    expect(r.status).toBe(404);
  });

  // 匿名公网入口：格式不对必须是 400，不能让「用户传错文件」变成 500。
  // 注意这条目前是被 multer 的 fileFilter 挡下的（它已经只放行 jpeg/png/webp），
  // 真正保证「即使有请求绕过 fileFilter 也不 500」的是下面 isUnsupportedMimeError 那条。
  it('上传不被支持的图片格式返回 400 而不是 500', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const r = await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken)
      .attach('image', PNG, { filename: 'shot.gif', contentType: 'image/gif' });
    expect(r.status).toBe(400);
    expect(typeof r.body.error).toBe('string');
  });

  // 路由层的兜底判定：extFor 抛的是裸 Error（不是 SubmissionInputError），
  // 若不在这里翻译就会落到全局兜底变成 500。这条用例锁住「消息特征 → 400」的映射本身，
  // 免得它被当成多余代码删掉（fileFilter 挡住了不等于这条分支没有意义）。
  it('裸的 unsupported mime 错误被判为 400 类，其他错误不误判', async () => {
    await bootApp();
    const { isUnsupportedMimeError } = await import('../../../server/index.js');
    expect(isUnsupportedMimeError(new Error('unsupported image mime type'))).toBe(true);
    expect(isUnsupportedMimeError(new Error('unsupported thumb mime type'))).toBe(true);
    expect(isUnsupportedMimeError(new Error('storage put failed'))).toBe(false);
    expect(isUnsupportedMimeError(new Error('投稿不存在'))).toBe(false);
  });
});

describe('后台审核路由', () => {
  it('approve 需要 admin 登录，未登录 401', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const r = await request(app).post(`/api/admin/works/${created.body.id}/approve`);
    expect(r.status).toBe(401);
  });

  it('approve / reject 对非 admin 是 403，且不改动作品状态', async () => {
    const { app } = await bootApp();
    const merchant = await loginMerchant(app);
    const created = await request(app).post('/api/public/works').send(GOOD);
    const approve = await request(app)
      .post(`/api/admin/works/${created.body.id}/approve`)
      .set('Cookie', merchant);
    expect(approve.status).toBe(403);
    const reject = await request(app)
      .post(`/api/admin/works/${created.body.id}/reject`)
      .set('Cookie', merchant);
    expect(reject.status).toBe(403);
    // 守卫漏掉时状态会被改掉，所以再从公开侧断言一次「确实没改成已过审」
    expect((await request(app).get(`/api/public/works/${created.body.id}`)).status).toBe(404);
  });

  it('GET /api/admin/works?status=... 也要 admin 登录', async () => {
    const { app } = await bootApp();
    const created = await request(app).post('/api/public/works').send(GOOD);
    const anon = await request(app).get('/api/admin/works?status=pending');
    expect(anon.status).toBe(401);
    expect(anon.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id })]));
  });

  it('approve 之后作品进入公开列表', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const created = await request(app).post('/api/public/works').send(GOOD);
    await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken)
      .attach('image', PNG, 'image.png');

    const approve = await request(app)
      .post(`/api/admin/works/${created.body.id}/approve`)
      .set('Cookie', cookie);
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('approved');

    const list = await request(app).get('/api/public/works');
    expect(list.body.total).toBe(1);
    const detail = await request(app).get(`/api/public/works/${created.body.id}`);
    expect(detail.status).toBe(200);
    // 详情带四个图纸参数
    expect(detail.body.beanCount).toBe(3814);
    expect(detail.body.colorCount).toBe(42);
    expect(detail.body.boardW).toBe(87);
    expect(detail.body.estimateMinutes).toBe(190);
  });

  it('reject 之后详情 404，后台列表仍能看到该行并带 rejected', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const created = await request(app).post('/api/public/works').send(GOOD);
    await request(app)
      .post(`/api/public/works/${created.body.id}/image`)
      .field('uploadToken', created.body.uploadToken)
      .attach('image', PNG, 'image.png');

    const reject = await request(app)
      .post(`/api/admin/works/${created.body.id}/reject`)
      .set('Cookie', cookie);
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe('rejected');

    const detail = await request(app).get(`/api/public/works/${created.body.id}`);
    expect(detail.status).toBe(404);

    const adminList = await request(app).get('/api/admin/works').set('Cookie', cookie);
    expect(adminList.body[0].status).toBe('rejected');
    expect(adminList.body[0].published).toBe(false);
  });

  it('GET /api/admin/works?status=pending 只回待审', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const a = await request(app).post('/api/public/works').send({ ...GOOD, title: '甲' });
    const b = await request(app).post('/api/public/works').send({ ...GOOD, title: '乙' });
    await request(app).post(`/api/admin/works/${a.body.id}/approve`).set('Cookie', cookie);

    const only = await request(app).get('/api/admin/works?status=pending').set('Cookie', cookie);
    expect(only.body).toHaveLength(1);
    expect(only.body[0].title).toBe('乙');
    expect(only.body[0].id).toBe(b.body.id);
  });
});
