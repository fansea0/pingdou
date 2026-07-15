import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/api/products', () => ({
  updateProduct: vi.fn().mockResolvedValue({}),
  uploadProductImage: vi.fn().mockResolvedValue({}),
}));

import { ProductEditModal } from './ProductEditModal';

describe('ProductEditModal', () => {
  const product = {
    id: 'p-a',
    name: 'A',
    image: '/products/a.jpg',
    price: 1,
    currency: 'CNY',
    description: '',
    url: '',
  };

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
});