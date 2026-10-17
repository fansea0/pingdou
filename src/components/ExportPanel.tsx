import { useEffect, useRef, useState } from 'react';
import { useActionMenu, type ActionChoice } from '@/hooks/useActionMenu';
import './ExportPanel.css';

interface Props {
  onExport: () => void;
  disabled: boolean;
  exporting?: boolean;
  flash?: 'idle' | 'done';
  /**
   * 除了下载之外的其它动作（当前是投稿）。传了就在主按钮右侧挂一个小箭头，
   * 点开是一个下拉菜单；整行只有**一个**能点出结果的按钮 —— 手机端左列只有
   * 206px，两个并排按钮各分到 100px，点按区域太小。
   *
   * 箭头只开菜单、不执行动作：把「换」和「做」混在同一次点击里，用户永远
   * 不知道自己刚才那下到底干了什么。
   */
  alternatives?: ActionChoice[];
}

export function ExportPanel({ onExport, disabled, exporting, flash, alternatives }: Props) {
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

  const menu = useActionMenu(
    { label: exporting ? '正在生成…' : flash === 'done' ? '已下载 ✓' : '下载', onSelect: onExport },
    alternatives,
  );
  // 导出进度条画在下载这条路上，停在投稿态时不该再闪
  const onDownload = menu.current.onSelect === onExport;

  return (
    <div className="export-panel">
      {/* 一个行、一个能点出结果的按钮；下拉箭头并进它自己的框里，
          读起来仍然是一个按钮，而不是「按钮 + 一个不相干的小控件」。 */}
      <div className="export-actions" ref={menu.ref}>
        <div className="export-split">
          <button
            className={`primary export-btn${exporting && onDownload ? ' is-loading' : ''}${progress >= 1 && onDownload ? ' is-done' : ''}`}
            disabled={disabled || !!exporting}
            onClick={menu.current.onSelect}
          >
            {onDownload && progress > 0 && progress < 1 && (
              <span
                className="export-progress"
                style={{ width: `${Math.round(progress * 100)}%` }}
                aria-hidden
              />
            )}
            <span className="export-label">{menu.current.label}</span>
          </button>
          {alternatives && alternatives.length > 0 && (
            <>
              <span className="export-split-divider" aria-hidden />
              <button
                type="button"
                className="export-caret"
                aria-haspopup="menu"
                aria-expanded={menu.open}
                aria-label="更多操作"
                disabled={disabled || !!exporting}
                onClick={menu.toggleMenu}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
                  fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </>
          )}
        </div>

        {menu.open && (
          <div className="action-menu" role="menu">
            {menu.items.map((item, i) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`action-menu-item${item.onSelect === menu.current.onSelect ? ' is-active' : ''}`}
                onClick={() => menu.pick(i)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="hint">默认 32px 一格，可直接打印或分享</p>
    </div>
  );
}
