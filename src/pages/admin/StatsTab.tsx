import { useEffect, useState } from 'react';
import { fetchSummary, type AdminSummary } from '@/api/statics';

export function StatsTab() {
  const [days, setDays] = useState<number>(7);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchSummary(days, 'admin')
      .then(s => setSummary(s as AdminSummary))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div className="statics-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h3>统计概览</h3>
        <select value={days} onChange={e => setDays(Number(e.target.value))}>
          <option value={1}>最近 1 天</option>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={90}>最近 90 天</option>
        </select>
      </div>
      {error && <p className="statics-error">加载失败：{error}</p>}
      {loading && <p className="statics-loading">加载中...</p>}
      {summary && (
        <>
          <div className="statics-grid">
            <StatCard label="独立访客 (UV)" value={summary.totals.uv} />
            <StatCard label="浏览量 (PV)" value={summary.totals.pageView} />
            <StatCard label="商品点击" value={summary.totals.productClick} />
            <StatCard label="图片导出" value={summary.totals.imageExport} />
          </div>
          <h3>每日事件总数</h3>
          <DayChart data={summary.perDay} />
          <h3 style={{ marginTop: 'var(--space-4)' }}>商品点击排名</h3>
          {summary.productClicks.length === 0 ? (
            <p className="statics-empty">暂无数据</p>
          ) : (
            <table className="statics-table">
              <thead>
                <tr>
                  <th>商品 ID</th>
                  <th>点击数</th>
                </tr>
              </thead>
              <tbody>
                {summary.productClicks.map(p => (
                  <tr key={p.ref}>
                    <td>{p.ref}</td>
                    <td>{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function DayChart({ data }: { data: { day: string; total: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.total));
  const W = 800;
  const H = 200;
  const PAD_L = 32;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  if (data.length === 0) return <p className="statics-empty">暂无数据</p>;
  const barW = Math.max(2, (innerW / data.length) * 0.7);
  const gap = innerW / data.length;
  const xLabelStride = data.length > 14 ? Math.ceil(data.length / 7) : data.length > 7 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="day-chart">
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#d9c9b9" strokeWidth="1" />
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#d9c9b9" strokeWidth="1" />
      <text x={4} y={PAD_T + 8} fontSize="10" fill="#968b80">{max}</text>
      <text x={4} y={H - PAD_B} fontSize="10" fill="#968b80">0</text>
      {data.map((d, i) => {
        const h = (d.total / max) * innerH;
        const x = PAD_L + i * gap + (gap - barW) / 2;
        const y = H - PAD_B - h;
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barW} height={h} fill="#e07856" rx="2" />
            {i % xLabelStride === 0 && (
              <text x={x + barW / 2} y={H - PAD_B + 14} fontSize="9" fill="#968b80" textAnchor="middle">{d.day.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}