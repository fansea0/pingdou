import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkDetail } from '@/api/works';
import { WorkDetailPage, formatBytes, REDIRECT_DELAY_MS } from './WorkDetailPage';

const fetchWork = vi.fn();
const likeWork = vi.fn();
const fetchLikeState = vi.fn();

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    fetchWork: (...a: unknown[]) => fetchWork(...a),
    likeWork: (...a: unknown[]) => likeWork(...a),
    fetchLikeState: (...a: unknown[]) => fetchLikeState(...a),
  };
});

beforeEach(() => {
  fetchWork.mockReset();
  likeWork.mockReset().mockResolvedValue({ ok: true, likes: 9, alreadyLiked: true });
  fetchLikeState.mockReset().mockResolvedValue({ likes: 8, liked: false });
});

// vitest.config.ts 是 globals:false，RTL 的自动 cleanup 不注册。
// 少了这行，DOM 会跨用例残留，下面的 getBy* 会撞到上一个用例的节点 ——
// 实现完全正确也会红。src/pages/WorksListPage.test.tsx 上踩过同一个坑。
afterEach(cleanup);

afterEach(() => {
  vi.clearAllMocks();
  // 导航用例靠 vi.stubGlobal('location', …) 换掉 window.location。写在用例体末尾
  // 的话，中间任何一条断言失败就会跳过它，桩漏到后面的用例 —— 而 location 是
  // 全局单例，漏掉的症状极隐蔽（后一条用例看到的是前一条的 replace）。
  // 放进 afterEach 才能保证「无论怎么失败都还原」。
  vi.unstubAllGlobals();
});

/**
 * 用工厂函数而不是字面量常量：WorkDetail 的必填字段一多，字面量漏掉任何一个
 * 都会直接 typecheck 失败（updatedAt 是先例，见 server/works.ts:23 与
 * server/works.ts 的 toSummary）。走工厂之后 overrides 也天然是完整的。
 */
function detail(overrides: Partial<WorkDetail> = {}): WorkDetail {
  return {
    id: 42,
    title: '粉色小熊',
    description: '100×120 · 18 色',
    thumbUrl: '/media/works/000000000000002a-t.webp',
    imageUrl: '/media/works/000000000000002a.png',
    width: 1240,
    height: 1560,
    bytes: 245_760,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    // WorkSummary.likes 是必填的（列表接口一次 SQL 带回，见 server/works.ts 的 toSummary），
    // 夹具漏掉它会直接 typecheck 失败 —— 与 updatedAt 同理。0 表示这个夹具还没被赞过。
    likes: 0,
    // 五个图纸参数同样是必填（src/api/works.ts 的 WorkDetail）。取值不是随手编的：
    // 100 × 120 与 18 色跟上面 description 里那句「100×120 · 18 色」对齐，
    // 这样详情页把参数渲染出来时不会自相矛盾（Task 13 会真的把它们显示出来）。
    // 3800 颗是 12000 格图纸里去掉背景格后的量级。
    //
    // estimateMinutes 必须等于 estimateAssemblyMinutes(3800)：3800/600 = 6.3 小时，
    // ×60 = 378。原先这里写 190，正好是「190 分钟 ≈ 3.2 小时」这种看着合理、
    // 实则与豆子数自相矛盾的值 —— 照着它推导换算公式就会把 64 倍 bug 带回来
    // （后台 WorksTab.test.tsx 为此专门注释过同一件事）。
    boardW: 100,
    boardH: 120,
    beanCount: 3800,
    colorCount: 18,
    estimateMinutes: 378,
    ...overrides,
  };
}

/**
 * 把页面上的 `<dl>` 读成「术语 → 取值」的字面量映射。
 *
 * 为什么不用 `getByText('图纸比例').nextElementSibling`：那条写法把「dt 与 dd
 * 在 DOM 里紧挨着」升级成了版式契约 —— 将来谁为了对齐在中间塞一个单位
 * `<span>`，展示的值一个字没变，测试却红了。这里用 `<dt>`/`<dd>` 自带的隐式
 * ARIA role（term / definition）按文档顺序配对，取值只依赖「描述列表里第 n 个
 * 术语配第 n 个定义」这一定义，与嵌套层级、兄弟顺序、class 名都无关。
 *
 * 代价：一次要拿全部 dd，而不在场时 getAllByRole 抛错 —— 这正是我们要的失败方式
 * （少一个参数行会立刻报「找不到 definition」，而不是静默取到 undefined）。
 */
function facts(): Record<string, string> {
  const terms = screen.getAllByRole('term').map(t => t.textContent ?? '');
  const defs = screen.getAllByRole('definition').map(d => d.textContent ?? '');
  return Object.fromEntries(terms.map((t, i) => [t, defs[i]]));
}

describe('WorkDetailPage', () => {
  it('加载中显示状态文案', () => {
    fetchWork.mockReturnValue(new Promise(() => {}));
    render(<WorkDetailPage id={42} />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it('渲染标题与大图', async () => {
    fetchWork.mockResolvedValue(detail());
    render(<WorkDetailPage id={42} />);
    expect(await screen.findByRole('heading', { name: '粉色小熊' })).toBeTruthy();
    const img = screen.getByRole('img', { name: '粉色小熊' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/media/works/000000000000002a.png');
  });

  it('按传入 id 拉数据', async () => {
    fetchWork.mockResolvedValue(detail());
    render(<WorkDetailPage id={42} />);
    await waitFor(() => expect(fetchWork).toHaveBeenCalledWith(42));
  });

  it('「下载原图」是带 download 属性的同源链接', async () => {
    const d = detail();
    fetchWork.mockResolvedValue(d);
    render(<WorkDetailPage id={42} />);
    const a = (await screen.findByRole('link', { name: '下载原图' })) as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(d.imageUrl);
    // 微信外浏览器直接下载；微信内置浏览器会拦截这条，届时靠长按提示兜底
    expect(a.getAttribute('download')).toBe('粉色小熊.png');
  });

  it('下载文件名跟随原图扩展名，不硬编码 .png', async () => {
    // 后端 /media 白名单是 (png|jpg|webp)（server/index.ts:482），原图不保证是 PNG。
    // 写死 .png 会让 JPEG 原图存成「标题.png」，按扩展名判类型的系统就认错了。
    fetchWork.mockResolvedValue(detail({ imageUrl: '/media/works/000000000000002a.jpg' }));
    render(<WorkDetailPage id={42} />);
    const a = (await screen.findByRole('link', { name: '下载原图' })) as HTMLAnchorElement;
    expect(a.getAttribute('download')).toBe('粉色小熊.jpg');
  });

  it('图片地址取不到已知扩展名时退回 .png', async () => {
    fetchWork.mockResolvedValue(detail({ imageUrl: '/media/works/000000000000002a' }));
    render(<WorkDetailPage id={42} />);
    const a = (await screen.findByRole('link', { name: '下载原图' })) as HTMLAnchorElement;
    expect(a.getAttribute('download')).toBe('粉色小熊.png');
  });

  it('「长按保存」提示常驻，不是弹窗', async () => {
    fetchWork.mockResolvedValue(detail());
    render(<WorkDetailPage id={42} />);
    expect(await screen.findByText(/长按图片保存/)).toBeTruthy();
  });

  it('展示体积元信息', async () => {
    fetchWork.mockResolvedValue(detail());
    render(<WorkDetailPage id={42} />);
    expect(await screen.findByText('1240 × 1560')).toBeTruthy();
    expect(screen.getByText('240 KB')).toBeTruthy();
  });

  it('尺寸或体积缺失时显示「未知」，不把 NaN / 0 B 抖到页面上', async () => {
    // 成品图的 width/height 来自投稿第二步，走 server/works.ts 的 optionalCount：
    // 非法值一律落 0（尺寸只是元数据，详情页显示「未知」），bytes 也可能是 0。
    // 这几条路径都不能把 NaN 抖到页面上。
    fetchWork.mockResolvedValue(detail({ width: 0, height: 0, bytes: 0 }));
    const { container } = render(<WorkDetailPage id={42} />);
    await screen.findByRole('heading', { name: '粉色小熊' });
    const facts = container.querySelector('.works-detail-facts') as HTMLElement;
    // 六项参数：前两项是成品图元信息，后四项是 2026-10-17 起带的投稿参数。
    // 逐项列全而不是抽查，是为了让「谁被删了/谁多了一项」都看得见。
    const values = Array.from(facts.querySelectorAll('dd')).map(dd => dd.textContent);
    expect(values).toEqual(['未知', '未知', '100 × 120 格', '3,800 颗', '18 种', '约 6.3 小时']);
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it('详情大图写 width/height 属性，供浏览器预留位置', async () => {
    // 与列表页刻意不写属性相反：.works-detail-img 的 CSS 是
    // width:100% + height:auto 且没有 aspect-ratio，属性推出的固有比例
    // 正是原图比例，图片加载完成前不会跳版。
    fetchWork.mockResolvedValue(detail());
    render(<WorkDetailPage id={42} />);
    const img = (await screen.findByRole('img', { name: '粉色小熊' })) as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('1240');
    expect(img.getAttribute('height')).toBe('1560');
  });

  it('404 / 下架给出提示，不再留「返回作品库」入口', async () => {
    fetchWork.mockRejectedValue(new Error('not found'));
    render(<WorkDetailPage id={42} />);
    // 404 与「已下架」刻意共用同一句：区分开等于告诉访客这个 id 曾经存在过
    expect(await screen.findByText(/不存在或已下架/)).toBeTruthy();
    // 原来这里还断言了「返回作品库」链接的 href。Task 13 起这一页改为自动跳回列表，
    // 手动的返回入口被取代 —— 留着两个出口会让访客以为自己得选一个。
    expect(screen.queryByRole('link', { name: '返回作品库' })).toBeNull();
  });

  it('加载中 / 出错 / 正常三种状态都保留导航栏', async () => {
    // SiteNav 在三个分支里各渲染一次（见报告第 3 节疑点 1）。这条把它钉住：
    // 将来谁加分支时忘了导航栏，只有这条会红。
    fetchWork.mockReturnValue(new Promise(() => {}));
    render(<WorkDetailPage id={42} />);
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
    cleanup();

    fetchWork.mockRejectedValue(new Error('not found'));
    render(<WorkDetailPage id={42} />);
    await screen.findByText(/不存在或已下架/);
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
    cleanup();

    fetchWork.mockResolvedValue(detail());
    render(<WorkDetailPage id={42} />);
    await screen.findByRole('heading', { name: '粉色小熊' });
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
  });

  it('id 变化时丢弃上一个请求的结果', async () => {
    // cancelled 守卫 + [id] 依赖在评审的变异测试里双双存活：删掉任一个，
    // 原有 18 条用例全绿。这条把它钉住 —— 让 id=1 的请求悬空，先 rerender 到
    // id=2 并显示「作品二」，再补上 id=1 的迟到响应。
    //
    // 注意这个场景在本项目生产环境不可达（无 client-side 路由，id 不会中途变），
    // 但 main.tsx:19 挂了 React.StrictMode，dev 下 effect 会双调用，
    // cancelled 是承重代码，值得有覆盖。
    let resolveOld: (v: unknown) => void = () => {};
    fetchWork.mockImplementation((id: number) =>
      id === 1
        ? new Promise(r => { resolveOld = r as (v: unknown) => void; })
        : Promise.resolve(detail({ id: 2, title: '作品二' }))
    );
    const { rerender } = render(<WorkDetailPage id={1} />);
    rerender(<WorkDetailPage id={2} />);
    await screen.findByRole('heading', { name: '作品二' });
    await act(async () => { resolveOld(detail({ id: 1, title: '作品一' })); });
    expect(screen.getByRole('heading', { name: '作品二' })).toBeTruthy();
  });

  it('标题含路径分隔符时替换掉，不原样进 download', async () => {
    // 后端 normalizeTitle 只 trim 和截断，不过滤 /（评审起真实后端上传过含 / 的
    // 标题，原样入库），所以这条路径是可达的。
    // 断言的是「我们给出的 download 属性自己就是干净的」——浏览器落盘时本来也会
    // 消毒，这里只是不让它被换成另一副样子。
    fetchWork.mockResolvedValue(detail({ title: '夏日/限定' }));
    render(<WorkDetailPage id={42} />);
    const a = (await screen.findByRole('link', { name: '下载原图' })) as HTMLAnchorElement;
    expect(a.getAttribute('download')).toBe('夏日_限定.png');
  });

  it('标题全部是禁用字符时退回 work，不产出空的 download 前缀', async () => {
    fetchWork.mockResolvedValue(detail({ title: '///' }));
    render(<WorkDetailPage id={42} />);
    const a = (await screen.findByRole('link', { name: '下载原图' })) as HTMLAnchorElement;
    expect(a.getAttribute('download')).toBe('___.png');
  });

  it('加载中是 live region，SR 会被播报', async () => {
    // 加载态在首次请求返回之后才出现；没有 aria-live 的话 SR 用户永远听不到。
    // role 与 App.tsx:273 的导出成功 toast 保持一致。
    fetchWork.mockReturnValue(new Promise(() => {}));
    render(<WorkDetailPage id={42} />);
    const loadingState = screen.getByRole('status');
    expect(loadingState.getAttribute('aria-live')).toBe('polite');
    expect(loadingState.textContent).toMatch(/加载中/);
  });

  it('出错态也是 live region', async () => {
    // 与加载态分开写：合成一条时，加载态的失败会短路掉这一段断言，
    // 只留下加载态有覆盖、错误态无覆盖。
    fetchWork.mockRejectedValue(new Error('not found'));
    render(<WorkDetailPage id={42} />);
    await screen.findByText(/不存在或已下架/);
    const errorState = screen.getByRole('status');
    expect(errorState.getAttribute('aria-live')).toBe('polite');
  });
});

describe('formatBytes', () => {
  it('0 与负数返回「未知」，不返回 0 B / -1 B', () => {
    expect(formatBytes(0)).toBe('未知');
    expect(formatBytes(-1)).toBe('未知');
  });

  it('小于 1 KB 按字节原样显示', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('1024 整进位到 KB，不再显示 1024 B', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('KB 分支取整：非整除的尾部不外溢', () => {
    // 245761 / 1024 = 240.0009…，四舍五入仍是 240 KB。
    // 这里保留整数是有意的：KB 与系统「属性」面板的显示精度一致，
    // 写 240.0 KB 反而像在假装精确。
    expect(formatBytes(245_760)).toBe('240 KB');
    expect(formatBytes(245_761)).toBe('240 KB');
    // 1040000 / 1024 = 1015.625 → 1016 KB
    expect(formatBytes(1_040_000)).toBe('1016 KB');
  });

  it('恰好 1 MB 走 MB 分支，1024*1024-1 仍是 KB', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('MB 分支保留一位小数', () => {
    expect(formatBytes(2_621_440)).toBe('2.5 MB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});

describe('详情页点赞', () => {
  it('状态查询失败时赞数退回详情接口带回的真实 likes', async () => {
    // 判别力来源（实测过）：WorkDetail.likes 是 Task 3 起接口带回的真实计数，LikeButton
    // 挂载后会再查一次「我今天赞过没」，成功时两者相等 —— 这时候把 work.likes 换成
    // 硬编码的 0 也能让用例全绿，判别力是 0。所以这里让状态查询失败：
    // 组件的 catch 按「未赞」处理并保留挂载时的计数，赞数只能来自详情接口。
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    fetchLikeState.mockRejectedValue(new Error('offline'));
    render(<WorkDetailPage id={42} />);
    expect(await screen.findByRole('button', { name: /8 次点赞/ })).toBeTruthy();
  });

  it('点一下点赞并更新数字', async () => {
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    render(<WorkDetailPage id={42} />);
    fireEvent.click(await screen.findByRole('button', { name: /8 次点赞/ }));

    await waitFor(() => expect(likeWork).toHaveBeenCalledWith(42));
    expect(await screen.findByRole('button', { name: /已赞，9 次点赞/ })).toBeTruthy();
  });

  it('我今天赞过则按钮为已赞且禁用，不能取消点赞', async () => {
    fetchWork.mockResolvedValue(detail({ likes: 9 }));
    fetchLikeState.mockResolvedValue({ likes: 9, liked: true });
    render(<WorkDetailPage id={42} />);
    const btn = await screen.findByRole('button', { name: /已赞/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    // 产品决定：点赞不可取消。再点不能再发请求。
    fireEvent.click(btn);
    expect(likeWork).not.toHaveBeenCalled();
  });

  it('点赞失败时给出提示且数字回滚', async () => {
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    likeWork.mockRejectedValue(new Error('网络炸了'));
    render(<WorkDetailPage id={42} />);
    fireEvent.click(await screen.findByRole('button', { name: /8 次点赞/ }));

    expect(await screen.findByText(/操作失败：网络炸了/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /8 次点赞/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('被限流（429）时给出能看懂的中文提示，不静默失败也不崩', async () => {
    // 判别力来源：后端 429 回的是英文 'too many likes, try again later'。
    // 不翻译的话详情页会把英文甩给中文用户（静默失败的一种）。
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    likeWork.mockRejectedValue(new Error('too many likes, try again later'));
    render(<WorkDetailPage id={42} />);
    fireEvent.click(await screen.findByRole('button', { name: /8 次点赞/ }));

    expect(await screen.findByText(/点得太快/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /8 次点赞/ })).toBeTruthy();
  });

  it('点赞与下载同在操作区里并排（共用一条左对齐轴）', async () => {
    // 用户原话「布局很奇怪」。病根是两个紧挨着的按钮用了两条不同的对齐轴：
    // 点赞 justify-content:center、下载 inline-block 靠左，中间还隔着一组
    // 左对齐的 meta 行。这条把「同辈 + 同一父容器」钉死 —— 回到上下两块时
    // 下面两条布局断言仍然全绿（它们只查文案与 download 属性），
    // 所以这里查的是结构本身。
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    const { container } = render(<WorkDetailPage id={42} />);
    const btn = await screen.findByRole('button', { name: /8 次点赞/ });
    const link = screen.getByRole('link', { name: '下载原图' });
    // 操作区在数据回来后才渲染，所以必须先 await 再查
    const actions = container.querySelector('.works-detail-actions');
    expect(actions).toBeTruthy();
    // 都是操作区的直接子元素（而不是一层 div 里一层 a）
    const kids = Array.from((actions as HTMLElement).children);
    expect(kids).toContain(btn);
    expect(kids).toContain(link);
    // 点赞按钮带着自己的形态 class，样式是它跟下载对齐的依据
    expect(btn.className).toContain('works-detail-like');
  });

  it('点赞用内联 SVG 爱心，不是 ♡ 字符（爱心太小读不出来）', async () => {
    // 字符心形在 12px 下就是一个小点，用户原话「爱心太小了」。改成内联 SVG 后
    // 尺寸/描边写在 SVG 属性上，与列表页排序图标同一套规格。
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    const { container } = render(<WorkDetailPage id={42} />);
    const btn = await screen.findByRole('button', { name: /8 次点赞/ });

    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg!.getAttribute('stroke')).toBe('currentColor');
    expect(svg!.getAttribute('stroke-width')).toBe('1.8');
    // 图形不进朗读：可访问名由 aria-label 给（上面 name: /8 次点赞/ 就是它）
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(btn.textContent).not.toMatch(/[♡♥]/);
    expect(container.querySelector('.works-detail-like-icon')).toBe(svg);
  });

  it('点赞按钮没有把大图包进链接（长按存相册的路不能被破坏）', async () => {
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    const { container } = render(<WorkDetailPage id={42} />);
    await screen.findByRole('button', { name: /8 次点赞/ });
    const img = screen.getByRole('img', { name: '粉色小熊' });

    // <img> 的父链上不允许出现 <a>：包进去会让部分浏览器走下载而不是内联渲染，
    // 微信内置浏览器的「长按存相册」就失效了。
    let node: HTMLElement | null = img.parentElement;
    while (node) {
      expect(node.tagName).not.toBe('A');
      node = node.parentElement;
    }
    // <a download> 只应有一个，且指向原图，不是大图
    const links = Array.from(container.querySelectorAll('a[download]'));
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/media/works/000000000000002a.png');
    // 操作区容器里不许出现图片或 figure：将来若把大图搬进行内做 overlay，
    // 长按手势就会被吞掉，这里提前钉死。
    const actions = container.querySelector('.works-detail-actions') as HTMLElement;
    expect(actions.querySelector('img, figure')).toBeNull();
  });

  it('详情页不监听 popstate（本项目全页跳转，加了也不会触发）', async () => {
    // 设计文档 §5.2 明确「实现时不要加这个监听器」。这里从 addEventListener 反查，
    // 钉住「没有」比钉住「有」难，但正是评审要求防的那条回归。
    const addSpy = vi.spyOn(window, 'addEventListener');
    try {
      fetchWork.mockResolvedValue(detail({ likes: 8 }));
      render(<WorkDetailPage id={42} />);
      await screen.findByRole('button', { name: /8 次点赞/ });
      const types = addSpy.mock.calls.map(c => c[0]);
      expect(types).not.toContain('popstate');
    } finally {
      addSpy.mockRestore();
    }
  });
});

describe('投稿参数展示', () => {
  it('详情页展示图纸比例、豆子数、颜色数与预估工时', async () => {
    // 3814 颗配 384 分钟不是随手编的：estimateAssemblyMinutes(3814) 恰好是 384
    // （3814/600 = 6.4 小时 → ×60）。写成 190 那种「看着合理但与豆子数矛盾」的
    // 值，正是把 64 倍换算 bug 重新引进来的入口 —— 后台 WorksTab.test.tsx 里
    // 有同一件事的记录。
    fetchWork.mockResolvedValue(detail({
      boardW: 87, boardH: 62, beanCount: 3814, colorCount: 42, estimateMinutes: 384,
    }));
    render(<WorkDetailPage id={42} />);
    await screen.findByRole('heading', { name: '粉色小熊' });

    const f = facts();
    expect(f['图纸比例']).toBe('87 × 62 格');
    // toLocaleString 加千分位：3814 颗豆子写成 "3814 颗" 时读者要多读一位对齐
    expect(f['豆子数量']).toBe('3,814 颗');
    expect(f['颜色数量']).toBe('42 种');
    // 384 分钟 → 「约 6.4 小时」。断言完整文案而不是只 toContain('小时')：
    // 只查「小时」二字的话，把 minutes/60 抄错成 minutes/6 也能通过。
    expect(f['预估时间']).toBe('约 6.4 小时');
  });

  it('参数全 0（旧数据没有这些列）时显示「—」而不是 0 或 NaN', async () => {
    // 这五个列是 ensureColumn 加进 works 表的，DEFAULT 0（server/db.ts:196-200），
    // 所以「作品是投稿功能上线前的老数据」在库里就是一个合法状态，不是异常。
    // 显示「0 颗豆子」会被访客当成一张空图，显示 NaN 则是直接把 bug 抖到页面上。
    fetchWork.mockResolvedValue(detail({
      boardW: 0, boardH: 0, beanCount: 0, colorCount: 0, estimateMinutes: 0,
    }));
    render(<WorkDetailPage id={42} />);
    await screen.findByRole('heading', { name: '粉色小熊' });

    const f = facts();
    expect(f['图纸比例']).toBe('—');
    expect(f['豆子数量']).toBe('—');
    expect(f['颜色数量']).toBe('—');
    // 预估工时由 formatMinutes 自己兜底成 '—'（它对 <=0 与 NaN 都返回 '—'），
    // 组件不再重复判一次 > 0 —— 同一个判断写两遍就得同步维护两遍。
    expect(f['预估时间']).toBe('—');
  });

  it('只有一半图纸参数缺失时也按项兜底，不整块塌掉', async () => {
    // boardH 缺失但 boardW 有值是最难看的组合：渲染出 "87 × 0 格" 比不显示更糟，
    // 因为它看起来像一个真实的 87 格宽图纸。
    fetchWork.mockResolvedValue(detail({
      boardW: 87, boardH: 0, beanCount: 0, colorCount: 18, estimateMinutes: 384,
    }));
    render(<WorkDetailPage id={42} />);
    await screen.findByRole('heading', { name: '粉色小熊' });

    const f = facts();
    expect(f['图纸比例']).toBe('—');
    expect(f['颜色数量']).toBe('18 种');
    expect(f['预估时间']).toBe('约 6.4 小时');
  });
});

describe('拿不到作品时自动跳回列表', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * 「断言不跳转」这类用例必须真的等一段时间，而等多久取决于产品的延迟。
   * 早先这里写死 900ms（= 800 + 100），改 REDIRECT_DELAY_MS 之后它就成了跟产品
   * 无关的魔数：调小立刻偶发红。跟着常量走就不会漂。
   *
   * 正向断言（断言跳了）不用这个，而是 waitFor —— 条件一成立就返回，
   * 既不慢也不受机器负载影响。
   */
  const SETTLE = REDIRECT_DELAY_MS + 200;

  /**
   * 「跳转至少要隔这么久」的**独立下限**，刻意不写成 REDIRECT_DELAY_MS。
   *
   * 写成 REDIRECT_DELAY_MS 就是同义反复：把常量改成 0，断言自动变成 >= 0，永远为真，
   * 于是「延迟被改成 0」这件事就彻底没人守了（评审实测过这个缺口）。
   * 这个 300 是产品决定的下限：低于它，提示还没渲染完页面就跳走了，访客只会觉得
   * 「点了没反应」—— 那是明确被否决的取值。真要改产品决定时，这里也该一起改。
   *
   * 它只是下限不是等式，所以把 REDIRECT_DELAY_MS 调大（850、2000…）不会红。
   */
  const MIN_REDIRECT_DELAY_MS = 300;

  function stubLocation() {
    const replace = vi.fn();
    // 必须用 stubGlobal：实测 vi.spyOn(window.location, 'replace') 在本仓库的
    // jsdom 下抛 "TypeError: Cannot redefine property: replace"。
    vi.stubGlobal('location', { replace, pathname: '/works/999', search: '' });
    return replace;
  }

  it('fetchWork 失败时先显示提示，REDIRECT_DELAY_MS 之后 replace 到 /works', async () => {
    const replace = stubLocation();
    fetchWork.mockRejectedValue(new Error('404'));
    const mountedAt = Date.now();
    render(<WorkDetailPage id={999} />);

    // 精确匹配整句，而不是子串正则：「，正在返回作品库…」这半句是给访客看的
    // 承诺（页面会自己跳走），文案一改却没有用例会红，子串匹配全都照过。
    expect(await screen.findByText('作品不存在或已下架，正在返回作品库…')).toBeTruthy();

    // 停顿的时长用「挂载后过了多久」来量，而不是「findByText 回来后还没跳」。
    // 后者是墙钟竞态：机器慢时 findByText 自己就可能耗掉 800ms 以上，
    // 实现完全正确也会红。这里量到的是「跳转真的发生了」的那一刻，
    // 定时器不可能早于 REDIRECT_DELAY_MS 触发，所以这个下限永远不会假红；
    // 上限交给 waitFor 的 timeout，条件一成立就返回，正常情况下不拖时间。
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/works'), { timeout: 5000 });
    expect(Date.now() - mountedAt).toBeGreaterThanOrEqual(MIN_REDIRECT_DELAY_MS);
  });

  it('fetchWork 返回 null 走同一条导航', async () => {
    // 404（fetch reject）与「这条 id 存在但已被删」在接口层是两种返回：
    // 前者走 catch，后者 resolve(null)。访客看到的是同一件事，两条路径都得跳。
    const replace = stubLocation();
    fetchWork.mockResolvedValue(null as never);
    render(<WorkDetailPage id={999} />);
    await screen.findByText(/不存在或已下架/);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/works'), { timeout: 5000 });
  });

  it('用 replace 而不是赋值 location.href（无效详情页不该堆进历史）', async () => {
    const replace = stubLocation();
    fetchWork.mockResolvedValue(null as never);
    render(<WorkDetailPage id={999} />);
    await screen.findByText(/不存在或已下架/);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(replace).toHaveBeenCalledWith('/works');
    // 桩是一个普通对象（不是 jsdom 的 Location），改成赋值 location.href 时
    // 浏览器语义被桩吞掉、不会报错（stub.href 就是一个普通属性），
    // 但 replace 一次都不会被调用 —— 所以上面那条断言本身就是
    // 「用 replace 而不是写 href」的判别器。
  });

  it('拿到作品时不跳转', async () => {
    // 这条守的是「不乱跳」：无条件的导航 effect（漏了 missing 判空）在这里会红。
    // 它对「组件干脆不跳了」没有判别力 —— 那种退化由上面三条红。
    const replace = stubLocation();
    fetchWork.mockResolvedValue(detail({}));
    render(<WorkDetailPage id={42} />);
    await screen.findByRole('heading', { name: '粉色小熊' });
    await wait(SETTLE);
    expect(replace).not.toHaveBeenCalled();
  });

  it('加载中不跳转（数据还没回来就踢走，等于误伤每一次正常访问）', async () => {
    // 承重的一条：missing 的判空必须带上 !loading。请求悬空时 work 仍是 null，
    // 若判空写成 `error !== null || work === null`，正常访客在数据到达前就被
    // 弹回列表页 —— 而且症状是「偶尔闪一下列表页」，极难归因。
    const replace = stubLocation();
    fetchWork.mockReturnValue(new Promise(() => {}));
    render(<WorkDetailPage id={42} />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
    await wait(SETTLE);
    expect(replace).not.toHaveBeenCalled();
  });

  it('从缺失详情换到有效作品时，已经排好的跳转被取消', async () => {
    // 守的是定时器 cleanup。这条路径真实可达：访客停在 /works/999（无效），
    // 点进 /works/43（有效），同一个组件实例只换 id、不重新挂载。少了 cleanup，
    // 缺失阶段排下的那个定时器照样会在 REDIRECT_DELAY_MS 之后开火 ——
    // 访客正在看的那张有效作品图被自己的导航抢走。
    //
    // 这是评审实测出来的覆盖缺口：删掉 return () => clearTimeout(t) 时，
    // 原有 40 条用例全绿，因为「无效页会跳」的三条都停在缺失状态就结束了，
    // 从没让状态翻回「不跳」。
    const replace = stubLocation();
    fetchWork.mockImplementation((id: number) =>
      id === 999
        ? Promise.reject(new Error('404'))
        : Promise.resolve(detail({ id: 43, title: '作品二' }))
    );
    const { rerender } = render(<WorkDetailPage id={999} />);
    await screen.findByText(/不存在或已下架/);

    rerender(<WorkDetailPage id={43} />);
    // 同步点用标题而不是「heading 已存在」：换 id 时组件先保留上一次的 work
    // 再拉新数据，所以旧标题一直在，不能拿它当「新数据到了」的证据。
    await screen.findByRole('heading', { name: '作品二' });

    await wait(SETTLE);
    expect(replace).not.toHaveBeenCalled();
  });
});
