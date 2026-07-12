interface Props {
  gridSize: number;
  onGridSizeChange: (n: number) => void;
  enableDither: boolean;
  onDitherChange: (b: boolean) => void;
  disabled?: boolean;
}

const PRESETS = [50, 75, 100, 150, 200, 300, 500];

export function ParamPanel({
  gridSize,
  onGridSizeChange,
  enableDither,
  onDitherChange,
  disabled,
}: Props) {
  return (
    <div className="param-panel">
      <label>
        网格大小（长边）
        <input
          type="range"
          min={50}
          max={500}
          step={1}
          value={gridSize}
          onChange={e => onGridSizeChange(Number(e.target.value))}
          disabled={disabled}
        />
        <span className="value">{gridSize} × {gridSize}</span>
      </label>

      <div className="presets">
        预设：
        {PRESETS.map(p => (
          <button
            key={p}
            className={p === gridSize ? 'preset active' : 'preset'}
            onClick={() => onGridSizeChange(p)}
            disabled={disabled}
          >
            {p}
          </button>
        ))}
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={enableDither}
          onChange={e => onDitherChange(e.target.checked)}
          disabled={disabled}
        />
        启用抖动（细节更平滑）
      </label>
    </div>
  );
}
