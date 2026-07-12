import type { LegendRow } from '@/pipeline/legend';

interface Props {
  legend: LegendRow[];
}

export function ColorLegend({ legend }: Props) {
  if (legend.length === 0) {
    return (
      <aside className="legend-wrap">
        <p className="empty-state">上传图片后查看色号对照表</p>
      </aside>
    );
  }

  return (
    <aside className="legend-wrap">
      <h3 className="legend-title">色号对照表</h3>
      <p className="legend-subtitle">当前图像所用色号</p>
      <div className="legend-table">
        <div className="legend-header">
          <div className="col-swatch">色块</div>
          <div className="col-id">色号</div>
          <div className="col-name">名称</div>
          <div className="col-count">数量</div>
        </div>
        {legend.map(row => (
          <div key={row.id} className="legend-row">
            <div className="col-swatch">
              <span
                className="swatch"
                style={{ backgroundColor: `rgb(${row.rgb[0]},${row.rgb[1]},${row.rgb[2]})` }}
              />
            </div>
            <div className="col-id">{row.id}</div>
            <div className="col-name">{row.name}</div>
            <div className="col-count">{row.count}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}