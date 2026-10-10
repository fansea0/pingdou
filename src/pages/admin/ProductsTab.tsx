import { useEffect, useState } from 'react';
import {
  listProducts,
  adminCreateProduct,
  adminDeleteProduct,
  adminReorderProducts,
  type Product,
} from '@/api/products';
import { ProductEditModal } from '@/components/ProductEditModal';

export function ProductsTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try { setProducts(await listProducts()); }
    catch (e: any) { setError(e.message ?? 'load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const remove = async (p: Product) => {
    if (!confirm(`确定删除 ${p.id}? 关联历史事件保留但不再对任何商家可见。`)) return;
    try {
      await adminDeleteProduct(p.id);
      await reload();
    } catch (e: any) {
      alert(e.message ?? 'delete failed');
    }
  };

  const handleDragEnd = async (sourceId: number, destId: number) => {
    if (sourceId === destId) return;
    const prev = products;
    const fromIdx = prev.findIndex(p => p.id === sourceId);
    const toIdx = prev.findIndex(p => p.id === destId);
    if (fromIdx === -1 || toIdx === -1) return;
    const ids = prev.map(p => p.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    const next = ids.map((id, i) => {
      const p = prev.find(x => x.id === id);
      if (!p) throw new Error(`reorder: missing product id=${id}`);
      return { ...p, order: i + 1 };
    });
    setProducts(next);
    try {
      const refreshed = await adminReorderProducts(ids);
      setProducts(refreshed);
    } catch (e) {
      console.error('reorder failed', e);
      setProducts(prev); // 乐观更新失败回滚
    }
  };

  const handleOrderChange = async (id: number, targetOrder: number) => {
    const prev = products;
    const fromIdx = prev.findIndex(p => p.id === id);
    if (fromIdx === -1) return;
    if (targetOrder < 1 || targetOrder > prev.length) return;
    const toIdx = targetOrder - 1;
    if (fromIdx === toIdx) return;
    const ids = prev.map(p => p.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    const next = ids.map((pid, i) => {
      const p = prev.find(x => x.id === pid);
      if (!p) throw new Error(`reorder: missing product id=${pid}`);
      return { ...p, order: i + 1 };
    });
    setProducts(next);
    try {
      const refreshed = await adminReorderProducts(ids);
      setProducts(refreshed);
    } catch (e) {
      console.error('reorder failed', e);
      setProducts(prev); // 乐观更新失败回滚
    }
  };

  return (
    <div className="statics-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h3>商品管理</h3>
        <button className="primary" onClick={() => setCreating(true)}>新建商品</button>
      </div>
      {loading && <p className="statics-loading">加载中...</p>}
      {error && <p className="statics-error">{error}</p>}
      {!loading && (
        <table className="statics-table">
          <thead>
            <tr>
              <th>ID</th><th>名称</th><th>价格</th><th>排序</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr
                key={p.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(p.id))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const sourceId = Number(e.dataTransfer.getData('text/plain'));
                  void handleDragEnd(sourceId, p.id);
                }}
              >
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>{p.price}</td>
                <td>
                  <OrderInput
                    order={p.order}
                    max={products.length}
                    onCommit={(n) => { void handleOrderChange(p.id, n); }}
                  />
                </td>
                <td>
                  <button onClick={() => setEditing(p)}>编辑</button>
                  <button className="danger" onClick={() => remove(p)} style={{ marginLeft: 4 }}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <ProductEditModal product={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      )}
      {creating && (
        <CreateProductModal onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} />
      )}
    </div>
  );
}

function OrderInput({ order, max, onCommit }: { order: number; max: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(order));
  // 当外部 order 改变（如拖拽后服务端返回）时同步本地草稿
  useEffect(() => { setDraft(String(order)); }, [order]);
  return (
    <input
      type="number"
      min={1}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        if (Number.isInteger(n) && n >= 1 && n <= max && n !== order) {
          onCommit(n);
        } else {
          setDraft(String(order));
        }
      }}
    />
  );
}

function CreateProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const numericYuan = Number(price);
      if (Number.isNaN(numericYuan)) throw new Error('invalid price');
      const numericCents = Math.round(numericYuan * 100);
      await adminCreateProduct({
        // server auto-generates id; placeholder satisfies FE type signature
        id: 0,
        name,
        image: '',
        price: numericCents,
        description,
        url,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message ?? 'create failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop modal-backdrop--product" onClick={onClose}>
      <form className="modal-card modal-card--product" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose} disabled={busy}>×</button>
        <h3>新建商品</h3>
        <fieldset className="modal-form-section">
          <legend>基础信息</legend>
          <div className="modal-form-grid">
            <label className="modal-form-field">名称<input value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
          </div>
        </fieldset>
        <fieldset className="modal-form-section">
          <legend>商品详情</legend>
          <div className="modal-form-grid">
            <label className="modal-form-field">价格（元）<input value={price} onChange={e => setPrice(e.target.value)} disabled={busy} inputMode="decimal" /></label>
            <label className="modal-form-field modal-form-field--wide">链接<input value={url} onChange={e => setUrl(e.target.value)} disabled={busy} /></label>
            <label className="modal-form-field modal-form-field--wide">介绍<textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy} /></label>
          </div>
        </fieldset>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="primary" disabled={busy || name.length === 0}>{busy ? '创建中...' : '创建'}</button>
        </div>
      </form>
    </div>
  );
}