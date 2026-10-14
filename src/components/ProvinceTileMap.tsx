import { useMemo } from 'react';
import type { ProvinceBucket } from '@/api/statics';

/**
 * 方块地图（tile grid map）：每省一个等面积方块，按地理方位排布。
 *
 * 为什么不用真实地图多边形：
 * - 个人站的访问量看不出省界形状差异，用户要的是「排序」不是「空间」
 * - 真实多边形要 ~1MB GeoJSON + ECharts/d3-geo，这份流量不值得
 * - 等面积方块不会被「四川比海南大 8 倍」误导注意力
 * - 手写 SVG，和后台现有 DayChart 风格一致，零额外依赖
 */
const TILE = 32;
const GAP = 4;
const COLS = 13;

/** [显示名, 列, 行] —— 位置按经纬度线性投影后手工微调，视觉上仍是中国 */
const LAYOUT: [string, number, number][] = [
  ['黑龙江', 9, 0], ['吉林', 11, 0], ['辽宁', 10, 1],
  ['新疆', 3, 2], ['内蒙古', 8, 2],
  ['甘肃', 6, 3], ['山西', 7, 3], ['河北', 8, 3], ['北京', 9, 3], ['天津', 10, 3],
  ['青海', 5, 4], ['宁夏', 6, 4], ['陕西', 7, 4], ['河南', 8, 4], ['山东', 9, 4],
  ['西藏', 3, 5], ['四川', 6, 5], ['重庆', 7, 5], ['湖北', 8, 5], ['安徽', 9, 5],
  ['江苏', 10, 5], ['上海', 11, 5],
  ['贵州', 7, 6], ['湖南', 8, 6], ['江西', 9, 6], ['浙江', 10, 6],
  ['云南', 6, 7], ['广西', 7, 7], ['广东', 8, 7], ['福建', 9, 7], ['台湾', 10, 7],
  ['海南', 8, 8], ['港澳', 9, 8],
];

/** 后端存的规范名 → 方块地图显示名 */
function tileKeyOf(province: string): string {
  return province
    .replace(/(省|市|自治区|特别行政区)$/, '')
    .replace(/^(内蒙古|广西|西藏|宁夏|新疆)/, '$1')
    .replace(/^(香港|澳门)$/, '港澳');
}

const DISPLAY_BY_KEY = new Map(LAYOUT.map(([name]) => [name, name]));

export function ProvinceTileMap(props: {
  provinces: ProvinceBucket[];
  /** 传中的指标决定着色深度，0 表示不参与着色 */
  valueOf: (p: ProvinceBucket) => number;
  selected: string | null;
  onSelect: (provinceKey: string | null) => void;
  legendLabel: string;
}) {
  const { provinces, valueOf, selected, onSelect, legendLabel } = props;

  const byKey = useMemo(() => {
    const m = new Map<string, ProvinceBucket>();
    for (const p of provinces) {
      const key = tileKeyOf(p.province);
      // 港澳是后端两个独立省份，方块地图合成一个格，取和
      const prev = m.get(key);
      m.set(key, prev ? { ...prev, pv: prev.pv + p.pv, externalPv: prev.externalPv + p.externalPv, selfPv: prev.selfPv + p.selfPv } : p);
    }
    return m;
  }, [provinces]);

  const max = Math.max(1, ...Array.from(byKey.values()).map(valueOf));
  const W = COLS * (TILE + GAP) + GAP;
  const H = 9 * (TILE + GAP) + GAP;

  return (
    <div className="region-tilemap">
      <svg viewBox={`0 0 ${W} ${H}`} className="region-tilemap__svg" role="img" aria-label={`来源地方块地图（按${legendLabel}着色）`}>
        {LAYOUT.map(([name, col, row]) => {
          const bucket = byKey.get(name);
          const value = bucket ? valueOf(bucket) : 0;
          const intensity = value > 0 ? 0.15 + 0.85 * (value / max) : 0;
          const isSelected = selected != null && selected === tileKeyOf(bucket?.province ?? name);
          const dimmed = selected != null && !isSelected;
          const title = bucket
            ? `${bucket.province}\n${legendLabel} ${value}`
            : `${name}\n暂无数据`;
          return (
            <g
              key={name}
              className={`region-tile${isSelected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}${bucket ? ' has-data' : ''}`}
              onClick={() => onSelect(isSelected ? null : tileKeyOf(bucket?.province ?? name))}
              role="button"
              tabIndex={0}
              aria-label={title.replace('\n', ' ')}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(isSelected ? null : tileKeyOf(bucket?.province ?? name));
                }
              }}
            >
              <title>{title}</title>
              <rect
                x={GAP + col * (TILE + GAP)}
                y={GAP + row * (TILE + GAP)}
                width={TILE}
                height={TILE}
                rx="6"
                fill={value > 0 ? `rgba(224, 120, 86, ${intensity.toFixed(3)})` : 'var(--color-surface-alt)'}
                stroke={isSelected ? 'var(--color-accent-hover)' : 'var(--color-border)'}
                strokeWidth={isSelected ? 2 : 1}
              />
              <text
                x={GAP + col * (TILE + GAP) + TILE / 2}
                y={GAP + row * (TILE + GAP) + TILE / 2 + 3}
                fontSize="10"
                textAnchor="middle"
                fill={value > max * 0.55 ? '#fff' : 'var(--color-text-muted)'}
              >
                {name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="region-tilemap__legend">
        <span className="region-tilemap__legend-label">低</span>
        {[0.15, 0.35, 0.55, 0.75, 1].map(a => (
          <span key={a} className="region-tilemap__swatch" style={{ background: `rgba(224, 120, 86, ${a})` }} />
        ))}
        <span className="region-tilemap__legend-label">高（{legendLabel}）</span>
      </div>
    </div>
  );
}

export { tileKeyOf, DISPLAY_BY_KEY };
