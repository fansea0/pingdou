import { useState } from 'react';
import { updateProduct, uploadProductImage, type Product } from '@/api/products';
import './ProductEditModal.css';

interface Props {
  product: Product;
  onClose: () => void;
  onSaved: (next: Product) => void;
}

export function ProductEditModal({ product, onClose, onSaved }: Props) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [price, setPrice] = useState(String(product.price));
  const [url, setUrl] = useState(product.url);
  const [badge, setBadge] = useState(product.badge ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState(product.image);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const numericPrice = Number(price);
      if (Number.isNaN(numericPrice)) throw new Error('invalid price');
      const updated = await updateProduct(product.id, {
        name,
        description,
        price: numericPrice,
        url,
        badge: badge === '' ? null : badge,
      });
      const fileInput = document.getElementById('product-image-input') as HTMLInputElement | null;
      const file = fileInput?.files?.[0] ?? null;
      let next: Product = updated;
      if (file) next = await uploadProductImage(product.id, file);
      setImagePath(next.image);
      onSaved(next);
    } catch (err: any) {
      setError(err?.message ?? 'save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card product-edit" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>编辑商品 {product.id}</h3>
        {imagePath && <img src={imagePath} alt="" className="product-edit-thumb" />}
        <label>
          名称
          <input value={name} onChange={e => setName(e.target.value)} disabled={busy} />
        </label>
        <label>
          价格
          <input value={price} onChange={e => setPrice(e.target.value)} disabled={busy} inputMode="decimal" />
        </label>
        <label>
          链接
          <input value={url} onChange={e => setUrl(e.target.value)} disabled={busy} />
        </label>
        <label>
          介绍
          <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy} />
        </label>
        <label>
          角标 (可空)
          <input value={badge} onChange={e => setBadge(e.target.value)} disabled={busy} placeholder="如：热销 / 新品" />
        </label>
        <label className="product-edit-upload">
          上传图片 (jpeg / png / webp, ≤ 5 MB)
          <input id="product-image-input" type="file" accept="image/*" disabled={busy} aria-label="upload image" />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? '保存中...' : '保存'}
        </button>
      </form>
    </div>
  );
}