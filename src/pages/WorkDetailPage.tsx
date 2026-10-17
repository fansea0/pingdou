import { useEffect, useState } from 'react';
import { SiteNav } from '@/components/SiteNav';
import { LikeButton } from '@/components/LikeButton';
import { fetchWork, type WorkDetail } from '@/api/works';
import { usePageView } from '@/hooks/useTracking';
import { formatMinutes } from '@/pipeline/timeEstimate';
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

/**
 * Windows 禁止的 9 个文件名字符 + 路径分隔符。
 *
 * 为什么需要它：标题是用户可输入的，后端 normalizeTitle 只 trim 和截断，
 * 不过滤 `/`（评审起真实后端上传过含 `/` 的标题，原样入库）。
 *
 * 注意这不是「防路径穿越」—— 浏览器在落盘时本来就会把这些字符消毒成 `_`，
 * 不存在写出目录的风险。改这里的收益只是让落盘文件名符合我们的预期
 * （与浏览器自己会做的替换一致，而不是换个字符），避免出现「标题里的
 * `/` 恰好在 `.` 前面、结果扩展名被算错」这类外观问题。
 */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/*
 * 详情页点赞按钮里的爱心：内联 SVG。
 *
 * 与 WorksListPage 的排序图标同一套规格（viewBox 0 0 24 24、fill=none、
 * stroke=currentColor、圆形/折角端点），差别只在尺寸与描边：这里 18px / 1.8，
 * 比排序的 20px / 1.6 略重一点点 —— 按钮更大、心形要靠描边而不是面积说话，
 * 17px 上下糊成黑团的风险更高。
 *
 * 为什么是爱心不是火焰：爱心 = 「点赞」这个动作（列表页浮层徽章也是心形，
 * 同一动作同一符号）；火焰 = 「按最热排序」那个排序方式。两者一个是动作、
 * 一个是排序，不是同一个东西，共存不矛盾。
 *
 * aria-hidden：可访问名一律由 <button> 的 aria-label（「N 次点赞」/「已赞，N 次点赞」）
 * 提供，图形不进朗读。
 */
const LIKE_ICON = (
  <svg
    className="works-detail-like-icon"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

function safeFileName(title: string): string {
  return title.replace(UNSAFE_FILENAME_CHARS, '_').trim() || 'work';
}

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
  // 点赞失败提示。LikeButton 负责乐观更新与回滚，只把「给人看的文案」交上来，
  // 错误由这一层渲染 —— 与列表页 WorksListPage 的 likeError 同一形状。
  const [likeError, setLikeError] = useState<string | null>(null);

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

  /**
   * 「这张图拿不到」——包括接口报错和接口成功但没有这条数据两种情况。
   *
   * !loading 不能省：请求悬空时 work 还是 null，去掉它就等于每次正常访问
   * 在数据到达前先触发一次导航，症状是列表页莫名闪一下，极难归因。
   */
  const missing = error !== null || (!loading && work === null);

  /**
   * 拿不到作品时自动跳回列表页。
   *
   * 用 location.replace 而不是赋值 location.href：无效详情页不该留在浏览器
   * 历史里，否则访客按「后退」会被反复弹回这一页，历史记录越按越乱。
   *
   * 延迟 800ms 是为了让人读完提示：0 延迟的话提示根本来不及渲染，直接闪回列表，
   * 访客只会觉得「点了没反应」。延迟期间组件仍然显示提示，不做空白。
   *
   * 依赖只写 [missing]：作品到位后 missing 翻 false，cleanup 会把还没触发的
   * 定时器清掉，不会出现「已经跳走了却还在跑定时器」的尾巴。
   */
  useEffect(() => {
    if (!missing) return;
    const t = window.setTimeout(() => window.location.replace('/works'), 800);
    return () => window.clearTimeout(t);
  }, [missing]);

  // 三个分支各自早返回，而不是把条件写成 !loading && !error && work && ...。
  // 后者每加一个状态就得改四处组合，漏一处就是「错误态盖掉已渲染内容」
  // 这类静默 bug（列表页就在这个形状上翻过车，见 task-7 报告 5.1/5.2）。
  if (loading) {
    return (
      <div className="app works-detail">
        <SiteNav current={`/works/${id}`} />
        {/* 两态都在首次请求返回之后才出现 —— 那时 SR 用户已经听完了文档标题，
            没有 live region 就不会播报。这里沿用 App.tsx:273 toast 的写法
            （role="status" + aria-live="polite"），不引入 role="alert"：
            错误态对访客是普通信息，不是需要打断当前朗读的紧急事件。 */}
        <p className="works-detail-state" role="status" aria-live="polite">加载中…</p>
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
        <div
          className="works-detail-state works-detail-state--error"
          role="status"
          aria-live="polite"
        >
          <p>作品不存在或已下架，正在返回作品库…</p>
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
            {/*
              2026-10-17 投稿参数。四项都允许全 0：这几列是 ensureColumn 补进
              works 表的，DEFAULT 0（server/db.ts:196-200），所以「这张图是投稿功能
              上线前的老数据」在库里就是个合法状态，不是异常。
              显示「—」而不是 0：「0 颗豆子」「0 × 0 格」会被访客当成一张空图或
              一张坏图，而不是「这个我们没记」。
              图纸比例按两项一起判：只判 boardW 会渲染出「87 × 0 格」，
              那比不显示更糟 —— 它看起来像一张真实的窄条图纸。
            */}
            <div>
              <dt>图纸比例</dt>
              <dd>{work.boardW > 0 && work.boardH > 0 ? `${work.boardW} × ${work.boardH} 格` : '—'}</dd>
            </div>
            <div>
              <dt>豆子数量</dt>
              <dd>{work.beanCount > 0 ? `${work.beanCount.toLocaleString()} 颗` : '—'}</dd>
            </div>
            <div>
              <dt>颜色数量</dt>
              <dd>{work.colorCount > 0 ? `${work.colorCount} 种` : '—'}</dd>
            </div>
            <div>
              <dt>预估时间</dt>
              {/* 存的是分钟、显示要换回小时，所以必须走 formatMinutes（timeEstimate.ts），
                  不能在这里写 estimateMinutes / 60：后台审核队列读同一列，
                  两处各写一遍换算，早晚有一处漏掉那个 60，类型系统不会报。
                  它对 <=0 与 NaN 自己就返回 '—'，组件不必再判一次。 */}
              <dd>{formatMinutes(work.estimateMinutes)}</dd>
            </div>
          </dl>

          {/*
            赞数初值来自 fetchWork 带回来的 WorkDetail.likes（Task 3 起列表/详情接口
            一次 SQL 带回真实计数），挂载后 LikeButton 自己再查一次「我今天赞过没」。
            图与「下载原图」链接都在这个 section 之外，点赞不会碰到长按存图那条路径。
          */}
          {/*
            点赞与下载放在同一个 flex 行里，两个控件共用一条左对齐轴 ——
            它们是「把这张图拿走 / 顺手赞一下」的同辈操作，不再是上下两个
            各占一行的独立块（以前点赞居中、下载靠左，两条不同的对齐轴夹着
            一组左对齐的 meta 行，就是用户说的「布局奇怪」）。
            flex-wrap：窄屏一行放不下就换行，换行后仍从左起点开始（默认行为）。
          */}
          <div className="works-detail-actions">
            <LikeButton work={work} onError={setLikeError} className="works-detail-like" icon={LIKE_ICON} />

            {/*
              同一个 URL 承担两种用途，这是刻意设计：
                被 <img> 引用 → 浏览器内联渲染 → 可长按保存（微信内置浏览器唯一可行路径）
                被带 download 的 <a> 引用 → 浏览器直接下载（微信外浏览器 / Safari / Chrome 桌面）
              所以不需要 Content-Disposition，也不需要 dev 路由与 nginx 各写一套 ?dl=1 分支。
              扩展名从 imageUrl 推，不写死 .png —— 原图不保证是 PNG。
              文件名先过 safeFileName：标题里的 / : 等字符由我们自己替换掉，
              免得落盘名被浏览器事后消毒成另一副样子（理由见 safeFileName 注释）。
            */}
            <a
              className="works-detail-btn"
              href={work.imageUrl}
              download={`${safeFileName(work.title)}${imageExt(work.imageUrl)}`}
            >
              下载原图
            </a>
          </div>
          {likeError && (
            <p className="works-detail-like-error" role="status">操作失败：{likeError}</p>
          )}
        </section>
      </main>
    </div>
  );
}
