import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listWorks,
  fetchWork,
  likeWork,
  fetchLikeState,
  adminListWorks,
  createWorkSubmission,
  uploadSubmissionImage,
  adminApproveWork,
  adminRejectWork,
} from './works';

const mockFetch = vi.fn();

// ⚠️ stub 必须装在 beforeEach：装在 afterEach 的话，第一个用例跑的时候
// 还没有 fetch 替身，会真的发请求。
beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ok(body: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  });
}

/** 既有的 ok() 只造成功响应；这里补一个能造失败的，顺带覆盖错误文案透传 */
function fail(body: unknown, status = 429) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    statusText: 'Too Many Requests',
    json: async () => body,
  });
}

describe('listWorks', () => {
  it('默认拉第一页（带默认 limit / offset）', async () => {
    ok({ items: [], total: 0 });
    await listWorks();
    // 实现里 listWorks 始终拼 ?limit=&offset=（limit/offset 有默认值），
    // 所以这里是 /api/public/works?limit=20&offset=0，不是裸路径。
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/works?limit=20&offset=0',
      expect.anything()
    );
  });

  it('带上 limit / offset', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 40);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/works?limit=20&offset=40',
      expect.anything()
    );
  });

  it('带 credentials: include', async () => {
    ok({ items: [], total: 0 });
    await listWorks();
    expect(mockFetch.mock.calls[0][1]).toEqual({ credentials: 'include' });
  });

  it('失败时抛出后端 error 文案', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'query failed' }),
    });
    await expect(listWorks()).rejects.toThrow('query failed');
  });

  it('body 不是 JSON 时保留状态码原文', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(listWorks()).rejects.toThrow('404 Not Found');
  });
});

describe('fetchWork', () => {
  it('拉指定 id', async () => {
    ok({ id: 7 });
    await fetchWork(7);
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works/7', expect.anything());
  });
});

describe('listWorks 的搜索与排序参数', () => {
  it('不带 opts 时 URL 与旧版完全一致', async () => {
    ok({ items: [], total: 0 });
    await listWorks();
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works?limit=20&offset=0', expect.anything());
  });

  it('传 q 时拼进 query', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { q: '小熊' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/works?limit=20&offset=0&q=%E5%B0%8F%E7%86%8A',
      expect.anything()
    );
  });

  it('传 sort=hot 时拼进 query', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { sort: 'hot' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/works?limit=20&offset=0&sort=hot',
      expect.anything()
    );
  });

  it('显式传 sort=latest 时不拼 sort（latest 是默认值，与不传 opts 完全一致）', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { sort: 'latest' });
    // 断言的是「URL 里没有 sort」，不是「URL 里有 sort=latest」：实现把 latest
    // 归一为「不传」（service 端回落 latest），所以显式传 latest 必须与不传 opts
    // 拼出同一条 URL。这条钉住 listWorks 里 `opts.sort !== 'latest'` 那条 guard，
    // 去掉 guard 后 URL 变成 `...&sort=latest`，本用例变红。
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/works?limit=20&offset=0',
      expect.anything()
    );
  });

  it('q 为空串时不拼（避免 URL 里出现裸 q=）', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { q: '' });
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works?limit=20&offset=0', expect.anything());
  });

  it('q 与 sort 同时传', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { q: '熊', sort: 'hot' });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('q=%E7%86%8A');
    expect(url).toContain('sort=hot');
  });

  it('q 含空格与中文时正确编码', async () => {
    ok({ items: [], total: 0 });
    await listWorks(20, 0, { q: '粉 色' });
    const url = mockFetch.mock.calls[0][0] as string;
    // 空格编码成 `+` 而不是 `%20`：URLSearchParams 就是这个行为，
    // 两者都是 query string 的合法空格写法，Express req.query 解出来完全一样
    // （已实测 `+` 与 `%20` 都得到 '粉 色'），不必为迎合断言去手写 encodeURIComponent。
    expect(url).toContain('q=%E7%B2%89+%E8%89%B2');
    expect(() => new URL(url, 'http://x')).not.toThrow();
  });
});

describe('likeWork', () => {
  it('POST 到正确的 URL 且不带 body', async () => {
    ok({ ok: true, likes: 1, alreadyLiked: true });
    await likeWork(7);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/works/7/like',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('服务端报错时抛出其 error 文案', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({ error: 'too many likes, try again later' }),
    });
    await expect(likeWork(7)).rejects.toThrow('too many likes, try again later');
  });
});

describe('fetchLikeState', () => {
  it('GET 到正确的 URL', async () => {
    ok({ likes: 3, liked: true });
    await fetchLikeState(7);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/works/7/like',
      expect.objectContaining({ credentials: 'include' })
    );
    // 这条才是关键断言。服务端 /api/public/works/:id/like 上 GET 与 POST 同时注册
    // （server/index.ts:538 / :559），POST 是真写库的点赞接口 —— 一旦这里退化成
    // POST，用户每次进详情页就会自动点赞一次。
    //
    // 不能写 expect.objectContaining({ method: 'GET' })：实现刻意不带 method
    // 字段（fetch 不带 method 即 GET），那样断言会与实现不符。也不能用
    // expect.anything()：那是恒真断言，完全约束不到 method，正是「GET 变 POST
    // 仍然全绿」的根因。所以这里断言 init 上没有 method。
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBeUndefined();
  });

  it('返回 liked=false 也算成功', async () => {
    ok({ likes: 3, liked: false });
    await expect(fetchLikeState(7)).resolves.toEqual({ likes: 3, liked: false });
  });
});

describe('投稿两步', () => {
  it('第一步 POST JSON 到 /api/public/works', async () => {
    ok({ id: 7, uploadToken: 'abc' });
    const r = await createWorkSubmission({
      title: '粉色小熊', boardW: 87, boardH: 62,
      beanCount: 3814, colorCount: 42, estimateMinutes: 190,
    });
    expect(r).toEqual({ id: 7, uploadToken: 'abc' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/public/works');
    expect(init.method).toBe('POST');
    // method 与 Content-Type 两条各自都能拦住「字段被删」，但都拦不住
    // credentials 被删 —— 那时 init 照样有 method 和 headers，上面两条照样绿。
    // 所以这里补第三条：整个 init 的形状被钉住，任何一个键被摘掉都会红。
    // 它本身不承载安全含义（投稿配额按 IP + UA 算，不看 cookie），钉它只是为了
    // 让「整个 init 被重写」这种改动有地方冒头。
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('application/json');
    // JSON.parse 而不是字符串比对：字段顺序、空白都不该让用例变红，
    // 而少一个字段、多一个字段一定会红。
    expect(JSON.parse(init.body)).toEqual({
      title: '粉色小熊', boardW: 87, boardH: 62,
      beanCount: 3814, colorCount: 42, estimateMinutes: 190,
    });
  });

  it('第二步用 multipart 带上令牌、图片、缩略图与尺寸', async () => {
    ok({ ok: true, id: 7 });
    await uploadSubmissionImage(7, 'tok', new Blob(['x'], { type: 'image/png' }), {
      thumb: new Blob(['y'], { type: 'image/webp' }),
      width: 1500, height: 2200,
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/public/works/7/image');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    // multipart 请求刻意不带 Content-Type：boundary 必须由 fetch 自己生成，
    // 手写一个 application/json（或 multipart/form-data 但没有 boundary）会把
    // boundary 抹掉，服务端 multer 直接解析不出文件。缺 headers 这条断言就钉它。
    expect(init.headers).toBeUndefined();
    const fd = init.body as FormData;
    expect(fd.get('uploadToken')).toBe('tok');
    expect(fd.get('width')).toBe('1500');
    expect(fd.get('height')).toBe('2200');
    expect(fd.get('image')).toBeInstanceOf(Blob);
    expect(fd.get('thumb')).toBeInstanceOf(Blob);
    // 字段名是服务端硬编码的那几个（server/index.ts 的 SUBMISSION_IMAGE_FIELDS
    // 与 req.body.uploadToken），改任何一个名字都会让服务端读不到值。
    // 刻意不断言 append 时的文件名 'image.png' / 'thumb.webp'：后台上传通道在
    // Task 7 拆掉之后服务端已改成按 part 的 mime 判类型（server/index.ts 的
    // fileFilter 看 mimetype，works.ts 用 EXT_BY_MIME 派生落盘扩展名），
    // 文件名不再被读，断言它只会把用例变成对装饰性字面量的守门。
  });

  it('第二步没有缩略图时不发 thumb 字段（而不是发一个空 Blob）', async () => {
    ok({ ok: true, id: 7 });
    await uploadSubmissionImage(7, 'tok', new Blob(['x'], { type: 'image/png' }));
    const fd = mockFetch.mock.calls[0][1].body as FormData;
    // FormData.get 对不存在的字段返回 null（不是抛错、也不是空串，已实测）。
    // 所以这条能真的抓住「无条件 fd.append('thumb', ...)」那个变异。
    expect(fd.get('thumb')).toBeNull();
  });

  it('没有缩略图时仍带得出尺寸', async () => {
    ok({ ok: true, id: 7 });
    await uploadSubmissionImage(7, 'tok', new Blob(['x'], { type: 'image/png' }), {
      width: 1500,
    });
    const fd = mockFetch.mock.calls[0][1].body as FormData;
    expect(fd.get('width')).toBe('1500');
    // height 走的是 `!= null` 而不是真值判断：不传就是 undefined 不发，
    // 但显式传 0 也应该发出去（宽度 0 的图不存在，可那不是客户端该替服务端做的决定）。
    expect(fd.get('height')).toBeNull();
  });

  it('服务端返回的错误文案原样抛出来（中文提示，不是英文原文）', async () => {
    fail({ error: '今天的投稿次数已用完，明天再来吧' });
    await expect(createWorkSubmission({ title: 'x' } as never))
      .rejects.toThrow('今天的投稿次数已用完，明天再来吧');
  });

  it('body 不是 JSON 时退回状态码原文', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(createWorkSubmission({ title: 'x' } as never))
      .rejects.toThrow('502 Bad Gateway');
  });
});

describe('后台审核动作', () => {
  it('approve 打 POST /api/admin/works/:id/approve', async () => {
    ok({ id: 3, status: 'approved' });
    await adminApproveWork(3);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/works/3/approve');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('reject 打 POST /api/admin/works/:id/reject', async () => {
    ok({ id: 3, status: 'rejected' });
    await adminRejectWork(3);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/works/3/reject');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('通过 / 拒绝把带审核态的整条记录原样带回来', async () => {
    // 审核后界面要立刻把这一行挪到「作品集」并刷新上下架开关，靠的是响应里
    // 的 status 与 published，而不是本地猜。少转一个字段，界面就会拿旧数据继续画。
    ok({ id: 3, status: 'approved', published: true });
    await expect(adminApproveWork(3)).resolves.toEqual({
      id: 3, status: 'approved', published: true,
    });
  });
});

describe('后台作品列表的审核态过滤', () => {
  it('不传 status 时 URL 与改动前完全一致（不带 query）', async () => {
    ok([]);
    await adminListWorks();
    // 钉的是「一个 query 都不拼」。实现里多写一个 `?` 或 `?status=` 都会红，
    // 那样等于给后台列表凭空换掉一个契约（服务端把空串归一为「全部」，
    // 但那是服务端的兜底，不该由客户端去依赖它）。
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/works');
  });

  it('传 status 时拼进 query', async () => {
    ok([]);
    await adminListWorks('pending');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/works?status=pending');
  });

  it('三个审核态都原样透传，不做客户端白名单改写', async () => {
    for (const s of ['pending', 'approved', 'rejected'] as const) {
      mockFetch.mockReset();
      ok([]);
      await adminListWorks(s);
      expect(mockFetch.mock.calls[0][0]).toBe(`/api/admin/works?status=${s}`);
    }
  });

  it('带 credentials: include', async () => {
    ok([]);
    await adminListWorks();
    expect(mockFetch.mock.calls[0][1]).toEqual({ credentials: 'include' });
  });
});

