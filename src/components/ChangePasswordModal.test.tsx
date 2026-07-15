import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/statics', () => ({
  changePassword: vi.fn().mockResolvedValue(undefined),
}));

import { ChangePasswordModal } from './ChangePasswordModal';

describe('ChangePasswordModal', () => {
  it('renders both current and new password fields', () => {
    render(<ChangePasswordModal required={false} onSuccess={() => {}} />);
    expect(screen.getByText(/当前密码/)).toBeTruthy();
    expect(screen.getByText(/新密码/)).toBeTruthy();
  });

  it('hides the close button when required=true (cannot dismiss)', () => {
    render(<ChangePasswordModal required={true} onSuccess={() => {}} />);
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
  });

  it('shows the close button when required=false and onClose is provided', () => {
    render(<ChangePasswordModal required={false} onSuccess={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();
  });
});