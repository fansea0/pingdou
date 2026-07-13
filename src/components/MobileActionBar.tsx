import { useCallback, useRef } from 'react';
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
  onGridSizeChange: (n: number) => void;
  onLoad: (imageData: ImageData) => void;
  onExport: () => void;
  canExport: boolean;
  exporting: boolean;
}

export function MobileActionBar({
  gridSize,
  beanCount,
  onGridSizeChange,
  onLoad,
  onExport,
  canExport,
  exporting,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

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

  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onGridSizeChange(nearestPreset(ratioToValue(ratio)));
  };

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

      <div className="mobile-grid-row" onClick={onTrackClick}>
        <span className="mobile-grid-text">网格</span>
        <div className="mobile-grid-track-wrap">
          <div className="mobile-grid-track">
            <div
              className="mobile-grid-fill"
              style={{ width: `${valueToRatio(gridSize) * 100}%` }}
            />
          </div>
          {GRID_PRESETS.map(p => {
            const isActive = p === gridSize;
            return (
              <button
                key={p}
                type="button"
                className={`mobile-grid-dot ${isActive ? 'active' : ''}`}
                style={{ left: `${valueToRatio(p) * 100}%` }}
                onClick={e => {
                  e.stopPropagation();
                  onGridSizeChange(p);
                }}
                aria-label={`网格 ${p}`}
              />
            );
          })}
        </div>
        <span className="mobile-grid-value">{gridSize}</span>
      </div>

      <div className="mobile-action-row">
        <p className="mobile-bean-count">
          {beanCount > 0 ? `${beanCount.toLocaleString()} 颗` : '—'}
        </p>
        <div className="mobile-buttons">
          <button className="primary" onClick={() => inputRef.current?.click()}>
            上传图片
          </button>
          <button
            className="primary"
            disabled={!canExport || exporting}
            onClick={onExport}
          >
            {exporting ? '导出中…' : '导出 1 张图'}
          </button>
        </div>
      </div>
    </div>
  );
}
