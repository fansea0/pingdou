import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ExportPanel } from '@/components/ExportPanel';

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

  // 「投稿和下载在一个位置、可以来回切」是这条 secondary 契约存在的全部理由。
  // 形态退回到两个并排按钮时，下面三条会直接变红 —— 而只查「按钮还在」查不出来。
  describe('可切换的次级动作', () => {
    const secondary = { label: '投稿', onSelect: vi.fn() };

    it('默认显示「下载」，切换位显示要切过去的「投稿」', () => {
      const { container } = render(
        <ExportPanel onExport={() => {}} disabled={false} secondary={secondary} />
      );
      expect(container.querySelector('button.primary')?.textContent).toBe('下载');
      expect(container.querySelector('.export-swap')?.textContent).toBe('投稿');
    });

    it('点切换位只改状态、不执行任何动作', () => {
      const onExport = vi.fn();
      const onSelect = vi.fn();
      const { container } = render(
        <ExportPanel
          onExport={onExport}
          disabled={false}
          secondary={{ label: '投稿', onSelect }}
        />
      );
      fireEvent.click(container.querySelector('.export-swap')!);
      // 判别力：把切换位也接上 onSelect 时，本条会红。切和做混在一次点击里，
      // 用户永远不知道自己刚才那下到底干了什么。
      expect(onSelect).not.toHaveBeenCalled();
      expect(onExport).not.toHaveBeenCalled();
      expect(container.querySelector('button.primary')?.textContent).toBe('投稿');
    });

    it('切到投稿后点主按钮走投稿，再切回来点主按钮走下载', () => {
      const onExport = vi.fn();
      const onSelect = vi.fn();
      const { container } = render(
        <ExportPanel
          onExport={onExport}
          disabled={false}
          secondary={{ label: '投稿', onSelect }}
        />
      );
      const swap = () => fireEvent.click(container.querySelector('.export-swap')!);
      const main = () => fireEvent.click(container.querySelector('button.primary')!);

      swap();
      main();
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onExport).not.toHaveBeenCalled();

      swap();
      expect(container.querySelector('button.primary')?.textContent).toBe('下载');
      main();
      expect(onExport).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('切换位标出当前所处的状态', () => {
      const { container } = render(
        <ExportPanel onExport={() => {}} disabled={false} secondary={secondary} />
      );
      const swap = container.querySelector('.export-swap')!;
      expect(swap.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(swap);
      expect(container.querySelector('.export-swap')!.getAttribute('aria-pressed')).toBe('true');
    });

    it('没有次级动作时退化成单个满宽按钮，不留切换位', () => {
      const { container } = render(<ExportPanel onExport={() => {}} disabled={false} />);
      expect(container.querySelector('.export-swap')).toBeNull();
      expect(container.querySelectorAll('.export-actions button')).toHaveLength(1);
    });
  });
});
