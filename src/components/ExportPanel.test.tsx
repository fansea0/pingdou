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

  // 「投稿和下载在同一个位置」是这条插槽存在的全部理由。位置一旦被拆回两块，
  // 这组断言会直接变红 —— 而 DOM 里只查「按钮还在」是查不出来的。
  it('把次级动作与下载按钮放进同一个并排容器', () => {
    const { container } = render(
      <ExportPanel onExport={() => {}} disabled={false}>
        <button type="button">投稿到作品库</button>
      </ExportPanel>
    );
    const row = container.querySelector('.export-actions');
    expect(row).not.toBeNull();
    expect(row?.querySelector('button.primary')?.textContent).toMatch(/下载/);
    expect(row?.textContent).toMatch(/投稿到作品库/);
  });

  it('次级动作在下载按钮之后 —— 主次顺序不能反', () => {
    const { container } = render(
      <ExportPanel onExport={() => {}} disabled={false}>
        <button type="button">投稿到作品库</button>
      </ExportPanel>
    );
    const buttons = Array.from(container.querySelectorAll('.export-actions button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['下载', '投稿到作品库']);
  });

  it('没有次级动作时导出面板照常渲染（插槽是可选的）', () => {
    const { container } = render(<ExportPanel onExport={() => {}} disabled={false} />);
    expect(container.querySelectorAll('.export-actions button')).toHaveLength(1);
    expect(container.querySelector('.hint')?.textContent).toMatch(/32px/);
  });
});
