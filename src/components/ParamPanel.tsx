import './ParamPanel.css';
import { BOARD_SIZE_PRESETS } from '@/constants/boardSizes';

interface Props {
  gridSize: number;
  beanCount: number;
  totalCells: number;
  estimateLabel?: string | null;
  removeBackground: boolean;
  simplifyColors: boolean;
  onGridSizeChange: (n: number) => void;
  onRemoveBackgroundChange: (b: boolean) => void;
  onSimplifyColorsChange: (enabled: boolean) => void;
  disabled?: boolean;
}

const GRID_PRESETS = [20, 30, 50, 75, 100, 150, 200, 300] as const;
const MIN_PRESET = GRID_PRESETS[0];
const MAX_PRESET = GRID_PRESETS[GRID_PRESETS.length - 1];

const LOG_MIN = Math.log(MIN_PRESET);
const LOG_MAX = Math.log(MAX_PRESET);
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

function isMainPreset(p: number): boolean {
  return p >= 20 && p <= 100;
}

function ProgressBar({
  value,
  presets,
  onChange,
  disabled,
}: {
  value: number;
  presets: readonly number[];
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const rawValue = ratioToValue(ratio);
    onChange(nearestPreset(rawValue));
  };

  return (
    <div
      className="grid-progress"
      onClick={disabled ? undefined : onTrackClick}
      role="slider"
      aria-valuenow={value}
      aria-valuemin={MIN_PRESET}
      aria-valuemax={MAX_PRESET}
    >
      <div className="grid-progress-track">
        <div
          className="grid-progress-fill"
          style={{ width: `${valueToRatio(value) * 100}%` }}
        />
      </div>
      <div
        className="grid-progress-value"
        style={{ left: `${valueToRatio(value) * 100}%` }}
      >
        {value}
      </div>
      {presets.map(p => {
        const isActive = p === value;
        return (
          <button
            key={p}
            type="button"
            className={`grid-preset ${isActive ? 'active' : ''} ${isMainPreset(p) ? 'main' : ''}`}
            style={{ left: `${valueToRatio(p) * 100}%` }}
            onClick={e => {
              e.stopPropagation();
              onChange(p);
            }}
            aria-label={`网格 ${p}`}
            disabled={disabled}
          />
        );
      })}
    </div>
  );
}

export function ParamPanel({
  gridSize,
  beanCount,
  totalCells,
  estimateLabel,
  removeBackground,
  simplifyColors,
  onGridSizeChange,
  onRemoveBackgroundChange,
  onSimplifyColorsChange,
  disabled,
}: Props) {
  const removed = totalCells > 0 ? totalCells - beanCount : 0;
  return (
    <div className="param-panel">
      <div className="board-size-shortcuts" aria-label="快捷板子尺寸">
        <span className="board-size-label">快捷板子尺寸</span>
        <div className="board-size-options">
          {BOARD_SIZE_PRESETS.map(size => (
            <button
              key={size}
              type="button"
              className={`board-size-option ${gridSize === size ? 'active' : ''}`}
              aria-label={`${size} × ${size} 板子`}
              aria-pressed={gridSize === size}
              disabled={disabled}
              onClick={() => onGridSizeChange(size)}
            >
              {size} × {size}
            </button>
          ))}
        </div>
      </div>

      <label className="grid-label">网格大小（长边豆子数）</label>

      <ProgressBar
        value={gridSize}
        presets={GRID_PRESETS}
        onChange={onGridSizeChange}
        disabled={disabled}
      />

      <p className="bean-count">
        <strong>{beanCount > 0 ? beanCount.toLocaleString() : '—'}</strong> 颗
        <span className="bean-count-grid">
          {' '}
          （{gridSize} × {gridSize} = {totalCells.toLocaleString()} 格）
        </span>
        {estimateLabel && <span className="assembly-time"> · {estimateLabel}</span>}
        {removeBackground && removed > 0 && (
          <span className="bean-count-removed">
            {' '}
            · 已去 {removed.toLocaleString()} 颗背景
          </span>
        )}
      </p>
      <p className="hint">推荐 20-100 档位（普通图案常用范围）</p>

      <label className="checkbox param-toggle">
        <input
          type="checkbox"
          checked={removeBackground}
          onChange={e => onRemoveBackgroundChange(e.target.checked)}
          disabled={disabled}
        />
        <span>
          自动去背景
          <span className="param-toggle-hint"> · 适合卡通插画</span>
        </span>
      </label>

      <label className="checkbox param-toggle">
        <input
          type="checkbox"
          checked={simplifyColors}
          onChange={e => onSimplifyColorsChange(e.target.checked)}
          disabled={disabled}
        />
        <span>
          自动简化颜色
          <span className="param-toggle-hint"> · 启用后每种颜色至少 10 颗</span>
        </span>
      </label>
    </div>
  );
}
