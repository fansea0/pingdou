import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listWorks, fetchWork, likeWork, fetchLikeState } from './works';

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
    expect(mockFetch).toHaveBeenCalledWith('/api/public/works/7/like', expect.anything());
  });

  it('返回 liked=false 也算成功', async () => {
    ok({ likes: 3, liked: false });
    await expect(fetchLikeState(7)).resolves.toEqual({ likes: 3, liked: false });
  });
});
