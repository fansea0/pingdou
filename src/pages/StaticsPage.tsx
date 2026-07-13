import { useEffect, useState } from 'react';
import {
  fetchHealth,
  fetchSummary,
  login,
  logout,
  type Summary,
} from '@/api/statics';
import './StaticsPage.css';

export function StaticsPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [authed, setAuthed] = useState<boolean>(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(7);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const h = await fetchHealth();
        setConfigured(h.staticsConfigured);
        if (!h.staticsConfigured) return;
      } catch {
        setConfigured(false);
        return;
      }
      // If we already have a valid cookie from a previous session, skip login form.
      try {
        await fetchSummary(1);
        setAuthed(true);
      } catch {
        // cookie invalid or missing — show login form
      }
    })();
  }, []);

  useEffect(() => {
    if (!authed) {
      setSummary(null);
      return;
    }
    setLoading(true);
    setSummaryError(null);
    fetchSummary(days)
      .then(s => setSummary(s))
      .catch(e => {
        if (String(e.message).includes('401')) {
          setAuthed(false);
        } else {
          setSummaryError(e.message);
        }
      })
      .finally(() => setLoading(false));
  }, [authed, days]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoginError(null);
    setLoggingIn(true);
    try {
      await login(password);
      setAuthed(true);
      setPassword('');
    } catch (err: any) {
      if (String(err?.message ?? '').includes('503')) {
        setLoginError('服务端未配置 STATICS_PASSWORD，请联系管理员');
      } else {
        setLoginError('密码错误');
      }
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setAuthed(false);
  };

  if (configured === null) {
    return (
      <div className="statics-page">
        <div className="statics-card">加载中...</div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="statics-page">
        <div className="statics-card">
          <h2>统计未启用</h2>
          <p>服务端未读到 <code>STATICS_PASSWORD</code> 环境变量（或密码长度 &lt; 4）。</p>
          <p className="hint">设置方式（任选其一）：</p>
          <pre className="hint">
{`# 方式 1：系统环境变量（直接取自系统）
export STATICS_PASSWORD=your-password-here
npm run start

# 方式 2：项目根目录 .env 文件
echo "STATICS_PASSWORD=your-password-here" > .env
npm run start`}
          </pre>
          <p className="hint">设置后必须重启服务生效。</p>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="statics-page">
        <form className="statics-card" onSubmit={handleLogin}>
          <h2>📊 拼豆图统计</h2>
          <p>请输入管理员密码以访问</p>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="管理员密码"
            autoFocus
            disabled={loggingIn}
          />
          {loginError && <p className="statics-error">{loginError}</p>}
          <button type="submit" className="primary" disabled={loggingIn || !password}>
            {loggingIn ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="statics-page">
      <div className="statics-header">
        <h1>📊 拼豆图统计</h1>
        <div className="statics-controls">
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={1}>最近 1 天</option>
            <option value={7}>最近 7 天</option>
            <option value={30}>最近 30 天</option>
            <option value={90}>最近 90 天</option>
          </select>
          <button className="statics-secondary" onClick={handleLogout}>退出</button>
        </div>
      </div>

      {summaryError && <p className="statics-error">加载失败：{summaryError}</p>}
      {loading && <p className="statics-loading">加载中...</p>}

      {summary && (
        <>
          <div className="statics-grid">
            <StatCard label="独立访客 (UV)" value={summary.totals.uv} />
            <StatCard label="浏览量 (PV)" value={summary.totals.pageView} />
            <StatCard label="商品点击" value={summary.totals.productClick} />
            <StatCard label="图片导出" value={summary.totals.imageExport} />
          </div>

          <div className="statics-section">
            <h3>每日事件总数（PV + 商品点击 + 导出）</h3>
            <DayChart data={summary.perDay} />
          </div>

          <div className="statics-section">
            <h3>商品点击排名</h3>
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
          </div>
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
              <text
                x={x + barW / 2}
                y={H - PAD_B + 14}
                fontSize="9"
                fill="#968b80"
                textAnchor="middle"
              >
                {d.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}