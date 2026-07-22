import { describe, it, expect, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ColorLegend } from '@/components/ColorLegend';
import type { LegendRow } from '@/pipeline/legend';
import type { ColorSimplificationStats } from '@/types';

const legend: LegendRow[] = [
  { id: 'A01', name: '红', rgb: [255, 0, 0], count: 3, index: 0 },
  { id: 'A02', name: '绿', rgb: [0, 255, 0], count: 1, index: 1 },
];

const unchangedColors: ColorSimplificationStats = {
  beforeColorCount: 0,
  afterColorCount: 0,
  mergedColorCount: 0,
};

beforeAll(() => {
  // jsdom default: no matchMedia. Stub it for mobile detection logic.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

describe('ColorLegend', () => {
  it('renders one row per legend entry', () => {
    const { container } = render(<ColorLegend legend={legend} colorSimplification={unchangedColors} />);
    const rows = container.querySelectorAll('.legend-row');
    expect(rows).toHaveLength(2);
  });

  it('shows id, name, count for each row', () => {
    const { container } = render(<ColorLegend legend={legend} colorSimplification={unchangedColors} />);
    expect(container.textContent).toContain('A01');
    expect(container.textContent).toContain('红');
    expect(container.textContent).toContain('3');
  });

  it('renders empty state when legend is empty', () => {
    const { container } = render(<ColorLegend legend={[]} colorSimplification={unchangedColors} />);
    const el = container.querySelector('.empty-state');
    expect(el).toBeTruthy();
    expect(el?.textContent).toMatch(/上传图片后查看色号对照表/);
  });

  it('does not show empty-state when legend has items', () => {
    const { container } = render(<ColorLegend legend={legend} colorSimplification={unchangedColors} />);
    expect(container.querySelector('.empty-state')).toBeNull();
    expect(container.querySelector('.legend-row')).toBeTruthy();
  });

  it('does not have any highlighted class on rows', () => {
    const { container } = render(<ColorLegend legend={legend} colorSimplification={unchangedColors} />);
    const firstRow = container.querySelector('.legend-row')!;
    expect(firstRow.className).not.toMatch(/highlighted/);
  });

  it('starts in open state on desktop', () => {
    const { container } = render(<ColorLegend legend={legend} colorSimplification={unchangedColors} />);
    expect(container.querySelector('.legend-wrap')?.className).toMatch(/is-open/);
    expect(container.querySelector('.legend-toggle')).toBeTruthy();
  });

  it('clicking the toggle collapses the table', () => {
    const { container } = render(<ColorLegend legend={legend} colorSimplification={unchangedColors} />);
    const head = container.querySelector('.legend-head') as HTMLElement;
    fireEvent.click(head);
    expect(container.querySelector('.legend-wrap')?.className).toMatch(/is-closed/);
    expect(container.querySelector('.legend-row')).toBeNull();
  });

  it('shows before and after counts only when colors were merged', () => {
    const simplifiedColors: ColorSimplificationStats = {
      beforeColorCount: 12,
      afterColorCount: 8,
      mergedColorCount: 4,
    };
    const { container, rerender } = render(
      <ColorLegend legend={legend} colorSimplification={simplifiedColors} />,
    );

    expect(container.textContent).toContain('已从 12 种简化为 8 种');

    rerender(<ColorLegend legend={legend} colorSimplification={unchangedColors} />);

    expect(container.textContent).not.toContain('已从');
    expect(container.textContent).toContain('当前图像 · 2 种颜色');
  });
});
