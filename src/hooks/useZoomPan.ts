import { useCallback, useState } from 'react';

export const ZOOM_LEVELS: readonly number[] = [1, 1.5, 2, 3, 4, 6, 8];
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

function clampZoom(z: number): number {
  if (Number.isNaN(z)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function useZoomPan() {
  const [zoom, setZoomState] = useState(MIN_ZOOM);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const setZoom = useCallback((z: number) => {
    setZoomState(clampZoom(z));
  }, []);

  const setPan = useCallback((x: number, y: number) => {
    setPanX(x);
    setPanY(y);
  }, []);

  const zoomIn = useCallback(() => {
    setZoomState(prev => {
      const next = ZOOM_LEVELS.find(z => z > prev);
      return next ?? MAX_ZOOM;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState(prev => {
      const next = [...ZOOM_LEVELS].reverse().find(z => z < prev);
      return next ?? MIN_ZOOM;
    });
  }, []);

  const reset = useCallback(() => {
    setZoomState(MIN_ZOOM);
    setPanX(0);
    setPanY(0);
  }, []);

  return { zoom, panX, panY, setZoom, setPan, zoomIn, zoomOut, reset };
}