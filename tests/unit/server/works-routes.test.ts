import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let tmp = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'works-routes-'));
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
  const paths = await import('../../../server/paths.js');
  const works = await import('../../../server/works.js');
  const { app } = await import('../../../server/index.js');
  return { app, paths, works };
}

/** 起一个已登录的 admin 会话，拿 cookie 用 */
async function loginAdmin(app: unknown): Promise<string> {
  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  const admin = users.getUserByUsername('root')!;
  users.setUserPassword(admin.id, 'testpass1');
  const r = await request(app as never)
    .post('/api/auth/login')
    .send({ username: 'root', password: 'testpass1' });
  expect(r.status).toBe(200);
  const cookies = r.headers['set-cookie'] as unknown as string[];
  return cookies.map(c => c.split(';')[0]).join('; ');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('GET /api/public/works', () => {
  it('无需登录即可拿到已上架作品', async () => {
    const { app, works } = await bootApp();
    await works.createWork({ title: '小熊', image: { body: PNG, mime: 'image/png' } });
    const r = await request(app).get('/api/public/works');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.items[0].title).toBe('小熊');
    expect(r.body.items[0].thumbUrl).toMatch(/^\/media\/works\/[0-9a-f]{16}\.png$/);
  });

  it('limit / offset 生效', async () => {
    const { app, works } = await bootApp();
    for (const t of ['A', 'B', 'C']) {
      await works.createWork({ title: t, image: { body: PNG, mime: 'image/png' } });
    }
    const r = await request(app).get('/api/public/works?limit=2&offset=1');
    expect(r.body.items).toHaveLength(2);
    expect(r.body.total).toBe(3);
  });
});

describe('GET /api/public/works/:id', () => {
  it('返回详情含 imageUrl', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({ title: 'A', description: 'd', image: { body: PNG, mime: 'image/png' } });
    const r = await request(app).get(`/api/public/works/${w.id}`);
    expect(r.status).toBe(200);
    expect(r.body.imageUrl).toBe(w.imageUrl);
    expect(r.body.description).toBe('d');
  });

  it('草稿返回 404（不区分不存在与未上架）', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({ published: false, image: { body: PNG, mime: 'image/png' } });
    expect((await request(app).get(`/api/public/works/${w.id}`)).status).toBe(404);
    expect((await request(app).get('/api/public/works/99999')).status).toBe(404);
  });

  it('非数字 id 返回 404 而不是 500', async () => {
    const { app } = await bootApp();
    expect((await request(app).get('/api/public/works/abc')).status).toBe(404);
  });
});

describe('GET /media/works/:filename', () => {
  it('合法文件名正常返回 PNG', async () => {
    const { app, paths } = await bootApp();
    mkdirSync(join(paths.PATHS.mediaDir, 'works'), { recursive: true });
    writeFileSync(join(paths.PATHS.mediaDir, 'works', 'aabbccddeeff0011.png'), PNG);
    const r = await request(app).get('/media/works/aabbccddeeff0011.png');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/image\/png/);
  });

  it('合法缩略图文件名正常返回', async () => {
    const { app, paths } = await bootApp();
    mkdirSync(join(paths.PATHS.mediaDir, 'works'), { recursive: true });
    writeFileSync(join(paths.PATHS.mediaDir, 'works', 'aabbccddeeff0011-t.webp'), PNG);
    const r = await request(app).get('/media/works/aabbccddeeff0011-t.webp');
    expect(r.status).toBe(200);
  });

  it('文件不存在返回 404', async () => {
    const { app } = await bootApp();
    expect((await request(app).get('/media/works/0000000000000000.png')).status).toBe(404);
  });

  it('非法文件名一律 400，不落到 sendFile', async () => {
    const { app } = await bootApp();
    for (const bad of ['..%2F..%2Fetc%2Fpasswd.png', 'nothex.png', 'aabbccddeeff0011.exe']) {
      expect((await request(app).get(`/media/works/${bad}`)).status).toBe(400);
    }
  });
});

describe('admin 作品接口', () => {
  it('未登录一律 401', async () => {
    const { app } = await bootApp();
    expect((await request(app).post('/api/admin/works')).status).toBe(401);
    expect((await request(app).get('/api/admin/works')).status).toBe(401);
  });

  it('创建作品：multipart 带 file + thumb + 文本字段', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const r = await request(app)
      .post('/api/admin/works')
      .set('Cookie', cookie)
      .field('title', '上传的作品')
      .field('description', '描述')
      .field('width', '800')
      .field('height', '600')
      .field('published', '1')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .attach('thumb', PNG, { filename: 'a.webp', contentType: 'image/webp' });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('上传的作品');
    expect(r.body.width).toBe(800);
    expect(r.body.thumbUrl).toMatch(/-t\.webp$/);
  });

  it('创建作品：只有 file 也行（无缩略图降级）', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const r = await request(app)
      .post('/api/admin/works')
      .set('Cookie', cookie)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(r.status).toBe(200);
    expect(r.body.thumbUrl).toBe(r.body.imageUrl);
  });

  it('创建作品：缺 file 返回 400', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const r = await request(app).post('/api/admin/works').set('Cookie', cookie).field('title', 'x');
    expect(r.status).toBe(400);
  });

  it('创建作品：published=0 存为草稿', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const r = await request(app)
      .post('/api/admin/works')
      .set('Cookie', cookie)
      .field('published', '0')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(r.status).toBe(200);
    expect((await request(app).get(`/api/public/works/${r.body.id}`)).status).toBe(404);
    const list = await request(app).get('/api/admin/works').set('Cookie', cookie);
    expect(list.body).toHaveLength(1);
  });

  it('改元数据 / 换图 / 删除', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    const created = await request(app)
      .post('/api/admin/works')
      .set('Cookie', cookie)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });

    const put = await request(app)
      .put(`/api/admin/works/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ title: '改过的标题' });
    expect(put.status).toBe(200);
    expect(put.body.title).toBe('改过的标题');

    const img = await request(app)
      .post(`/api/admin/works/${created.body.id}/image`)
      .set('Cookie', cookie)
      .attach('file', PNG, { filename: 'b.webp', contentType: 'image/webp' });
    expect(img.status).toBe(200);
    expect(img.body.imageUrl).not.toBe(created.body.imageUrl);

    const del = await request(app).delete(`/api/admin/works/${created.body.id}`).set('Cookie', cookie);
    expect(del.status).toBe(200);
    expect((await request(app).get('/api/admin/works').set('Cookie', cookie)).body).toHaveLength(0);
  });

  it('删除不存在的作品返回 404', async () => {
    const { app } = await bootApp();
    const cookie = await loginAdmin(app);
    expect((await request(app).delete('/api/admin/works/99999').set('Cookie', cookie)).status).toBe(404);
  });
});
