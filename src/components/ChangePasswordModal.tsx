import { useState } from 'react';
import { changePassword } from '@/api/statics';
import './ChangePasswordModal.css';

interface Props {
  required: boolean;
  onClose?: () => void;
  onSuccess: () => void;
}

export function ChangePasswordModal({ required, onClose, onSuccess }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canDismiss = !required && Boolean(onClose);
  const valid = current.length > 0 && next.length >= 4 && next !== current;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      onSuccess();
    } catch (err: any) {
      setError(err?.message ?? 'change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={canDismiss ? onClose : undefined}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        {canDismiss && onClose && (
          <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        )}
        <h3>修改密码</h3>
        {required && <p className="modal-hint">首次登录请修改默认密码后再继续。</p>}
        <label>
          当前密码
          <input type="password" value={current} onChange={e => setCurrent(e.target.value)} disabled={busy} autoFocus />
        </label>
        <label>
          新密码（至少 4 位）
          <input type="password" value={next} onChange={e => setNext(e.target.value)} disabled={busy} />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={!valid || busy}>
          {busy ? '保存中...' : '保存'}
        </button>
      </form>
    </div>
  );
}