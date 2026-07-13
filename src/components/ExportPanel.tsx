interface Props {
  onExport: () => void;
  disabled: boolean;
}

export function ExportPanel({ onExport, disabled }: Props) {
  return (
    <div className="export-panel">
      <button
        className="primary"
        disabled={disabled}
        onClick={onExport}
      >
        导出 1 张图
      </button>
      <p className="hint">默认 32px 一格，可直接打印或分享</p>
    </div>
  );
}