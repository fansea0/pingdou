import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ExportPanel } from '@/components/ExportPanel';

describe('ExportPanel', () => {
  it('renders single export button', () => {
    const { container } = render(<ExportPanel onExport={() => {}} disabled={false} />);
    const btn = container.querySelector('button.primary');
    expect(btn?.textContent).toMatch(/导出 1 张图/);
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
});