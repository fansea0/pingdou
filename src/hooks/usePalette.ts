import { useEffect, useState } from 'react';
import { loadPalette } from '@/palette/schema';
import { cachePalette, readCachedPalette } from '@/data/palette';
import type { Palette } from '@/types';

const VERSION = 'v1';

export function usePalette(): { palette: Palette | null; error: Error | null } {
  const [palette, setPalette] = useState<Palette | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await readCachedPalette(VERSION);
        if (cached) {
          if (!cancelled) setPalette(cached.palette);
          return;
        }
        const fresh = await loadPalette();
        await cachePalette(fresh, VERSION);
        if (!cancelled) setPalette(fresh);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { palette, error };
}
