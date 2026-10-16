import { useEffect, useState } from 'react';
import { SiteNav } from '@/components/SiteNav';
import { fetchWork, type WorkDetail } from '@/api/works';
import { usePageView } from '@/hooks/useTracking';
import './WorkDetailPage.css';

interface WorkDetailPageProps {
  id: number;
}

/**
 * download 属性里的扩展名。
 *
 * 后端 WorkDetail 不暴露 MIME（server/works.ts 的 toDetail 只给 imageUrl），
 * 所以只能从地址后缀推。推得准是因为服务端把扩展名按 MIME 写进了 key
 * （EXT_BY_MIME，server/works.ts:65），而且 /media 的白名单恰好就是这三种
 * （MEDIA_FILENAME_RE，server/index.ts:482）。
 */
const KNOWN_EXTS = new Set(['.png', '.jpg', '.webp']);
const FALLBACK_EXT = '.png';

function imageExt(imageUrl: string): string {
  // (?=[?#]|$) 而不是 $：CDN 加签名参数时后缀不再在末尾
  const m = /\.([a-z0-9]+)(?=[?#]|$)/i.exec(imageUrl);
  const ext = m ? `.${m[1].toLowerCase()}` : '';
  return KNOWN_EXTS.has(ext) ? ext : FALLBACK_EXT;
}

/**
 * 单位阶梯：字节给精确值、KB 取整、MB 保留一位小数。
 * 精度随单位变化是有意的 —— 整数 KB 与系统「属性」面板一致，
 * 写 "240.0 KB" 反而像在假装精确；MB 位数多，一位小数刚好够用。
 * 这是展示用的元数据，不参与任何判定，舍入不影响正确性。
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function WorkDetailPage({ id }: WorkDetailPageProps) {
  usePageView();
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWork(id)
      .then(w => {
        if (cancelled) return;
        setWork(w);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // 三个分支各自早返回，而不是把条件写成 !loading && !error && work && ...。
  // 后者每加一个状态就得改四处组合，漏一处就是「错误态盖掉已渲染内容」
  // 这类静默 bug（列表页就在这个形状上翻过车，见 task-7 报告 5.1/5.2）。
  if (loading) {
    return (
      <div className="app works-detail">
        <SiteNav current={`/works/${id}`} />
        <p className="works-detail-state">加载中…</p>
      </div>
    );
  }

  // 404 和「已下架」返回同样的文案：区分开等于告诉访客这个 id 曾经存在过。
  // 注意这里没有再判 error —— 到这一行时 loading 必为 false，错误与空数据
  // 对访客是同一件事（拿不到这张图），文案也该同一句。
  if (error || !work) {
    return (
      <div className="app works-detail">
        <SiteNav current={`/works/${id}`} />
        <div className="works-detail-state works-detail-state--error">
          <p>作品不存在或已下架</p>
          <a className="works-detail-btn" href="/works">返回作品库</a>
        </div>
      </div>
    );
  }

  return (
    <div className="app works-detail">
      <header>
        <h1>{work.title}</h1>
      </header>

      <SiteNav current={`/works/${id}`} />

      <main className="works-detail-main">
        <figure className="works-detail-figure">
          {/* width/height 属性刻意保留：下面 CSS 是 width:100% + height:auto
              且没有 aspect-ratio，属性推出的固有比例正是原图比例，
              图片没加载完时位置已占好，不会跳版。列表页不写这两个属性
              是因为那里 CSS 固定了 aspect-ratio、属性不参与布局。 */}
          <img
            className="works-detail-img"
            src={work.imageUrl}
            alt={work.title}
            width={work.width || undefined}
            height={work.height || undefined}
          />
          <figcaption className="works-detail-tip">长按图片保存到手机相册</figcaption>
        </figure>

        <section className="works-detail-meta">
          {work.description && <p className="works-detail-desc">{work.description}</p>}
          <dl className="works-detail-facts">
            <div>
              <dt>成品尺寸</dt>
              <dd>{work.width > 0 && work.height > 0 ? `${work.width} × ${work.height}` : '未知'}</dd>
            </div>
            <div>
              <dt>文件体积</dt>
              <dd>{formatBytes(work.bytes)}</dd>
            </div>
          </dl>

          {/*
            同一个 URL 承担两种用途，这是刻意设计：
              被 <img> 引用 → 浏览器内联渲染 → 可长按保存（微信内置浏览器唯一可行路径）
              被带 download 的 <a> 引用 → 浏览器直接下载（微信外浏览器 / Safari / Chrome 桌面）
            所以不需要 Content-Disposition，也不需要 dev 路由与 nginx 各写一套 ?dl=1 分支。
            扩展名从 imageUrl 推，不写死 .png —— 原图不保证是 PNG。
          */}
          <a
            className="works-detail-btn"
            href={work.imageUrl}
            download={`${work.title}${imageExt(work.imageUrl)}`}
          >
            下载原图
          </a>
        </section>
      </main>
    </div>
  );
}
