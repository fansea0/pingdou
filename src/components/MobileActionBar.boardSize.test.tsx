import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileActionBar } from './MobileActionBar';

describe('MobileActionBar board-size shortcuts', () => {
  it('selects a board size and shows the supplied estimate', () => {
    const onGridSizeChange = vi.fn();
    render(
      <MobileActionBar
        gridSize={78}
        beanCount={1000}
        estimateLabel="约 4.0 小时"
        removeBackground={false}
        onGridSizeChange={onGridSizeChange}
        onRemoveBackgroundChange={() => {}}
        onLoad={() => {}}
        onExport={() => {}}
        canExport
        exporting={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '104 × 104 板子' }));

    expect(onGridSizeChange).toHaveBeenCalledWith(104);
    expect(screen.getByText(/约 4\.0 小时/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '78 × 78 板子' }).getAttribute('aria-pressed')).toBe('true');
  });
});
