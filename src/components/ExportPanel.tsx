import { useEffect, useRef, useState } from 'react';
import './ExportPanel.css';

/** 可以切到主按钮上的次级动作（当前是投稿） */
export interface SecondaryAction {
  /** 切过去之后主按钮显示的文案，必须诚实描述点下去会发生什么 */
  label: string;
  /** 主按钮处在该状态时被点击 → 调它 */
  onSelect: () => void;
}

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
  const [mode, setMode] = useState<'primary' | 'secondary'>('primary');
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

  // 次级动作被撤掉后还停在它的状态上，主按钮就会显示一个点了没反应的标签
  useEffect(() => {
    if (!secondary && mode === 'secondary') setMode('primary');
  }, [secondary, mode]);

  const onSecondary = mode === 'secondary' && secondary;
  const label = onSecondary
    ? secondary.label
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
          className={`primary export-btn${exporting && !onSecondary ? ' is-loading' : ''}${progress >= 1 && !onSecondary ? ' is-done' : ''}`}
          disabled={disabled || !!exporting}
          onClick={() => (onSecondary ? onSecondary.onSelect() : onExport())}
        >
          {!onSecondary && progress > 0 && progress < 1 && (
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
            aria-pressed={mode === 'secondary'}
            onClick={() => setMode(mode === 'primary' ? 'secondary' : 'primary')}
          >
            {mode === 'primary' ? secondary.label : '下载'}
          </button>
        )}
      </div>
      <p className="hint">默认 32px 一格，可直接打印或分享</p>
    </div>
  );
}
