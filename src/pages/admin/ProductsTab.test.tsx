import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listProducts: vi.fn(),
  adminCreateProduct: vi.fn(),
  adminDeleteProduct: vi.fn(),
  adminReorderProducts: vi.fn(),
  uploadProductImage: vi.fn(),
}));

vi.mock('@/api/products', () => ({
  listProducts: (...args: unknown[]) => mocks.listProducts(...args),
  adminCreateProduct: (...args: unknown[]) => mocks.adminCreateProduct(...args),
  adminDeleteProduct: (...args: unknown[]) => mocks.adminDeleteProduct(...args),
  adminReorderProducts: (...args: unknown[]) => mocks.adminReorderProducts(...args),
  uploadProductImage: (...args: unknown[]) => mocks.uploadProductImage(...args),
}));

import { ProductsTab } from './ProductsTab';

const sampleProducts = [
  { id: 1, name: 'A', image: '', price: 100, description: '', url: '', order: 1 },
  { id: 2, name: 'B', image: '', price: 200, description: '', url: '', order: 2 },
  { id: 3, name: 'C', image: '', price: 300, description: '', url: '', order: 3 },
];

function makeDataTransfer() {
  const store: Record<string, string> = {};
  return {
    setData: (format: string, value: string) => { store[format] = value; },
    getData: (format: string) => store[format] ?? '',
  };
}

function rowByText(text: string): HTMLTableRowElement {
  const cell = screen.getByText(text);
  const row = cell.closest('tr');
  if (!row) throw new Error(`no <tr> ancestor for "${text}"`);
  return row as HTMLTableRowElement;
}

beforeEach(() => {
  mocks.listProducts.mockReset();
  mocks.adminCreateProduct.mockReset().mockResolvedValue({ id: 99, name: 'X', image: '', price: 0, description: '', url: '', order: 1 });
  mocks.adminDeleteProduct.mockReset().mockResolvedValue({ ok: true });
  mocks.adminReorderProducts.mockReset();
  mocks.uploadProductImage.mockReset().mockResolvedValue({ id: 99, name: 'X', image: '/products/x.jpg', price: 0, description: '', url: '', order: 1 });
});

afterEach(() => {
  cleanup();
});

describe('ProductsTab', () => {
  it('opens a structured new-product form', async () => {
    mocks.listProducts.mockResolvedValue([]);
    render(<ProductsTab />);
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '新建商品' }));

    expect(screen.getByRole('group', { name: '基础信息' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '商品详情' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '介绍' }).closest('.modal-form-field--wide')).toBeTruthy();
    expect(screen.getByLabelText('介绍').closest('fieldset')).toBe(screen.getByRole('group', { name: '商品详情' }));
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });

  it('calls adminReorderProducts with reordered ids on drag end', async () => {
    mocks.listProducts.mockResolvedValue(sampleProducts);
    mocks.adminReorderProducts.mockResolvedValue([
      { id: 2, name: 'B', image: '', price: 200, description: '', url: '', order: 1 },
      { id: 3, name: 'C', image: '', price: 300, description: '', url: '', order: 2 },
      { id: 1, name: 'A', image: '', price: 100, description: '', url: '', order: 3 },
    ]);
    render(<ProductsTab />);
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    const sourceRow = rowByText('A');
    const destRow = rowByText('C');
    const dt = makeDataTransfer();
    fireEvent.dragStart(sourceRow, { dataTransfer: dt });
    fireEvent.dragOver(destRow, { dataTransfer: dt });
    fireEvent.drop(destRow, { dataTransfer: dt });

    await waitFor(() => expect(mocks.adminReorderProducts).toHaveBeenCalledTimes(1));
    expect(mocks.adminReorderProducts).toHaveBeenCalledWith([2, 3, 1]);
  });

  it('calls adminReorderProducts on manual order input commit (blur)', async () => {
    mocks.listProducts.mockResolvedValue(sampleProducts);
    mocks.adminReorderProducts.mockResolvedValue([
      { id: 2, name: 'B', image: '', price: 200, description: '', url: '', order: 1 },
      { id: 1, name: 'A', image: '', price: 100, description: '', url: '', order: 2 },
      { id: 3, name: 'C', image: '', price: 300, description: '', url: '', order: 3 },
    ]);
    render(<ProductsTab />);
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    // row A has order input with value '1' (its current order)
    const orderInputA = rowByText('A').querySelector('input[type="number"]') as HTMLInputElement;
    expect(orderInputA.value).toBe('1');

    fireEvent.change(orderInputA, { target: { value: '2' } });
    fireEvent.blur(orderInputA);

    await waitFor(() => expect(mocks.adminReorderProducts).toHaveBeenCalledTimes(1));
    expect(mocks.adminReorderProducts).toHaveBeenCalledWith([2, 1, 3]);
  });

  it('rolls back the products list when adminReorderProducts rejects', async () => {
    mocks.listProducts.mockResolvedValue(sampleProducts);
    mocks.adminReorderProducts.mockRejectedValueOnce(new Error('boom'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<ProductsTab />);
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    const orderInputA = rowByText('A').querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(orderInputA, { target: { value: '2' } });
    fireEvent.blur(orderInputA);

    await waitFor(() => expect(mocks.adminReorderProducts).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledWith('reorder failed', expect.any(Error)));

    // after rollback, A's order input snaps back to '1' and the table order is original
    await waitFor(() => expect(orderInputA.value).toBe('1'));
    const rowA = screen.getByText('A').closest('tr');
    const rowB = screen.getByText('B').closest('tr');
    const rowC = screen.getByText('C').closest('tr');
    expect(rowA?.nextElementSibling).toBe(rowB);
    expect(rowB?.nextElementSibling).toBe(rowC);

    consoleErrorSpy.mockRestore();
  });

  it('renders price column as yuan (divides cents by 100)', async () => {
    mocks.listProducts.mockResolvedValue([
      { id: 1, name: 'X', image: '', price: 1700000, description: '', url: '', order: 1 },
      { id: 2, name: 'Y', image: '', price: 120080, description: '', url: '', order: 2 },
    ]);
    render(<ProductsTab />);
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    // 1700000 cents = 17000.00 元
    expect(screen.getByText('¥17000.00')).toBeTruthy();
    // 120080 cents = 1200.80 元
    expect(screen.getByText('¥1200.80')).toBeTruthy();
  });
});