import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useZoomPan, ZOOM_LEVELS } from '@/hooks/useZoomPan';

describe('useZoomPan', () => {
  it('zoomIn: moves up through ZOOM_LEVELS', () => {
    const { result } = renderHook(() => useZoomPan());
    expect(result.current.zoom).toBe(1);
    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(ZOOM_LEVELS[1]);
    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(ZOOM_LEVELS[2]);
  });

  it('zoomOut: moves down through ZOOM_LEVELS', () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.zoomIn());
    act(() => result.current.zoomIn());
    act(() => result.current.zoomIn());
    act(() => result.current.zoomOut());
    expect(result.current.zoom).toBe(ZOOM_LEVELS[2]);
  });

  it('zoomOut: clamped at 1', () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());
    expect(result.current.zoom).toBe(1);
  });

  it('reset: returns to (1, 0, 0)', () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.zoomIn());
    act(() => result.current.setPan(50, 30));
    expect(result.current.zoom).toBeGreaterThan(1);
    expect(result.current.panX).toBe(50);
    act(() => result.current.reset());
    expect(result.current.zoom).toBe(1);
    expect(result.current.panX).toBe(0);
    expect(result.current.panY).toBe(0);
  });

  it('setZoom: clamps to [1, 8]', () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.setZoom(0.5));
    expect(result.current.zoom).toBe(1);
    act(() => result.current.setZoom(99));
    expect(result.current.zoom).toBe(8);
    act(() => result.current.setZoom(2));
    expect(result.current.zoom).toBe(2);
  });
});