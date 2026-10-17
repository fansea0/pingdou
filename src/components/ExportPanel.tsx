import { useEffect, useRef, useState, type ReactNode } from 'react';
import './ExportPanel.css';

interface Props {
  onExport: () => void;
  disabled: boolean;
  exporting?: boolean;
  flash?: 'idle' | 'done';
  /**
   * 与「下载」并排的次级动作（当前是投稿入口）。
   *
   * 做成插槽而不是让本组件直接认识投稿：两个按钮共享「拿这张图纸去做点什么」
   * 这层语义，但各自的流程与状态互不相干（投稿要先弹窗、再占 id、再渲染、
   * 再上传两轮请求）。硬塞进来只会让 Props 长成两套字段、状态互相污染。
   */
  children?: ReactNode;
}

export function ExportPanel({ onExport, disabled, exporting, flash, children }: Props) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (exporting) {
      wasRunningRef.current = true;
      setProgress(0);
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(0.92, (now - start) / 1400);
        setProgress(t);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (wasRunningRef.current) {
        wasRunningRef.current = false;
        setProgress(1);
        window.setTimeout(() => setProgress(0), 600);
      }
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [exporting]);

  const label = exporting
    ? '正在生成…'
    : flash === 'done'
    ? '已下载 ✓'
    : '下载';

  return (
    <div className="export-panel">
      {/* 下载吃掉剩余宽度，次级动作按文案自然宽度 —— 层级如实反映权重：
          下载是即时、私有、不需要别人点头的默认动作，所以实心；投稿会把
          这张图交给站主审核、公开挂出去，所以描边。 */}
      <div className="export-actions">
        <button
          className={`primary export-btn${exporting ? ' is-loading' : ''}${progress >= 1 ? ' is-done' : ''}`}
          disabled={disabled || !!exporting}
          onClick={onExport}
        >
          {progress > 0 && progress < 1 && (
            <span
              className="export-progress"
              style={{ width: `${Math.round(progress * 100)}%` }}
              aria-hidden
            />
          )}
          <span className="export-label">{label}</span>
        </button>
        {children}
      </div>
      <p className="hint">默认 32px 一格，可直接打印或分享</p>
    </div>
  );
}
