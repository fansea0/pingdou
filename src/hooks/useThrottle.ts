import { useEffect, useRef } from 'react';

export function useThrottle<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): T {
  const lastCall = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = delay - (now - lastCall.current);
    if (remaining <= 0) {
      lastCall.current = now;
      fn(...args);
    } else if (timer.current === null) {
      timer.current = window.setTimeout(() => {
        lastCall.current = Date.now();
        timer.current = null;
        fn(...args);
      }, remaining);
    }
  }) as T;
}
