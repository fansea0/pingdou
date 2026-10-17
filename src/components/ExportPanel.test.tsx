import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent, screen } from '@testing-library/react';
import { ExportPanel } from '@/components/ExportPanel';

// vitest.config.ts 是 globals:false，RTL 的自动 cleanup 不注册。少了这行，
// 上一条用例展开的菜单会留在 DOM 里，getByRole 直接命中两个。
afterEach(cleanup);

describe('ExportPanel', () => {
  it('renders the export button labeled "下载"', () => {
    const { container } = render(<ExportPanel onExport={() => {}} disabled={false} />);
    const btn = container.querySelector('button.primary');
    expect(btn?.textContent).toMatch(/下载/);
  });

  it('shows "正在生成…" while exporting', () => {
    const { container } = render(
      <ExportPanel onExport={() => {}} disabled={false} exporting={true} />
    );
    const btn = container.querySelector('button.primary');
    expect(btn?.textContent).toMatch(/正在生成/);
  });

  it('shows "已下载 ✓" after flash', () => {
    const { container } = render(
      <ExportPanel onExport={() => {}} disabled={false} flash="done" />
    );
    const btn = container.querySelector('button.primary');
    expect(btn?.textContent).toMatch(/已下载/);
  });

  it('clicking the button triggers onExport', () => {
    const onExport = vi.fn();
    const { container } = render(<ExportPanel onExport={onExport} disabled={false} />);
    fireEvent.click(container.querySelector('button.primary')!);
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('disables button when disabled prop is true', () => {
    const { container } = render(<ExportPanel onExport={() => {}} disabled={true} />);
    const btn = container.querySelector('button.primary') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('disables button while exporting', () => {
    const { container } = render(
      <ExportPanel onExport={() => {}} disabled={false} exporting={true} />
    );
    const btn = container.querySelector('button.primary') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('does not contain any emoji in the button label', () => {
    const { container } = render(<ExportPanel onExport={() => {}} disabled={false} />);
    const btn = container.querySelector('button.primary');
    const text = btn?.textContent ?? '';
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  // 「投稿和下载在一个位置、可以来回换」是 alternatives 这条契约存在的全部理由。
  // 形态退回到两个并排按钮时，下面几条会直接变红 —— 而只查「按钮还在」查不出来。
  describe('下拉菜单式的动作切换', () => {
    const alternatives = [{ label: '投稿', onSelect: vi.fn() }];

    it('默认是「下载」，旁边只有一个小箭头', () => {
      const { container } = render(
        <ExportPanel onExport={() => {}} disabled={false} alternatives={alternatives} />
      );
      expect(container.querySelector('button.primary')?.textContent).toBe('下载');
      expect(container.querySelector('.export-caret')).toBeTruthy();
      // 菜单默认不展开：菜单里才有的动作不该平铺在主按钮旁边
      expect(container.querySelector('.action-menu')).toBeNull();
    });

    it('点箭头只开菜单、不执行任何动作', () => {
      const onExport = vi.fn();
      const onSelect = vi.fn();
      const { container } = render(
        <ExportPanel onExport={onExport} disabled={false}
          alternatives={[{ label: '投稿', onSelect }]} />
      );
      fireEvent.click(container.querySelector('.export-caret')!);
      // 判别力：箭头顺带调 onSelect 时本条会红。把「换」和「做」混在一次点击里，
      // 用户永远不知道自己刚才那下到底干了什么。
      expect(onSelect).not.toHaveBeenCalled();
      expect(onExport).not.toHaveBeenCalled();
      expect(container.querySelector('.action-menu')?.textContent).toContain('投稿');
    });

    it('菜单里选中投稿后主按钮变成投稿，再选回下载', () => {
      const onExport = vi.fn();
      const onSelect = vi.fn();
      const { container } = render(
        <ExportPanel onExport={onExport} disabled={false}
          alternatives={[{ label: '投稿', onSelect }]} />
      );
      fireEvent.click(container.querySelector('.export-caret')!);
      fireEvent.click(screen.getByRole('menuitem', { name: '投稿' }));

      // 选中即关：选完还挂着菜单，用户会以为没点上
      expect(container.querySelector('.action-menu')).toBeNull();
      expect(container.querySelector('button.primary')?.textContent).toBe('投稿');

      fireEvent.click(container.querySelector('button.primary')!);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onExport).not.toHaveBeenCalled();

      fireEvent.click(container.querySelector('.export-caret')!);
      fireEvent.click(screen.getByRole('menuitem', { name: '下载' }));
      expect(container.querySelector('button.primary')?.textContent).toBe('下载');
      fireEvent.click(container.querySelector('button.primary')!);
      expect(onExport).toHaveBeenCalledTimes(1);
    });

    it('菜单项标出当前选中的那个', () => {
      const { container } = render(
        <ExportPanel onExport={() => {}} disabled={false} alternatives={alternatives} />
      );
      fireEvent.click(container.querySelector('.export-caret')!);
      expect(container.querySelector('.action-menu-item.is-active')?.textContent).toBe('下载');
    });

    it('没有其它动作时退化成单个满宽按钮，不留箭头', () => {
      const { container } = render(<ExportPanel onExport={() => {}} disabled={false} />);
      expect(container.querySelector('.export-caret')).toBeNull();
      expect(container.querySelectorAll('.export-actions button')).toHaveLength(1);
    });
  });
});
