import { useEffect, useRef, useState } from 'react';
import './ExportPanel.css';

interface Props {
  onExport: () => void;
  disabled: boolean;
  exporting?: boolean;
  flash?: 'idle' | 'done';
}

export function ExportPanel({ onExport, disabled, exporting, flash }: Props) {
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
    ? '已导出 ✓'
    : '导出图片';

  return (
    <div className="export-panel">
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
        <span className="export-label">
          <span className="export-emoji" aria-hidden>
            {flash === 'done' ? '🎉' : exporting ? '🎨' : '📦'}
          </span>
          {label}
        </span>
      </button>
      <p className="hint">默认 32px 一格，可直接打印或分享</p>
    </div>
  );
}
