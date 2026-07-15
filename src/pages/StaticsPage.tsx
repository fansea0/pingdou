import { useEffect, useState } from 'react';
import {
  fetchMe, loginWithUsername, logout, type Me,
} from '@/api/statics';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { AdminDashboard } from './admin/AdminDashboard';
import { MerchantDashboard } from './merchant/MerchantDashboard';
import './StaticsPage.css';

type Status = 'loading' | 'login' | 'authed';

export function StaticsPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [forceModalOpen, setForceModalOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const m = await fetchMe();
        setMe(m);
        setStatus('authed');
      } catch {
        setStatus('login');
      }
    })();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoginError(null);
    setLoggingIn(true);
    try {
      const m = await loginWithUsername(username, password);
      setMe(m);
      setStatus('authed');
      setUsername('');
      setPassword('');
    } catch (err: any) {
      setLoginError(err?.message ?? '登录失败');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setMe(null);
    setStatus('login');
  };

  const refreshMe = async () => {
    try { setMe(await fetchMe()); } catch { setStatus('login'); }
  };

  if (status === 'loading') {
    return <div className="statics-page"><div className="statics-card">加载中...</div></div>;
  }

  if (status === 'login') {
    return (
      <div className="statics-page">
        <form className="statics-card" onSubmit={handleLogin}>
          <h2>拼豆图统计</h2>
          <p>请输入账号密码</p>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="账号"
            autoFocus
            disabled={loggingIn}
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="密码"
            disabled={loggingIn}
          />
          {loginError && <p className="statics-error">{loginError}</p>}
          <button type="submit" className="primary" disabled={loggingIn || !username || !password}>
            {loggingIn ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="statics-page">
      <div className="statics-header">
        <h1>拼豆图统计</h1>
        <div className="statics-controls">
          <span className="statics-greeting">{me?.username}</span>
          <button className="statics-secondary" onClick={() => setForceModalOpen(true)}>修改密码</button>
          <button className="statics-secondary" onClick={handleLogout}>退出</button>
        </div>
      </div>
      {me?.role === 'admin' ? <AdminDashboard /> : <MerchantDashboard />}
      {me?.mustChangePassword && (
        <ChangePasswordModal
          required
          onSuccess={async () => { await refreshMe(); }}
        />
      )}
      {forceModalOpen && (
        <ChangePasswordModal
          required={false}
          onClose={() => setForceModalOpen(false)}
          onSuccess={async () => { setForceModalOpen(false); await refreshMe(); }}
        />
      )}
    </div>
  );
}