import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSiteConfig } from '@/hooks/useSiteConfig';

describe('useSiteConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with fallback config and loaded=false', () => {
    const { result } = renderHook(() => useSiteConfig());
    expect(result.current.config).toEqual({ showProducts: true });
    expect(result.current.loaded).toBe(false);
  });

  it('updates config from server response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ showProducts: false }),
    } as Response);

    const { result } = renderHook(() => useSiteConfig());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.config.showProducts).toBe(false);
  });

  it('falls back to safe defaults on fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('net'));
    const { result } = renderHook(() => useSiteConfig());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.config).toEqual({ showProducts: true });
  });

  it('does not setState after unmount', async () => {
    let resolveFetch: (v: any) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise<any>(r => { resolveFetch = r; }));
    const { unmount } = renderHook(() => useSiteConfig());
    unmount();
    resolveFetch({ ok: true, json: async () => ({ showProducts: false }) });
    await new Promise(r => setTimeout(r, 30));
  });
});