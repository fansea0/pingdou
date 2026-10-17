import { useCallback, useEffect, useState } from 'react';
import {
  adminApproveWork,
  adminDeleteWork,
  adminListWorks,
  adminRejectWork,
  adminUpdateWork,
  type AdminWorkDetail,
} from '@/api/works';
import { formatMinutes } from '@/pipeline/timeEstimate';
import './WorksTab.css';

type Section = 'pending' | 'gallery' | 'rejected';

/**
 * 状态 → 展示区。gallery 同时装已上架与已下架（都是审核通过的），
 * 上下架只是这一区里两种状态标签，不是分区依据 —— 否则站主每次下架一次，
 * 作品就要从列表上半部分跳到下半部分，位置记不住。
 */
function sectionOf(w: AdminWorkDetail): Section {
  if (w.status === 'pending') return 'pending';
  if (w.status === 'rejected') return 'rejected';
  return 'gallery';
}

function ThumbOrPlaceholder({ work }: { work: AdminWorkDetail }) {
  // rejected 的源文件在审核时就删掉了，画 <img> 只会得到一个 404 破图。
  // image_key 字符串保留在库里是审计线索，不是可访问地址。
  if (work.status === 'rejected') {
    return <span className="works-admin-flag">源文件已删除</span>;
  }
  // 孤儿 pending 行（投稿第一步成功、第二步上传没做成）：thumb_key 与 image_key
  // 都是空，服务端把 thumbUrl 算成空串而不是 '/media/'（server/works.ts 的
  // publicUrlOrEmpty）。空 src 一样是一次破图请求/一次对着当前页的请求，所以
  // 这里必须挡，不能只修服务端那一半。
  // 这里只占位不出声：这一行的说明由下面字段区的「图片未上传」标记承担，
  // 同一行说两遍会被当成两个问题。
  if (!work.thumbUrl) {
    return <span className="works-admin-flag" aria-hidden="true" />;
  }
  return <img className="works-admin-thumb" src={work.thumbUrl} alt="" />;
}

export function WorksTab() {
  const [works, setWorks] = useState<AdminWorkDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * 每个作品正在编辑、尚未保存的字段。草稿存在期间输入框显示草稿值，保存成功、
   * 草稿清空后回落成服务端返回值 —— 于是「服务端规范化后的值」（trim / 超长截断）
   * 照样能刷进界面，不用靠 key 强制重挂载（那会在用户打字途中吞掉未保存的输入）。
   */
  const [drafts, setDrafts] = useState<Record<number, { title?: string; description?: string }>>({});

  const reload = useCallback(() => {
    setLoading(true);
    adminListWorks()
      .then((w) => { setWorks(w); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  /**
   * 只把响应里真正变动的字段合并回列表，而不是整对象替换。
   * 两次 PUT/审核并发返回乱序时，整对象替换会让后到的**旧**快照把先到的更新
   * 整体盖掉（改标题顺手把刚切换的上架状态退回去）。同字段仍是后写为准，
   * 但跨字段的互相踩踏没了。
   */
  const patch = useCallback((id: number, next: Partial<AdminWorkDetail>) => {
    setWorks((prev) => prev.map((w) => (w.id === id ? { ...w, ...next } : w)));
  }, []);

  const dropDraft = useCallback((id: number) => {
    setDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /**
   * 审核动作：乐观更新 + 失败回滚。
   *
   * 先动界面再发请求，是因为审核是连续动作：站主通常一次要过好几条，等 400ms
   * 往返再看到行挪走，人会以为没点上而重复点击。
   *
   * 回滚只还原**本次改动的字段**（status / published），不是把整对象换回旧快照：
   * 两次审核并发时整对象回滚会把对方刚做的改动一起盖掉。
   */
  const runReview = useCallback(
    async (work: AdminWorkDetail, action: 'approve' | 'reject') => {
      const prev = { status: work.status, published: work.published };
      const next = action === 'approve'
        ? { status: 'approved' as const, published: true }
        : { status: 'rejected' as const, published: false };
      // 确认放在发请求之前、乐观更新之前：用户点了「取消」就什么都没发生，
      // 不该留下一条已经翻过状态的行再被悄悄改回去。
      // 拒绝会连带永久删除源文件，必须二次确认 —— 静默删除比误删更糟。
      if (action === 'reject'
        && !window.confirm(`拒绝「${work.title}」？源文件会被永久删除，无法恢复。`)) return;
      setError(null);
      patch(work.id, next);
      try {
        const saved = action === 'approve'
          ? await adminApproveWork(work.id)
          : await adminRejectWork(work.id);
        patch(work.id, { updatedAt: saved.updatedAt });
      } catch (e) {
        patch(work.id, prev);
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [patch],
  );

  const togglePublished = useCallback(
    async (work: AdminWorkDetail) => {
      const prevPublished = work.published;
      const next = !prevPublished;
      setError(null);
      patch(work.id, { published: next });
      try {
        const saved = await adminUpdateWork(work.id, { published: next });
        patch(work.id, { published: saved.published, updatedAt: saved.updatedAt });
      } catch (e) {
        patch(work.id, { published: prevPublished });
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [patch],
  );

  const remove = useCallback(
    async (work: AdminWorkDetail) => {
      if (!window.confirm(`彻底删除「${work.title}」？记录和文件都会消失，无法恢复。`)) return;
      setError(null);
      try {
        await adminDeleteWork(work.id);
        // 草稿也要一起清：行没了而草稿还留着，drafts 会随历史投稿无上限增长
        dropDraft(work.id);
        setWorks((prev) => prev.filter((w) => w.id !== work.id));
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [dropDraft],
  );

  const saveMeta = useCallback(
    async (work: AdminWorkDetail, patchIn: { title?: string; description?: string }) => {
      setError(null);
      try {
        const saved = await adminUpdateWork(work.id, patchIn);
        // 只合并本次请求动过的字段：服务端没参与本次改动的字段不该被旧值带回来
        patch(work.id, {
          ...(typeof patchIn.title === 'string' ? { title: saved.title } : {}),
          ...(typeof patchIn.description === 'string' ? { description: saved.description } : {}),
          updatedAt: saved.updatedAt,
        });
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [patch],
  );

  const renderRow = (work: AdminWorkDetail) => {
    const d = drafts[work.id];
    const sec = sectionOf(work);
    return (
      <li key={work.id} className="works-admin-item" data-section={sec}>
        <ThumbOrPlaceholder work={work} />
        <div className="works-admin-fields">
          {/* 受控 + 草稿态，**不要**改回 defaultValue + key 强制重挂载：
              那样任何一次保存成功都会重挂载输入框，用户 blur 后立刻点回来继续
              打字时，那段未保存的输入会被静默丢弃。 */}
          <input
            type="text"
            value={d?.title ?? work.title}
            aria-label={`${work.title} 标题`}
            onChange={(e) =>
              setDrafts((p) => ({ ...p, [work.id]: { ...p[work.id], title: e.target.value } }))
            }
            onBlur={(e) => {
              const v = e.target.value;
              dropDraft(work.id);
              if (v !== work.title) saveMeta(work, { title: v });
            }}
          />

          {/* 图纸参数只在待审核区出现：它们是审核的判断依据（这活儿值不值
              6.4 小时），审核完就是历史信息，挂在那儿只是噪声。 */}
          {sec === 'pending' && (
            <p className="works-admin-params">
              <span>{work.boardW} × {work.boardH} 格</span>
              <span>{work.beanCount.toLocaleString()} 颗</span>
              <span>{work.colorCount} 种颜色</span>
              <span>{formatMinutes(work.estimateMinutes)}</span>
            </p>
          )}

          {sec === 'gallery' && (
            <textarea
              rows={2}
              value={d?.description ?? work.description}
              aria-label={`${work.title} 描述`}
              onChange={(e) =>
                setDrafts((p) => ({ ...p, [work.id]: { ...p[work.id], description: e.target.value } }))
              }
              onBlur={(e) => {
                const v = e.target.value;
                dropDraft(work.id);
                if (v !== work.description) saveMeta(work, { description: v });
              }}
            />
          )}

          {/* thumb_key 为空时服务端回落用原图当缩略图（toSummary: thumb_key || image_key），
              前台列表会真的去拉大图。标出来，免得站主以为「列表只加载缩略图」
              这句文案在骗人。rejected 行不判：它那个 imageUrl 本来就取不到图。
              imageUrl 为空同样不判：那一行压根没有图，「前台加载的是原图」是假的
              （孤儿 pending 行两个 URL 都是空串，等值条件天然成立，会误报）。 */}
          {!!work.imageUrl && work.thumbUrl === work.imageUrl && sec !== 'rejected' && (
            <span className="works-admin-flag">无缩略图，前台加载的是原图</span>
          )}
          {/* 用户在生成图之前就关掉页面，会留下一条只有元数据、没有图片的投稿。
              它照样要被拒绝掉（否则审核队列永远清不空），但得先告诉站主
              「你看到的是一条空的」，别以为缩略图加载失败是站点的 bug。 */}
          {!work.imageUrl && sec === 'pending' && (
            <span className="works-admin-flag">图片未上传</span>
          )}
        </div>

        <div className="works-admin-actions">
          {sec === 'pending' && (
            <>
              <button
                type="button"
                className="works-admin-btn"
                onClick={() => runReview(work, 'approve')}
              >
                通过 {work.title}
              </button>
              <button
                type="button"
                className="works-admin-btn works-admin-btn--danger"
                onClick={() => runReview(work, 'reject')}
              >
                拒绝 {work.title}
              </button>
            </>
          )}

          {sec === 'gallery' && (
            <>
              <button
                type="button"
                className="works-admin-btn"
                onClick={() => togglePublished(work)}
              >
                {work.published ? '下架' : '上架'} {work.title}
              </button>
              <button
                type="button"
                className="works-admin-btn works-admin-btn--danger"
                onClick={() => remove(work)}
              >
                删除 {work.title}
              </button>
              {!work.published && <span className="works-admin-flag">已下架</span>}
            </>
          )}

          {/* 已拒绝行只剩「彻底删除」：源文件审核时就没了，唯一还能做的事是
              把这条记录本身清掉，否则审核队列下半部分只会越积越多。 */}
          {sec === 'rejected' && (
            <button
              type="button"
              className="works-admin-btn works-admin-btn--danger"
              onClick={() => remove(work)}
            >
              彻底删除 {work.title}
            </button>
          )}
        </div>
      </li>
    );
  };

  const groups: { key: Section; title: string }[] = [
    { key: 'pending', title: '待审核' },
    { key: 'gallery', title: '作品集' },
    { key: 'rejected', title: '已拒绝' },
  ];

  return (
    <div className="works-admin">
      <h2 className="works-admin-title">作品管理</h2>

      {error && <p className="works-admin-error" role="alert">操作失败：{error.message}</p>}
      {loading && <p className="works-admin-hint">加载中…</p>}
      {!loading && works.length === 0 && (
        <p className="works-admin-hint">
          还没有作品。用户在生成页点「投稿」后会出现在「待审核」里。
        </p>
      )}

      {groups.map((g) => {
        const items = works.filter((w) => sectionOf(w) === g.key);
        return (
          <section key={g.key} role="region" aria-label={g.title} className="works-admin-section">
            <h3 className="works-admin-section-title">
              {g.title}（{items.length}）
            </h3>
            {items.length === 0 ? (
              <p className="works-admin-hint">空</p>
            ) : (
              <ul className="works-admin-list">{items.map(renderRow)}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
