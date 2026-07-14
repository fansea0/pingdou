import { useCallback, useEffect, useRef, useState } from 'react';
import './MobileActionBar.css';

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
  removeBackground: boolean;
  onGridSizeChange: (n: number) => void;
  onRemoveBackgroundChange: (b: boolean) => void;
  onLoad: (imageData: ImageData) => void;
  onExport: () => void;
  canExport: boolean;
  exporting: boolean;
  flash?: 'idle' | 'done';
}

export function MobileActionBar({
  gridSize,
  beanCount,
  removeBackground,
  onGridSizeChange,
  onRemoveBackgroundChange,
  onLoad,
  onExport,
  canExport,
  exporting,
  flash,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

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
    <div className="mobile-action-bar">
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

      <div className="mobile-action-row">
        <p className="mobile-bean-count">
          {beanCount > 0 ? (
            <>
              <strong>{beanCount.toLocaleString()}</strong> 颗
              {removeBackground && <span className="bean-count-removed"> · 已去背景</span>}
            </>
          ) : (
            '—'
          )}
        </p>
        <div className="mobile-buttons">
          <button
            className="primary mobile-icon-btn"
            onClick={() => inputRef.current?.click()}
            aria-label="上传图片"
          >
            <span aria-hidden>📷</span>
            <span>上传</span>
          </button>
          <button
            className={`primary mobile-icon-btn${exporting ? ' is-loading' : ''}${flash === 'done' ? ' is-done' : ''}`}
            disabled={!canExport || exporting}
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
              <span aria-hidden>{flash === 'done' ? '🎉' : exporting ? '🎨' : '📦'}</span>
              {exportLabel}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
