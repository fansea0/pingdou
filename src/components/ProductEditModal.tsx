import { useState } from 'react';
import { updateProduct, uploadProductImage, type Product } from '@/api/products';
import './ProductEditModal.css';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_MB = MAX_IMAGE_BYTES / 1024 / 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface Props {
  product: Product;
  onClose: () => void;
  onSaved: (next: Product) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return `不支持的图片格式（仅 jpeg / png / webp），当前：${file.type || '未知'}`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `图片过大：${formatBytes(file.size)}，上限 ${MAX_IMAGE_MB} MB，请压缩后再上传`;
  }
  return null;
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
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    setError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setPickedFile(null);
      return;
    }
    const err = validateImageFile(file);
    if (err) {
      // 清空 input 让用户能重新选同一个文件
      e.target.value = '';
      setPickedFile(null);
      setFileError(err);
      return;
    }
    setPickedFile(file);
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card product-edit" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose} disabled={busy}>×</button>
        <h3>编辑商品 {product.id}</h3>
        {imagePath && <img src={imagePath} alt="" className="product-edit-thumb" />}
        <fieldset className="modal-form-section">
          <legend>基础信息</legend>
          <div className="modal-form-grid">
            <label className="modal-form-field">名称<input value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
            <label className="modal-form-field">角标（可空）<input value={badge} onChange={e => setBadge(e.target.value)} disabled={busy} placeholder="如：热销 / 新品" maxLength={10} /></label>
          </div>
        </fieldset>
        <fieldset className="modal-form-section">
          <legend>商品详情</legend>
          <div className="modal-form-grid">
            <label className="modal-form-field">价格（元）<input value={price} onChange={e => setPrice(e.target.value)} disabled={busy} inputMode="decimal" placeholder="0.00" /></label>
            <label className="modal-form-field">链接<input value={url} onChange={e => setUrl(e.target.value)} disabled={busy} placeholder="https://..." /></label>
            <label className="modal-form-field modal-form-field--wide">介绍<textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy} rows={3} /></label>
          </div>
        </fieldset>
        <fieldset className="modal-form-section">
          <legend>商品图片</legend>
          <div className="modal-form-grid">
            <label className="modal-form-field modal-form-field--wide product-edit-upload">
              上传图片（jpeg / png / webp，≤ {MAX_IMAGE_MB} MB）
              <input id="product-image-input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} aria-label="upload image" onChange={handleFileChange} />
            </label>
            {pickedFile && !fileError && (
              <p className="product-edit-file-info">已选择：{pickedFile.name}（{formatBytes(pickedFile.size)}）</p>
            )}
            {fileError && <p className="modal-error">{fileError}</p>}
          </div>
        </fieldset>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? '保存中...' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}