import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSampleImage } from '@/hooks/useSampleImage';

describe('useSampleImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts in loading state', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSampleImage());
    expect(result.current.loading).toBe(true);
    expect(result.current.imageData).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('populates imageData on successful fetch', async () => {
    const fakeBitmap = { width: 4, height: 4 } as unknown as ImageBitmap;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'image/png' }),
    } as unknown as Response);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap));

    const stubCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 })),
    };
    const stubCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => stubCtx),
    };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return stubCanvas as unknown as HTMLCanvasElement;
      return origCreate(tag);
    });

    const { result } = renderHook(() => useSampleImage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.imageData).toBeTruthy();
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      blob: async () => new Blob([], { type: 'image/png' }),
    } as unknown as Response);

    const { result } = renderHook(() => useSampleImage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.imageData).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });
});