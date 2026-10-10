import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

const { updateProductMock, uploadProductImageMock } = vi.hoisted(() => ({
  updateProductMock: vi.fn().mockResolvedValue({}),
  uploadProductImageMock: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/api/products', () => ({
  updateProduct: updateProductMock,
  uploadProductImage: uploadProductImageMock,
}));

import { ProductEditModal } from './ProductEditModal';

describe('ProductEditModal', () => {
  const product = {
    id: 1,
    name: 'A',
    image: '/products/a.jpg',
    price: 99,    // cents; form 输入框以元为单位初始化 (String(product.price) = "99")
    description: '',
    url: '',
    order: 0,
  };

  beforeEach(() => {
    updateProductMock.mockClear();
    uploadProductImageMock.mockClear();
  });

  it('renders editable text fields prefilled', () => {
    const { container } = render(<ProductEditModal product={product} onClose={() => {}} onSaved={() => {}} />);
    const nameInput = container.querySelector<HTMLInputElement>('input:not([type=file]):not([type=password])');
    expect(nameInput?.value).toBe('A');
  });

  it('shows a file input accepting image types', () => {
    render(<ProductEditModal product={product} onClose={() => {}} onSaved={() => {}} />);
    const input = document.getElementById('product-image-input') as HTMLInputElement;
    expect(input.type).toBe('file');
    // 后端只接受 jpeg/png/webp，因此前端 accept 也限定为具体 mime，便于自动筛选
    expect(input.accept).toContain('image/jpeg');
    expect(input.accept).toContain('image/png');
    expect(input.accept).toContain('image/webp');
  });

  it('submits price as cents (yuan input × 100)', async () => {
    // product.price = 99 cents = 0.99 元，input 默认显示 "0.99"
    render(<ProductEditModal product={product} onClose={() => {}} onSaved={() => {}} />);
    const form = document.querySelector('form.product-edit') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => expect(updateProductMock).toHaveBeenCalledTimes(1));
    // updateProduct(id, patch) — 第二个参数是 patch body
    const [, patch] = updateProductMock.mock.calls[0];
    expect(patch).toMatchObject({ price: 99 });
  });

  it('rejects an oversize image before sending upload request', async () => {
    render(<ProductEditModal product={product} onClose={() => {}} onSaved={() => {}} />);
    const input = document.getElementById('product-image-input') as HTMLInputElement;
    const bigFile = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [bigFile] } });

    await waitFor(() => expect(screen.getByText(/图片过大/i)).toBeTruthy());
    expect(uploadProductImageMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported image mime before sending upload request', async () => {
    render(<ProductEditModal product={product} onClose={() => {}} onSaved={() => {}} />);
    const input = document.getElementById('product-image-input') as HTMLInputElement;
    const gif = new File([new Uint8Array(1024)], 'a.gif', { type: 'image/gif' });
    fireEvent.change(input, { target: { files: [gif] } });

    await waitFor(() => expect(screen.getByText(/不支持的图片格式/i)).toBeTruthy());
    expect(uploadProductImageMock).not.toHaveBeenCalled();
  });
});