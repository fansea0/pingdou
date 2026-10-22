import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SampleModePicker } from './SampleModePicker';

afterEach(cleanup);

describe('SampleModePicker', () => {
  it('renders one radio per sampling mode', () => {
    render(<SampleModePicker value="gradient" onChange={() => {}} />);

    expect(screen.getByRole('radio', { name: '渐变色' })).toBeDefined();
    expect(screen.getByRole('radio', { name: '同步相近色' })).toBeDefined();
  });

  it('marks only the current mode as checked', () => {
    render(<SampleModePicker value="similar" onChange={() => {}} />);

    expect((screen.getByRole('radio', { name: '同步相近色' }) as HTMLInputElement).checked).toBe(
      true
    );
    expect((screen.getByRole('radio', { name: '渐变色' }) as HTMLInputElement).checked).toBe(false);
  });

  it('calls onChange with the selected mode', () => {
    const onChange = vi.fn();
    render(<SampleModePicker value="gradient" onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: '同步相近色' }));

    expect(onChange).toHaveBeenCalledWith('similar');
  });

  it('shows the hint of the current mode only', () => {
    const { rerender } = render(<SampleModePicker value="gradient" onChange={() => {}} />);
    expect(screen.getByText(/原图的渐变过渡如实保留/)).toBeDefined();

    rerender(<SampleModePicker value="similar" onChange={() => {}} />);
    expect(screen.getByText(/边缘格子跟随主色/)).toBeDefined();
    expect(screen.queryByText(/原图的渐变过渡如实保留/)).toBeNull();
  });

  it('disables every option when disabled', () => {
    render(<SampleModePicker value="gradient" onChange={() => {}} disabled />);

    for (const name of ['渐变色', '同步相近色']) {
      expect((screen.getByRole('radio', { name }) as HTMLInputElement).disabled).toBe(true);
    }
  });

  it('keeps desktop and mobile instances in separate radio groups', () => {
    // 两个实例同时存在于 DOM，name 必须不同，否则会被浏览器当成同一组
    const { container } = render(
      <>
        <SampleModePicker value="gradient" onChange={() => {}} />
        <SampleModePicker value="gradient" onChange={() => {}} />
      </>
    );
    const names = Array.from(container.querySelectorAll('input[name]')).map(
      input => (input as HTMLInputElement).name
    );
    expect(new Set(names).size).toBe(2);
  });
});
