import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkDetail } from '@/api/works';
import { WorkDetailPage, formatBytes } from './WorkDetailPage';

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
});

/**
 * 用工厂函数而不是字面量常量：WorkDetail 的 updatedAt 是必填的
 * （server/works.ts:23，src/api/works.ts:21），字面量漏掉它会直接
 * typecheck 失败。走工厂之后 overrides 也天然是完整的。
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
    ...overrides,
  };
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
    // 后台建作品时 width/height 可以是 0（server/works.ts normalizeDimension
    // 对非正数返回 0），bytes 也可能是 0。这几条路径不能露出 NaN。
    fetchWork.mockResolvedValue(detail({ width: 0, height: 0, bytes: 0 }));
    const { container } = render(<WorkDetailPage id={42} />);
    await screen.findByRole('heading', { name: '粉色小熊' });
    const facts = container.querySelector('.works-detail-facts') as HTMLElement;
    const values = Array.from(facts.querySelectorAll('dd')).map(dd => dd.textContent);
    expect(values).toEqual(['未知', '未知']);
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

  it('404 / 下架给出提示和回列表入口', async () => {
    fetchWork.mockRejectedValue(new Error('not found'));
    render(<WorkDetailPage id={42} />);
    // 404 与「已下架」刻意共用同一句：区分开等于告诉访客这个 id 曾经存在过
    expect(await screen.findByText(/不存在或已下架/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回作品库' }).getAttribute('href')).toBe('/works');
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

  it('点赞按钮在标题行右侧，底部操作区只剩「下载原图」', async () => {
    // 用户原话「点赞放在标题那一行的右侧」。这条钉的是结构本身：
    // 点赞是 header 那一行的直接子元素（h1 与它同辈），下载独占底部操作区。
    // 回到「点赞在 meta 区、与下载并排」时下面两条文案/download 断言仍然全绿，
    // 所以只有结构断言能拦住这种回退。
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    const { container } = render(<WorkDetailPage id={42} />);
    const btn = await screen.findByRole('button', { name: /8 次点赞/ });

    const row = container.querySelector('.works-detail-header-row') as HTMLElement;
    expect(row).toBeTruthy();
    // h1 与点赞按钮是同一行的两个直接子元素
    expect(Array.from(row.children)).toEqual([screen.getByRole('heading', { name: '粉色小熊' }), btn]);
    expect(row.closest('header')).toBeTruthy();

    // 底部操作区只剩下载，且它仍是直接子元素（没有多包一层）
    const actions = container.querySelector('.works-detail-actions') as HTMLElement;
    expect(Array.from(actions.children)).toEqual([screen.getByRole('link', { name: '下载原图' })]);
    // 点赞按钮带着自己的形态 class，胶囊样式是它跟标题行对齐的依据
    expect(btn.className).toContain('works-detail-like');
  });

  it('点赞失败提示紧跟在标题行下方（不在 meta 区里）', async () => {
    // 按钮搬到标题行后，提示必须跟着走 —— 否则「点得太快啦」会出现在页面中部
    // 离出错源头很远的地方。这条钉的是提示与按钮同处一个 header。
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    likeWork.mockRejectedValue(new Error('too many likes, try again later'));
    const { container } = render(<WorkDetailPage id={42} />);
    fireEvent.click(await screen.findByRole('button', { name: /8 次点赞/ }));

    const err = await screen.findByText(/操作失败：点得太快啦/);
    expect((err as HTMLElement).closest('header')).toBeTruthy();
    expect(container.querySelector('.works-detail-like-error')).toBe(err);
  });

  it('已赞态下爱心换成实心填充，不只是换颜色', async () => {
    // 用户原话「没有记录是否已经点赞，只是展示了点赞数量」。病根是未赞/已赞
    // 是同一颗心、只换颜色 —— 远看只能读出一个数字。这条钉住形状开关：
    //   未赞 path 无 fill/stroke 属性（由 CSS 控制）+ 默认态 CSS 是空心描边
    //   已赞 CSS 那条规则是 fill:currentColor + stroke:none
    // 只断言 class 名是不够的 —— class 一直在，改回「只换颜色」照样全绿。
    fetchWork.mockResolvedValue(detail({ likes: 9 }));
    fetchLikeState.mockResolvedValue({ likes: 9, liked: true });
    const { container } = render(<WorkDetailPage id={42} />);
    const btn = await screen.findByRole('button', { name: /已赞，9 次点赞/ });
    expect(btn.className).toContain('works-like--on');

    const svg = btn.querySelector('svg') as SVGSVGElement;
    const path = btn.querySelector('svg path') as SVGPathElement;
    expect(path).toBeTruthy();
    // fill / stroke 必须是纯 CSS 控制：SVG 呈现属性一旦写在这里（svg 或 path 上都算），
    // 下面的 .works-like--on 规则就再也切不动形状了。旧版本正是写在 <svg> 上的。
    for (const el of [svg, path] as Element[]) {
      expect(el.hasAttribute('fill')).toBe(false);
      expect(el.hasAttribute('stroke')).toBe(false);
    }

    // vitest 默认不注入样式表，getComputedStyle 读不到值会空跑，
    // 所以直接查 CSS 源码（与 RegionStatsPanel.test.tsx 同一个理由）。
    const css = readFileSync(resolve(process.cwd(), 'src/pages/WorkDetailPage.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const offRule = css.slice(css.indexOf('.works-detail-like-icon path'));
    expect(offRule.slice(0, offRule.indexOf('}'))).toMatch(/fill:\s*none/);
    const onRule = css.slice(css.indexOf('.works-detail-like.works-like--on .works-detail-like-icon path'));
    const onBody = onRule.slice(0, onRule.indexOf('}'));
    expect(onBody).toMatch(/fill:\s*currentColor/);
    expect(onBody).toMatch(/stroke:\s*none/);
    // 过渡也不能丢：否则切换是硬跳，两态的区别更读不出来
    expect(css).toMatch(/transition:\s*fill 0\.18s[^;]*stroke 0\.18s/);
    expect(container.querySelector('.works-detail-like-icon path')).toBe(path);
  });

  it('点赞用内联 SVG 爱心，不是 ♡ 字符（爱心太小读不出来）', async () => {
    // 字符心形在 12px 下就是一个小点，用户原话「爱心太小了」。改成内联 SVG 后
    // 几何对称路径（两段圆弧严格镜像）+ 18px 内联尺寸。
    fetchWork.mockResolvedValue(detail({ likes: 8 }));
    const { container } = render(<WorkDetailPage id={42} />);
    const btn = await screen.findByRole('button', { name: /8 次点赞/ });

    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg!.getAttribute('width')).toBe('18');
    expect(svg!.getAttribute('stroke-linecap')).toBe('round');
    // 图形不进朗读：可访问名由 aria-label 给（上面 name: /8 次点赞/ 就是它）
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(svg!.getAttribute('focusable')).toBe('false');
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
