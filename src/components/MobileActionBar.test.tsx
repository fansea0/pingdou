import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MobileActionBar } from './MobileActionBar';

type BarProps = ComponentProps<typeof MobileActionBar>;

function renderBar(overrides: Partial<BarProps> = {}) {
  const props: BarProps = {
    gridSize: 100,
    removeBackground: false,
    simplifyColors: false,
    onGridSizeChange: () => {},
    onRemoveBackgroundChange: () => {},
    onSimplifyColorsChange: () => {},
    onLoad: () => {},
    onExport: () => {},
    canExport: true,
    exporting: false,
    ...overrides,
  };
  return render(<MobileActionBar {...props} />);
}

// vitest runs with globals:false, so RTL's automatic cleanup is not registered.
afterEach(cleanup);

describe('MobileActionBar', () => {
  it('keeps the toolbar to a single row: upload, size chip, download', () => {
    const { container } = renderBar();
    const bar = container.querySelector('.mobile-action-bar');

    expect(bar).toBeTruthy();
    expect(bar?.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /板子尺寸 100 × 100/ })).toBeTruthy();
  });

  it('gives upload and download the same accent fill — no secondary variant', () => {
    renderBar();

    const upload = screen.getByRole('button', { name: '上传图片' });
    const download = screen.getByRole('button', { name: '下载图片' });

    for (const button of [upload, download]) {
      expect(button.classList.contains('primary')).toBe(true);
      expect(button.classList.contains('mobile-action-button')).toBe(true);
      expect(button.classList.contains('mobile-btn-secondary')).toBe(false);
    }
  });

  it('labels the export action as 下载', () => {
    renderBar();

    expect(screen.getByRole('button', { name: '下载图片' }).textContent).toBe('下载');
  });

  it('keeps the bean summary out of the toolbar — it lives on the preview card', () => {
    const { container } = renderBar();
    const bar = container.querySelector('.mobile-action-bar');

    expect(bar?.textContent).not.toMatch(/颗|小时|未上传图片/);
    expect(container.querySelector('.mobile-gear-btn')).toBeNull();
  });

  it('enables automatic color simplification from the size chip sheet', () => {
    const onSimplifyColorsChange = vi.fn();
    const { container } = renderBar({
      simplifyColors: false,
      onSimplifyColorsChange,
    });

    fireEvent.click(screen.getByRole('button', { name: /板子尺寸/ }));

    const checkbox = within(container).getByRole('checkbox', {
      name: '自动简化颜色 · 启用后每种颜色至少 10 颗',
    });
    expect((checkbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(checkbox);

    expect(onSimplifyColorsChange).toHaveBeenCalledWith(true);
  });
});