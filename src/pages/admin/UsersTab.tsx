import { useEffect, useState } from 'react';
import {
  adminListUsers, adminCreateUser, adminPatchUser, adminDeleteUser, adminResetPassword,
  type AdminUserView,
} from '@/api/users';
import { listProducts, type Product } from '@/api/products';
import './UsersTab.css';

export function UsersTab() {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AdminUserView | null>(null);
  const [renewing, setRenewing] = useState<AdminUserView | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, p] = await Promise.all([adminListUsers(), listProducts()]);
      setUsers(u);
      setProducts(p);
    } catch (e: any) {
      setError(e.message ?? 'load failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []);

  const toggleDisabled = async (u: AdminUserView) => {
    try {
      await adminPatchUser(u.id, { disabled: !u.disabled });
      await reload();
    } catch (e: any) {
      alert(e.message ?? 'patch failed');
    }
  };
  const removeUser = async (u: AdminUserView) => {
    if (!confirm(`确定删除 ${u.username}?`)) return;
    try {
      await adminDeleteUser(u.id);
      await reload();
    } catch (e: any) {
      alert(e.message ?? 'delete failed');
    }
  };

  return (
    <div className="statics-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h3>账号管理</h3>
        <button className="primary" onClick={() => setCreating(true)}>新建账号</button>
      </div>
      {loading && <p className="statics-loading">加载中...</p>}
      {error && <p className="statics-error">{error}</p>}
      {!loading && (
        <table className="statics-table users-tab-table">
          <thead>
            <tr>
              <th>账号</th><th>角色</th><th>状态</th><th>商品</th><th>过期时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.username}{u.mustChangePassword ? ' (待改密)' : ''}</td>
                <td>{u.role === 'admin' ? '管理员' : '商家'}</td>
                <td>{u.disabled ? '已禁用' : '正常'}</td>
                <td>{u.products.length === 0 ? '—' : u.products.join(', ')}</td>
                <td>{u.expiresAt ? new Date(u.expiresAt).toLocaleDateString() : '永久'}</td>
                <td className="users-tab-actions">
                  <button onClick={() => setResetting(u)}>重置密码</button>
                  <button onClick={() => setRenewing(u)}>续期</button>
                  <button onClick={() => toggleDisabled(u)}>{u.disabled ? '启用' : '禁用'}</button>
                  <button className="danger" onClick={() => removeUser(u)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && (
        <CreateUserModal products={products} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} />
      )}
      {resetting && (
        <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} onDone={async () => { setResetting(null); await reload(); }} />
      )}
      {renewing && (
        <RenewModal user={renewing} onClose={() => setRenewing(null)} onDone={async () => { setRenewing(null); await reload(); }} />
      )}
    </div>
  );
}

function CreateUserModal({ products, onClose, onCreated }: { products: Product[]; onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'merchant' | 'admin'>('merchant');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [mustChange, setMustChange] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminCreateUser({
        username,
        password,
        role,
        productIds: role === 'merchant' ? productIds : [],
        mustChangePassword: mustChange,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message ?? 'create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>创建新账号</h3>
        <label>账号<input value={username} onChange={e => setUsername(e.target.value)} disabled={busy} /></label>
        <label>初始密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
        <label>角色
          <select value={role} onChange={e => setRole(e.target.value as 'admin' | 'merchant')} disabled={busy}>
            <option value="merchant">商家</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={mustChange} onChange={e => setMustChange(e.target.checked)} disabled={busy} />
          首次登录需修改密码
        </label>
        {role === 'merchant' && (
          <fieldset className="users-tab-products">
            <legend>分配商品</legend>
            {products.length === 0 && <p className="statics-empty">暂无商品</p>}
            {products.map(p => (
              <label key={p.id} className="users-tab-product-row">
                <input type="checkbox" disabled={busy}
                  checked={productIds.includes(p.id)}
                  onChange={e => setProductIds(ids => e.target.checked ? [...ids, p.id] : ids.filter(x => x !== p.id))}
                />
                {p.name} ({p.id})
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || username.length === 0 || password.length < 4}>{busy ? '创建中...' : '创建'}</button>
      </form>
    </div>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AdminUserView; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminResetPassword(user.id, pw);
      onDone();
    } catch (err: any) {
      setError(err.message ?? 'reset failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>重置 {user.username} 的密码</h3>
        <label>新密码（≥ 4 位）
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} disabled={busy} />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || pw.length < 4}>{busy ? '保存中...' : '保存'}</button>
      </form>
    </div>
  );
}

function RenewModal({ user, onClose, onDone }: { user: AdminUserView; onClose: () => void; onDone: () => void }) {
  const today = new Date();
  const defaultExpiry = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()).getTime();
  const initial = user.expiresAt ?? defaultExpiry;
  const [ts, setTs] = useState(new Date(initial).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminPatchUser(user.id, { expiresAt: new Date(ts).getTime() });
      onDone();
    } catch (err: any) {
      setError(err.message ?? 'renew failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>为 {user.username} 续期</h3>
        <label>到期日<input type="date" value={ts} onChange={e => setTs(e.target.value)} disabled={busy} /></label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? '保存中...' : '保存'}</button>
      </form>
    </div>
  );
}