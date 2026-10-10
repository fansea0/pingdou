import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

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

  it('shows a file input accepting image/*', () => {
    render(<ProductEditModal product={product} onClose={() => {}} onSaved={() => {}} />);
    const input = document.getElementById('product-image-input') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/*');
  });

  it('submits price as cents (yuan input × 100)', async () => {
    render(<ProductEditModal product={product} onClose={() => {}} onSaved={() => {}} />);
    const form = document.querySelector('form.product-edit') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => expect(updateProductMock).toHaveBeenCalledTimes(1));
    // updateProduct(id, patch) — 第二个参数是 patch body
    const [, patch] = updateProductMock.mock.calls[0];
    expect(patch).toMatchObject({ price: 9900 });
  });
});