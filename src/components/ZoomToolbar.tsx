import { useState, useEffect } from 'react';

interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onZoomChange: (z: number) => void;
  disabled: boolean;
}

export function ZoomToolbar({ zoom, onZoomIn, onZoomOut, onReset, onZoomChange, disabled }: Props) {
  const [inputValue, setInputValue] = useState(String(zoom));

  useEffect(() => {
    setInputValue(String(zoom));
  }, [zoom]);

  const commit = () => {
    const n = parseFloat(inputValue);
    if (!Number.isNaN(n)) onZoomChange(n);
    setInputValue(String(zoom));
  };

  return (
    <div className="zoom-toolbar">
      <button
        type="button"
        className="zoom-btn"
        data-testid="zoom-out"
        disabled={disabled}
        onClick={onZoomOut}
        aria-label="缩小"
      >
        −
      </button>
      <input
        type="number"
        className="zoom-input"
        value={inputValue}
        min={1}
        max={8}
        step={0.5}
        disabled={disabled}
        onChange={e => setInputValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        aria-label="当前缩放倍数"
      />
      <button
        type="button"
        className="zoom-btn"
        data-testid="zoom-in"
        disabled={disabled}
        onClick={onZoomIn}
        aria-label="放大"
      >
        +
      </button>
      <button
        type="button"
        className="zoom-btn zoom-reset"
        data-testid="zoom-reset"
        disabled={disabled}
        onClick={onReset}
        aria-label="复位"
      >
        ⊕
      </button>
    </div>
  );
}