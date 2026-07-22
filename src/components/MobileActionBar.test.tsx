import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MobileActionBar } from './MobileActionBar';

describe('MobileActionBar', () => {
  it('marks upload and export buttons for centered mobile alignment', () => {
    render(
      <MobileActionBar
        gridSize={100}
        beanCount={0}
        removeBackground={false}
        simplifyColors={false}
        onGridSizeChange={() => {}}
        onRemoveBackgroundChange={() => {}}
        onSimplifyColorsChange={() => {}}
        onLoad={() => {}}
        onExport={() => {}}
        canExport
        exporting={false}
      />,
    );

    const uploadButton = screen.getByRole('button', { name: '上传图片' });
    expect(uploadButton.textContent).toBe('上传图片');
    expect(uploadButton.classList.contains(
      'mobile-action-button',
    )).toBe(true);
    expect(screen.getByRole('button', { name: '导出图片' }).classList.contains(
      'mobile-action-button',
    )).toBe(true);
  });

  it('enables automatic color simplification from the mobile control', () => {
    const onSimplifyColorsChange = vi.fn();
    const { container } = render(
      <MobileActionBar
        gridSize={100}
        beanCount={0}
        removeBackground={false}
        simplifyColors={false}
        onGridSizeChange={() => {}}
        onRemoveBackgroundChange={() => {}}
        onSimplifyColorsChange={onSimplifyColorsChange}
        onLoad={() => {}}
        onExport={() => {}}
        canExport
        exporting={false}
      />,
    );

    const checkbox = within(container).getByRole('checkbox', {
      name: '自动简化颜色 · 合并少于 10 颗的相近色',
    });
    expect((checkbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(checkbox);

    expect(onSimplifyColorsChange).toHaveBeenCalledWith(true);
  });
});
