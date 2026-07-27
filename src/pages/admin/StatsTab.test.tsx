import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetchSummary: vi.fn().mockResolvedValue({
    totals: { uv: 0, pageView: 0, productClick: 0, imageExport: 0 },
    perDay: [],
    productClicks: [],
  }),
  listSettings: vi.fn(),
  putSetting: vi.fn(),
}));

vi.mock('@/api/statics', () => ({
  fetchSummary: mocks.fetchSummary,
}));

vi.mock('@/api/settings', () => ({
  adminListSettings: (...args: unknown[]) => mocks.listSettings(...args),
  adminPutSetting: (...args: unknown[]) => mocks.putSetting(...args),
}));

import { StatsTab } from './StatsTab';

describe('StatsTab site display card (admin only)', () => {
  beforeEach(() => {
    mocks.listSettings.mockReset();
    mocks.putSetting.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the site display card for admin role', async () => {
    mocks.listSettings.mockResolvedValueOnce({ settings: [{ key: 'showProducts', value: 'true', updatedAt: 1, updatedBy: 'root' }] });
    render(<StatsTab role="admin" />);
    expect(await screen.findByText('站点展示')).toBeTruthy();
    expect(await screen.findByText('当前：显示')).toBeTruthy();
  });

  it('toggles showProducts and persists via PUT', async () => {
    mocks.listSettings.mockResolvedValueOnce({ settings: [{ key: 'showProducts', value: 'true', updatedAt: 1, updatedBy: 'root' }] });
    mocks.putSetting.mockResolvedValueOnce({ ok: true, setting: { key: 'showProducts', value: 'false', updatedAt: 2, updatedBy: 'root' } });

    render(<StatsTab role="admin" />);
    await screen.findByText('当前：显示');
    const toggle = screen.getByTestId('site-toggle-products');
    fireEvent.click(toggle);

    await waitFor(() => expect(mocks.putSetting).toHaveBeenCalledWith('showProducts', 'false'));
    expect(await screen.findByText('当前：隐藏')).toBeTruthy();
  });

  it('rolls back UI when PUT fails', async () => {
    mocks.listSettings.mockResolvedValueOnce({ settings: [{ key: 'showProducts', value: 'true', updatedAt: 1, updatedBy: 'root' }] });
    mocks.putSetting.mockRejectedValueOnce(new Error('boom'));

    render(<StatsTab role="admin" />);
    await screen.findByText('当前：显示');
    const toggle = screen.getByTestId('site-toggle-products');
    fireEvent.click(toggle);

    await waitFor(() => expect(mocks.putSetting).toHaveBeenCalled());
    expect(await screen.findByText('当前：显示')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
  });

  it('falls back to showProducts=true when listing fails', async () => {
    mocks.listSettings.mockRejectedValueOnce(new Error('list fail'));
    render(<StatsTab role="admin" />);
    expect(await screen.findByText('当前：显示')).toBeTruthy();
  });
});