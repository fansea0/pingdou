import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { ParamPanel } from '@/components/ParamPanel';

const baseProps = () => ({
  gridSize: 100,
  beanCount: 10000,
  totalCells: 10000,
  removeBackground: false,
  simplifyColors: false,
  onGridSizeChange: () => {},
  onRemoveBackgroundChange: () => {},
  onSimplifyColorsChange: () => {},
});

describe('ParamPanel', () => {
  it('renders 8 scatter preset buttons for grid sizes', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    const presets = container.querySelectorAll('.grid-preset');
    expect(presets).toHaveLength(8);
  });

  it('displays bean count formatted with locale string', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    expect(container.textContent).toMatch(/10,000/);
  });

  it('displays "—" when bean count is 0', () => {
    const { container } = render(<ParamPanel {...baseProps()} beanCount={0} />);
    const el = container.querySelector('.bean-count');
    expect(el?.textContent).toMatch(/—/);
  });

  it('clicking a scatter button triggers onGridSizeChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel {...baseProps()} onGridSizeChange={onChange} />
    );
    const presets = container.querySelectorAll('.grid-preset');
    fireEvent.click(presets[3]);
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('marks main presets (20-100) with .main class', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    const mainPresets = container.querySelectorAll('.grid-preset.main');
    expect(mainPresets).toHaveLength(5);
  });

  it('marks current gridSize preset with .active class', () => {
    const { container } = render(
      <ParamPanel {...baseProps()} gridSize={50} beanCount={2500} />
    );
    const activeDots = container.querySelectorAll('.grid-preset.active');
    expect(activeDots).toHaveLength(1);
    const valueBadge = container.querySelector('.grid-progress-value');
    expect(valueBadge?.textContent).toBe('50');
  });

  it('exposes distinct background removal and color simplification options (no dither)', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect(within(container).getByRole('checkbox', { name: /自动去背景/ })).toBeTruthy();
    expect(within(container).getByRole('checkbox', { name: /自动简化颜色/ })).toBeTruthy();
  });

  it('renders automatic color simplification off by default with its hint', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    const checkbox = within(container).getByRole('checkbox', { name: /自动简化颜色/ });

    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(checkbox.closest('label')?.querySelector('.param-toggle-hint')?.textContent).toBe(
      ' · 启用后每种颜色至少 10 颗',
    );
  });

  it('toggling automatic color simplification fires onSimplifyColorsChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel {...baseProps()} onSimplifyColorsChange={onChange} />
    );

    fireEvent.click(within(container).getByRole('checkbox', { name: /自动简化颜色/ }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggling removeBackground fires onRemoveBackgroundChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel {...baseProps()} onRemoveBackgroundChange={onChange} />
    );
    const checkbox = container.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('shows removed count annotation when bg removal is on', () => {
    const { container } = render(
      <ParamPanel
        {...baseProps()}
        removeBackground={true}
        beanCount={7000}
        totalCells={10000}
      />
    );
    expect(container.textContent).toMatch(/已去\s*3,000\s*颗背景/);
  });

  it('hides removed count annotation when bg removal is off', () => {
    const { container } = render(
      <ParamPanel
        {...baseProps()}
        removeBackground={false}
        beanCount={7000}
        totalCells={10000}
      />
    );
    expect(container.textContent).not.toMatch(/已去/);
  });

  it('offers board-size shortcuts that select the matching grid size', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel {...baseProps()} onGridSizeChange={onChange} estimateLabel="约 4.0 小时" />
    );
    const shortcuts = within(container.querySelector('[aria-label="快捷板子尺寸"]')!);

    fireEvent.click(shortcuts.getByRole('button', { name: '78 × 78 板子' }));

    expect(onChange).toHaveBeenCalledWith(78);
  });

  it('highlights the selected board size and renders its estimate', () => {
    const { container } = render(
      <ParamPanel {...baseProps()} gridSize={52} estimateLabel="约 4.0 小时" />
    );
    const shortcuts = within(container.querySelector('[aria-label="快捷板子尺寸"]')!);

    expect(shortcuts.getByRole('button', { name: '52 × 52 板子' }).classList.contains('active')).toBe(true);
    expect(within(container).getByText(/约 4\.0 小时/)).toBeTruthy();
  });
});
