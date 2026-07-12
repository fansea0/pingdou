import { useState } from 'react';

interface Props {
  onExport: (cellPx: number) => void;
  disabled: boolean;
}

const OPTIONS = [16, 24, 32, 48];

export function ExportPanel({ onExport, disabled }: Props) {
  const [cellPx, setCellPx] = useState(32);
  return (
    <div className="export-panel">
      <label>
        导出像素密度（一格）
        <select value={cellPx} onChange={e => setCellPx(Number(e.target.value))}>
          {OPTIONS.map(o => <option key={o} value={o}>{o}px</option>)}
        </select>
        <span className="hint">默认 32；≥24 时附标注图</span>
      </label>
      <button
        className="primary"
        disabled={disabled}
        onClick={() => onExport(cellPx)}
      >
        导出三件套
      </button>
    </div>
  );
}
