import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, screen, cleanup } from '@testing-library/react';
import { ProductShowcase } from '@/components/ProductShowcase';

const mockProducts = [
  { id: 'p1', name: '128 色套装', image: '/a.jpg', price: 99, currency: 'CNY' as const, description: '套装介绍', url: 'https://taobao.com/1' },
  { id: 'p2', name: '24 色套装', image: '/b.jpg', price: 29.9, currency: 'CNY' as const, description: '入门套装', url: 'https://taobao.com/2', badge: '新品' },
];

describe('ProductShowcase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('shows loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    const { container } = render(<ProductShowcase />);
    expect(container.querySelector('.product-loading')).toBeTruthy();
  });

  it('renders one card per product', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockProducts,
    } as Response);

    const { container } = render(<ProductShowcase />);
    await waitFor(() => expect(container.querySelectorAll('.product-card')).toHaveLength(2));
  });

  it('renders product name, price, badge', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockProducts,
    } as Response);

    render(<ProductShowcase />);
    await waitFor(() => screen.getAllByText('128 色套装').length > 0);
    expect(screen.getAllByText('128 色套装').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('¥99.00')).toBeTruthy();
    expect(screen.getByText('新品')).toBeTruthy();
  });

  it('shows error state on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));
    const { container } = render(<ProductShowcase />);
    await waitFor(() => expect(container.querySelector('.product-error')).toBeTruthy());
  });

  it('renders nothing for empty product list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const { container } = render(<ProductShowcase />);
    await waitFor(() => expect(container.querySelector('.product-grid')).toBeNull());
  });
});

describe('ProductCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('sets correct anchor attributes for safety', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockProducts,
    } as Response);

    const { container } = render(<ProductShowcase />);
    await waitFor(() => container.querySelectorAll('.product-card').length > 0);

    const firstCard = container.querySelector('.product-card') as HTMLAnchorElement;
    expect(firstCard.target).toBe('_blank');
    expect(firstCard.rel).toBe('noopener noreferrer');
    expect(firstCard.href).toContain('https://taobao.com/1');
  });
});