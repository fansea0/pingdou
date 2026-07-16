import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/api/products', () => ({
  listProducts: vi.fn().mockResolvedValue([]),
  adminCreateProduct: vi.fn().mockResolvedValue({ ok: true }),
  adminDeleteProduct: vi.fn().mockResolvedValue({ ok: true }),
}));

import { ProductsTab } from './ProductsTab';

describe('ProductsTab', () => {
  it('opens a structured new-product form', async () => {
    render(<ProductsTab />);
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '新建商品' }));

    expect(screen.getByRole('group', { name: '基础信息' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '商品详情' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '介绍' }).closest('.modal-form-field--wide')).toBeTruthy();
    expect(screen.getByLabelText('介绍').closest('fieldset')).toBe(screen.getByRole('group', { name: '商品详情' }));
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });
});
