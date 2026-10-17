import { useCallback, useState } from 'react';
import { createWorkSubmission, uploadSubmissionImage } from '@/api/works';
import { renderSubmissionComposite } from '@/pipeline/submission';
import { canvasToBlob } from '@/pipeline/exporter';
import { drawWorksQr, renderSubmissionQr } from '@/pipeline/qr';
import type { Palette, PipelineResult } from '@/types';
import './SubmitWorkButton.css';

export interface SubmitWorkButtonProps {
  palette: Palette;
  result: PipelineResult | null;
  /** 当前这四个值就是要随投稿入库的图纸参数 */
  beanCount: number;
  colorCount: number;
  /** 仅用于弹窗摘要展示的文案（如「约 6.4 小时」）。服务端存的是下面的分钟数。 */
  estimateLabel: string | null;
  estimateMinutes: number;
  disabled?: boolean;
}

/** 缩略图长边，与后台上传时期一致（THUMB_MAX = 480）。 */
const THUMB_MAX = 480;
const THUMB_QUALITY = 0.82;

type Phase = 'idle' | 'submitting' | 'done';

/**
 * 浏览器里把成品图压成 480px WebP 缩略图。
 *
 * 放前端而不是服务端 sharp：图本来就在浏览器里解码过一次，再缩一次没有额外
 * I/O；而服务端目前是纯 JS 依赖（sql.js / express），引入 sharp 会带来原生
 * 模块编译，拖慢 CI 部署。
 *
 * 必须验 blob.type：按 HTML 规范，浏览器不支持 WebP 编码时 toBlob 会**静默回落**
 * 成 image/png，而不是回 null。把它当缩略图传上去，服务端按 mime 判类型时
 * 直接 400，整次投稿连带原图一起失败 —— 比没有缩略图糟得多。
 */
async function makeThumb(canvas: HTMLCanvasElement): Promise<Blob | null> {
  try {
    const scale = Math.min(1, THUMB_MAX / Math.max(canvas.width, canvas.height));
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', THUMB_QUALITY));
    if (!blob || blob.type !== 'image/webp') return null;
    return blob;
  } catch (e) {
    console.warn('[submit] 缩略图生成失败，降级为无缩略图', e);
    return null;
  }
}

export function SubmitWorkButton({
  palette,
  result,
  beanCount,
  colorCount,
  estimateLabel,
  estimateMinutes,
  disabled,
}: SubmitWorkButtonProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const busy = phase === 'submitting';

  const submit = useCallback(async () => {
    const name = title.trim();
    if (!name || !result || busy) return;
    setPhase('submitting');
    setError(null);
    // 提交一开始就关窗：投稿要跑渲染 + 两次请求，期间用户不该还能改名字重开弹窗。
    // 失败提示因此必须活在弹窗之外（见文件末尾的 role="alert"），
    // 否则「点确认 → 失败」会变成什么都没发生。
    setOpen(false);
    try {
      // ① 先渲染：白带按 SUBMISSION_QR_PX 预留好，但还不画码
      const canvas = await renderSubmissionComposite(palette, result);

      // ② 再占 id —— 码的内容依赖它
      const created = await createWorkSubmission({
        title: name,
        boardW: result.outW,
        boardH: result.outH,
        beanCount,
        colorCount,
        // 传数字而不是「约 6.4 小时」那句文案：服务端存的必须是分钟数，
        // 以后改 estimateAssemblyHours 的措辞不该洗历史数据
        estimateMinutes,
      });

      // ③ 补画这一件作品自己的码。renderSubmissionQr 失败会降级成 null，
      //    那就留一条空的白带上传 —— 码是锦上添花，不该让整次投稿失败。
      const qrImage = await renderSubmissionQr(created.id);
      if (qrImage) drawWorksQr(canvas, qrImage);

      const [blob, thumb] = await Promise.all([
        canvasToBlob(canvas),
        makeThumb(canvas),
      ]);

      // ④ 上传。缩略图失败不是致命错误，服务端会留空 thumb_key 降级
      await uploadSubmissionImage(created.id, created.uploadToken, blob, {
        thumb,
        width: canvas.width,
        height: canvas.height,
      });

      setPhase('done');
      window.setTimeout(() => setPhase('idle'), 4000);
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [beanCount, busy, colorCount, estimateMinutes, palette, result, title]);

  const blocked = disabled || !result || beanCount <= 0;

  return (
    <div className="submit-work">
      <button
        type="button"
        className="submit-work-btn"
        disabled={blocked || busy}
        onClick={() => {
          // 重置放在「打开」这一刻而不是 useEffect([open]) 里：投稿失败时弹窗
          // 是被 submit 关掉的，若用 effect 清理，刚设上的 error 会被同一次
          // 关闭的清理连带抹掉 —— 配额 429 这种第一步失败就再也看不见提示了。
          setTitle('');
          setError(null);
          setOpen(true);
        }}
      >
        {busy ? '正在投稿…' : '投稿到作品库'}
      </button>

      {open && (
        <div className="submit-work-backdrop" onClick={() => setOpen(false)}>
          <div
            className="submit-work-dialog"
            role="dialog"
            aria-label="投稿"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="submit-work-title">投稿到作品库</h3>

            <label className="submit-work-label">
              名称
              <input
                type="text"
                value={title}
                maxLength={200}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>

            {/* 只读摘要：这四组值就是要写进审核表的内容，
                让用户在点确认之前看到，比事后在审核队列里才发现写错了要好 */}
            <dl className="submit-work-summary">
              <div>
                <dt>图纸比例</dt>
                <dd>{result ? `${result.outW} × ${result.outH} 格` : '—'}</dd>
              </div>
              <div>
                <dt>豆子数量</dt>
                <dd>{beanCount > 0 ? `${beanCount.toLocaleString()} 颗` : '—'}</dd>
              </div>
              <div>
                <dt>颜色数量</dt>
                <dd>{colorCount > 0 ? `${colorCount} 种` : '—'}</dd>
              </div>
              <div>
                <dt>预估时间</dt>
                {/* formatAssemblyHours 没有可估的豆子数时回 null，弹窗里显示
                    「—」而不是空格子或字面量 null */}
                <dd>{estimateLabel ?? '—'}</dd>
              </div>
            </dl>

            <p className="submit-work-hint">
              投稿要等站主审核通过才会出现在作品库里，通过后这张图的二维码
              会指向它自己的详情页。
            </p>

            {error && <p className="submit-work-error" role="alert">{error}</p>}

            <div className="submit-work-actions">
              <button type="button" className="submit-work-cancel" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="submit-work-confirm"
                disabled={title.trim().length === 0 || busy}
                onClick={submit}
              >
                确认投稿
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <p className="submit-work-toast" role="status" aria-live="polite">
          投稿成功，等审核通过就会出现在作品库～
        </p>
      )}
      {/* 失败提示放在弹窗之外：submit 一开始就关掉了弹窗，而最常见的失败
          （配额 429）发生在第一步占 id 时，用户只会在按钮下方看到这行。
          不给链接是故意的：还没过审时 /works/:id 是 404。 */}
      {phase === 'idle' && error && (
        <p className="submit-work-error" role="alert">{error}</p>
      )}
    </div>
  );
}
