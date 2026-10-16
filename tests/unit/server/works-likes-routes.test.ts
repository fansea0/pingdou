import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let tmp = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'works-likes-routes-'));
  process.env.PINGDOU_DATA_DIR = tmp;
  // 关键：令牌桶 likeBuckets 是 server/index.ts 的模块级 Map，vi.resetModules()
  // 之后 server/index.js 会被重新求值，桶随之清空 —— 否则「同一 IP 1 秒内第二次
  // POST 返回 429」会吃到上一个用例留下的时间戳而假红。
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * XFF 是后端取真实 IP 的唯一来源，nginx 必须传（docs 有说明）。
 *
 * 形状与 brief 不同（brief 写的是 `asIp(app, request(app), ip)` 后再 `.post()`）：
 * supertest 的 `request(app)` 返回的是 **TestAgent**（只有 get/post/... 方法），
 * 拿不到 `.set()`，brief 那种写法会直接 `req.set is not a function`。
 * 所以这里把 header 注入收进 helper，调用点变成 `asIp(app, ip).post(url)`。
 */
function asIp(app: unknown, ip: string) {
  const agent = request(app as never);
  return {
    post: (url: string) => agent.post(url).set('X-Forwarded-For', ip),
    get: (url: string) => agent.get(url).set('X-Forwarded-For', ip),
  };
}

describe('POST /api/public/works/:id/like', () => {
  it('首次点赞返回 alreadyLiked=true、likes=1', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: PNG, mime: 'image/png' },
    });
    const r = await asIp(app, '1.1.1.1')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, likes: 1, alreadyLiked: true });
  });

  it('同 IP 重复点赞：alreadyLiked=false 且 likes 不变', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: PNG, mime: 'image/png' },
    });
    await asIp(app, '1.1.1.1').post(`/api/public/works/${w.id}/like`);
    // 第二次 POST 会撞令牌桶（429），先等过 1 秒窗口再验证 DB 幂等
    await new Promise(r => setTimeout(r, 1050));
    const r = await asIp(app, '1.1.1.1')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.body).toEqual({ ok: true, likes: 1, alreadyLiked: false });
  });

  it('不同 IP 各计一次', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: PNG, mime: 'image/png' },
    });
    await asIp(app, '1.1.1.1').post(`/api/public/works/${w.id}/like`);
    const r = await asIp(app, '2.2.2.2')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.body.likes).toBe(2);
  });

  it('草稿点赞返回 404（不给草稿刷数的入口）', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', published: false,
      image: { body: PNG, mime: 'image/png' },
    });
    const r = await asIp(app, '1.1.1.1')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.status).toBe(404);
  });

  it('不存在的 id 返回 404', async () => {
    const { app } = await bootApp();
    const r = await asIp(app, '1.1.1.1')
      .post('/api/public/works/999999/like');
    expect(r.status).toBe(404);
  });

  it('不需要登录即可点赞（公开功能）', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: PNG, mime: 'image/png' },
    });
    const r = await asIp(app, '1.1.1.1')
      .post(`/api/public/works/${w.id}/like`);
    expect(r.status).toBe(200);
  });
});

describe('GET /api/public/works/:id/like', () => {
  it('返回当前 IP 的点赞状态，不改变计数', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: PNG, mime: 'image/png' },
    });
    await asIp(app, '1.1.1.1').post(`/api/public/works/${w.id}/like`);
    const r = await asIp(app, '1.1.1.1')
      .get(`/api/public/works/${w.id}/like`);
    expect(r.body).toEqual({ likes: 1, liked: true });
    // 再读一次，确认读操作没有副作用
    const again = await asIp(app, '1.1.1.1')
      .get(`/api/public/works/${w.id}/like`);
    expect(again.body.likes).toBe(1);
  });

  it('别的 IP 看到 liked=false 但 likes 是总数', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: PNG, mime: 'image/png' },
    });
    await asIp(app, '1.1.1.1').post(`/api/public/works/${w.id}/like`);
    const r = await asIp(app, '9.9.9.9')
      .get(`/api/public/works/${w.id}/like`);
    expect(r.body).toEqual({ likes: 1, liked: false });
  });

  // 护栏：like 路由必须注册在 /:id 之后。若注册在前，`:id` 会把字面量 "like"
  // 当成 id 吃掉，Number('like') = NaN → 一律 404，看起来像「路由不存在」。
  it('GET 路由也必须注册在 :id 之后（草稿 404、不存在的 id 404）', async () => {
    const { app, works } = await bootApp();
    const draft = await works.createWork({
      title: 'D', published: false, image: { body: PNG, mime: 'image/png' },
    });
    expect((await asIp(app, '1.1.1.1')
      .get(`/api/public/works/${draft.id}/like`)).status).toBe(404);
    expect((await asIp(app, '1.1.1.1')
      .get('/api/public/works/999999/like')).status).toBe(404);
  });
});

describe('令牌桶限流', () => {
  it('同一 IP 1 秒内第二次 POST 返回 429', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: PNG, mime: 'image/png' },
    });
    const first = await asIp(app, '5.5.5.5')
      .post(`/api/public/works/${w.id}/like`);
    expect(first.status).toBe(200);
    const second = await asIp(app, '5.5.5.5')
      .post(`/api/public/works/${w.id}/like`);
    expect(second.status).toBe(429);
  });

  it('429 时不产生任何 DB 写入', async () => {
    const { app, works } = await bootApp();
    const db = await import('../../../server/db.js');
    const w = await works.createWork({
      title: 'A', image: { body: PNG, mime: 'image/png' },
    });
    await asIp(app, '6.6.6.6').post(`/api/public/works/${w.id}/like`);
    const before = db.queryAll('SELECT * FROM work_likes').length;
    await asIp(app, '6.6.6.6').post(`/api/public/works/${w.id}/like`);
    const after = db.queryAll('SELECT * FROM work_likes').length;
    expect(after).toBe(before);
  });

  it('不同 IP 互不影响（桶按 IP 分开）', async () => {
    const { app, works } = await bootApp();
    const w = await works.createWork({
      title: 'A', image: { body: PNG, mime: 'image/png' },
    });
    const a = await asIp(app, '7.7.7.7')
      .post(`/api/public/works/${w.id}/like`);
    const b = await asIp(app, '8.8.8.8')
      .post(`/api/public/works/${w.id}/like`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

describe('列表接口透传 q / sort', () => {
  it('?q= 过滤生效', async () => {
    const { app, works } = await bootApp();
    await works.createWork({ title: '粉色小熊', image: { body: PNG, mime: 'image/png' } });
    await works.createWork({ title: '蓝色小猪', image: { body: PNG, mime: 'image/png' } });
    const r = await request(app as never).get('/api/public/works?q=小熊');
    expect(r.body.total).toBe(1);
  });

  it('?sort=hot 按点赞排序', async () => {
    const { app, works } = await bootApp();
    const a = await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    const b = await works.createWork({ title: 'B', image: { body: PNG, mime: 'image/png' } });
    const h = works.ipHashOf;
    works.addLike(a.id, h('1')); works.addLike(a.id, h('2'));
    works.addLike(b.id, h('1'));
    const r = await request(app as never).get('/api/public/works?sort=hot');
    expect(r.body.items[0].title).toBe('A');
  });

  it('列表每项都带 likes', async () => {
    const { app, works } = await bootApp();
    const a = await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    works.addLike(a.id, works.ipHashOf('1'));
    const r = await request(app as never).get('/api/public/works');
    expect(r.body.items[0].likes).toBe(1);
  });

  it('草稿不出现在列表里', async () => {
    const { app, works } = await bootApp();
    await works.createWork({ title: '草稿', published: false, image: { body: PNG, mime: 'image/png' } });
    const r = await request(app as never).get('/api/public/works');
    expect(r.body.total).toBe(0);
  });

  // 护栏：sort 必须是白名单，不能「任意值都当 hot」也不「任意值都当 latest」。
  // 非法值回落 latest，这条钉住回落方向。
  it('sort 非法值回落 latest（不落 hot）', async () => {
    const { app, works } = await bootApp();
    const a = await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    await works.createWork({ title: 'B', image: { body: PNG, mime: 'image/png' } });
    // B 后建 → latest 下 B 在前；给 A 两个赞，hot 下 A 在前
    works.addLike(a.id, works.ipHashOf('1'));
    works.addLike(a.id, works.ipHashOf('2'));
    const r = await request(app as never).get('/api/public/works?sort=hots');
    expect(r.body.items.map((i: { title: string }) => i.title)).toEqual(['B', 'A']);
  });

  // 默认 limit 从 20 改成 10：一次最多渲染 10 条。
  it('默认每页 10 条', async () => {
    const { app, works } = await bootApp();
    for (let i = 0; i < 12; i++) {
      await works.createWork({ title: `W${i}`, image: { body: PNG, mime: 'image/png' } });
    }
    const r = await request(app as never).get('/api/public/works');
    expect(r.body.total).toBe(12);
    expect(r.body.items).toHaveLength(10);
  });

  it('?limit=（空串）也走默认值 10', async () => {
    const { app, works } = await bootApp();
    for (let i = 0; i < 12; i++) {
      await works.createWork({ title: `W${i}`, image: { body: PNG, mime: 'image/png' } });
    }
    const r = await request(app as never).get('/api/public/works?limit=');
    expect(r.body.items).toHaveLength(10);
  });
});
