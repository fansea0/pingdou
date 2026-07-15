import { useEffect, useState } from 'react';
import { fetchSummary, type MerchantSummary } from '@/api/statics';
import { listProducts, type Product } from '@/api/products';
import { ProductEditModal } from '@/components/ProductEditModal';

export function MerchantDashboard() {
  const [summary, setSummary] = useState<MerchantSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [days, setDays] = useState<number>(7);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const reload = async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([
        fetchSummary(d, 'merchant') as Promise<MerchantSummary>,
        listProducts(),
      ]);
      setSummary(s);
      setProducts(p);
    } catch (e: any) {
      setError(e.message ?? 'load failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(days); }, [days]);

  return (
    <>
      <div className="statics-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <h3>我的数据</h3>
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
              <StatCard label="我的商品点击" value={summary.totals.myClicks} />
              <StatCard label="站点总 PV" value={summary.totals.pageView} />
              <StatCard label="我的商品数" value={summary.totals.productCount} />
            </div>
            <h3>每日点击</h3>
            <DayChartMy data={summary.perDay} />
          </>
        )}
      </div>

      <div className="statics-section">
        <h3>我的商品</h3>
        {products.length === 0 ? (
          <p className="statics-empty">暂未分配商品，请联系管理员</p>
        ) : (
          <table className="statics-table">
            <thead>
              <tr>
                <th>商品</th>
                {summary && <th>点击数</th>}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const stat = summary?.productBreakdown.find(b => b.productId === p.id);
                return (
                  <tr key={p.id}>
                    <td>{p.name} ({p.id})</td>
                    {summary && <td>{stat?.total ?? 0}</td>}
                    <td><button onClick={() => setEditing(p)}>编辑</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <ProductEditModal
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(days); }}
        />
      )}
    </>
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

function DayChartMy({ data }: { data: { day: string; myClicks: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.myClicks));
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
        const h = (d.myClicks / max) * innerH;
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