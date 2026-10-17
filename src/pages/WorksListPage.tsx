import { useEffect, useState } from 'react';
import { LikeButton } from '@/components/LikeButton';
import { SiteNav } from '@/components/SiteNav';
import { useWorks } from '@/hooks/useWorks';
import { usePageView } from '@/hooks/useTracking';
import { parseListQuery } from '@/router';
import './WorksListPage.css';

/**
 * 每页 10 条（产品决定，原为 20）。显式传给 useWorks 而不是改 hook 的
 * PAGE_SIZE 默认值 —— 那个默认值还服务着别的调用方，这里只让作品库走 10。
 */
const PAGE_SIZE = 10;

/*
 * 排序图标：内联 SVG。
 *
 * 不用 emoji 字符 —— emoji 在各系统的字形/基线/颜色都不可控，20px 下会糊成
 * 一团彩色噪点，正好毁掉「轻图标」这件事；也不为此新增图标库依赖（项目目前
 * 没有，两个图标不值得）。
 *
 * 统一规格：viewBox 0 0 24 24、fill=none、stroke=currentColor（跟着主题色走）、
 * stroke-width 1.6、strokeLinecap/Linejoin=round（和这个站点柔和圆角的语言
 * 一致），页面内实际 20px。
 * 描边粗细写在 CSS 里（.works-sort-icon / --on 状态）：stroke-width 只是
 * presentation attribute，同权重的 CSS 规则能覆盖它，选中态加粗才不必两处各写一份。
 * aria-hidden：可访问名一律由外层 <button> 的 aria-label 提供。
 */
const SORT_ICONS = {
  // 最新 → 时钟：时间 / 最新添加
  latest: (
    <svg
      className="works-sort-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </svg>
  ),
  // 最热 → 火焰：本站的热度就是点赞数，图标与数据同构，比任何文字标签都直观
  hot: (
    <svg
      className="works-sort-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 21c3.6 0 6.5-2.7 6.5-6.2 0-4.6-4.3-6.4-4.3-10.8-2.4 1.6-3.7 3.6-3.7 5.6 0 1.3.5 2 .5 2.9 0 .9-.7 1.6-1.5 1.6-.9 0-1.6-.7-1.7-1.6-1 1.2-1.3 2.4-1.3 2.6C5.5 18.3 8.4 21 12 21z" />
    </svg>
  ),
} as const;

export function WorksListPage() {
  usePageView();
  const {
    items, total, loading, loadingMore, error, loadMoreError, hasMore, loadMore, reload,
    query, setQuery, sort, setSort,
  } = useWorks(PAGE_SIZE);
  const [likeError, setLikeError] = useState<string | null>(null);

  // 进页面时从 URL 读初值：刷新、分享、从详情页后退回来都保留搜索词。
  // 一次性读取就够了 —— 本项目没有 client-side 路由，页面每次导航都重新挂载，
  // 所以刻意不加 popstate 监听（加了也不会触发，见设计文档 §5.2）。
  const [initial] = useState(() =>
    parseListQuery(typeof window !== 'undefined' ? window.location.search : ''),
  );
  const [urlReady, setUrlReady] = useState(false);
  useEffect(() => {
    if (initial.q) setQuery(initial.q);
    if (initial.sort !== 'latest') setSort(initial.sort);
    // 置位后本轮渲染带着回填好的 query/sort，URL 同步 effect 不会先把
    // ?q=xxx 抹成空再写回去（那一下闪动在分享链接上尤其难看）。
    setUrlReady(true);
  }, [initial.q, initial.sort, setQuery, setSort]);

  // 搜索词 / 排序写回 URL，让刷新和分享都能保留。
  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (sort !== 'latest') params.set('sort', sort);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    // replaceState 而不是 pushState：搜索框每敲一个字都 push 一次的话，
    // 历史栈会被几十个中间态塞满，用户按「后退」得按几十次才回得去。
    window.history.replaceState(null, '', url);
  }, [urlReady, query, sort]);

  const trimmed = query.trim();

  return (
    <div className="app works-page">
      {/* 标题区的收紧样式挂在 works-head 上（见 WorksListPage.css）：
          global.css 里的 header h1 / .subtitle 是三个页面共用的，不能动。 */}
      <header className="works-head">
        <h1>作品库</h1>
        <p className="subtitle">站主挑好的拼豆图纸，扫码或点进来就能拿走</p>
      </header>

      <SiteNav current="/works" />

      <div className="works-controls">
        {/* 搜索框回归单一职责：只管输入。排序已经移到「共 N 件」那一行，
            这里不再有任何为了给排序腾位置的派生宽度（--works-sort-w /
            --works-search-right / works-search--filled 全部已删）。
            ✕ 只在有内容时挂载，输入框右侧固定留出的 44px 就是它的位置。 */}
        <div className="works-search">
          <input
            type="search"
            className="works-search-input"
            placeholder="搜作品名…"
            aria-label="搜索作品"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="works-search-clear"
              aria-label="清空搜索框"
              onClick={() => setQuery('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <main className="works-main">
        {likeError && (
          <p className="works-like-error" role="status">点赞失败：{likeError}</p>
        )}

        {loading && <p className="works-state">加载中…</p>}

        {!loading && error && (
          <div className="works-state works-state--error">
            <p>加载失败：{error.message}</p>
            <button type="button" className="works-btn" onClick={reload}>重试</button>
          </div>
        )}

        {/* 「共 N 件 + 排序」这一行：只要这一屏请求成功（无 error）就渲染，空结果也渲染。
            两条理由：
            1) 排序跟着这一行走。如果把这一行关进 items.length > 0 里，空库 / 搜不到
               东西时排序控件会整块消失 —— 而那恰恰是最需要它的场景（搜错了，换成
               「最热」也许能翻出东西；空库时也该让人看清当前排序口径）。
            2) 它必须排在所有状态块「之前」。它回答的是「我在看什么」，是列表区的抬头；
               放到状态块之后，空库时这一行会掉到「还没有上传作品」下面，同一个控件
               在有无结果时出现在两个不同的高度上，看起来像出了 bug。
            文案沿用原有的两句话，N=0 时读作「共 0 件」/「找到 0 件与「x」相关的作品」，
            没有新增任何面向用户的措辞。 */}
        {!loading && !error && (
          <div className="works-count">
            <span className="works-count-text">
              {trimmed
                ? <>找到 {total} 件与「{trimmed}」相关的作品</>
                : <>共 {total} 件</>}
            </span>
            {/* 保持两个可见按钮而不是单个循环切换：两个模式同时可见，
                用户才知道「切过去会是什么」，不存在假可供性。
                文字标签搬到了 aria-label / title 上。 */}
            <div className="works-sort" role="group" aria-label="排序方式">
              <button
                type="button"
                aria-pressed={sort === 'latest'}
                aria-label="按最新排序"
                title="最新"
                className={sort === 'latest' ? 'works-sort-btn works-sort-btn--on' : 'works-sort-btn'}
                onClick={() => setSort('latest')}
              >{SORT_ICONS.latest}</button>
              <button
                type="button"
                aria-pressed={sort === 'hot'}
                aria-label="按最热排序"
                title="最热"
                className={sort === 'hot' ? 'works-sort-btn works-sort-btn--on' : 'works-sort-btn'}
                onClick={() => setSort('hot')}
              >{SORT_ICONS.hot}</button>
            </div>
          </div>
        )}

        {/* 空状态分两种：库里压根没作品 vs 有作品但没搜到。混成一句「暂无数据」
            会让搜错词的用户以为站里是空的。 */}
        {!loading && !error && items.length === 0 && (
          trimmed ? (
            <div className="works-state">
              <p>没有找到与「{trimmed}」相关的作品，换个词试试。</p>
              <button type="button" className="works-btn" onClick={() => setQuery('')}>
                清除搜索
              </button>
            </div>
          ) : (
            <div className="works-state">
              <p>还没有上传作品。</p>
              <a className="works-btn" href="/">去生成第一个图纸</a>
            </div>
          )
        )}

        {!loading && !error && items.length > 0 && (
          <>
            <ul className="works-grid">
              {items.map(w => (
                <li key={w.id} className="works-card">
                  {/* 结构约束（三条同时成立才合法）：
                      1) 标题必须留在 <a> 里 —— img 的 alt 是刻意留空的，
                         链接的可访问名全靠这段文字，挪出去链接就成了空名字。
                      2) <button> 不能嵌套在 <a> 里 —— 那是无效 HTML，
                         点它到底跳不跳详情页各家浏览器行为不一致。
                      3) 所以点赞按钮是 <a> 的兄弟，靠 position:absolute
                         钉在标题行的右端（见 WorksListPage.css 的 .works-card-like）。
                         标题行本身就是 44px（--works-title-h），按钮的触摸区
                         整个落在行内，不会压到图片上。
                      日期一并去掉：它曾独占卡片底部一整行，也是「作品太大了」
                      的一半原因。发布日期不是找图的必要信息。 */}
                  <a href={`/works/${w.id}`} className="works-card-link">
                    {/* alt 留空是刻意的：标题文字就在同一张 <a> 里，
                        再给 img 一份 alt 会让链接的可访问名变成「标题标题」，
                        屏幕阅读器读两遍，getByRole('link', {name}) 也匹配不上。
                        也不写 width/height 属性：它们是原图尺寸，而下面 CSS 强制
                        4:5 的框，浏览器按 CSS aspect-ratio 预留位置，留着只会误导。 */}
                    {/* thumbUrl 为空就是「这件作品没有图」：两列 key 都空时，服务端算出来
                        的正是空串，而不是一个能取到图的地址（server/works.ts 的
                        publicUrlOrEmpty）。
                        这里必须挡：空 src 不是「不发请求」，浏览器会拿当前页地址再请求一次，
                        要么画破图、要么把整页当图片拉一遍，访客只会以为站点坏了。
                        判断用真值而不是 === ''：undefined 与空串落进同一个分支，
                        顺带兜住，不是在断言线上真出现过缺字段的响应。
                        占位框复用 .works-card-img 的 4:5 尺寸，网格才不会因这条
                        行而塌一块。
                        aria-hidden 是必须的：它待在 <a> 里，一旦被读屏念出来，链接的
                        可访问名就变成「标题暂无图片」，上面那条 alt 留空的约束
                        （名字只能来自标题文字）就白写了。占位是视觉说明，不是链接名。 */}
                    {w.thumbUrl ? (
                      <img
                        className="works-card-img"
                        src={w.thumbUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="works-card-img works-card-img-empty" aria-hidden="true">
                        暂无图片
                      </span>
                    )}
                    <span className="works-card-title">{w.title}</span>
                  </a>
                  {/* 点赞只改自己的数字，不回调父级、不排序 —— 列表顺序
                      一律以服务端本次响应为准（设计文档 §4.2.1）。 */}
                  <LikeButton
                    work={w}
                    onError={setLikeError}
                    className="works-card-like"
                  />
                </li>
              ))}
            </ul>

            {(hasMore || loadMoreError) && (
              <div className="works-more">
                {hasMore && (
                  <button
                    type="button"
                    className="works-btn"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? '加载中…' : '加载更多'}
                  </button>
                )}
                {/* 翻页失败留在列表底部：卡片都还在，只是多一句提示 */}
                {loadMoreError && (
                  <p className="works-more-error">
                    加载更多失败：{loadMoreError.message}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>© 拼豆图生成器 · 仅作手工参考 · 颜色归各品牌所有</p>
      </footer>
    </div>
  );
}
