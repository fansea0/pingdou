import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/users', () => ({
  adminListUsers: vi.fn().mockResolvedValue([
    { id: 1, username: 'root', role: 'admin', disabled: false, mustChangePassword: false, expiresAt: null, createdAt: 0, products: [] },
    { id: 2, username: 'mike', role: 'merchant', disabled: false, mustChangePassword: false, expiresAt: null, createdAt: 0, products: ['p-a'] },
  ]),
  adminCreateUser: vi.fn().mockResolvedValue({ id: 3, username: 'new', role: 'merchant' }),
  adminPatchUser: vi.fn().mockResolvedValue({ ok: true }),
  adminDeleteUser: vi.fn().mockResolvedValue({ ok: true }),
  adminResetPassword: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/api/products', () => ({
  listProducts: vi.fn().mockResolvedValue([
    { id: 'p-a', name: 'A', image: '', price: 1, currency: 'CNY', description: '', url: '' },
  ]),
}));

import { UsersTab } from './UsersTab';

describe('UsersTab', () => {
  it('lists users and opens the new-user modal on 新建账号 click', async () => {
    render(<UsersTab />);
    await waitFor(() => screen.getByText('root'));
    fireEvent.click(screen.getByRole('button', { name: /新建账号/i }));
    expect(screen.getByText(/创建新账号/i)).toBeTruthy();
  });
});