import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchRegions, setSelfFingerprint, type RegionStats, type ProvinceBucket, type CityBucket } from '@/api/statics';
import { ProvinceTileMap, tileKeyOf } from './ProvinceTileMap';
import './RegionStatsPanel.css';

type TrendMode = 'external' | 'self' | 'all';

export function RegionStatsPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<RegionStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 默认「排除我的访问」：需求就是要看外部涨没涨
  const [excludeSelf, setExcludeSelf] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [trendMode, setTrendMode] = useState<TrendMode>('external');
  const [markSaving, setMarkSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRegions(days)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // 切时间窗时收回下钻，避免停在一个已经不在结果集里的省份
  useEffect(() => { setSelected(null); }, [days]);

  const toggleFingerprint = useCallback(async () => {
    if (!data || markSaving) return;
    setMarkSaving(true);
    setError(null);
    try {
      const next = await setSelfFingerprint(!data.selfFingerprintEnabled);
      setData({ ...data, selfFingerprintEnabled: next.enabled });
    } catch (e: any) {
      setError(e?.message ?? '保存失败');
    } finally {
      setMarkSaving(false);
    }
  }, [data, markSaving]);

  const valueOf = useCallback(
    (p: ProvinceBucket) => (excludeSelf ? p.externalPv : p.pv),
    [excludeSelf],
  );

  const metricLabel = excludeSelf ? '外部访客 PV' : '总 PV';

  const provinces = useMemo(() => {
    if (!data) return [];
    const list = [...data.provinces];
    // 排除自我访问时把纯内部流量省份沉到末尾，但不隐藏——「只有我在看的省」也有信息量
    return list.sort((a, b) => valueOf(b) - valueOf(a));
  }, [data, valueOf]);

  const cityValue = useCallback(
    (c: CityBucket) => (excludeSelf ? c.externalPv : c.pv),
    [excludeSelf],
  );

  const cityList = useMemo(() => {
    if (!data || !selected) return [];
    return data.cities
      .filter(c => tileKeyOf(c.province) === selected)
      .filter(c => cityValue(c) > 0)
      .sort((a, b) => cityValue(b) - cityValue(a));
  }, [data, selected, cityValue]);

  if (error && !data) {
    return (
      <div className="region-panel">
        <p className="statics-error">来源地加载失败：{error}</p>
      </div>
    );
  }

  const totals = data?.totals;
  const externalUv = totals?.externalUv ?? 0;
  const selfUv = totals?.selfUv ?? 0;
  const externalPv = totals?.externalPv ?? 0;
  const selfPv = totals?.selfPv ?? 0;
  const coverageRatio = data && data.coverage.totalPv > 0
    ? data.coverage.resolvedPv / data.coverage.totalPv
    : 0;

  return (
    <section className="region-panel" aria-label="流量来源地统计">
      {/* ── 概览：外部 / 内部直接并列，这是本板块要回答的核心问题 ── */}
      <div className="region-panel__head">
        <div>
          <h3 className="region-panel__title">谁来看我了</h3>
          <p className="region-panel__subtitle">
            内部访问 = 已登录后台账号或你标记过的设备；外部访客 = 匿名访问者
          </p>
        </div>
        <select
          className="region-panel__select"
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          aria-label="来源地统计时间范围"
        >
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={90}>最近 90 天</option>
        </select>
      </div>

      {loading && !data && <p className="statics-loading">加载中…</p>}
      {error && data && <p className="statics-error">{error}</p>}

      {data && totals && (
        <>
          <div className="region-cards">
            <RegionCard label="外部访客 UV" value={externalUv} tone="external" hint="真正的新面孔" />
            <RegionCard label="内部访问 UV" value={selfUv} tone="self" hint="我 / 商户账号" />
            <RegionCard label="外部 PV" value={externalPv} tone="external" hint="外部访问次数" />
            <RegionCard label="内部 PV" value={selfPv} tone="self" hint="内部访问次数" />
          </div>

          <div className="region-controls">
            <label className="region-switch">
              <input
                type="checkbox"
                checked={excludeSelf}
                onChange={e => setExcludeSelf(e.target.checked)}
                data-testid="exclude-self-toggle"
              />
              <span>排除我的访问</span>
              <span className="region-switch__hint">
                {excludeSelf ? '当前只看外部访客' : '当前含内部访问'}
              </span>
            </label>

            <label className="region-switch">
              <input
                type="checkbox"
                checked={data.selfFingerprintEnabled}
                onChange={toggleFingerprint}
                disabled={markSaving}
                data-testid="mark-self-toggle"
              />
              <span>标记我的访问</span>
              <span className="region-switch__hint">
                {data.selfFingerprintEnabled ? '已按当前 IP 识别' : '退出登录后也会认得我'}
              </span>
            </label>

            {data.coverage.totalPv > 0 && (
              <span className="region-coverage" title="历史数据和部分 IP 段无法归属到省市">
                已识别 {Math.round(coverageRatio * 100)}% 的 PV
                {totals.unknownPv > 0 && ` · ${totals.unknownPv.toLocaleString()} 次未归属`}
              </span>
            )}
          </div>

          {externalPv === 0 && selfPv === 0 ? (
            <p className="statics-empty">最近 {days} 天还没有访问记录。</p>
          ) : (
            <>
              <div className="region-body">
                <ProvinceTileMap
                  provinces={data.provinces}
                  valueOf={valueOf}
                  selected={selected}
                  onSelect={setSelected}
                  legendLabel={metricLabel}
                />

                <div className="region-rank">
                  <div className="region-rank__head">
                    <span className="region-rank__title">
                      {selected ? `${selected} · 城市` : '省份排行'}
                    </span>
                    {selected && (
                      <button type="button" className="region-rank__back" onClick={() => setSelected(null)}>
                        回到全国
                      </button>
                    )}
                  </div>

                  {selected ? (
                    cityList.length === 0
                      ? <p className="statics-empty">该省暂无城市级数据</p>
                      : (
                        <ul className="region-rank__list">
                          {cityList.map(c => (
                            <li key={`${c.province}-${c.city}`} className="region-rank__row">
                              <span className="region-rank__name">{c.city}</span>
                              <RegionBar value={cityValue(c)} max={Math.max(1, ...cityList.map(cityValue))} />
                              <span className="region-rank__value">{cityValue(c).toLocaleString()}</span>
                              <span className="region-rank__uv">UV {c.externalUv}</span>
                            </li>
                          ))}
                        </ul>
                      )
                  ) : (
                    provinces.length === 0
                      ? <p className="statics-empty">暂无可归属的来源地数据</p>
                      : (
                        <ul className="region-rank__list">
                          {provinces.slice(0, 12).map(p => (
                            <li
                              key={p.province}
                              className="region-rank__row region-rank__row--clickable"
                              onClick={() => setSelected(tileKeyOf(p.province))}
                            >
                              <span className="region-rank__name">{p.province}</span>
                              <RegionBar
                                value={valueOf(p)}
                                max={Math.max(1, ...provinces.map(valueOf))}
                              />
                              <span className="region-rank__value">{valueOf(p).toLocaleString()}</span>
                              <span className="region-rank__uv">UV {p.externalUv}</span>
                            </li>
                          ))}
                        </ul>
                      )
                  )}
                </div>
              </div>

              <div className="region-trend__head">
                <h4 className="region-trend__title">每日外部访客</h4>
                <div className="region-trend__modes">
                  {(['external', 'self', 'all'] as TrendMode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`region-trend__mode${trendMode === m ? ' active' : ''}`}
                      onClick={() => setTrendMode(m)}
                    >
                      {m === 'external' ? '外部' : m === 'self' ? '内部' : '全部'}
                    </button>
                  ))}
                </div>
              </div>
              <RegionTrend data={data.perDay} mode={trendMode} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function RegionCard(props: { label: string; value: number; tone: 'external' | 'self'; hint: string }) {
  return (
    <div className={`region-card region-card--${props.tone}`}>
      <div className="region-card__value">{props.value.toLocaleString()}</div>
      <div className="region-card__label">{props.label}</div>
      <div className="region-card__hint">{props.hint}</div>
    </div>
  );
}

function RegionBar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(2, Math.round((value / Math.max(1, max)) * 100));
  return (
    <span className="region-bar" aria-hidden="true">
      <span className="region-bar__fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** 堆叠柱：外部在左（主色）、内部在右（中性灰），一眼看出主体是谁 */
function RegionTrend({ data, mode }: { data: RegionStats['perDay']; mode: TrendMode }) {
  const max = Math.max(1, ...data.map(d =>
    mode === 'external' ? d.externalPv : mode === 'self' ? d.selfPv : d.pv,
  ));
  const H = 150;
  // 标签移到 HTML 之后，SVG 里不用再给它留底部空间了
  const PAD_B = 0;
  const PAD_T = 8;
  const innerH = H - PAD_B - PAD_T;
  const gap = 100 / Math.max(1, data.length);
  const stride = data.length > 20 ? 5 : data.length > 10 ? 3 : 1;

  return (
    <div className="region-trend">
      {/* 柱子留在 SVG 里并横向拉伸（这样柱子宽度才能跟着容器走），
          日期标签改用 HTML 排：preserveAspectRatio="none" 会把 SVG 里的文字
          横向放大约 9 倍、纵向不变，文字会被压成扁条。 */}
      <svg viewBox={`0 0 100 ${H}`} className="region-trend__bars" preserveAspectRatio="none" aria-hidden="true">
        {data.map((d, i) => {
          const x = i * gap + gap * 0.2;
          const w = gap * 0.6;
          const extH = (d.externalPv / max) * innerH;
          const selfH = (d.selfPv / max) * innerH;
          return (
            <g key={d.day}>
              {mode !== 'self' && (
                <rect x={x} y={H - PAD_B - extH} width={w} height={Math.max(0, extH)} fill="#e07856" rx="1" />
              )}
              {mode !== 'external' && (
                <rect
                  x={x}
                  y={H - PAD_B - (mode === 'self' ? selfH : extH + selfH)}
                  width={w}
                  height={Math.max(0, selfH)}
                  fill="#d9c9b9"
                  rx="1"
                />
              )}
            </g>
          );
        })}
      </svg>
      {/* 每个数据点一个等宽格子，跳过的日期留空格子占位，保证标签和柱子对齐 */}
      <div className="region-trend__axis">
        {data.map((d, i) => (
          <span key={d.day} className="region-trend__tick">
            {i % stride === 0 ? d.day.slice(5) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
