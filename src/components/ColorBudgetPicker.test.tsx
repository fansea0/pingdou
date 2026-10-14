import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ColorBudgetPicker } from './ColorBudgetPicker';

afterEach(cleanup);

const OPTIONS = [
  { value: 'off', label: '不限' },
  { value: 'relaxed', label: '12 色' },
  { value: 'standard', label: '20 色' },
  { value: 'tight', label: '32 色' },
] as const;

describe('ColorBudgetPicker', () => {
  it('renders one radio per budget level', () => {
    render(<ColorBudgetPicker value="off" onChange={() => {}} />);
    for (const option of OPTIONS) {
      expect(screen.getByRole('radio', { name: option.label })).toBeDefined();
    }
  });

  it('marks only the current value as checked', () => {
    render(<ColorBudgetPicker value="standard" onChange={() => {}} />);
    expect((screen.getByRole('radio', { name: '20 色' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: '不限' }) as HTMLInputElement).checked).toBe(false);
  });

  it('calls onChange with the selected level', () => {
    const onChange = vi.fn();
    render(<ColorBudgetPicker value="off" onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: '12 色' }));

    expect(onChange).toHaveBeenCalledWith('relaxed');
  });

  it('shows the hint for the current level only', () => {
    const { rerender } = render(<ColorBudgetPicker value="off" onChange={() => {}} />);
    expect(screen.getByText('保持原图用色数量不变')).toBeDefined();

    rerender(<ColorBudgetPicker value="relaxed" onChange={() => {}} />);
    expect(screen.getByText('色数最少，备料最省，层次损失明显')).toBeDefined();
  });

  it('disables every option when disabled', () => {
    render(<ColorBudgetPicker value="off" onChange={() => {}} disabled />);
    for (const option of OPTIONS) {
      expect((screen.getByRole('radio', { name: option.label }) as HTMLInputElement).disabled).toBe(
        true
      );
    }
  });

  it('keeps desktop and mobile instances in separate radio groups', () => {
    // 两个实例同时存在于 DOM，name 必须不同，否则会被浏览器当成同一组
    const { container } = render(
      <>
        <ColorBudgetPicker value="off" onChange={() => {}} />
        <ColorBudgetPicker value="off" onChange={() => {}} />
      </>
    );
    const names = Array.from(container.querySelectorAll('input[name]')).map(
      input => (input as HTMLInputElement).name
    );
    expect(new Set(names).size).toBe(2);
  });
});