import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ColorLegend } from '@/components/ColorLegend';
import type { LegendRow } from '@/pipeline/legend';

const legend: LegendRow[] = [
  { id: 'A01', name: '红', rgb: [255, 0, 0], count: 3, index: 0 },
  { id: 'A02', name: '绿', rgb: [0, 255, 0], count: 1, index: 1 },
];

describe('ColorLegend', () => {
  it('renders one row per legend entry', () => {
    const { container } = render(
      <ColorLegend legend={legend} highlightedIndex={null} onHoverIndex={() => {}} />
    );
    const rows = container.querySelectorAll('.legend-row');
    expect(rows).toHaveLength(2);
  });

  it('shows id, name, count for each row', () => {
    const { container } = render(
      <ColorLegend legend={legend} highlightedIndex={null} onHoverIndex={() => {}} />
    );
    expect(container.textContent).toContain('A01');
    expect(container.textContent).toContain('红');
    expect(container.textContent).toContain('3');
  });

  it('calls onHoverIndex on mouseEnter and null on mouseLeave', () => {
    const onHover = vi.fn();
    const { container } = render(
      <ColorLegend legend={legend} highlightedIndex={null} onHoverIndex={onHover} />
    );
    const firstRow = container.querySelectorAll('.legend-row')[0];
    fireEvent.mouseEnter(firstRow);
    expect(onHover).toHaveBeenCalledWith(0);
    fireEvent.mouseLeave(firstRow);
    expect(onHover).toHaveBeenCalledWith(null);
  });

  it('renders empty state when legend is empty', () => {
    const { container } = render(
      <ColorLegend legend={[]} highlightedIndex={null} onHoverIndex={() => {}} />
    );
    expect(container.querySelector('.legend-empty')?.textContent).toMatch(/未匹配/);
  });
});
