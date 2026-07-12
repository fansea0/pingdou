import { useState } from 'react';

interface Props {
  currentGridSize: number;
  onExport: (exportCellPx: number, extraGridSizes: number[]) => void;
  disabled: boolean;
}

const PIXEL_OPTIONS = [16, 24, 32, 48];
const SIZE_OPTIONS = [50, 75, 100, 150, 200, 300, 500];

export function ExportPanel({ currentGridSize, onExport, disabled }: Props) {
  const [cellPx, setCellPx] = useState(32);
  const [extra, setExtra] = useState<number[]>([]);

  const toggle = (n: number) => {
    setExtra(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]);
  };

  const totalCount = 1 + extra.filter(n => n !== currentGridSize).length;
  const buttonText = totalCount === 1 ? '导出 1 张图片' : `导出 ${totalCount} 张图片`;

  return (
    <div className="export-panel">
      <label>
        导出像素密度（一格）
        <select value={cellPx} onChange={e => setCellPx(Number(e.target.value))}>
          {PIXEL_OPTIONS.map(o => <option key={o} value={o}>{o}px</option>)}
        </select>
        <span className="hint">默认 32</span>
      </label>

      <div className="extra-sizes">
        <p className="extra-label">额外尺寸（当前必选：{currentGridSize}）</p>
        <div className="size-grid">
          {SIZE_OPTIONS.map(n => {
            const isCurrent = n === currentGridSize;
            const checked = extra.includes(n) || isCurrent;
            return (
              <label key={n} className="size-option">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || isCurrent}
                  onChange={() => toggle(n)}
                />
                <span>{n}</span>
              </label>
            );
          })}
        </div>
      </div>

      <button
        className="primary"
        disabled={disabled}
        onClick={() => onExport(cellPx, extra.filter(n => n !== currentGridSize))}
      >
        {buttonText}
      </button>
    </div>
  );
}