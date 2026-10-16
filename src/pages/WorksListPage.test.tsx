import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorksListPage } from './WorksListPage';
import { useWorks } from '@/hooks/useWorks';

const listWorks = vi.fn();

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return { ...actual, listWorks: (...a: unknown[]) => listWorks(...a) };
});

beforeEach(() => {
  listWorks.mockReset();
});

// vitest runs with globals:false, so RTL's automatic cleanup is not registered.
// 少了这两行，DOM 会跨用例残留，下面的 getBy* 会撞到上一个用例的节点。
afterEach(cleanup);

afterEach(() => {
  vi.clearAllMocks();
});

function work(id: number, title: string) {
  return {
    id,
    title,
    thumbUrl: `/media/works/${String(id).padStart(16, '0')}.png`,
    width: 800,
    height: 1000,
    createdAt: 1_700_000_000_000,
  };
}

/**
 * reload 的验证宿主。
 *
 * 为什么不直接点页面上的「重试」按钮：那条按钮只在首屏 error 分支渲染，而 error
 * 只由首屏 effect 写，触发它意味着这一轮一次数据都没拿到 —— items 必定为空。
 * 于是「reload 要把旧列表清空」这条永远观察不到，reload 里删掉 setItems([])
 * 全量测试照样绿。这里用最小宿主组件直接驱动 hook，让 items 非空时也能调 reload。
 */
function ReloadHarness() {
  const { items, loading, loadMoreError, loadMore, reload } = useWorks();
  return (
    <div>
      {/* 无条件渲染：reload 那一帧 loading 还是 false，正好能观察到清空前后的差别 */}
      <span data-testid="titles">{items.map(i => i.title).join(',')}</span>
      <button type="button" onClick={loadMore}>more</button>
      <button type="button" onClick={reload}>reload</button>
      {loading && <span>busy</span>}
      {loadMoreError && <p>翻页失败：{loadMoreError.message}</p>}
    </div>
  );
}

describe('WorksListPage', () => {
  it('加载中显示状态文案', () => {
    listWorks.mockReturnValue(new Promise(() => {}));
    render(<WorksListPage />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it('渲染作品卡片，标题可见', async () => {
    listWorks.mockResolvedValue({ items: [work(1, '粉色小熊')], total: 1 });
    render(<WorksListPage />);
    await waitFor(() => expect(screen.getByText('粉色小熊')).toBeTruthy());
  });

  it('卡片是跳转到 /works/:id 的链接', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A')], total: 1 });
    render(<WorksListPage />);
    const link = await screen.findByRole('link', { name: 'A' });
    expect(link.getAttribute('href')).toBe('/works/1');
  });

  it('卡片图用 thumbUrl，不是详情页的大图地址', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A')], total: 1 });
    const { container } = render(<WorksListPage />);
    const img = await waitFor(() => {
      const el = container.querySelector('.works-card-img');
      expect(el).toBeTruthy();
      return el as HTMLImageElement;
    });
    expect(img.getAttribute('src')).toBe('/media/works/0000000000000001.png');
    expect(img.getAttribute('loading')).toBe('lazy');
    // alt 留空是有意的：标题文字就在同一张 <a> 里，重复 alt 会让链接的可访问名翻倍
    expect(img.getAttribute('alt')).toBe('');
  });

  it('空列表给出空状态和前往生成的入口', async () => {
    listWorks.mockResolvedValue({ items: [], total: 0 });
    render(<WorksListPage />);
    expect(await screen.findByText(/还没有作品/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /去生成第一个图纸/ }).getAttribute('href')).toBe('/');
  });

  it('加载失败给出错误与重试按钮，重试后能出列表', async () => {
    listWorks.mockRejectedValueOnce(new Error('boom'));
    render(<WorksListPage />);
    expect(await screen.findByText(/boom/)).toBeTruthy();

    listWorks.mockResolvedValueOnce({ items: [work(1, 'A')], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('A')).toBeTruthy();
  });

  it('有剩余时点「加载更多」追加下一页并保留已有项', async () => {
    listWorks
      .mockResolvedValueOnce({ items: [work(1, 'A')], total: 2 })
      .mockResolvedValueOnce({ items: [work(2, 'B')], total: 2 });
    render(<WorksListPage />);
    await screen.findByText('A');

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(screen.getByText('B')).toBeTruthy());
    expect(screen.getByText('A')).toBeTruthy();
    expect(listWorks).toHaveBeenCalledTimes(2);
    // 第三个参数是 Task 6 起才有的搜索词/排序 —— 没有搜索词时是 { q: '', sort: 'latest' }，
    // api 层会把它折叠成与改造前完全一样的请求（空 q 与 latest 都不进 query）。
    expect(listWorks.mock.calls[1]).toEqual([20, 1, { q: '', sort: 'latest' }]);
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('总页数取完时不再显示「加载更多」', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A')], total: 1 });
    render(<WorksListPage />);
    await screen.findByText('A');
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('「加载更多」失败只提示，不顶掉已加载的列表', async () => {
    listWorks
      .mockResolvedValueOnce({ items: [work(1, 'A')], total: 3 })
      .mockRejectedValueOnce(new Error('network down'));
    render(<WorksListPage />);
    await screen.findByText('A');

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText(/network down/)).toBeTruthy();

    // 关键断言：已加载的卡片还在，页面没有退化成整屏错误态
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    // 还有剩余，入口仍在，用户能直接再点一次
    expect(screen.getByRole('button', { name: '加载更多' })).toBeTruthy();
  });

  it('同一批次内多次调用 loadMore 只发一次请求', async () => {
    listWorks
      .mockResolvedValueOnce({ items: [work(1, 'A')], total: 3 })
      .mockResolvedValue({ items: [work(2, 'B')], total: 3 });
    render(<WorksListPage />);
    await screen.findByText('A');

    // 判别力来源：两次调用落在同一个 act 批次里 —— state 里的 loadingMore 还没
    // 提交，两次 handler 读到的是同一个闭包。这是 React 的契约性质（一次
    // 事件里连着调多次 handler），真实浏览器双击走不到这里（见下一条），
    // 守住它的是同步标志 pendingRef。
    const more = screen.getByRole('button', { name: '加载更多' });
    act(() => {
      fireEvent.click(more);
      fireEvent.click(more);
    });

    await screen.findByText('B');
    expect(listWorks).toHaveBeenCalledTimes(2);
  });

  it('真实双击「加载更多」只发一次请求', async () => {
    listWorks
      .mockResolvedValueOnce({ items: [work(1, 'A')], total: 3 })
      .mockResolvedValue({ items: [work(2, 'B')], total: 3 });
    render(<WorksListPage />);
    await screen.findByText('A');

    // 两个独立的 act，对应浏览器里两次独立的点击任务。React 对 discrete event
    // （click）同步 flush，所以第一次点击提交的 loadingMore 此时已经生效 ——
    // 这一条守的是真实用户场景：手快连点两下「加载更多」。
    // 中间绝对不能 await：await 会把 mock 那条已 resolve 的 promise 跑掉，
    // loadingMore 回落成 false，那就变成「两次独立加载」而不是双击了。
    const more = screen.getByRole('button', { name: '加载更多' });
    act(() => { fireEvent.click(more); });
    act(() => { fireEvent.click(more); });

    await screen.findByText('B');
    expect(listWorks).toHaveBeenCalledTimes(2);
  });

  it('下一页与已加载项重叠时不产生重复卡片', async () => {
    // 复现 offset 分页的经典错位：首屏 2 件/total 3，两次请求之间新增 1 件插到
    // 最前，offset 后移，第二页把上一页的尾项又拉了一遍。
    listWorks
      .mockResolvedValueOnce({ items: [work(1, 'W1'), work(2, 'W2')], total: 3 })
      .mockResolvedValueOnce({ items: [work(2, 'W2'), work(3, 'W3')], total: 3 });
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(<WorksListPage />);
      await screen.findByText('W1');
      fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
      await screen.findByText('W3');

      // 每个标题只渲染一次
      expect(screen.getAllByText('W1')).toHaveLength(1);
      expect(screen.getAllByText('W2')).toHaveLength(1);
      expect(screen.getAllByText('W3')).toHaveLength(1);
      // React 的重复 key 警告会掩盖真实报错，这里显式钉住
      const dupKey = warn.mock.calls.filter(c => /same key/.test(String(c[0])));
      expect(dupKey).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('reload 清掉旧列表与翻页错误，重新拉第一页', async () => {
    listWorks
      .mockResolvedValueOnce({ items: [work(1, 'A')], total: 3 })
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ items: [work(2, 'B')], total: 1 });
    render(<ReloadHarness />);
    await waitFor(() => expect(screen.getByTestId('titles').textContent).toBe('A'));

    // 先制造一个翻页错误
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(await screen.findByText(/network down/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'reload' }));
    // 这一帧 effect 还没跑，loading 还是 false：两个断言正好卡在清空那一刻
    expect(screen.queryByText(/network down/)).toBeNull();
    expect(screen.getByTestId('titles').textContent).toBe('');

    await waitFor(() => expect(screen.getByTestId('titles').textContent).toBe('B'));
    expect(listWorks).toHaveBeenCalledTimes(3);
  });
});
