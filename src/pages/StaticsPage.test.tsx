import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const meState: { value: any } = { value: null as any };
vi.mock('@/api/statics', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ ok: true, staticsConfigured: true }),
  fetchMe: vi.fn().mockImplementation(() => {
    if (meState.value === null) return Promise.reject(new Error('401'));
    return Promise.resolve(meState.value);
  }),
  loginWithUsername: vi.fn().mockResolvedValue({ ok: true, role: 'admin', username: 'root', mustChangePassword: false, expiresAt: null, id: 1 }),
  logout: vi.fn().mockResolvedValue(undefined),
  fetchSummary: vi.fn().mockResolvedValue({ totals: {}, perDay: [], productClicks: [] }),
  trackEvent: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock('./admin/AdminDashboard', () => ({ AdminDashboard: () => <div data-testid="admin-dashboard" /> }));
vi.mock('./merchant/MerchantDashboard', () => ({ MerchantDashboard: () => <div data-testid="merchant-dashboard" /> }));

import { StaticsPage } from './StaticsPage';

describe('StaticsPage', () => {
  beforeEach(() => { meState.value = null; });

  it('renders login form when /me 401s', async () => {
    render(<StaticsPage />);
    await waitFor(() => screen.getByRole('button', { name: /登录/ }));
    expect(screen.getByPlaceholderText(/账号/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/密码/)).toBeTruthy();
  });

  it('renders admin dashboard when me.role=admin', async () => {
    meState.value = { id: 1, username: 'root', role: 'admin', mustChangePassword: false, expiresAt: null };
    render(<StaticsPage />);
    await waitFor(() => screen.getByTestId('admin-dashboard'));
    expect(screen.getByTestId('admin-dashboard')).toBeTruthy();
  });

  it('renders merchant dashboard when me.role=merchant', async () => {
    meState.value = { id: 2, username: 'mike', role: 'merchant', mustChangePassword: false, expiresAt: null };
    render(<StaticsPage />);
    await waitFor(() => screen.getByTestId('merchant-dashboard'));
    expect(screen.getByTestId('merchant-dashboard')).toBeTruthy();
  });

  it('renders a forced password-change modal when mustChangePassword=true', async () => {
    meState.value = { id: 2, username: 'mike', role: 'merchant', mustChangePassword: true, expiresAt: null };
    render(<StaticsPage />);
    await waitFor(() => screen.getByText(/首次登录请修改默认密码后再继续/));
    expect(screen.getByText(/首次登录请修改默认密码/)).toBeTruthy();
  });
});