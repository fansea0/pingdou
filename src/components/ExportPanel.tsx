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
        导出合成图
      </button>
      <p className="hint">拼豆图 + 色号对照表合一</p>
    </div>
  );
}
