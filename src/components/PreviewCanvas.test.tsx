import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import type { Palette, PipelineResult } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [255, 0, 0], name: '红' },
  { id: 'A02', rgb: [0, 0, 255], name: '蓝' },
];

const result: PipelineResult = {
  indices: new Uint8Array([0, 1, 1, 0]),
  gridSize: 2,
  outW: 2,
  outH: 2,
  token: 1,
  mask: new Uint8Array([0, 0, 0, 0]),
  colorSimplification: {
    beforeColorCount: 2,
    afterColorCount: 2,
    mergedColorCount: 0,
    rareColorCountBefore: 0,
    rareColorCountAfter: 0,
    minimumColorCountSatisfied: true,
  },
};

describe('PreviewCanvas (empty state)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows empty-state text when result is null', () => {
    const { container } = render(
      <PreviewCanvas
        result={null}
        palette={palette}
        cellPx={24}
        isRecomputing={false}
      />
    );
    const el = container.querySelector('.empty-state');
    expect(el).toBeTruthy();
    expect(el?.textContent).toMatch(/上传图片以查看预览/);
  });

  it('does not render <canvas> when result is null', () => {
    const { container } = render(
      <PreviewCanvas
        result={null}
        palette={palette}
        cellPx={24}
        isRecomputing={false}
      />
    );
    expect(container.querySelector('canvas.preview')).toBeNull();
  });

  it('does not render empty-state when result is provided', () => {
    const { container } = render(
      <PreviewCanvas
        result={result}
        palette={palette}
        cellPx={24}
        isRecomputing={false}
      />
    );
    expect(container.querySelector('.empty-state')).toBeNull();
    expect(container.querySelector('canvas.preview')).toBeTruthy();
  });
});
