import { useCallback, useEffect, useRef, useState } from 'react';
import './MobileActionBar.css';
import { BOARD_SIZE_PRESETS } from '@/constants/boardSizes';

const GRID_PRESETS = [20, 30, 50, 75, 100, 150, 200, 300] as const;
const LOG_MIN = Math.log(GRID_PRESETS[0]);
const LOG_MAX = Math.log(GRID_PRESETS[GRID_PRESETS.length - 1]);
const LOG_RANGE = LOG_MAX - LOG_MIN;

function valueToRatio(v: number): number {
  return (Math.log(v) - LOG_MIN) / LOG_RANGE;
}

function ratioToValue(ratio: number): number {
  return Math.exp(LOG_MIN + LOG_RANGE * Math.max(0, Math.min(1, ratio)));
}

function nearestPreset(rawValue: number): number {
  let nearest: number = GRID_PRESETS[0];
  let minDiff = Math.abs(rawValue - nearest);
  for (const p of GRID_PRESETS) {
    const diff = Math.abs(rawValue - p);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = p;
    }
  }
  return nearest;
}

interface Props {
  gridSize: number;
  beanCount: number;
  estimateLabel?: string | null;
  removeBackground: boolean;
  simplifyColors: boolean;
  onGridSizeChange: (n: number) => void;
  onRemoveBackgroundChange: (b: boolean) => void;
  onSimplifyColorsChange: (enabled: boolean) => void;
  onLoad: (imageData: ImageData) => void;
  onExport: () => void;
  canExport: boolean;
  exporting: boolean;
  flash?: 'idle' | 'done';
}

export function MobileActionBar({
  gridSize,
  beanCount,
  estimateLabel,
  removeBackground,
  simplifyColors,
  onGridSizeChange,
  onRemoveBackgroundChange,
  onSimplifyColorsChange,
  onLoad,
  onExport,
  canExport,
  exporting,
  flash,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (exporting) {
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
      if (progress > 0) {
        setProgress(1);
        window.setTimeout(() => setProgress(0), 600);
      }
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // progress intentionally not in deps — only used in cleanup branch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exporting]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请上传图片文件');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      if (!confirm('图片较大，可能处理较慢，是否继续？')) return;
    }
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    onLoad(imageData);
  }, [onLoad]);

  const trackRef = useRef<HTMLDivElement>(null);

  const setValueFromPointer = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onGridSizeChange(nearestPreset(ratioToValue(ratio)));
  }, [onGridSizeChange]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setValueFromPointer(e.clientX);

    const handleMove = (ev: PointerEvent) => {
      ev.preventDefault();
      setValueFromPointer(ev.clientX);
    };

    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, [setValueFromPointer]);

  const exportLabel = exporting
    ? '生成中…'
    : flash === 'done'
    ? '已导出 ✓'
    : '导出图片';

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      <div className="mobile-action-bar">
        <div className="mobile-bar-row mobile-bar-summary">
          <button
            type="button"
            className="mobile-gear-btn"
            aria-label="设置"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94a7.49 7.49 0 0 0 .05-.94 7.49 7.49 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.48a.5.5 0 0 0 .12.61l2.03 1.58a7.49 7.49 0 0 0-.05.94 7.49 7.49 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.49.39 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.24 1.13-.55 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"
              />
            </svg>
          </button>
          <p className="mobile-bean-count">
            {beanCount > 0 ? (
              <>
                <strong>{beanCount.toLocaleString()}</strong> 颗
                {estimateLabel && <span className="mobile-assembly-time"> · {estimateLabel}</span>}
                {removeBackground && <span className="bean-count-removed"> · 已去背景</span>}
              </>
            ) : (
              <span className="mobile-bean-empty">未上传图片</span>
            )}
          </p>
        </div>

        <div className="mobile-board-size-options" aria-label="快捷板子尺寸">
          {BOARD_SIZE_PRESETS.map(size => (
            <button
              key={size}
              type="button"
              className={`mobile-board-size-option ${gridSize === size ? 'active' : ''}`}
              aria-label={`${size} × ${size} 板子`}
              aria-pressed={gridSize === size}
              onClick={() => onGridSizeChange(size)}
            >
              {size} × {size}
            </button>
          ))}
        </div>

        <div className="mobile-bar-row mobile-bar-actions">
          <button
            className="primary mobile-action-button mobile-btn-secondary"
            onClick={() => inputRef.current?.click()}
            aria-label="上传图片"
          >
            <span>上传图片</span>
          </button>
          <button
            className={`primary mobile-action-button mobile-btn-primary${exporting ? ' is-loading' : ''}${flash === 'done' ? ' is-done' : ''}`}
            disabled={!canExport || exporting}
            onClick={onExport}
            aria-label="导出图片"
          >
            {progress > 0 && progress < 1 && (
              <span
                className="export-progress"
                style={{ width: `${Math.round(progress * 100)}%` }}
                aria-hidden
              />
            )}
            <span className="export-label">{exportLabel}</span>
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div
          className="mobile-sheet-mask"
          role="presentation"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="设置"
            onClick={e => e.stopPropagation()}
          >
            <div className="mobile-sheet-handle" aria-hidden="true" />
            <div className="mobile-sheet-header">
              <span className="mobile-sheet-title">设置</span>
              <button
                type="button"
                className="mobile-sheet-close"
                aria-label="关闭"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </div>

            <div
              className="mobile-grid-row"
              onPointerDown={onPointerDown}
            >
              <span className="mobile-grid-text">网格</span>
              <div className="mobile-grid-track-wrap" ref={trackRef}>
                <div className="mobile-grid-track">
                  <div
                    className="mobile-grid-fill"
                    style={{ width: `${valueToRatio(gridSize) * 100}%` }}
                  />
                </div>
                {GRID_PRESETS.map(p => {
                  const isActive = p === gridSize;
                  return (
                    <div
                      key={p}
                      className={`mobile-grid-dot ${isActive ? 'active' : ''}`}
                      style={{ left: `${valueToRatio(p) * 100}%` }}
                    />
                  );
                })}
              </div>
              <span className="mobile-grid-value">{gridSize}</span>
            </div>

            <label className="mobile-toggle-row">
              <input
                type="checkbox"
                checked={removeBackground}
                onChange={e => onRemoveBackgroundChange(e.target.checked)}
              />
              自动去纯色背景
            </label>

            <label className="mobile-toggle-row">
              <input
                type="checkbox"
                checked={simplifyColors}
                onChange={e => onSimplifyColorsChange(e.target.checked)}
              />
              自动简化颜色 · 启用后每种颜色至少 10 颗
            </label>
          </div>
        </div>
      )}
    </>
  );
}