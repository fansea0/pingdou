import { useEffect, useRef } from 'react';

export function useThrottle<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): T {
  const fnRef = useRef(fn);
  const lastCall = useRef(0);
  const timer = useRef<number | null>(null);
  const pendingArgs = useRef<Parameters<T> | null>(null);

  fnRef.current = fn;

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    pendingArgs.current = null;
  }, []);

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = delay - (now - lastCall.current);
    pendingArgs.current = args;
    if (remaining <= 0) {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      pendingArgs.current = null;
      lastCall.current = now;
      fnRef.current(...args);
    } else if (timer.current === null) {
      timer.current = window.setTimeout(() => {
        const latestArgs = pendingArgs.current;
        pendingArgs.current = null;
        lastCall.current = Date.now();
        timer.current = null;
        if (latestArgs) fnRef.current(...latestArgs);
      }, remaining);
    }
  }) as T;
}
