import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ColorLegend } from '@/components/ColorLegend';
import type { LegendRow } from '@/pipeline/legend';

const legend: LegendRow[] = [
  { id: 'A01', name: '红', rgb: [255, 0, 0], count: 3, index: 0 },
  { id: 'A02', name: '绿', rgb: [0, 255, 0], count: 1, index: 1 },
];

describe('ColorLegend', () => {
  it('renders one row per legend entry', () => {
    const { container } = render(<ColorLegend legend={legend} />);
    const rows = container.querySelectorAll('.legend-row');
    expect(rows).toHaveLength(2);
  });

  it('shows id, name, count for each row', () => {
    const { container } = render(<ColorLegend legend={legend} />);
    expect(container.textContent).toContain('A01');
    expect(container.textContent).toContain('红');
    expect(container.textContent).toContain('3');
  });

  it('renders empty state when legend is empty', () => {
    const { container } = render(<ColorLegend legend={[]} />);
    expect(container.querySelector('.legend-empty')?.textContent).toMatch(/未匹配/);
  });

  it('does not have any highlighted class on rows', () => {
    const { container } = render(<ColorLegend legend={legend} />);
    const firstRow = container.querySelector('.legend-row')!;
    expect(firstRow.className).not.toMatch(/highlighted/);
  });
});