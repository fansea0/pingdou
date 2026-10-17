import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorksListPage } from './WorksListPage';
import { useWorks } from '@/hooks/useWorks';

const listWorks = vi.fn();
const likeWork = vi.fn();
const fetchLikeState = vi.fn();

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    listWorks: (...a: unknown[]) => listWorks(...a),
    likeWork: (...a: unknown[]) => likeWork(...a),
    fetchLikeState: (...a: unknown[]) => fetchLikeState(...a),
  };
});

beforeEach(() => {
  // 默认返回空库：下面大量用例是「进页面 → 等空状态」这条路径，
  // 没有默认实现的话 listWorks 返回 undefined，useWorks 里 .then 直接抛 TypeError。
  listWorks.mockReset().mockResolvedValue({ items: [], total: 0 });
  likeWork.mockReset().mockResolvedValue({ ok: true, likes: 1, alreadyLiked: true });
  fetchLikeState.mockReset().mockResolvedValue({ likes: 0, liked: false });
});

// vitest runs with globals:false, so RTL's automatic cleanup is not registered.
// 少了这两行，DOM 会跨用例残留，下面的 getBy* 会撞到上一个用例的节点。
afterEach(cleanup);

afterEach(() => {
  vi.clearAllMocks();
  // 有用例会改 location.search（URL 同步 / 初值回填），不清会漏到下一个用例。
  window.history.replaceState({}, '', '/works');
});

function work(id: number, title: string, likes = 0) {
  return {
    id,
    title,
    thumbUrl: `/media/works/${String(id).padStart(16, '0')}.png`,
    width: 800,
    height: 1000,
    createdAt: 1_700_000_000_000,
    likes,
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

/**
 * 多张卡片时按 id 分别给点赞态。fetchLikeState 是按作品 id 查的，
 * 用一个 mockResolvedValue 会把同一个 likes 糊到所有卡片上，排序用例就废了。
 */
function likeStateById(states: Record<number, { likes: number; liked: boolean }>) {
  fetchLikeState.mockImplementation((id: number) => Promise.resolve(states[id]));
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
    expect(await screen.findByText(/还没有上传作品/)).toBeTruthy();
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
    // 第一个参数是 10：本 feature 的产品决定是每页 10 条，页面显式传给 useWorks，
    // 不吃 hook 里 PAGE_SIZE 的默认 20（那个默认值是给别处留的，别去改它）。
    expect(listWorks.mock.calls[1]).toEqual([10, 1, { q: '', sort: 'latest' }]);
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

describe('分页大小', () => {
  it('首屏实际按每页 10 条请求（显式传参，不吃 hook 默认的 20）', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    // 行为级断言而不是 grep 源码里的字面量 10：靠一行显式传参对齐的
    // 「hook 默认 20 / 页面 10」很容易在后续维护里走散（谁把参数删了就静默变回 20）。
    expect(listWorks.mock.calls[0][0]).toBe(10);
  });
});

describe('搜索框', () => {
  it('渲染一个搜索框', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('输入会触发带 q 的请求（防抖后）', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    listWorks.mockClear();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
    await waitFor(
      () => expect(listWorks).toHaveBeenCalledWith(10, 0, { q: '小熊', sort: 'latest' }),
      { timeout: 2000 },
    );
  });

  it('搜索词同步到 URL', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    try {
      render(<WorksListPage />);
      await screen.findByText(/还没有上传作品/);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
      await waitFor(() => expect(window.location.search).toContain('q='));
      const lastUrl = replaceSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('q=');
    } finally {
      replaceSpy.mockRestore();
    }
  });

  /**
   * 计划自己承认过：「把 replaceState 换成 pushState，这条用例测不出来」。
   * 那就另写一条钉住它的 —— 搜索框每敲一个字都 push 一次，历史栈会被塞满，
   * 用户想退回搜索前的页面得按几十次后退。这是很容易被「顺手改回去」的回归。
   */
  it('同步 URL 只用 replaceState，绝不 pushState（否则历史栈被每个字塞满）', async () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const lengthBefore = window.history.length;
    try {
      render(<WorksListPage />);
      await screen.findByText(/还没有上传作品/);

      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊宝' } });
      await waitFor(() => expect(window.location.search).toContain('q='));
      // 等防抖那次请求落地，确保 URL 写入不是还在路上
      await waitFor(
        () => expect(listWorks).toHaveBeenCalledWith(10, 0, { q: '小熊宝', sort: 'latest' }),
        { timeout: 2000 },
      );

      expect(pushSpy).not.toHaveBeenCalled();
      expect(window.history.length).toBe(lengthBefore);
    } finally {
      pushSpy.mockRestore();
    }
  });

  it('从 URL 初值回填搜索框', async () => {
    window.history.replaceState({}, '', '/works?q=%E5%B0%8F%E7%86%8A&sort=hot');
    render(<WorksListPage />);
    await waitFor(
      () => expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('小熊'),
      { timeout: 2000 },
    );
    expect(screen.getByRole('button', { name: '按最热排序' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(
      () => expect(listWorks).toHaveBeenCalledWith(10, 0, { q: '小熊', sort: 'hot' }),
      { timeout: 2000 },
    );
  });

  it('清除按钮清空搜索词', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
    const clear = await screen.findByRole('button', { name: '清空搜索框' });
    fireEvent.click(clear);
    await waitFor(() => expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(''));
    // 清空后 URL 里也不该残留 q
    await waitFor(() => expect(window.location.search).not.toContain('q='));
  });

  it('有搜索词时展示匹配数量', async () => {
    listWorks.mockResolvedValue({ items: [work(1, '小熊')], total: 1 });
    render(<WorksListPage />);
    await screen.findByText('小熊');
    expect(screen.getByText(/共 1 件/)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
    expect(await screen.findByText(/找到 1 件与「小熊」相关的作品/)).toBeTruthy();
  });
});

describe('排序切换', () => {
  it('有「按最新排序」「按最热排序」两个切换按钮', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    expect(screen.getByRole('button', { name: '按最新排序' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '按最热排序' })).toBeTruthy();
  });

  it('点「按最热排序」发 sort=hot 的请求', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    listWorks.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '按最热排序' }));
    await waitFor(() => expect(listWorks).toHaveBeenCalledWith(10, 0, { q: '', sort: 'hot' }));
    expect(screen.getByRole('button', { name: '按最热排序' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('默认「按最新排序」按下、「按最热排序」未按下', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    expect(screen.getByRole('button', { name: '按最新排序' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '按最热排序' }).getAttribute('aria-pressed')).toBe('false');
  });

  /**
   * 按钮里没有文字了（只剩图标），可访问名全靠 aria-label。
   * 这条钉住它：去掉 aria-label 的话 getByRole 立刻失配，
   * 屏幕阅读器会读出两个没名字的按钮 —— 用户根本分不清哪个是热度。
   * aria-hidden 的 SVG 不参与命名（否则名字会变成「按钮 图标」）。
   */
  it('图标按钮的可访问名是中文标签，不含 SVG 里的内容', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    for (const name of ['按最新排序', '按最热排序']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.getAttribute('aria-label')).toBe(name);
      // 文字标签搬到 title 上：桌面端 hover 能看到，触屏没有就靠 aria-label
      expect(btn.getAttribute('title')).toBeTruthy();
      expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('排序挂在「共 N 件」那一行里（不另占一行，也不塞回搜索框）', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A')], total: 1 });
    const { container } = render(<WorksListPage />);
    await screen.findByText('A');

    const countRow = container.querySelector('.works-count') as HTMLElement;
    expect(countRow).toBeTruthy();
    // 排序是这一行的子节点 —— 用户抱怨的「占空间」正是这么消掉的
    expect(countRow.querySelector('.works-sort')).toBeTruthy();
    expect(countRow.contains(screen.getByRole('button', { name: '按最热排序' }))).toBe(true);
    // 反面：排序不在搜索框里了，搜索框回归单一职责
    const search = container.querySelector('.works-search') as HTMLElement;
    expect(search.querySelector('.works-sort')).toBeNull();
  });

  it('搜索出结果时（文案换成「找到 N 件…」）排序仍然在同一行', async () => {
    listWorks.mockResolvedValue({ items: [work(1, '小熊')], total: 1 });
    const { container } = render(<WorksListPage />);
    await screen.findByText('小熊');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '小熊' } });
    await screen.findByText(/找到 1 件与「小熊」相关的作品/);

    const countRow = container.querySelector('.works-count') as HTMLElement;
    expect(countRow.querySelector('.works-sort')).toBeTruthy();
    expect(countRow.contains(screen.getByRole('button', { name: '按最热排序' }))).toBe(true);
  });

  /**
   * 排序跟着「共 N 件」这一行走之后有个必须钉住的后果：这一行如果被关进
   * items.length > 0 的判断里，空库 / 搜不到结果时排序控件会整块消失 ——
   * 而那恰恰是最需要它的场景（搜错了，换「最热」也许能翻出东西）。
   * 所以这一行在「请求成功但零结果」时也必须在。
   */
  it('空结果时这一行仍在，排序控件不会消失', async () => {
    listWorks.mockResolvedValue({ items: [], total: 0 });
    const { container } = render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    const countRow = container.querySelector('.works-count') as HTMLElement;
    expect(countRow).toBeTruthy();
    expect(countRow.contains(screen.getByRole('button', { name: '按最热排序' }))).toBe(true);
    expect(screen.getByText(/共 0 件/)).toBeTruthy();
  });
});

describe('两类空状态必须区分', () => {
  it('无作品时提示「还没有上传作品」', async () => {
    render(<WorksListPage />);
    expect(await screen.findByText(/还没有上传作品/)).toBeTruthy();
    // 空作品库不该出现搜索相关的文案
    expect(screen.queryByText(/换个词试试/)).toBeNull();
    expect(screen.queryByRole('button', { name: '清除搜索' })).toBeNull();
  });

  it('有搜索词但无结果时提示「换个词试试」', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的词' } });
    expect(await screen.findByText(/换个词试试/, {}, { timeout: 2000 })).toBeTruthy();
    // 关键：这时不该再显示「库里没作品」，否则用户搜错词却以为站里空着
    expect(screen.queryByText(/还没有上传作品/)).toBeNull();
  });

  it('搜索无结果时提供清除搜索入口', async () => {
    render(<WorksListPage />);
    await screen.findByText(/还没有上传作品/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的词' } });
    const clearSearch = await screen.findByRole('button', { name: '清除搜索' }, { timeout: 2000 });
    fireEvent.click(clearSearch);
    // 清空后回到「空作品库」那条文案
    expect(await screen.findByText(/还没有上传作品/)).toBeTruthy();
  });
});

describe('点赞按钮', () => {
  it('每张卡片都有点赞按钮并显示次数', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    render(<WorksListPage />);
    await screen.findByText('A');
    expect(screen.getByRole('button', { name: /5 次点赞/ })).toBeTruthy();
  });

  it('点赞按钮不在卡片链接里（否则点点赞会跳详情页）', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    render(<WorksListPage />);
    const link = await screen.findByRole('link', { name: 'A' });
    const btn = screen.getByRole('button', { name: /5 次点赞/ });
    // 标题行形态下按钮仍然是 <a> 的兄弟（只是这次钉在标题右端，不是压在图上），
    // 而不是链接的后代
    expect(link.contains(btn)).toBe(false);
    expect(btn.closest('a')).toBeNull();
  });

  it('卡片标题仍留在链接内 —— 链接的可访问名全靠它（img 的 alt 是留空的）', async () => {
    listWorks.mockResolvedValue({ items: [work(1, '粉色小熊', 5)], total: 1 });
    render(<WorksListPage />);
    const link = await screen.findByRole('link', { name: '粉色小熊' });
    // 可访问名退化（标题挪出 <a>）时这条 findByRole 直接找不到链接
    expect(link.querySelector('.works-card-title')?.textContent).toBe('粉色小熊');
    expect(link.querySelector('.works-card-img')).toBeTruthy();
  });

  it('日期那一行已从卡片上移除，点赞挂在卡片而不是链接里', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    const { container } = render(<WorksListPage />);
    await screen.findByText('A');

    // 产品决定：发布日期是设计移除的，不是漏了 —— 底部整行（日期 + 游离的
    // 小爱心）被标题行右端的点赞取代。
    expect(container.querySelector('.works-card-body')).toBeNull();
    expect(container.querySelector('.works-card-meta')).toBeNull();
    const card = container.querySelector('.works-card') as HTMLElement;
    expect(card.querySelector('.works-card-like')).toBeTruthy();
  });

  it('点赞钉在标题行的右端，与标题同行（不是浮在图上的徽章）', async () => {
    // 用户原话「点赞在标题那一行的右侧」。这条钉的是 CSS：
    //   · 按钮 bottom:0 + 高度 = --works-title-h → 与标题行同一高度、贴卡片下沿
    //   · 标题行 min-height 同样是 --works-title-h，且右端 padding 让开按钮
    //   · 不再有压在图片上的深色浮层（::before 那块半透明底 + text-shadow）
    // 判别力：只断言 DOM 结构的话，下面两条「按钮在卡片里」「不在链接里」
    // 全都照样绿 —— 位置是纯 CSS 事实，只能查样式表源码。
    // vitest 默认不注入样式表，getComputedStyle 在这里读不到值、断言会空跑，
    // 所以直接读 CSS 源码（与 RegionStatsPanel.test.tsx 同一个理由）。
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    render(<WorksListPage />);
    await screen.findByText('A');

    const css = readFileSync(resolve(process.cwd(), 'src/pages/WorksListPage.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.slice(css.indexOf('.works-card .works-card-like'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/bottom:\s*0/);
    expect(body).toMatch(/height:\s*var\(--works-title-h\)/);
    // 触摸区 ≥44px：--works-title-h 定义在 .works-card 上
    expect(css.slice(css.indexOf('--works-title-h:'))).toMatch(/--works-title-h:\s*44px/);
    // 旧浮层形态的死东西必须已经删干净
    expect(body).not.toMatch(/text-shadow/);
    expect(css).not.toMatch(/\.works-card-like::before/);

    // 标题行右端让出位置，长标题的省略号停在这条线之前
    const titleRule = css.slice(css.indexOf('.works-card-title'));
    expect(titleRule.slice(0, titleRule.indexOf('}')))
      .toMatch(/padding-right:[^;]*--works-like-w/);
    // 标题行必须是块级：flex 容器的匿名子项拿不到 text-overflow，
    // 长标题会直接冲出卡片被 overflow:hidden 硬切（没有省略号）。
    // 这一条是实测踩出来的 —— 只看截断属性齐全同样会绿。
    expect(titleRule.slice(0, titleRule.indexOf('}'))).not.toMatch(/display:\s*flex/);
  });

  it('已赞态下心形换成实心填充，不只是换颜色', async () => {
    // 用户原话「没有记录是否已经点赞，只是展示了点赞数量」。病根是未赞/已赞
    // 是同一颗心、只换颜色 —— 远看只能读出一个数字。这条钉住形状开关：
    //   未赞 path 无 fill/stroke 属性（由 CSS 控制）+ 默认态 CSS 是空心描边
    //   已赞 CSS 那条规则是 fill:currentColor + stroke:none
    // 只断言 class 名是不够的 —— class 一直在，改回「只换颜色」照样全绿。
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: true });
    render(<WorksListPage />);
    const btn = await screen.findByRole('button', { name: /已赞，5 次点赞/ });
    expect(btn.className).toContain('works-like--on');

    const svg = btn.querySelector('svg') as SVGSVGElement;
    const path = btn.querySelector('svg path') as SVGPathElement;
    expect(path).toBeTruthy();
    // fill / stroke 必须是纯 CSS 控制：SVG 呈现属性一旦写在这里（svg 或 path 上都算），
    // .works-like--on 那条规则就再也切不动形状了。
    for (const el of [svg, path] as Element[]) {
      expect(el.hasAttribute('fill')).toBe(false);
      expect(el.hasAttribute('stroke')).toBe(false);
    }
    // 图形不进朗读，可访问名由 aria-label 给
    expect(svg.getAttribute('aria-hidden')).toBe('true');

    const css = readFileSync(resolve(process.cwd(), 'src/components/LikeButton.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const offRule = css.slice(css.indexOf('.works-like-icon path'));
    expect(offRule.slice(0, offRule.indexOf('}'))).toMatch(/fill:\s*none/);
    const onRule = css.slice(css.indexOf('.works-like--on .works-like-icon path'));
    const onBody = onRule.slice(0, onRule.indexOf('}'));
    expect(onBody).toMatch(/fill:\s*currentColor/);
    expect(onBody).toMatch(/stroke:\s*none/);
    // 过渡也不能丢：否则切换是硬跳，两态的区别更读不出来
    expect(css).toMatch(/transition:\s*fill 0\.18s[^;]*stroke 0\.18s/);
  });

  it('心形是几何对称 SVG，不是 ♡/♥ 字符', async () => {
    // 字符心形挤在 12px 的行里就是一个小点（用户原话「爱心希望简洁好看些」），
    // 而且它是字体字形，各设备渲染不一致。
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    render(<WorksListPage />);
    const btn = await screen.findByRole('button', { name: /5 次点赞/ });

    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg!.getAttribute('stroke-linecap')).toBe('round');
    expect(btn.textContent).not.toMatch(/[♡♥]/);
  });

  it('点一下调 likeWork 并更新数字', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    likeWork.mockResolvedValue({ ok: true, likes: 6, alreadyLiked: true });
    render(<WorksListPage />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));
    await waitFor(() => expect(likeWork).toHaveBeenCalledWith(1));
    expect(await screen.findByRole('button', { name: /6 次点赞/ })).toBeTruthy();
  });

  it('乐观更新：请求还没回来数字就已经 +1（点击手感即时）', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    // 永不 resolve：只观察乐观更新，服务端回包这一步根本没走到
    likeWork.mockReturnValue(new Promise(() => {}));
    render(<WorksListPage />);
    await screen.findByText('A');

    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));
    // 判别力来源：删掉乐观更新时这里还是 5
    expect(screen.getByRole('button', { name: /6 次点赞/ })).toBeTruthy();
  });

  it('点赞成功后按钮变为已赞状态且不可再点', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    likeWork.mockResolvedValue({ ok: true, likes: 6, alreadyLiked: true });
    render(<WorksListPage />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));

    const btn = await screen.findByRole('button', { name: /已赞/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    // 产品决定：不能取消点赞。再点一次不能再发请求。
    fireEvent.click(btn);
    expect(likeWork).toHaveBeenCalledTimes(1);
  });

  it('alreadyLiked=false（今天已经赞过）时数字不变、状态为已赞', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    // 服务端判定今天这一票已经投过了：计数不动
    likeWork.mockResolvedValue({ ok: true, likes: 5, alreadyLiked: false });
    render(<WorksListPage />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));

    await waitFor(() =>
      expect((screen.getByRole('button', { name: /5 次点赞/ }) as HTMLButtonElement).disabled).toBe(true),
    );
  });

  it('我今天赞过（fetchLikeState.liked=true）时初始就是已赞态', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: true });
    render(<WorksListPage />);
    await screen.findByText('A');
    const btn = await screen.findByRole('button', { name: /已赞/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(likeWork).not.toHaveBeenCalled();
  });

  it('点赞失败时回滚数字并提示', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    likeWork.mockRejectedValue(new Error('网络炸了'));
    render(<WorksListPage />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));

    expect(await screen.findByText(/网络炸了/)).toBeTruthy();
    // 判别力来源：catch 里不回滚的话这里会停在 6，用户白看到一个假的赞
    const btn = screen.getByRole('button', { name: /5 次点赞/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('被限流（429）时给出能看懂的中文提示且不崩', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    likeWork.mockRejectedValue(new Error('too many likes, try again later'));
    render(<WorksListPage />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));

    expect(await screen.findByText(/点得太快/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /5 次点赞/ })).toBeTruthy();
  });

  it('同一批次内连点只发一次请求', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 5)], total: 1 });
    fetchLikeState.mockResolvedValue({ likes: 5, liked: false });
    likeWork.mockResolvedValue({ ok: true, likes: 6, alreadyLiked: true });
    render(<WorksListPage />);
    await screen.findByText('A');

    // 判别力来源与 useWorks 的 loadMore 用例同源：三次点击落在同一个 act 批次，
    // busy/liked 的 state 还没提交，三个 handler 读到的是同一个闭包。
    // 守住它的是组件里的同步标志，不是 DOM 的 disabled。
    const btn = screen.getByRole('button', { name: /5 次点赞/ });
    act(() => {
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await waitFor(() => expect(likeWork).toHaveBeenCalled());
    expect(likeWork).toHaveBeenCalledTimes(1);
  });
});

describe('排名不实时变化（用户明确要求）', () => {
  it('点赞后卡片顺序不变（客户端绝不重排）', async () => {
    // 服务端给的顺序是 A(1 赞) 在前、B(0 赞) 在后。点赞后 B 变成 2 赞、反超 A ——
    // 任何「顺手加个前端 sort 让排名实时」的改动都会在这里露馅。
    listWorks.mockResolvedValue({ items: [work(1, 'A', 1), work(2, 'B', 0)], total: 2 });
    likeStateById({ 1: { likes: 1, liked: false }, 2: { likes: 0, liked: false } });
    likeWork.mockResolvedValue({ ok: true, likes: 2, alreadyLiked: true });
    render(<WorksListPage />);
    await screen.findByText('A');

    fireEvent.click(screen.getByRole('button', { name: /0 次点赞/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /2 次点赞/ })).toBeTruthy());

    const titles = screen.getAllByRole('link').map(a => a.textContent ?? '');
    const idxA = titles.findIndex(t => t.includes('A'));
    const idxB = titles.findIndex(t => t.includes('B'));
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
  });

  it('点赞只改数字不改 DOM 位置', async () => {
    listWorks.mockResolvedValue({ items: [work(1, 'A', 1), work(2, 'B', 0)], total: 2 });
    likeStateById({ 1: { likes: 1, liked: false }, 2: { likes: 0, liked: false } });
    likeWork.mockResolvedValue({ ok: true, likes: 2, alreadyLiked: true });
    render(<WorksListPage />);
    await screen.findByText('A');

    const before = screen.getAllByRole('link').map(a => a.textContent);
    fireEvent.click(screen.getByRole('button', { name: /0 次点赞/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /2 次点赞/ })).toBeTruthy());

    expect(screen.getAllByRole('link').map(a => a.textContent)).toEqual(before);
  });
});
