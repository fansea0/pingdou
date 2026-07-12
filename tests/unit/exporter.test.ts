import { describe, it, expect, beforeEach, vi } from 'vitest';
import { triggerDownload } from '@/pipeline/exporter';

beforeEach(() => {
  (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
  (URL as any).revokeObjectURL = vi.fn();
});

describe('triggerDownload', () => {
  it('creates anchor with download attribute and clicks it', () => {
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    const blob = new Blob(['x'], { type: 'text/plain' });
    triggerDownload(blob, 'hello.txt');

    expect(createSpy).toHaveBeenCalledWith('a');
    expect(clickSpy).toHaveBeenCalled();

    createSpy.mockRestore();
  });
});
