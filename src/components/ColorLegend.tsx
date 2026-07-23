import { useEffect, useState } from 'react';
import type { LegendRow } from '@/pipeline/legend';
import type { ColorSimplificationStats } from '@/types';

interface Props {
  legend: LegendRow[];
  colorSimplification: ColorSimplificationStats;
  simplifyColors: boolean;
  statisticsCurrent: boolean;
}

const MOBILE_QUERY = '(max-width: 900px)';

export function ColorLegend({
  legend,
  colorSimplification,
  simplifyColors,
  statisticsCurrent,
}: Props) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    if (mql.matches) setOpen(false);
  }, []);

  if (legend.length === 0) {
    return (
      <aside className="legend-wrap">
        <p className="empty-state empty-state-inline">上传图片后查看色号对照表</p>
      </aside>
    );
  }

  return (
    <aside className={`legend-wrap${open ? ' is-open' : ' is-closed'}`}>
      <header className="legend-head" onClick={() => setOpen(o => !o)} role="button">
        <div>
          <h3 className="legend-title">色号对照表</h3>
          <p className="legend-subtitle">
            {!statisticsCurrent ? (
              <>正在更新颜色统计</>
            ) : simplifyColors && !colorSimplification.minimumColorCountSatisfied ? (
              <>图案总数不足 10 颗，无法满足每色至少 10 颗</>
            ) : colorSimplification.mergedColorCount > 0 ? (
              <>
                已从 <strong>{colorSimplification.beforeColorCount}</strong> 种简化为{' '}
                <strong>{colorSimplification.afterColorCount}</strong> 种 · 已消除{' '}
                <strong>
                  {colorSimplification.rareColorCountBefore - colorSimplification.rareColorCountAfter}
                </strong>{' '}
                种零散色
              </>
            ) : (
              <>当前图像 · <strong>{legend.length}</strong> 种颜色</>
            )}
          </p>
        </div>
        <span
          className="legend-toggle"
          aria-label={open ? '收起色号对照表' : '展开色号对照表'}
        >
          {open ? '▾' : '▸'}
        </span>
      </header>
      {open && (
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
      )}
    </aside>
  );
}
