import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorksListPage } from './WorksListPage';

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
    expect(listWorks.mock.calls[1]).toEqual([20, 1]);
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

  it('快速连点「加载更多」只发一次请求', async () => {
    listWorks
      .mockResolvedValueOnce({ items: [work(1, 'A')], total: 3 })
      .mockResolvedValue({ items: [work(2, 'B')], total: 3 });
    render(<WorksListPage />);
    await screen.findByText('A');

    // 同一个 act 批次里连点两次：state 里的 loadingMore 还没提交，
    // 只靠 state 守卫会漏，第二次会用同一个 offset 重复拉同一页。
    const more = screen.getByRole('button', { name: '加载更多' });
    act(() => {
      fireEvent.click(more);
      fireEvent.click(more);
    });

    await screen.findByText('B');
    expect(listWorks).toHaveBeenCalledTimes(2);
  });
});
