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
        {/* 排序收进搜索框内部（作为输入框右侧的后缀控件），不再另占一行或一列宽度。
            ✕ 只在有内容时挂载，所以它与排序的避让交给 CSS：
            works-search--filled 才把 ✕ 要的那 44px 加进输入框的 padding-right，
            两者的横向位置都从同一个 --works-sort-w 推导，不可能互相压住。 */}
        <div className={query ? 'works-search works-search--filled' : 'works-search'}>
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

          <div className="works-sort" role="group" aria-label="排序方式">
            <button
              type="button"
              aria-pressed={sort === 'latest'}
              className={sort === 'latest' ? 'works-sort-btn works-sort-btn--on' : 'works-sort-btn'}
              onClick={() => setSort('latest')}
            >最新</button>
            <button
              type="button"
              aria-pressed={sort === 'hot'}
              className={sort === 'hot' ? 'works-sort-btn works-sort-btn--on' : 'works-sort-btn'}
              onClick={() => setSort('hot')}
            >最热</button>
          </div>
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
            <p className="works-count">
              {trimmed
                ? <>找到 {total} 件与「{trimmed}」相关的作品</>
                : <>共 {total} 件</>}
            </p>
            <ul className="works-grid">
              {items.map(w => (
                <li key={w.id} className="works-card">
                  {/* 结构约束（三条同时成立才合法）：
                      1) 标题必须留在 <a> 里 —— img 的 alt 是刻意留空的，
                         链接的可访问名全靠这段文字，挪出去链接就成了空名字。
                      2) <button> 不能嵌套在 <a> 里 —— 那是无效 HTML，
                         点它到底跳不跳详情页各家浏览器行为不一致。
                      3) 所以点赞按钮是 <a> 的兄弟，靠 position:absolute
                         压在图片右下角（见 WorksListPage.css 的 .works-card-like）。
                      日期一并去掉：它曾独占卡片底部一整行，也是「作品太大了」
                      的一半原因。发布日期不是找图的必要信息。 */}
                  <a href={`/works/${w.id}`} className="works-card-link">
                    {/* alt 留空是刻意的：标题文字就在同一张 <a> 里，
                        再给 img 一份 alt 会让链接的可访问名变成「标题标题」，
                        屏幕阅读器读两遍，getByRole('link', {name}) 也匹配不上。
                        也不写 width/height 属性：它们是原图尺寸，而下面 CSS 强制
                        4:5 的框，浏览器按 CSS aspect-ratio 预留位置，留着只会误导。 */}
                    <img
                      className="works-card-img"
                      src={w.thumbUrl}
                      alt=""
                      loading="lazy"
                    />
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
