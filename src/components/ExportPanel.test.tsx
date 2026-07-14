import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ExportPanel } from '@/components/ExportPanel';

describe('ExportPanel', () => {
  it('renders the export button labeled "导出图片"', () => {
    const { container } = render(<ExportPanel onExport={() => {}} disabled={false} />);
    const btn = container.querySelector('button.primary');
    expect(btn?.textContent).toMatch(/导出图片/);
  });

  it('shows "正在生成…" while exporting', () => {
    const { container } = render(
      <ExportPanel onExport={() => {}} disabled={false} exporting={true} />
    );
    const btn = container.querySelector('button.primary');
    expect(btn?.textContent).toMatch(/正在生成/);
  });

  it('shows "已导出 ✓" after flash', () => {
    const { container } = render(
      <ExportPanel onExport={() => {}} disabled={false} flash="done" />
    );
    const btn = container.querySelector('button.primary');
    expect(btn?.textContent).toMatch(/已导出/);
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

  it('contains a 📦 emoji in idle label and 🎨 while loading', () => {
    const idle = render(<ExportPanel onExport={() => {}} disabled={false} />);
    expect(idle.container.textContent).toMatch(/📦/);
    idle.unmount();
    const loading = render(
      <ExportPanel onExport={() => {}} disabled={false} exporting={true} />
    );
    expect(loading.container.textContent).toMatch(/🎨/);
  });
});
