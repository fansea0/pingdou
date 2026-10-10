import { useState } from 'react';
import { updateProduct, uploadProductImage, type Product } from '@/api/products';
import {
  formatImageBytes,
  validateProductImageFile,
  MAX_PRODUCT_IMAGE_MB,
} from '@/utils/imageFile';
import './ProductEditModal.css';

interface Props {
  product: Product;
  onClose: () => void;
  onSaved: (next: Product) => void;
}

export function ProductEditModal({ product, onClose, onSaved }: Props) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  // price 后端存「分」；表单输入以「元」为单位
  const [price, setPrice] = useState((product.price / 100).toString());
  const [url, setUrl] = useState(product.url);
  const [badge, setBadge] = useState(product.badge ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState(product.image);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    setError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setPickedFile(null);
      setPickedPreview(null);
      return;
    }
    const err = validateProductImageFile(file);
    if (err) {
      e.target.value = '';
      setPickedFile(null);
      setPickedPreview(null);
      setFileError(err);
      return;
    }
    setPickedFile(file);
    const reader = new FileReader();
    reader.onload = () => setPickedPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const numericYuan = Number(price);
      if (Number.isNaN(numericYuan)) throw new Error('价格格式不正确');
      if (numericYuan < 0) throw new Error('价格不能为负数');
      const numericCents = Math.round(numericYuan * 100);
      const updated = await updateProduct(product.id, {
        name,
        description,
        price: numericCents,
        url,
        badge: badge === '' ? null : badge,
      });
      let next: Product = updated;
      if (pickedFile) next = await uploadProductImage(product.id, pickedFile);
      setImagePath(next.image);
      onSaved(next);
    } catch (err: any) {
      setError(err?.message ?? 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const previewSrc = pickedPreview ?? (imagePath && imagePath !== '' ? imagePath : null);

  return (
    <div className="modal-backdrop modal-backdrop--product" onClick={onClose}>
      <form className="modal-card modal-card--product product-edit" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose} disabled={busy}>×</button>
        <h3>
          编辑商品
          <span className="modal-subtitle">#{product.id} · {name || '未命名'}</span>
        </h3>
        <fieldset className="modal-form-section">
          <legend>基础信息</legend>
          <div className="modal-form-grid">
            <label className="modal-form-field">
              名称
              <input value={name} onChange={e => setName(e.target.value)} disabled={busy} maxLength={50} />
            </label>
            <label className="modal-form-field">
              角标
              <input value={badge} onChange={e => setBadge(e.target.value)} disabled={busy} placeholder="如：热销 / 新品" maxLength={10} />
            </label>
          </div>
        </fieldset>
        <fieldset className="modal-form-section">
          <legend>商品详情</legend>
          <div className="modal-form-grid">
            <label className="modal-form-field">
              <span className="modal-form-label">价格 <em>元</em></span>
              <input value={price} onChange={e => setPrice(e.target.value)} disabled={busy} inputMode="decimal" placeholder="0.00" />
            </label>
            <label className="modal-form-field">
              链接
              <input value={url} onChange={e => setUrl(e.target.value)} disabled={busy} placeholder="https://..." />
            </label>
            <label className="modal-form-field modal-form-field--wide">
              介绍
              <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy} rows={3} />
            </label>
          </div>
        </fieldset>
        <fieldset className="modal-form-section">
          <legend>封面图</legend>
          <div className="product-image-row">
            <div className="product-image-preview" data-empty={!previewSrc}>
              {previewSrc
                ? <img src={previewSrc} alt="封面预览" />
                : <span className="product-image-placeholder">暂无图片<br/>建议 1:1 比例</span>
              }
            </div>
            <div className="product-image-controls">
              <label className="product-image-pick">
                <input
                  id="product-image-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={handleFileChange}
                  aria-label="选择新封面图"
                />
                <span>{pickedFile ? '已选新图 · 更换' : imagePath ? '更换图片' : '选择图片'}</span>
              </label>
              {pickedFile && !fileError && (
                <p className="product-image-hint">{pickedFile.name} · {formatImageBytes(pickedFile.size)}</p>
              )}
              {!pickedFile && !fileError && (
                <p className="product-image-hint">jpeg / png / webp，≤ {MAX_PRODUCT_IMAGE_MB} MB</p>
              )}
              {fileError && <p className="modal-error">{fileError}</p>}
            </div>
          </div>
        </fieldset>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="primary" disabled={busy || name.trim().length === 0}>{busy ? '保存中...' : '保存'}</button>
        </div>
      </form>
    </div>
  );
}