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
    if (!blob) return null;
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

  const fileInputRef = useRef<HTMLInputElement>(null);

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
    try {
      const next = await adminUpdateWork(work.id, { published: !isPublished(work) });
      setWorks(prev => prev.map(w => (w.id === next.id ? next : w)));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const remove = async (work: AdminWorkDetail) => {
    if (!window.confirm(`删除「${work.title}」？图片文件会一并删掉，无法恢复。`)) return;
    try {
      await adminDeleteWork(work.id);
      setWorks(prev => prev.filter(w => w.id !== work.id));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const saveMeta = async (work: AdminWorkDetail, patch: { title?: string; description?: string }) => {
    try {
      const next = await adminUpdateWork(work.id, patch);
      setWorks(prev => prev.map(w => (w.id === next.id ? next : w)));
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
        {works.map(work => (
          <li key={work.id} className="works-admin-item">
            <img className="works-admin-thumb" src={work.thumbUrl} alt="" />
            <div className="works-admin-fields">
              {/* key 里带 title/description：defaultValue 只在挂载时生效，
                  服务端把标题规范化后（trim / 超长截断 / 空标题补默认名）返回的新值
                  必须能把输入框刷出来，否则界面上留着用户输的原样、
                  存进去的却是另一个值。key 变了就重挂载，顺带解决受控化。 */}
              <input
                key={`${work.id}-title-${work.title}`}
                type="text"
                defaultValue={work.title}
                aria-label={`${work.title} 标题`}
                onBlur={e => {
                  if (e.target.value !== work.title) saveMeta(work, { title: e.target.value });
                }}
              />
              <textarea
                key={`${work.id}-desc-${work.description}`}
                rows={2}
                defaultValue={work.description}
                aria-label={`${work.title} 描述`}
                onBlur={e => {
                  if (e.target.value !== work.description) {
                    saveMeta(work, { description: e.target.value });
                  }
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
        ))}
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
