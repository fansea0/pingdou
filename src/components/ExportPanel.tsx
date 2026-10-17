import { useEffect, useRef, useState } from 'react';
import { useSecondaryToggle, type SecondaryAction } from '@/hooks/useSecondaryToggle';
import './ExportPanel.css';

interface Props {
  onExport: () => void;
  disabled: boolean;
  exporting?: boolean;
  flash?: 'idle' | 'done';
  /**
   * 次级动作。传了就在主按钮右侧挂一个切换位，整行只有**一个**能点出结果的
   * 按钮 —— 手机端左列只有 206px，两个并排按钮各分到 100px，点按区域太小。
   *
   * 切换位只改状态、不执行动作：切错了顶多多点一下，但把「切」和「做」混在
   * 同一次点击里，用户永远不知道自己刚才那下到底干了什么。
   */
  secondary?: SecondaryAction;
}

export function ExportPanel({ onExport, disabled, exporting, flash, secondary }: Props) {
  const [progress, setProgress] = useState(0);
  const { onSecondary: onSecondaryMode, toggle } = useSecondaryToggle(secondary);
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

  // 收成一个值，省得后面到处写 secondary! —— onSecondaryMode 为真才可能有它
  const active = secondary && onSecondaryMode ? secondary : null;
  const label = active
    ? active.label
    : exporting
    ? '正在生成…'
    : flash === 'done'
    ? '已下载 ✓'
    : '下载';

  return (
    <div className="export-panel">
      {/* 一个行、一个能点出结果的按钮。切换位窄、无填充、字小 —— 它是「换一件事做」
          而不是第二个动作，所以不能跟主按钮抢同样的视觉权重。 */}
      <div className="export-actions">
        <button
          className={`primary export-btn${exporting && !onSecondaryMode ? ' is-loading' : ''}${progress >= 1 && !onSecondaryMode ? ' is-done' : ''}`}
          disabled={disabled || !!exporting}
          onClick={() => (active ? active.onSelect() : onExport())}
        >
          {!onSecondaryMode && progress > 0 && progress < 1 && (
            <span
              className="export-progress"
              style={{ width: `${Math.round(progress * 100)}%` }}
              aria-hidden
            />
          )}
          <span className="export-label">{label}</span>
        </button>
        {secondary && (
          <button
            type="button"
            className="export-swap"
            aria-pressed={onSecondaryMode}
            onClick={toggle}
          >
            {onSecondaryMode ? secondary.backLabel ?? '下载' : secondary.label}
          </button>
        )}
      </div>
      <p className="hint">默认 32px 一格，可直接打印或分享</p>
    </div>
  );
}
