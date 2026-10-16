import { SiteNav } from '@/components/SiteNav';
import { useWorks } from '@/hooks/useWorks';
import { usePageView } from '@/hooks/useTracking';
import './WorksListPage.css';

export function WorksListPage() {
  usePageView();
  const {
    items, total, loading, loadingMore, error, loadMoreError, hasMore, loadMore, reload,
  } = useWorks();

  return (
    <div className="app works-page">
      <header>
        <h1>作品库</h1>
        <p className="subtitle">站主挑好的拼豆图纸，扫码或点进来就能拿走</p>
      </header>

      <SiteNav current="/works" />

      <main className="works-main">
        {loading && <p className="works-state">加载中…</p>}

        {!loading && error && (
          <div className="works-state works-state--error">
            <p>加载失败：{error.message}</p>
            <button type="button" className="works-btn" onClick={reload}>重试</button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="works-state">
            <p>还没有作品。</p>
            <a className="works-btn" href="/">去生成第一个图纸</a>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <>
            <p className="works-count">共 {total} 件</p>
            <ul className="works-grid">
              {items.map(w => (
                <li key={w.id} className="works-card">
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
