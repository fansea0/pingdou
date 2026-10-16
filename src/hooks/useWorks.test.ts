import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { useWorks } from './useWorks';

const listWorks = vi.fn();

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return { ...actual, listWorks: (...a: unknown[]) => listWorks(...a) };
});

// 字段严格对齐 WorkSummary：夹具里多写几个后端根本不返回的字段（如 imageUrl）
// 不会让测试变红，只会让「这条数据长什么样」在测试里说谎。
const item = (id: number, title: string, likes = 0) => ({
  id,
  title,
  thumbUrl: '/a.png',
  width: 800,
  height: 1000,
  createdAt: 1_700_000_000_000 + id,
  likes,
});

beforeEach(() => {
  listWorks.mockReset();
  listWorks.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
  // 用例里混了真/假定时器，统一在 afterEach 还原：某个用例中途抛错时
  // 假定时器会漏到下一个用例，报出一堆看不懂的 timeout。
  vi.useRealTimers();
  vi.clearAllMocks();
});

// 等一次「防抖后的搜索请求真的发出去了」。
//
// 不用 `await act(async () => { await sleep(350) })`：那个 350ms 是从 act 进去
// 那一刻开始算的，而 setQuery 的渲染可能要等到 act 让出控制权才落到 hook 上
// （外层 waitFor 自己就包着 async act）。两者错开时，350ms 根本不够防抖的
// 300ms，请求发不出去，用例就变成「随机红」。waitFor 等的是可观察结果，
// 不依赖这些内部时序。
const waitForSearch = async (assertion: () => void) => {
  await waitFor(assertion, { timeout: 3000 });
};

describe('useWorks 默认行为', () => {
  it('首屏用 latest、不带 q', async () => {
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '', sort: 'latest' });
  });

  it('query/sort 初值是默认值', async () => {
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.query).toBe('');
    expect(result.current.sort).toBe('latest');
  });

  it('顺序完全以服务端返回为准，不按 likes 重排', async () => {
    // 钉住「排名不实时变化」这条产品约束：点赞只改数字，不改位置。
    // 这里故意让 B 的 likes 最低且在中间 —— 任何按 likes 排序的实现
    // 都会把它挪到末尾，断言立刻炸。
    listWorks.mockResolvedValue({
      items: [item(1, 'A', 10), item(2, 'B', 0), item(3, 'C', 5)],
      total: 3,
    });
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.items.map(i => i.title)).toEqual(['A', 'B', 'C']);
  });
});

describe('搜索防抖', () => {
  it('setQuery 后 300ms 内不立即发请求', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorks());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    listWorks.mockClear();

    act(() => { result.current.setQuery('小'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(listWorks).not.toHaveBeenCalled();   // 还没到 300ms

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(listWorks).toHaveBeenCalledTimes(1);
    expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '小', sort: 'latest' });
  });

  it('连续输入只发最后一次（不是每个字一次）', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorks());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    listWorks.mockClear();

    act(() => { result.current.setQuery('小'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => { result.current.setQuery('小熊'); });

    // 关键的一步：走到 t=350，「小」那个定时器（排在 t=300）早就该到点了。
    // effect 的 cleanup 若没把它清掉，这里就会冒出一个 q='小' 的请求 ——
    // 只在最后断言「总共 1 次」是抓不到的：三个到点的 setState 被同一个 act
    // 批处理掉了，中间那次请求根本发不出去。
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(listWorks).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(listWorks).toHaveBeenCalledTimes(1);
    expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '小熊', sort: 'latest' });
  });

  it('query 立刻反映到返回值上（防抖的是请求，不是输入框）', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorks());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    act(() => { result.current.setQuery('小'); });
    expect(result.current.query).toBe('小');
  });
});

describe('乱序防护（核心）', () => {
  it('先发的请求后到，不能覆盖新结果', async () => {
    const deferreds: Array<{ resolve: (v: unknown) => void }> = [];
    listWorks.mockImplementation(() => new Promise(res => deferreds.push({ resolve: res })));

    const { result } = renderHook(() => useWorks());
    await act(async () => {});                     // 触发首屏
    expect(deferreds).toHaveLength(1);

    act(() => { result.current.setQuery('新词'); });
    await waitForSearch(() => expect(deferreds).toHaveLength(2));

    // 先让「后发」的第二个请求返回
    await act(async () => {
      deferreds[1]!.resolve({ items: [item(2, '新结果')], total: 1 });
    });
    expect(result.current.items.map(i => i.title)).toEqual(['新结果']);

    // 再让「先发但后到」的第一个请求返回 —— 它必须被丢弃
    await act(async () => {
      deferreds[0]!.resolve({ items: [item(1, '旧结果')], total: 99 });
    });
    expect(result.current.items.map(i => i.title)).toEqual(['新结果']);
    expect(result.current.total).toBe(1);
  });

  // 上面那条用例靠 effect cleanup 的 cancelled 标志就足以通过 —— 首屏 effect
  // 每次重跑都会把上一次的 cancelled 置真，序号在这里并没有额外的判别力。
  // 真正只有序号能挡的是 loadMore：它不在 effect 里，没有任何 cleanup 罩着，
  // 「用户翻页途中改了搜索词」时，旧搜索词的那一页只有靠序号才拦得住。
  it('loadMore 在途时改搜索词，旧搜索词的那一页不能拼进新结果', async () => {
    const deferreds: Array<{ resolve: (v: unknown) => void }> = [];
    listWorks.mockImplementation(() => new Promise(res => deferreds.push({ resolve: res })));

    const { result } = renderHook(() => useWorks());
    await act(async () => {});
    expect(deferreds).toHaveLength(1);

    // 首屏：无搜索词，1 条 / 共 100 条
    await act(async () => {
      deferreds[0]!.resolve({ items: [item(1, 'A')], total: 100 });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    // 翻页：在途（q=''，offset=1）
    act(() => { result.current.loadMore(); });
    expect(deferreds).toHaveLength(2);

    // 翻页还没回来，用户改搜「熊」
    act(() => { result.current.setQuery('熊'); });
    await waitForSearch(() => expect(deferreds).toHaveLength(3));

    // 新搜索的结果先到
    await act(async () => {
      deferreds[2]!.resolve({ items: [item(9, '熊结果')], total: 1 });
    });
    expect(result.current.items.map(i => i.title)).toEqual(['熊结果']);
    expect(result.current.total).toBe(1);

    // 旧搜索词的在途页后到 —— 必须丢弃，否则页面上会出现
    // 「小熊结果 + A + C」这种两个搜索词混在一起的列表
    await act(async () => {
      deferreds[1]!.resolve({ items: [item(2, 'A 的第二页')], total: 100 });
    });
    expect(result.current.items.map(i => i.title)).toEqual(['熊结果']);
    expect(result.current.total).toBe(1);
  });
});

describe('搜索时清空旧结果', () => {
  it('query 变化后 items 不保留上一批', async () => {
    listWorks.mockResolvedValueOnce({ items: [item(1, 'A')], total: 1 });
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    listWorks.mockResolvedValueOnce({ items: [item(2, 'B')], total: 1 });
    act(() => { result.current.setQuery('B'); });
    await waitForSearch(() => expect(result.current.items.map(i => i.title)).toEqual(['B']));
  });
});

describe('排序切换', () => {
  it('setSort 立即触发新请求（不防抖）', async () => {
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    listWorks.mockClear();

    act(() => { result.current.setSort('hot'); });

    // 断言必须落在 act 出来的同一刻，不能用 waitFor：排序是点按钮，不是一个字
    // 一个字地敲，没有「等用户停下来」这回事 —— 走 300ms 防抖是实现偷懒。
    // 用 waitFor 等「listWorks 被调用过」的话，防抖版 300ms 后照样满足，绿灯。
    expect(listWorks).toHaveBeenCalledTimes(1);
    expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '', sort: 'hot' });
  });

  it('排序 + 搜索组合传递', async () => {
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.setSort('hot'); });
    await waitFor(() => expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '', sort: 'hot' }));

    listWorks.mockClear();
    act(() => { result.current.setQuery('熊'); });
    await waitForSearch(() =>
      expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '熊', sort: 'hot' }));
  });
});

describe('loadMore 与搜索共存', () => {
  it('搜索结果也能加载更多', async () => {
    listWorks
      .mockResolvedValueOnce({ items: [item(1, 'A')], total: 2 })
      .mockResolvedValueOnce({ items: [item(2, 'B')], total: 2 });
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
  });

  it('loadMore 带上当前搜索词', async () => {
    listWorks.mockResolvedValue({ items: [item(1, 'A')], total: 100 });
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    listWorks.mockClear();
    act(() => { result.current.setQuery('熊'); });
    await waitForSearch(() =>
      expect(listWorks).toHaveBeenCalledWith(20, 0, { q: '熊', sort: 'latest' }));
    listWorks.mockClear();

    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(listWorks).toHaveBeenCalled());
    expect(listWorks).toHaveBeenCalledWith(20, 1, { q: '熊', sort: 'latest' });
  });

  it('换搜索词后 loadMore 的 offset 按新结果重新算，而不是沿用上一批', async () => {
    listWorks.mockResolvedValue({ items: [item(1, 'A')], total: 100 });
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 换词后这批是 3 条 —— offset 必须跟着变成 3。
    // 沿用上一批的长度会翻到错的页，用户看到「新词的前 3 条 + 旧词的第 2 条」。
    listWorks.mockResolvedValue({ items: [item(2, 'X'), item(3, 'Y'), item(4, 'Z')], total: 50 });
    act(() => { result.current.setQuery('熊'); });
    await waitForSearch(() => expect(result.current.items).toHaveLength(3));
    listWorks.mockClear();

    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(listWorks).toHaveBeenCalled());
    expect(listWorks).toHaveBeenCalledWith(20, 3, { q: '熊', sort: 'latest' });
  });

  it('防抖窗口内点加载更多，用的仍是屏幕上那一批对应的搜索词', async () => {
    // 防抖的 300ms 里 loading 是 false，loadMore 点得动。此时屏幕上的卡片属于
    // 旧搜索词，请求就必须带旧搜索词 —— 带新的会拉回来一页跟屏幕不匹配的数据，
    // 而且 offset 是按旧结果算的，拼接出来是错的。
    listWorks.mockResolvedValue({ items: [item(1, 'A')], total: 100 });
    const { result } = renderHook(() => useWorks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    listWorks.mockClear();

    act(() => { result.current.setQuery('熊'); });
    act(() => { result.current.loadMore(); });

    expect(listWorks).toHaveBeenCalledTimes(1);
    expect(listWorks).toHaveBeenCalledWith(20, 1, { q: '', sort: 'latest' });
  });
});
