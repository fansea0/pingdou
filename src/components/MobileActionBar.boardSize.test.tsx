import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MobileActionBar } from './MobileActionBar';

type BarProps = ComponentProps<typeof MobileActionBar>;

function renderBar(overrides: Partial<BarProps> = {}) {
  const props: BarProps = {
    gridSize: 78,
    removeBackground: false,
    simplifyColors: false,
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

describe('MobileActionBar board-size presets', () => {
  it('reaches the presets through the size chip instead of a pinned toolbar row', () => {
    renderBar();

    expect(screen.queryByRole('button', { name: '104 × 104 板子' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /板子尺寸 78 × 78/ }));

    expect(screen.getByRole('button', { name: '104 × 104 板子' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '78 × 78 板子' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('reports the chosen board size', () => {
    const onGridSizeChange = vi.fn();
    renderBar({ onGridSizeChange });

    fireEvent.click(screen.getByRole('button', { name: /板子尺寸/ }));
    fireEvent.click(screen.getByRole('button', { name: '104 × 104 板子' }));

    expect(onGridSizeChange).toHaveBeenCalledWith(104);
  });

  it('reflects a non-preset grid size in the chip label', () => {
    renderBar({ gridSize: 60 });

    const chip = screen.getByRole('button', { name: /板子尺寸 60 × 60/ });
    expect(chip.textContent).toContain('60');
    expect(chip.textContent).toContain('×60');
  });
});