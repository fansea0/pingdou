import { useEffect, useState } from 'react';
import { fetchSiteConfig, type SiteConfig } from '@/api/settings';

export interface SiteConfigState {
  config: SiteConfig;
  loaded: boolean;
}

const FALLBACK: SiteConfig = { showProducts: true };

export function useSiteConfig(): SiteConfigState {
  const [config, setConfig] = useState<SiteConfig>(FALLBACK);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSiteConfig()
      .then(c => {
        if (cancelled) return;
        setConfig(c);
      })
      .catch(() => {
        if (cancelled) return;
        setConfig(FALLBACK);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  return { config, loaded };
}