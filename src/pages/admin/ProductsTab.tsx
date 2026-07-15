import { useEffect, useState } from 'react';
import { listProducts, adminCreateProduct, adminDeleteProduct, type Product } from '@/api/products';
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
              <th>ID</th><th>名称</th><th>价格</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>{p.price}</td>
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

function CreateProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [currency, setCurrency] = useState('CNY');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminCreateProduct({ id, name, image: '', price: Number(price), currency, description, url });
      onCreated();
    } catch (err: any) {
      setError(err.message ?? 'create failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>新建商品</h3>
        <label>ID (小写字母数字与连字符)<input value={id} onChange={e => setId(e.target.value)} disabled={busy} /></label>
        <label>名称<input value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
        <label>价格<input value={price} onChange={e => setPrice(e.target.value)} disabled={busy} inputMode="decimal" /></label>
        <label>币种<input value={currency} onChange={e => setCurrency(e.target.value)} disabled={busy} /></label>
        <label>链接<input value={url} onChange={e => setUrl(e.target.value)} disabled={busy} /></label>
        <label>介绍<textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy} /></label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || !/^[a-z0-9-]+$/.test(id) || name.length === 0}>{busy ? '创建中...' : '创建'}</button>
      </form>
    </div>
  );
}