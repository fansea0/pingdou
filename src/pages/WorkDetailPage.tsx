import { useEffect, useState } from 'react';
import { SiteNav } from '@/components/SiteNav';
import { LikeButton } from '@/components/LikeButton';
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
 * 详情页点赞按钮里的爱心：内联 SVG，几何对称版（两段圆弧严格镜像、无凹口）。
 *
 * 为什么 SVG 上**不写** fill / stroke：这两条正是「未赞 / 已赞」的形状开关
 * （空心描边 ↔ 实心填充），写死成呈现属性就没法用 CSS 切换。CSS 规则的优先级
 * 高于 SVG 呈现属性，所以把它们全部交给 WorkDetailPage.css 控制，
 * `.works-like--on` 那条才能干净地换形状而不只是换颜色。
 *
 * 为什么是爱心不是火焰：爱心 = 「点赞」这个动作（列表页浮层徽章也是心形，
 * 同一动作同一符号）；火焰 = 「按最热排序」那个排序方式。
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
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 20.4 4.1 12.5a4.8 4.8 0 0 1 6.8-6.8L12 6.8l1.1-1.1a4.8 4.8 0 1 1 6.8 6.8Z" />
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
          <p>作品不存在或已下架</p>
          <a className="works-detail-btn" href="/works">返回作品库</a>
        </div>
      </div>
    );
  }

  return (
    <div className="app works-detail">
      {/* 标题行：h1 靠左、点赞靠右（用户原话「点赞放在标题那一行的右侧」）。
          flex + space-between 让两极分到容器两端；h1 单行 + ellipsis + min-width:0，
          标题再长也只是自己截断，不会把右边的按钮挤出屏幕。
          这里只加布局，不动 global.css 里 header h1 的字号（--text-2xl / 700，
          ≤900px 压到 18px 是整站外壳一起缩小的规则）。 */}
      <header className="works-detail-header">
        <div className="works-detail-header-row">
          <h1 className="works-detail-title">{work.title}</h1>

          {/*
            点赞放在标题行里而不是 meta 区：它是「顺手赞一下」的轻操作，
            挂在标题上比挂在下面那条主操作轴上更像附属动作，也不会跟
            「下载原图」抢层级。图与这个按钮不在一个容器里，
            点赞碰不到长按存图那条路径。
          */}
          <LikeButton work={work} onError={setLikeError} className="works-detail-like" icon={LIKE_ICON} />
        </div>

        {/* 失败提示跟着按钮走：按钮在标题行，提示就压在标题行正下方（靠右对齐，
            与按钮同一侧），而不是掉到页面中部的 meta 区里离出错源头很远。 */}
        {likeError && (
          <p className="works-detail-like-error" role="status">操作失败：{likeError}</p>
        )}
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
            赞数初值来自 fetchWork 带回来的 WorkDetail.likes（Task 3 起列表/详情接口
            一次 SQL 带回真实计数），挂载后 LikeButton 自己再查一次「我今天赞过没」。
          */}
          {/*
            操作区现在只剩「下载原图」一个按钮 —— 点赞已挪到标题行右侧。
            它是这个页面唯一的任务（「把图拿走」），所以这里不该再有同辈控件
            分它的层级，留一个主操作独占一条左对齐轴。
            同一个 URL 承担两种用途，这是刻意设计：
              被 <img> 引用 → 浏览器内联渲染 → 可长按保存（微信内置浏览器唯一可行路径）
              被带 download 的 <a> 引用 → 浏览器直接下载（微信外浏览器 / Safari / Chrome 桌面）
            所以不需要 Content-Disposition，也不需要 dev 路由与 nginx 各写一套 ?dl=1 分支。
            扩展名从 imageUrl 推，不写死 .png —— 原图不保证是 PNG。
            文件名先过 safeFileName：标题里的 / : 等字符由我们自己替换掉，
            免得落盘名被浏览器事后消毒成另一副样子（理由见 safeFileName 注释）。
          */}
          <div className="works-detail-actions">
            <a
              className="works-detail-btn"
              href={work.imageUrl}
              download={`${safeFileName(work.title)}${imageExt(work.imageUrl)}`}
            >
              下载原图
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
