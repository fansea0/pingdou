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
    tightCrop: true,
    onTightCropChange: () => {},
    colorBudget: 'off' as const,
    onColorBudgetChange: () => {},
    watermark: true,
    onWatermarkChange: () => {},
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

  it('carries the watermark toggle in the sheet, on by default, right after the color one', () => {
    const onWatermarkChange = vi.fn();
    const { container } = renderBar({ watermark: true, onWatermarkChange });

    fireEvent.click(screen.getByRole('button', { name: /板子尺寸/ }));

    const rows = Array.from(container.querySelectorAll('label.mobile-toggle-row')).map(
      l => l.textContent ?? ''
    );
    expect(rows[rows.length - 1]).toMatch(/添加水印/);
    expect(rows.indexOf(rows.find(t => /自动简化颜色/.test(t))!)).toBeLessThan(
      rows.length - 1,
    );

    const checkbox = within(container).getByRole('checkbox', {
      name: '添加水印 · 导出图页眉右侧的拼豆.xyz 标识',
    });
    expect((checkbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(checkbox);

    expect(onWatermarkChange).toHaveBeenCalledWith(false);
  });
});
describe('投稿入口（下拉菜单）', () => {
  const alternatives = [{ label: '投稿', onSelect: vi.fn() }];

  it('默认是下载，旁边只有一个小箭头', () => {
    renderBar({ alternatives });
    expect(screen.getByRole('button', { name: '下载图片' }).textContent).toContain('下载');
    expect(screen.getByRole('button', { name: '更多操作' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('点箭头只开菜单、不触发任何动作', () => {
    const onExport = vi.fn();
    renderBar({ onExport, alternatives });
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    // 判别力：箭头顺带调 onSelect 时本条会红。把「换」和「做」混在一次点击里，
    // 用户永远不知道自己刚才那下到底干了什么。
    expect(alternatives[0].onSelect).not.toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();
  });

  it('菜单里选投稿后主按钮变投稿，选回下载再点主按钮才下载', () => {
    const onExport = vi.fn();
    const onSelect = vi.fn();
    renderBar({ onExport, alternatives: [{ label: '投稿', onSelect }] });

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '投稿' }));
    const submit = screen.getByRole('button', { name: '投稿到作品库' });
    expect(submit.textContent).toContain('投稿');
    fireEvent.click(submit);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '下载' }));
    fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('没传 alternatives 时不留箭头', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
  });
});
