import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ParamPanel } from '@/components/ParamPanel';

describe('ParamPanel', () => {
  it('renders 8 scatter preset buttons for grid sizes', () => {
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={10000}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const presets = container.querySelectorAll('.grid-preset');
    expect(presets).toHaveLength(8);
  });

  it('displays bean count formatted with locale string', () => {
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={10000}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    expect(container.textContent).toMatch(/10,000/);
  });

  it('displays "—" when bean count is 0', () => {
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={0}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const el = container.querySelector('.bean-count');
    expect(el?.textContent).toMatch(/—/);
  });

  it('clicking a scatter button triggers onGridSizeChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={10000}
        onGridSizeChange={onChange}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const presets = container.querySelectorAll('.grid-preset');
    fireEvent.click(presets[3]);
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('marks main presets (20-100) with .main class', () => {
    const { container } = render(
      <ParamPanel
        gridSize={100}
        beanCount={10000}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const mainPresets = container.querySelectorAll('.grid-preset.main');
    expect(mainPresets).toHaveLength(5);
  });

  it('marks current gridSize preset with .active class', () => {
    const { container } = render(
      <ParamPanel
        gridSize={50}
        beanCount={2500}
        onGridSizeChange={() => {}}
        enableDither={false}
        onDitherChange={() => {}}
      />
    );
    const active = container.querySelectorAll('.grid-preset.active');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe('50');
  });
});
