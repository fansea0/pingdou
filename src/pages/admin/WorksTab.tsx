import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminCreateWork,
  adminDeleteWork,
  adminListWorks,
  adminUpdateWork,
  type AdminWorkDetail,
} from '@/api/works';
import './WorksTab.css';

/** 缩略图长边目标像素 */
const THUMB_MAX = 480;
const THUMB_QUALITY = 0.82;

/**
 * 在浏览器里把图缩到 480px 并转 WebP。
 *
 * 放前端而不是服务端 sharp：上传本来就发生在浏览器里，原图必然已经解码过一次，
 * 再缩一次没有额外 I/O；而服务端目前是纯 JS 依赖（sql.js / ip2region / express），
 * 引入 sharp 会带来原生模块编译，拖慢 npm ci 和 CI 部署。
 *
 * 失败返回 null（不阻断上传），服务端会把 thumb_key 留空、前端回落用原图当缩略图。
 * 浏览器不支持 WebP 编码时同样返回 null —— 那不是「检查失败」，见 toBlob 处的注释。
 *
 * width/height 返回的是**原图**尺寸（不是缩略图尺寸）：服务端把它存进 works.width/height，
 * 详情页的「成品尺寸」直接读这两个字段。不传的话详情页会显示「未知」。
 */
async function makeThumb(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    // 先把原图尺寸取出来：ImageBitmap.close() 之后 bitmap 的像素数据被释放，
    // 规范不保证 width/height 还能读到（实现上多数仍在，但那是未定义行为）。
    // 存成局部变量零成本，也没必要赌。
    const srcWidth = bmp.width;
    const srcHeight = bmp.height;
    const scale = Math.min(1, THUMB_MAX / Math.max(srcWidth, srcHeight));
    const w = Math.max(1, Math.round(srcWidth * scale));
    const h = Math.max(1, Math.round(srcHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close?.(); return null; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/webp', THUMB_QUALITY)
    );
    // 必须验 blob.type：按 HTML 规范，浏览器不支持 WebP 编码时 toBlob 会**静默回落**
    // 成 image/png，而不是回 null。blob 非空就把 PNG 当缩略图传上去的话，
    // 服务端 extFor 拿到 .png ≠ .webp 直接抛 `thumb must be image/webp`（400），
    // 整次上传连带原图一起失败 —— 比没有缩略图糟得多。
    if (!blob || blob.type !== 'image/webp') return null;
    return { blob, width: srcWidth, height: srcHeight };
  } catch (e) {
    console.warn('[works] 缩略图生成失败，降级为无缩略图', e);
    return null;
  }
}

export function WorksTab() {
  const [works, setWorks] = useState<AdminWorkDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [published, setPublished] = useState(true);

  /**
   * 每个作品正在编辑、尚未保存的字段。存在草稿期间输入框显示草稿值，
   * 保存成功、草稿清空后回落成服务端返回的 work.title/work.description ——
   * 于是「服务端规范化后的值」（trim / 超长截断 / 空标题补默认名）照样能刷进界面，
   * 不用像之前那样靠 key 强制重挂载（那会在用户打字途中吞掉未保存的输入）。
   */
  const [drafts, setDrafts] = useState<Record<number, { title?: string; description?: string }>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 只把响应里真正变动的字段合并回列表，而不是整对象替换。
   * 两次 PUT 并发返回乱序时，整对象替换会让后到的**旧**快照把先到的更新整体盖掉
   * （改标题顺手把刚切换的上架状态退回去）。同字段仍是后写为准，
   * 但跨字段的互相踩踏没了。
   */
  const patchWork = useCallback((id: number, patch: Partial<AdminWorkDetail>) => {
    setWorks(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)));
  }, []);

  const dropDraft = useCallback((id: number) => {
    setDrafts(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    adminListWorks()
      .then(w => { setWorks(w); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleUpload = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const thumb = await makeThumb(file);
      await adminCreateWork(file, {
        thumb: thumb?.blob ?? null,
        title,
        description,
        published,
        // 缩略图生成失败时就没有尺寸可传，详情页会退回显示「未知」——可接受，
        // 总比为了凑尺寸在上传路径里再解一次码划算。
        width: thumb?.width,
        height: thumb?.height,
      });
      setFile(null);
      setTitle('');
      setDescription('');
      setPublished(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async (work: AdminWorkDetail) => {
    setError(null);
    try {
      const next = await adminUpdateWork(work.id, { published: !isPublished(work) });
      patchWork(next.id, { published: next.published, updatedAt: next.updatedAt });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const remove = async (work: AdminWorkDetail) => {
    if (!window.confirm(`删除「${work.title}」？图片文件会一并删掉，无法恢复。`)) return;
    setError(null);
    try {
      await adminDeleteWork(work.id);
      dropDraft(work.id);
      setWorks(prev => prev.filter(w => w.id !== work.id));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const saveMeta = async (work: AdminWorkDetail, patch: { title?: string; description?: string }) => {
    setError(null);
    try {
      const next = await adminUpdateWork(work.id, patch);
      // 只合并本次请求动过的字段：服务端没参与本次改动的字段不该被旧值带回来
      patchWork(next.id, {
        ...(typeof patch.title === 'string' ? { title: next.title } : {}),
        ...(typeof patch.description === 'string' ? { description: next.description } : {}),
        updatedAt: next.updatedAt,
      });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  return (
    <div className="works-admin">
      <h2 className="works-admin-title">作品管理</h2>

      <section className="works-admin-upload">
        <h3>上传作品</h3>
        <label className="works-admin-label">
          选择图片
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="works-admin-label">
          标题
          <input
            type="text"
            value={title}
            placeholder="留空则显示「未命名作品」"
            onChange={e => setTitle(e.target.value)}
          />
        </label>
        <label className="works-admin-label">
          描述
          <textarea value={description} rows={2} onChange={e => setDescription(e.target.value)} />
        </label>
        <label className="works-admin-check">
          <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />
          立即上架
        </label>
        <button
          type="button"
          className="works-admin-btn"
          disabled={!file || busy}
          onClick={handleUpload}
        >
          {busy ? '上传中…' : '上传'}
        </button>
        <p className="works-admin-hint">
          上传原图会自动生成 480px WebP 缩略图；作品库列表只加载缩略图，下载仍是原始 PNG。
        </p>
      </section>

      {error && <p className="works-admin-error" role="alert">操作失败：{error.message}</p>}
      {loading && <p className="works-admin-hint">加载中…</p>}

      {!loading && works.length === 0 && (
        <p className="works-admin-hint">还没有上传作品。</p>
      )}

      <ul className="works-admin-list">
        {works.map(work => {
          const d = drafts[work.id];
          return (
            <li key={work.id} className="works-admin-item">
              <img className="works-admin-thumb" src={work.thumbUrl} alt="" />
              <div className="works-admin-fields">
                {/* 受控 + 草稿态，**不要**改回 defaultValue + key 强制重挂载：
                    上一轮为解决「defaultValue 不反映服务端规范化值」用了
                    key={work.id-title-work.title}，结果任何一次保存成功都会重挂载输入框，
                    用户 blur 后立刻点回来继续打字时，那段未保存的输入会被静默丢弃。
                    现在保存成功走 patchWork → work.title 变化 → 草稿已清空 →
                    value 自然回落成服务端值，既不吞输入也不需要 key。 */}
                <input
                  type="text"
                  value={d?.title ?? work.title}
                  aria-label={`${work.title} 标题`}
                  onChange={e =>
                    setDrafts(p => ({ ...p, [work.id]: { ...p[work.id], title: e.target.value } }))
                  }
                  onBlur={e => {
                    const v = e.target.value;
                    dropDraft(work.id);
                    if (v !== work.title) saveMeta(work, { title: v });
                  }}
                />
                <textarea
                  rows={2}
                  value={d?.description ?? work.description}
                  aria-label={`${work.title} 描述`}
                  onChange={e =>
                    setDrafts(p => ({ ...p, [work.id]: { ...p[work.id], description: e.target.value } }))
                  }
                  onBlur={e => {
                    const v = e.target.value;
                    dropDraft(work.id);
                    if (v !== work.description) saveMeta(work, { description: v });
                  }}
                />
                {/* thumb_key 为空时服务端回落用原图当缩略图（toSummary: thumb_key || image_key），
                    于是 thumbUrl === imageUrl，前台列表会真的去拉大图。标出来，
                    免得站主以为是「列表只加载缩略图」这句文案在骗人。 */}
                {work.thumbUrl === work.imageUrl && (
                  <span className="works-admin-flag">无缩略图，前台加载的是原图</span>
                )}
              </div>
              <div className="works-admin-actions">
                <label className="works-admin-check">
                  <input
                    type="checkbox"
                    checked={isPublished(work)}
                    onChange={() => togglePublished(work)}
                  />
                  {work.title}
                </label>
                <button
                  type="button"
                  className="works-admin-btn works-admin-btn--danger"
                  onClick={() => remove(work)}
                >
                  删除 {work.title}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 服务端 /api/admin/works 会带 published（见 server/works.ts 的 toAdminDetail）。
 * 这里仍用宽松读法兜底：字段缺失时宁可显示成「已上架」（需要多勾一次才能下架），
 * 也不能反过来把已上架的显示成草稿、让站主以为作品已经不在前台了。
 */
function isPublished(work: AdminWorkDetail): boolean {
  return (work as AdminWorkDetail & { published?: boolean }).published !== false;
}
