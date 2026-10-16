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

  // I-2 护栏：令牌桶必须排在 404 检查**之前**。排在后面时，同一 IP 连打不存在的
  // id 会一路穿透到 DB（每次一条 getPublishedWork 的 SQL），而且**永远拿不到 429**
  // ——评审实测 12 次全 404、零 429，那是一条真能刷库的路径。
  it('不存在的 id 也吃令牌：同 IP 第二次返回 429 而不是 404', async () => {
    const { app } = await bootApp();
    const first = await asIp(app, '4.4.4.4')
      .post('/api/public/works/999999/like');
    expect(first.status).toBe(404); // 首次仍然如实告诉调用方「没这个作品」
    const second = await asIp(app, '4.4.4.4')
      .post('/api/public/works/999999/like');
    expect(second.status).toBe(429); // 第二次被频率闸拦下，不进 DB
  });

  // I-1 护栏：429 时不该有任何 SQL 发出去。用「另一张图」观察不到「读 SQL」，
  // 所以这里换成草稿 id —— 命中 404 分支必然先跑 getPublishedWork 的 SELECT。
  // 桶在 404 之前时，第二次请求压根走不到 getPublishedWork：行数不变只能说明
  // 「addLike 没写」，配合上面的 429 断言才把「读也没发生」钉住。
  it('草稿点赞同 IP 第二次 429（读路径也被频率闸挡在前面）', async () => {
    const { app, works } = await bootApp();
    const db = await import('../../../server/db.js');
    const draft = await works.createWork({
      title: 'D', published: false, image: { body: PNG, mime: 'image/png' },
    });
    expect((await asIp(app, '4.4.4.5')
      .post(`/api/public/works/${draft.id}/like`)).status).toBe(404);
    const second = await asIp(app, '4.4.4.5')
      .post(`/api/public/works/${draft.id}/like`);
    expect(second.status).toBe(429);
    expect(db.queryAll('SELECT * FROM work_likes').length).toBe(0);
  });
});

describe('allowLike 纯函数边界（M-4）', () => {
  // allowLike 已导出且带 now 参数，本该直接单测 —— 之前 19 条用例全走 HTTP，
  // 「now-last 恰好 1000」「清理阈值 4096」「TTL 10 秒」这些边界只靠人读代码。
  async function allow() {
    const mod = await import('../../../server/index.js');
    return mod.allowLike;
  }

  it('首次放行；now-last 为 999 时拒绝、恰好 1000 时放行', async () => {
    const allowLike = await allow();
    const t0 = 1_700_000_000_000;
    expect(allowLike('ip-a', t0)).toBe(true);
    expect(allowLike('ip-a', t0 + 999)).toBe(false);
    expect(allowLike('ip-a', t0 + 1000)).toBe(true);
  });

  it('不同 IP 互不影响', async () => {
    const allowLike = await allow();
    const t0 = 1_700_000_000_000;
    expect(allowLike('ip-a', t0)).toBe(true);
    expect(allowLike('ip-b', t0)).toBe(true);
    expect(allowLike('ip-a', t0 + 10)).toBe(false);
    expect(allowLike('ip-b', t0 + 10)).toBe(false);
  });

  // I-4：桶超过 4096 条会走进扫描分支。
  //
  // **这条用例证明不了「真的删掉了过期条目」，也证明不了节流生效** —— 不是漏写，是
  // 结构上观测不到：只有「比上次早 10 秒以上」的条目会被删，而早 10 秒的条目早就落在
  // 1 秒窗口之外，删与不删 allowLike 的返回值都是 true。删除的效果只体现在内存上，
  // 要观测就得导出 likeBuckets 或统计遍历次数，那是为测试改产品形状，不做。
  // 这里能钉住的是「超过阈值时这条分支被走到、返回值仍自洽、不抛异常」。
  it('桶超过 4096 条时走扫描分支，返回值仍自洽', async () => {
    const allowLike = await allow();
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 4097; i++) allowLike(`bulk-${i}`, t0);

    // 这一发让 size 越过阈值、且与 lastSweepAt(0) 相隔 >1 秒 → 走扫描。
    expect(allowLike('trigger', t0 + 20_000)).toBe(true);
    expect(allowLike('trigger', t0 + 20_000 + 999)).toBe(false); // 刚戳过，仍被限
    expect(allowLike('trigger', t0 + 20_000 + 1000)).toBe(true);
    // 桶里早就塞满的老条目不应把后续判定搞坏
    expect(allowLike('bulk-0', t0 + 30_000)).toBe(true);
  });

  // 未超过阈值时不做全量扫描（扫描纯属浪费：条目少时 Map 不会失控）。
  it('未超过 4096 条时不走扫描分支', async () => {
    const allowLike = await allow();
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 10; i++) allowLike(`small-${i}`, t0);
    // 一分钟后再来一发，行为不变（这条只覆盖「阈值以下」这条分支，不试图观测扫描）。
    expect(allowLike('small-0', t0 + 60_000)).toBe(true);
    expect(allowLike('small-1', t0 + 60_000)).toBe(true);
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

  // 打卡时的假设是「顺序错了 → :id 吞掉 like → 全 404」。实测（变异验证 M5）这个
  // 假设不成立：Express 5 按整段匹配，`:id` 只吃一段，`/:id` 根本匹配不到 `/:id/like`，
  // 把 like 路由挪到 :id 之前 19 条用例照样全绿。所以这条用例钉的是**真正的不变量**
  // —— GET like 对草稿与不存在的 id 都得 404（读操作也走 getPublishedWork 校验）。
  it('GET like 对草稿与不存在的 id 都返回 404', async () => {
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
    const a = await works.createWork({ title: 'A', image: { body: PNG, mime: 'image/png' } });
    const b = await works.createWork({ title: 'B', image: { body: PNG, mime: 'image/png' } });
    await asIp(app, '6.6.6.6').post(`/api/public/works/${a.id}/like`);
    const before = db.queryAll('SELECT * FROM work_likes').length;
    // 第二次必须打**另一张**作品：同图重复点赞靠复合主键幂等，有没有 429 都不新增行，
    // 那样这条断言对「限流闸被摘掉」是零判别力（已实测：变异 1/2 下它照样绿）。
    const second = await asIp(app, '6.6.6.6').post(`/api/public/works/${b.id}/like`);
    expect(second.status).toBe(429);
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

  // M-1 护栏：`?limit=abc` → Number 得 NaN，不收口就会落进数据层陈旧的 `: 20` 兜底，
  // 把「默认 10」的口径绕过去（评审实测返回 20 条）。
  it('?limit=abc 非法值也回落 10（不被数据层的 20 兜底绕过）', async () => {
    const { app, works } = await bootApp();
    for (let i = 0; i < 12; i++) {
      await works.createWork({ title: `W${i}`, image: { body: PNG, mime: 'image/png' } });
    }
    const r = await request(app as never).get('/api/public/works?limit=abc');
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
