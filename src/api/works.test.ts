import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listWorks, fetchWork } from './works';

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
