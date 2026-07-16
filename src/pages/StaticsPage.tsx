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
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="statics-page statics-page--login">
        <div className="statics-login-bg" aria-hidden="true">
          <span className="statics-blob statics-blob--a" />
          <span className="statics-blob statics-blob--b" />
          <span className="statics-blob statics-blob--c" />
        </div>
        <form className="statics-card statics-card--login" onSubmit={handleLogin}>
          <div className="statics-login-header">
            <div className="statics-login-mark" aria-hidden="true">拼豆</div>
            <h2>拼豆图统计</h2>
            <p>请输入账号密码以继续</p>
          </div>

          <div className="statics-field">
            <span className="statics-field__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
              </svg>
            </span>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="账号"
              autoComplete="username"
              autoFocus
              disabled={loggingIn}
            />
          </div>

          <div className="statics-field">
            <span className="statics-field__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="密码"
              autoComplete="current-password"
              disabled={loggingIn}
              onKeyDown={e => {
                if (e.key === 'Enter' && (!username || !password || loggingIn)) {
                  e.preventDefault();
                }
              }}
            />
            <button
              type="button"
              className="statics-field__toggle"
              onClick={() => setShowPassword(v => !v)}
              tabIndex={-1}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              disabled={loggingIn}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                  <path d="M9.9 5.1A9.7 9.7 0 0 1 12 5c5 0 9 4 10 7a13 13 0 0 1-3.3 4.3" />
                  <path d="M6.6 6.6C4.5 8 3 10 2 12c1 3 5 7 10 7 1.7 0 3.3-.4 4.7-1.1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {loginError && <p className="statics-error">{loginError}</p>}

          <button type="submit" className="statics-primary" disabled={loggingIn || !username || !password}>
            {loggingIn ? (
              <span className="statics-spinner" aria-hidden="true" />
            ) : null}
            <span>{loggingIn ? '登录中...' : '登录'}</span>
          </button>

          <p className="statics-login-foot">拼豆图 · 配色与统计后台</p>
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